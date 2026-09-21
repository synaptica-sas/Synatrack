import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, authorize } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";
import { puedeVerTarifas } from "../../utils/consultant-scope.js";
import {
  computeAvailability,
  calculateCommittedHours,
  calculateCapacityHours,
  addDays,
  getAvailabilityStatus,
  type AvailabilityStatus,
} from "../../utils/capacity.js";

const periodQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  country: z.string().trim().optional(),
  skill: z.string().trim().optional(),
  seniority: z.string().trim().optional(),
  minAvailableHours: z.coerce.number().optional(),
  status: z.enum(["FREE", "PARTIAL", "FULL", "OVERLOADED"]).optional(),
});

const withinSchema = z.object({ within: z.coerce.number().int().positive().default(30) });
const consultantIdSchema = z.object({ consultantId: z.string().min(1) });

/** Pro-rate `total` hours by calendar-day overlap between forecast range and the query period */
function proRateHours(
  total: number,
  forecastRange: { from: Date; to: Date },
  queryPeriod: { from: Date; to: Date },
): number {
  const oStart = forecastRange.from > queryPeriod.from ? forecastRange.from : queryPeriod.from;
  const oEnd   = forecastRange.to   < queryPeriod.to   ? forecastRange.to   : queryPeriod.to;
  if (oEnd < oStart) return 0;
  const overlapMs = oEnd.getTime() - oStart.getTime() + 86_400_000; // +1 day inclusive
  const totalMs   = forecastRange.to.getTime() - forecastRange.from.getTime() + 86_400_000;
  return totalMs > 0 ? total * (overlapMs / totalMs) : 0;
}

function defaultPeriod(): { from: Date; to: Date } {
  const from = new Date();
  from.setDate(1);
  from.setHours(0, 0, 0, 0);
  const to = new Date(from.getFullYear(), from.getMonth() + 1, 0);
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

async function buildCapacityRows(
  period: { from: Date; to: Date },
  filters: { country?: string; skill?: string; seniority?: string },
) {
  // Pre-cargar todos los CustomHoliday que coincidan temporalmente con el periodo consultado
  const customHolidays = await prisma.customHoliday.findMany({
    where: {
      date: {
        gte: period.from,
        lte: period.to,
      },
    },
  });

  const consultants = await prisma.consultant.findMany({
    where: {
      active: true,
      ...(filters.country ? { country: { equals: filters.country, mode: "insensitive" } } : {}),
      ...(filters.seniority ? { seniority: { equals: filters.seniority, mode: "insensitive" } } : {}),
      ...(filters.skill ? { skills: { has: filters.skill } } : {}),
    },
    include: {
      capacityConfig: true,
      blocks: {
        where: {
          startDate: { lte: period.to },
          endDate: { gte: period.from },
        },
      },
      assignments: {
        where: {
          status: { in: ["ACTIVE", "PARTIAL", "PLANNED"] },
          startDate: { lte: period.to },
          endDate: { gte: period.from },
        },
        include: { project: { select: { id: true, name: true } } },
      },
      forecasts: {
        include: { project: { select: { id: true, name: true } } },
      },
    },
  });

  return consultants.map((c) => {
    // Filtrar feriados corporativos ("All") y específicos de su país
    const cry = c.country || "Default";
    const consultantCustomHolidays = customHolidays.filter(
      (h) => h.country === "All" || h.country.toLowerCase() === cry.toLowerCase()
    );

    const customHolidaySet = new Set(
      consultantCustomHolidays.map((h) => {
        const y = h.date.getUTCFullYear();
        const m = String(h.date.getUTCMonth() + 1).padStart(2, "0");
        const d = String(h.date.getUTCDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
      })
    );

    const { consultantId: _cid, ...availability } = computeAvailability(
      c.id, c.assignments, c.blocks, c.capacityConfig, period, c.country, customHolidaySet
    );

    // ── Forecast contribution ──────────────────────────────────────────────
    let forecastHours = 0;
    const forecastEntries: {
      assignmentId: string;
      projectId: string;
      projectName: string;
      startDate: Date;
      endDate: Date;
      allocationMode: "HOURS";
      allocationPct: null;
      hoursPerPeriod: number;
      status: string;
    }[] = [];

    for (const f of c.forecasts) {
      if (!f.startDate || !f.endDate) continue;
      const range = {
        from: new Date(f.startDate + "T00:00:00Z"),
        to:   new Date(f.endDate   + "T23:59:59Z"),
      };
      const prorated = proRateHours(Number(f.hoursProjected), range, period);
      if (prorated <= 0) continue;
      forecastHours += prorated;
      forecastEntries.push({
        assignmentId: `forecast-${f.id}`,
        projectId: f.projectId,
        projectName: (f as unknown as { project?: { name: string } }).project?.name ?? f.projectId,
        startDate: range.from,
        endDate:   range.to,
        allocationMode: "HOURS",
        allocationPct: null,
        hoursPerPeriod: Math.round(Number(f.hoursProjected) * 10) / 10,
        status: "FORECAST",
      });
    }

    // ── Merge forecast into availability ───────────────────────────────────
    const totalCommitted  = Math.round((availability.committedHours + forecastHours) * 10) / 10;
    const availableHours  = Math.max(Math.round((availability.capacityHours - totalCommitted) * 10) / 10, 0);
    const utilizationPct  = availability.capacityHours > 0
      ? Math.round((totalCommitted / availability.capacityHours) * 1000) / 10
      : 0;
    const newStatus = getAvailabilityStatus(utilizationPct);

    // nextAvailableDate: use real assignment date when available, fall back to latest forecast end
    const nextAvailableDate = newStatus !== "FREE"
      ? (availability.nextAvailableDate
          ?? (forecastEntries.length > 0
              ? addDays(
                  forecastEntries.reduce(
                    (latest, fe) => (fe.endDate > latest ? fe.endDate : latest),
                    forecastEntries[0].endDate,
                  ),
                  1,
                )
              : null))
      : null;

    return {
      consultantId: c.id,
      fullName: c.fullName,
      role: c.role,
      seniority: c.seniority,
      country: c.country,
      skills: c.skills,
      capacityHours: availability.capacityHours,
      committedHours: totalCommitted,
      availableHours,
      utilizationPct,
      availabilityStatus: newStatus,
      nextAvailableDate,
      activeAssignments: [
        ...c.assignments.map((a) => ({
          assignmentId: a.id,
          projectId: a.projectId,
          projectName: (a as { project?: { name: string } }).project?.name ?? "",
          startDate: a.startDate,
          endDate: a.endDate,
          allocationMode: a.allocationMode,
          allocationPct: a.allocationPct ? Number(a.allocationPct) : null,
          hoursPerPeriod: a.hoursPerPeriod ? Number(a.hoursPerPeriod) : null,
          status: a.status,
        })),
        ...forecastEntries,
      ],
    };
  });
}

export async function capacityRoutes(app: FastifyInstance) {
  // GET /api/capacity/overview
  app.get(
    "/overview",
    { preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE, AppRole.VIEWER])] },
    async (request) => {
      const query = periodQuerySchema.parse(request.query);
      const period = {
        from: query.from ?? defaultPeriod().from,
        to: query.to ?? defaultPeriod().to,
      };

      let rows = await buildCapacityRows(period, {
        country: query.country,
        skill: query.skill,
        seniority: query.seniority,
      });

      if (query.status) {
        rows = rows.filter((r) => r.availabilityStatus === query.status);
      }
      if (query.minAvailableHours != null) {
        rows = rows.filter((r) => r.availableHours >= query.minAvailableHours!);
      }

      const summary = {
        totalConsultants: rows.length,
        freeCount: rows.filter((r) => r.availabilityStatus === "FREE").length,
        partialCount: rows.filter((r) => r.availabilityStatus === "PARTIAL").length,
        fullCount: rows.filter((r) => r.availabilityStatus === "FULL").length,
        overloadedCount: rows.filter((r) => r.availabilityStatus === "OVERLOADED").length,
        totalCapacityHours: Math.round(rows.reduce((s, r) => s + r.capacityHours, 0) * 10) / 10,
        totalCommittedHours: Math.round(rows.reduce((s, r) => s + r.committedHours, 0) * 10) / 10,
        utilizationPct:
          rows.reduce((s, r) => s + r.capacityHours, 0) > 0
            ? Math.round(
                (rows.reduce((s, r) => s + r.committedHours, 0) /
                  rows.reduce((s, r) => s + r.capacityHours, 0)) *
                  1000,
              ) / 10
            : 0,
      };

      return { data: { period, consultants: rows, summary } };
    },
  );

  // GET /api/capacity/available — consultores FREE o PARTIAL
  app.get(
    "/available",
    { preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE, AppRole.VIEWER])] },
    async (request) => {
      const query = periodQuerySchema.parse(request.query);
      const period = {
        from: query.from ?? defaultPeriod().from,
        to: query.to ?? defaultPeriod().to,
      };

      let rows = await buildCapacityRows(period, {
        country: query.country,
        skill: query.skill,
        seniority: query.seniority,
      });

      rows = rows.filter((r) => r.availabilityStatus === "FREE" || r.availabilityStatus === "PARTIAL");

      if (query.minAvailableHours != null) {
        rows = rows.filter((r) => r.availableHours >= query.minAvailableHours!);
      }

      rows.sort((a, b) => b.availableHours - a.availableHours);

      return { data: rows };
    },
  );

  // GET /api/capacity/bench — consultores sin ninguna asignación activa hoy
  app.get(
    "/bench",
    { preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE, AppRole.VIEWER])] },
    async (request) => {
      const query = periodQuerySchema.parse(request.query);
      const asOf = query.from ?? new Date();

      const rows = await buildCapacityRows(
        { from: asOf, to: query.to ?? addDays(asOf, 30) },
        { country: query.country, skill: query.skill, seniority: query.seniority },
      );

      const bench = rows.filter((r) => r.availabilityStatus === "FREE");

      return { data: bench };
    },
  );

  // GET /api/capacity/releasing — consultores cuya asignación termina pronto
  app.get(
    "/releasing",
    { preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE, AppRole.VIEWER])] },
    async (request) => {
      const { within } = withinSchema.parse(request.query);
      const now = new Date();
      const horizon = addDays(now, within);

      const assignments = await prisma.assignment.findMany({
        where: {
          status: { in: ["ACTIVE", "PARTIAL"] },
          endDate: { gte: now, lte: horizon },
        },
        include: {
          consultant: {
            select: { id: true, fullName: true, role: true, country: true, seniority: true, skills: true },
          },
          project: { select: { id: true, name: true } },
        },
        orderBy: { endDate: "asc" },
      });

      const data = assignments.map((a) => ({
        assignmentId: a.id,
        consultantId: a.consultantId,
        consultant: a.consultant,
        projectId: a.projectId,
        project: a.project,
        endDate: a.endDate,
        daysUntilRelease: Math.ceil((a.endDate.getTime() - now.getTime()) / 86_400_000),
        allocationPct: a.allocationPct ? Number(a.allocationPct) : null,
      }));

      return { data };
    },
  );

  // GET /api/capacity/overloaded
  app.get(
    "/overloaded",
    { preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE, AppRole.VIEWER])] },
    async (request) => {
      const query = periodQuerySchema.parse(request.query);
      const period = {
        from: query.from ?? defaultPeriod().from,
        to: query.to ?? defaultPeriod().to,
      };

      const rows = await buildCapacityRows(period, {});
      const overloaded = rows.filter((r) => r.availabilityStatus === "OVERLOADED");

      return { data: overloaded };
    },
  );

  // GET /api/capacity/consultant/:consultantId — detalle mensual para un consultor
  app.get(
    "/consultant/:consultantId",
    { preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE, AppRole.VIEWER])] },
    async (request, reply) => {
      const { consultantId } = consultantIdSchema.parse(request.params);
      const query = z
        .object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() })
        .parse(request.query);

      const consultant = await prisma.consultant.findUnique({
        where: { id: consultantId },
        include: {
          capacityConfig: true,
          blocks: true,
          assignments: {
            where: { status: { in: ["ACTIVE", "PARTIAL", "PLANNED", "COMPLETED"] } },
            include: { project: { select: { id: true, name: true } } },
            orderBy: { startDate: "asc" },
          },
        },
      });

      if (!consultant) return reply.status(404).send({ message: "Consultor no encontrado" });

      const from = query.from ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      const to = query.to ?? new Date(from.getFullYear(), from.getMonth() + 6, 0);

      // Calcular disponibilidad mes a mes
      const months: { year: number; month: number; from: Date; to: Date }[] = [];
      let cursor = new Date(from.getFullYear(), from.getMonth(), 1);
      while (cursor <= to) {
        const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
        months.push({ year: cursor.getFullYear(), month: cursor.getMonth() + 1, from: cursor, to: monthEnd });
        cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
      }

      const timeline = months.map(({ year, month, from: mFrom, to: mTo }) => {
        const avail = computeAvailability(
          consultantId,
          consultant.assignments,
          consultant.blocks,
          consultant.capacityConfig,
          { from: mFrom, to: mTo },
          consultant.country,
        );
        return { year, month, ...avail };
      });

      return {
        data: {
          consultant: {
            id: consultant.id,
            fullName: consultant.fullName,
            role: consultant.role,
            country: consultant.country,
            seniority: consultant.seniority,
            skills: consultant.skills,
          },
          timeline,
          assignments: consultant.assignments,
          blocks: consultant.blocks,
        },
      };
    },
  );

  // GET /api/capacity/project/:projectId — recursos asignados al proyecto con costo estimado
  app.get(
    "/project/:projectId",
    { preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE, AppRole.VIEWER])] },
    async (request, reply) => {
      const { projectId } = z.object({ projectId: z.string().min(1) }).parse(request.params);
      const query = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() }).parse(request.query);

      const project = await prisma.project.findUnique({ where: { id: projectId } });
      if (!project) return reply.status(404).send({ message: "Proyecto no encontrado" });

      const period = {
        from: query.from ?? project.startDate,
        to: query.to ?? project.endDate,
      };

      // Alcance por campo (DEP-38): `estimatedCost` es `committedHours *
      // hourlyRate`, y ambas cifras viajan en la respuesta, así que dividir una
      // por la otra devuelve la tarifa exacta. Para quien no puede verla, la
      // tarifa ni siquiera se lee de la base y el costo sale `null`.
      const verTarifas = puedeVerTarifas(request.authUser!.roles);

      const assignments = await prisma.assignment.findMany({
        where: { projectId, status: { in: ["ACTIVE", "PARTIAL", "PLANNED", "COMPLETED"] } },
        include: {
          consultant: {
            select: {
              id: true,
              fullName: true,
              role: true,
              seniority: true,
              country: true,
              rateCurrency: true,
              hourlyRate: verTarifas,
              capacityConfig: true,
              blocks: { where: { startDate: { lte: period.to }, endDate: { gte: period.from } } },
            },
          },
        },
        orderBy: { startDate: "asc" },
      });

      const consultants = assignments
        .map((a) => {
          const c = a.consultant;
          const overlapFrom = a.startDate > period.from ? a.startDate : period.from;
          const overlapTo = a.endDate < period.to ? a.endDate : period.to;
          if (overlapTo < overlapFrom) return null;

          const overlapPeriod = { from: overlapFrom, to: overlapTo };
          const capacityHours = calculateCapacityHours(overlapPeriod, c.capacityConfig, c.blocks, c.country);
          const committedHours = calculateCommittedHours([a], overlapPeriod, c.capacityConfig, c.country);
          const hourlyRate = c.hourlyRate ? Number(c.hourlyRate) : 0;
          const estimatedCost = verTarifas ? Math.round(committedHours * hourlyRate * 100) / 100 : null;

          return {
            consultantId: c.id,
            fullName: c.fullName,
            role: c.role,
            seniority: c.seniority,
            country: c.country,
            assignment: {
              id: a.id,
              startDate: a.startDate,
              endDate: a.endDate,
              allocationMode: a.allocationMode,
              allocationPct: a.allocationPct ? Number(a.allocationPct) : null,
              hoursPerPeriod: a.hoursPerPeriod ? Number(a.hoursPerPeriod) : null,
              periodUnit: a.periodUnit,
              status: a.status,
              role: a.role,
              note: a.note,
            },
            capacityHours: Math.round(capacityHours * 10) / 10,
            committedHours: Math.round(committedHours * 10) / 10,
            utilizationPct: capacityHours > 0 ? Math.round((committedHours / capacityHours) * 1000) / 10 : 0,
            estimatedCost,
            costCurrency: c.rateCurrency ?? "USD",
          };
        })
        .filter(Boolean);

      const totalCommittedHours = Math.round(consultants.reduce((s, c) => s + c!.committedHours, 0) * 10) / 10;
      const totalEstimatedCost = verTarifas
        ? Math.round(consultants.reduce((s, c) => s + (c!.estimatedCost ?? 0), 0) * 100) / 100
        : null;

      return {
        data: {
          project: { id: project.id, name: project.name, startDate: project.startDate, endDate: project.endDate, status: project.status },
          period,
          consultants,
          summary: { totalConsultants: consultants.length, totalCommittedHours, totalEstimatedCost },
        },
      };
    },
  );

  // GET /api/capacity/by-project — resumen de capacidad consumida por proyecto
  app.get(
    "/by-project",
    { preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE, AppRole.VIEWER])] },
    async (request) => {
      const query = periodQuerySchema.parse(request.query);
      const period = { from: query.from ?? defaultPeriod().from, to: query.to ?? defaultPeriod().to };

      // Mismo criterio que en `/capacity/project/:projectId` (DEP-38).
      const verTarifas = puedeVerTarifas(request.authUser!.roles);

      const projects = await prisma.project.findMany({
        where: { status: { not: "CLOSED" } },
        include: {
          assignments: {
            where: {
              status: { in: ["ACTIVE", "PARTIAL", "PLANNED"] },
              startDate: { lte: period.to },
              endDate: { gte: period.from },
            },
            include: {
              consultant: {
                select: {
                  id: true,
                  fullName: true,
                  country: true,
                  rateCurrency: true,
                  hourlyRate: verTarifas,
                  capacityConfig: true,
                  blocks: { where: { startDate: { lte: period.to }, endDate: { gte: period.from } } },
                },
              },
            },
          },
        },
        orderBy: { name: "asc" },
      });

      const data = projects.map((p) => {
        const consultantRows = p.assignments
          .map((a) => {
            const c = a.consultant;
            const overlapFrom = a.startDate > period.from ? a.startDate : period.from;
            const overlapTo = a.endDate < period.to ? a.endDate : period.to;
            if (overlapTo < overlapFrom) return null;
            const overlapPeriod = { from: overlapFrom, to: overlapTo };
            const committedHours = calculateCommittedHours([a], overlapPeriod, c.capacityConfig, c.country);
            const hourlyRate = c.hourlyRate ? Number(c.hourlyRate) : 0;
            return {
              consultantId: c.id,
              fullName: c.fullName,
              committedHours: Math.round(committedHours * 10) / 10,
              estimatedCost: verTarifas ? Math.round(committedHours * hourlyRate * 100) / 100 : null,
              currency: c.rateCurrency ?? "USD",
            };
          })
          .filter(Boolean);

        return {
          projectId: p.id,
          projectName: p.name,
          projectStatus: p.status,
          assignedConsultants: consultantRows.length,
          totalCommittedHours: Math.round(consultantRows.reduce((s, c) => s + c!.committedHours, 0) * 10) / 10,
          totalEstimatedCost: verTarifas
            ? Math.round(consultantRows.reduce((s, c) => s + (c!.estimatedCost ?? 0), 0) * 100) / 100
            : null,
          consultants: consultantRows,
        };
      });

      return { data };
    },
  );
}

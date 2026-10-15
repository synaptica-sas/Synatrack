import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requirePermission } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";
import { monthRange, type MonthKey } from "../../utils/capacityMonthly.js";
import { cargarSettings, cargarYCalcular, redondear1 } from "./monthly.service.js";

/**
 * Informe mensual de capacity (CONTRATO §3.1 y §3.2). Solo lectura: `capacity:read`.
 * Registrado bajo `/api/capacity/monthly`, así no choca con `/api/capacity/consultant/:id`.
 */

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Se espera YYYY-MM");

const baseQuery = {
  from: monthSchema.optional(),
  to: monthSchema.optional(),
  includeProbables: z.enum(["true", "false"]).optional(),
  internal: z.enum(["include", "exclude"]).default("include"),
};

const listQuerySchema = z.object({
  ...baseQuery,
  country: z.string().trim().min(1).optional(),
  city: z.string().trim().min(1).optional(),
  company: z.string().trim().min(1).optional(),
  consultantId: z.string().min(1).optional(),
});

const detailQuerySchema = z.object(baseQuery);
const idSchema = z.object({ id: z.string().min(1) });

/** Redondea a 1 decimal los campos de horas y porcentajes de una celda (workdays y contadores quedan enteros). */
const CAMPOS_REDONDEO = [
  "capacityHours",
  "assignedHours",
  "billableHours",
  "internalHours",
  "probableHours",
  "availableHours",
  "pct",
  "billablePct",
  "utilizationPct",
] as const;

function redondearCelda<T extends object>(celda: T): T {
  const out = { ...celda } as Record<string, unknown>;
  for (const campo of CAMPOS_REDONDEO) {
    const v = out[campo];
    if (typeof v === "number") out[campo] = redondear1(v);
  }
  return out as T;
}

/** Rango pedido (por defecto, el año en curso en UTC); un rango inválido da 400. */
function resolverRango(from?: string, to?: string): { months: MonthKey[]; from: MonthKey; to: MonthKey } {
  const anio = new Date().getUTCFullYear();
  const desde = from ?? `${anio}-01`;
  const hasta = to ?? `${anio}-12`;
  return { months: monthRange(desde, hasta), from: desde, to: hasta };
}

export async function monthlyCapacityRoutes(app: FastifyInstance) {
  // GET /api/capacity/monthly
  app.get(
    "/",
    { preHandler: [authenticate, requirePermission("capacity:read")] },
    async (request, reply) => {
      const query = listQuerySchema.parse(request.query);

      let rango;
      try {
        rango = resolverRango(query.from, query.to);
      } catch (error) {
        return reply.status(400).send({ message: (error as Error).message });
      }

      const settings = await cargarSettings();
      const includeProbables =
        query.includeProbables === undefined ? settings.includeProbablesDefault : query.includeProbables === "true";

      const { consultants, result } = await cargarYCalcular({
        months: rango.months,
        includeProbables,
        internal: query.internal,
        thresholds: { underPct: settings.underThresholdPct, overPct: settings.overThresholdPct },
        consultantWhere: query.consultantId ? { id: query.consultantId } : undefined,
        filtros: { country: query.country, city: query.city, company: query.company },
      });

      const porId = new Map(consultants.map((c) => [c.id, c]));
      const data = {
        from: rango.from,
        to: rango.to,
        includeProbables,
        internal: query.internal,
        settings: { underThresholdPct: settings.underThresholdPct, overThresholdPct: settings.overThresholdPct },
        months: result.months,
        consultants: result.consultants.map((r) => {
          const c = porId.get(r.consultantId)!;
          return {
            id: c.id,
            fullName: c.fullName,
            country: c.country,
            city: c.city,
            company: c.company,
            isInternal: c.isInternal,
            role: c.role,
            hireDate: c.hireDate,
            exitDate: c.exitDate,
            months: r.months.map(redondearCelda),
            period: redondearCelda(r.period),
          };
        }),
        team: {
          months: result.team.months.map(redondearCelda),
          period: redondearCelda(result.team.period),
        },
        kpis: redondearCelda(result.kpis),
        warnings: result.warnings.map((w) =>
          w.code === "CONSULTANT_WITHOUT_COUNTRY"
            ? { ...w, fullName: porId.get(w.consultantId)?.fullName ?? null }
            : w,
        ),
      };

      return { data };
    },
  );

  // GET /api/capacity/monthly/consultant/:id
  app.get(
    "/consultant/:id",
    { preHandler: [authenticate, requirePermission("capacity:read")] },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const query = detailQuerySchema.parse(request.query);

      let rango;
      try {
        rango = resolverRango(query.from, query.to);
      } catch (error) {
        return reply.status(400).send({ message: (error as Error).message });
      }

      const existe = await prisma.consultant.findUnique({ where: { id }, select: { id: true } });
      if (!existe) return reply.status(404).send({ message: "Consultor no encontrado" });

      const settings = await cargarSettings();
      const includeProbables =
        query.includeProbables === undefined ? settings.includeProbablesDefault : query.includeProbables === "true";

      const { consultants, assignments, result } = await cargarYCalcular({
        months: rango.months,
        includeProbables,
        internal: query.internal,
        thresholds: { underPct: settings.underThresholdPct, overPct: settings.overThresholdPct },
        consultantWhere: { id },
        sinFiltroDeActivo: true,
      });

      const c = consultants[0];
      const r = result.consultants[0];
      const desglose = new Map(r.assignments.map((b) => [b.assignmentId, b]));

      return {
        data: {
          from: rango.from,
          to: rango.to,
          includeProbables,
          internal: query.internal,
          settings: { underThresholdPct: settings.underThresholdPct, overThresholdPct: settings.overThresholdPct },
          consultant: {
            id: c.id,
            fullName: c.fullName,
            country: c.country,
            city: c.city,
            company: c.company,
            isInternal: c.isInternal,
            role: c.role,
            hireDate: c.hireDate,
            exitDate: c.exitDate,
          },
          months: r.months.map(redondearCelda),
          period: redondearCelda(r.period),
          assignments: assignments.map((a) => {
            const b = desglose.get(a.id)!;
            return {
              assignmentId: a.id,
              projectId: a.projectId,
              projectName: a.projectName,
              client: a.client,
              projectStatus: a.projectStatus,
              isInternal: a.isInternal,
              certainty: a.certainty,
              status: a.status,
              startDate: a.startDate,
              endDate: a.endDate,
              hoursPerWeek: Math.round(a.hoursPerWeek * 100) / 100,
              included: b.included,
              totalHours: redondear1(b.totalHours),
              months: b.months.map((m) => ({ month: m.month, hours: redondear1(m.hours) })),
            };
          }),
          warnings: result.warnings.map((w) =>
            w.code === "CONSULTANT_WITHOUT_COUNTRY" ? { ...w, fullName: c.fullName } : w,
          ),
        },
      };
    },
  );
}

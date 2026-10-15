import { AllocationMode, AssignmentCertainty, AssignmentStatus } from "@prisma/client";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { authenticate, requirePermission } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";
import { AUDIT_ENTITIES, writeAudit } from "../../utils/audit.js";
import { monthRange } from "../../utils/capacityMonthly.js";
import { addMonthsKey, fromIsoDate, isValidIsoDate, monthKeyOf, toIsoDate, type IsoDate } from "../../utils/isoDate.js";
import { cargarSettings, cargarYCalcular, redondear1 } from "../capacity/monthly.service.js";

/**
 * Asignaciones (CONTRATO §3.6). Lectura: `capacity:read`. Escritura: `assignments:write` (solo ADMIN).
 *
 * - Las fechas viajan como "YYYY-MM-DD" (las ISO completas se truncan a la fecha UTC) y se guardan
 *   en columnas DATE: una asignación es por días calendario, sin hora ni zona.
 * - Ya no crea `Forecast` (el cálculo de capacity sale de las propias asignaciones).
 * - La sobreasignación no bloquea: se avisa en `warnings` (OVERALLOCATED por mes).
 */

/** Acepta "YYYY-MM-DD" o una fecha ISO completa (se trunca al día UTC). */
const fechaSchema = z
  .string()
  .trim()
  .transform((value, ctx): IsoDate => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      if (!isValidIsoDate(value)) {
        ctx.addIssue({ code: "custom", message: "Fecha inexistente en el calendario" });
        return z.NEVER;
      }
      return value;
    }
    const fecha = new Date(value);
    if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(fecha.getTime())) {
      ctx.addIssue({ code: "custom", message: "Se espera una fecha YYYY-MM-DD" });
      return z.NEVER;
    }
    return toIsoDate(fecha);
  });

const assignmentPayloadSchema = z
  .object({
    projectId: z.string().min(1),
    consultantId: z.string().min(1),
    startDate: fechaSchema,
    endDate: fechaSchema,
    certainty: z.nativeEnum(AssignmentCertainty).default("CONFIRMED"),
    allocationMode: z.nativeEnum(AllocationMode).default("PERCENTAGE"),
    allocationPct: z.coerce.number().min(0).max(200).optional(),
    hoursPerPeriod: z.coerce.number().positive().optional(),
    periodUnit: z.enum(["week", "month"]).optional(),
    role: z.string().trim().optional(),
    note: z.string().trim().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.endDate < val.startDate) {
      ctx.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "La fecha de fin no puede ser anterior a la de inicio",
      });
    }
    if (val.allocationMode === "PERCENTAGE" && val.allocationPct == null) {
      ctx.addIssue({ code: "custom", path: ["allocationPct"], message: "allocationPct required for PERCENTAGE mode" });
    }
    if (val.allocationMode === "HOURS" && val.hoursPerPeriod == null) {
      ctx.addIssue({ code: "custom", path: ["hoursPerPeriod"], message: "hoursPerPeriod required for HOURS mode" });
    }
  });

type AssignmentPayload = z.infer<typeof assignmentPayloadSchema>;

const listQuerySchema = z.object({
  consultantId: z.string().optional(),
  projectId: z.string().optional(),
  status: z.nativeEnum(AssignmentStatus).optional(),
  from: fechaSchema.optional(),
  to: fechaSchema.optional(),
});

const idSchema = z.object({ id: z.string().min(1) });

/** Hoy como fecha calendario UTC. */
function hoyIso(): IsoDate {
  return toIsoDate(new Date());
}

/** Estado que corresponde a las fechas (BE-09): futura = PLANNED, vencida = COMPLETED, en curso = ACTIVE. */
function estadoPorFechas(startDate: IsoDate, endDate: IsoDate, hoy: IsoDate = hoyIso()): AssignmentStatus {
  if (startDate > hoy) return "PLANNED";
  if (endDate < hoy) return "COMPLETED";
  return "ACTIVE";
}

/** Columnas de la asignación según el modo: lo que no aplica al modo queda en null. */
function datosDeAsignacion(p: AssignmentPayload) {
  return {
    projectId: p.projectId,
    consultantId: p.consultantId,
    startDate: fromIsoDate(p.startDate),
    endDate: fromIsoDate(p.endDate),
    certainty: p.certainty,
    allocationMode: p.allocationMode,
    allocationPct: p.allocationMode === "PERCENTAGE" ? (p.allocationPct ?? null) : null,
    hoursPerPeriod: p.allocationMode === "HOURS" ? (p.hoursPerPeriod ?? null) : null,
    periodUnit: p.allocationMode === "HOURS" ? (p.periodUnit ?? "week") : null,
    role: p.role,
    note: p.note,
  };
}

/** Respuesta: las fechas DATE salen como "YYYY-MM-DD". */
function serializar<T extends { startDate: Date; endDate: Date }>(a: T) {
  return { ...a, startDate: toIsoDate(a.startDate), endDate: toIsoDate(a.endDate) };
}

/** Para auditoría: mismo objeto con fechas legibles. */
function paraAuditoria<T extends { startDate: Date; endDate: Date }>(a: T): Record<string, unknown> {
  return serializar(a) as unknown as Record<string, unknown>;
}

/**
 * Meses (de la asignación, máximo 24) en los que el consultor queda por encima del umbral de
 * sobreocupación contando solo asignaciones confirmadas, con feriados y jornadas reales.
 * No bloquea: si el cálculo falla se registra y no se avisa nada (la asignación ya se guardó).
 */
async function avisosDeSobreasignacion(
  request: FastifyRequest,
  consultantId: string,
  startDate: IsoDate,
  endDate: IsoDate,
) {
  try {
    const primero = monthKeyOf(startDate);
    const ultimo = monthKeyOf(endDate);
    const tope = addMonthsKey(primero, 23);
    const months = monthRange(primero, ultimo < tope ? ultimo : tope);
    const settings = await cargarSettings();
    const { result } = await cargarYCalcular({
      months,
      includeProbables: false,
      internal: "include",
      thresholds: { underPct: settings.underThresholdPct, overPct: settings.overThresholdPct },
      consultantWhere: { id: consultantId },
      sinFiltroDeActivo: true,
    });
    return (result.consultants[0]?.months ?? [])
      .filter((m) => m.status === "OVER" && m.pct !== null)
      .map((m) => ({ code: "OVERALLOCATED" as const, month: m.month, pct: redondear1(m.pct as number) }));
  } catch (error) {
    request.log.warn({ err: error, consultantId }, "No se pudo calcular el aviso de sobreasignación");
    return [];
  }
}

const assignmentInclude = {
  project: { select: { id: true, name: true } },
  consultant: { select: { id: true, fullName: true } },
} as const;

export async function assignmentsRoutes(app: FastifyInstance) {
  // GET /api/assignments
  app.get(
    "/",
    { preHandler: [authenticate, requirePermission("capacity:read")] },
    async (request) => {
      const query = listQuerySchema.parse(request.query);

      const assignments = await prisma.assignment.findMany({
        where: {
          consultantId: query.consultantId,
          projectId: query.projectId,
          status: query.status,
          ...(query.from || query.to
            ? {
                AND: [
                  query.from ? { endDate: { gte: fromIsoDate(query.from) } } : {},
                  query.to ? { startDate: { lte: fromIsoDate(query.to) } } : {},
                ],
              }
            : {}),
        },
        include: {
          project: { select: { id: true, name: true, company: true, currency: true } },
          consultant: { select: { id: true, fullName: true, role: true, country: true } },
        },
        orderBy: [{ startDate: "asc" }, { createdAt: "desc" }],
      });

      return { data: assignments.map(serializar) };
    },
  );

  // POST /api/assignments
  app.post(
    "/",
    { preHandler: [authenticate, requirePermission("assignments:write")] },
    async (request, reply) => {
      const payload = assignmentPayloadSchema.parse(request.body);
      const performedBy = request.authUser!.email;

      const [project, consultant] = await Promise.all([
        prisma.project.findUnique({ where: { id: payload.projectId } }),
        prisma.consultant.findUnique({ where: { id: payload.consultantId } }),
      ]);

      if (!project) return reply.status(400).send({ message: "Proyecto no encontrado" });
      if (!consultant) return reply.status(400).send({ message: "Consultor no encontrado" });
      if (!consultant.active) return reply.status(400).send({ message: "El consultor no está activo" });

      const status = estadoPorFechas(payload.startDate, payload.endDate);
      const assignment = await prisma.assignment.create({
        data: { ...datosDeAsignacion(payload), status },
        include: assignmentInclude,
      });

      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.assignment,
        entityId: assignment.id,
        action: "CREATE",
        changedBy: performedBy,
        after: paraAuditoria(assignment),
        request,
      });

      const warnings = await avisosDeSobreasignacion(request, assignment.consultantId, payload.startDate, payload.endDate);
      return reply.status(201).send({ data: serializar(assignment), warnings });
    },
  );

  // GET /api/assignments/:id
  app.get(
    "/:id",
    { preHandler: [authenticate, requirePermission("capacity:read")] },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const assignment = await prisma.assignment.findUnique({
        where: { id },
        include: {
          project: { select: { id: true, name: true, company: true } },
          consultant: { select: { id: true, fullName: true, role: true, country: true, seniority: true } },
        },
      });
      if (!assignment) return reply.status(404).send({ message: "Asignación no encontrada" });
      return { data: serializar(assignment) };
    },
  );

  // PUT /api/assignments/:id
  app.put(
    "/:id",
    { preHandler: [authenticate, requirePermission("assignments:write")] },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const payload = assignmentPayloadSchema.parse(request.body);
      const performedBy = request.authUser!.email;

      const existing = await prisma.assignment.findUnique({ where: { id } });
      if (!existing) return reply.status(404).send({ message: "Asignación no encontrada" });
      if (existing.status === "COMPLETED" || existing.status === "CANCELLED") {
        return reply.status(409).send({ message: "No se puede editar una asignación completada o cancelada" });
      }

      const [project, consultant] = await Promise.all([
        prisma.project.findUnique({ where: { id: payload.projectId } }),
        prisma.consultant.findUnique({ where: { id: payload.consultantId } }),
      ]);

      if (!project) return reply.status(400).send({ message: "Proyecto no encontrado" });
      if (!consultant) return reply.status(400).send({ message: "Consultor no encontrado" });

      // Validar si el consultor está activo (a menos que siga siendo el mismo y no se cambie)
      if (!consultant.active && existing.consultantId !== payload.consultantId) {
        return reply.status(400).send({ message: "El consultor no está activo" });
      }

      try {
        // BE-09: el estado sigue a las fechas (antes quedaba el que tenía al crearse).
        const status = estadoPorFechas(payload.startDate, payload.endDate);
        const assignment = await prisma.assignment.update({
          where: { id },
          data: { ...datosDeAsignacion(payload), status },
          include: assignmentInclude,
        });

        await writeAudit(prisma, {
          entity: AUDIT_ENTITIES.assignment,
          entityId: id,
          action: "UPDATE",
          changedBy: performedBy,
          before: paraAuditoria(existing),
          after: paraAuditoria(assignment),
          request,
        });

        const warnings = await avisosDeSobreasignacion(
          request,
          assignment.consultantId,
          payload.startDate,
          payload.endDate,
        );
        return { data: serializar(assignment), warnings };
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === "P2003" || code === "P2014") {
          return reply.status(409).send({ message: "No se puede actualizar la asignación debido a restricciones de clave foránea" });
        }
        throw err;
      }
    },
  );

  // PATCH /api/assignments/:id/complete
  app.patch(
    "/:id/complete",
    { preHandler: [authenticate, requirePermission("assignments:write")] },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const existing = await prisma.assignment.findUnique({ where: { id } });
      if (!existing) return reply.status(404).send({ message: "Asignación no encontrada" });
      if (existing.status === "CANCELLED") {
        return reply.status(409).send({ message: "No se puede completar una asignación cancelada" });
      }

      // BE-09: completar fija el fin en hoy; si la asignación aún no empieza, el fin quedaría antes del inicio.
      const hoy = hoyIso();
      if (hoy < toIsoDate(existing.startDate)) {
        return reply.status(400).send({
          message: "No se puede completar una asignación que aún no ha empezado: la fecha de fin quedaría antes del inicio",
        });
      }

      const assignment = await prisma.assignment.update({
        where: { id },
        data: { status: "COMPLETED", endDate: fromIsoDate(hoy) },
      });

      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.assignment,
        entityId: id,
        action: "COMPLETE",
        changedBy: request.authUser!.email,
        before: { status: existing.status },
        after: { status: "COMPLETED" },
        request,
      });

      return { data: serializar(assignment) };
    },
  );

  // PATCH /api/assignments/:id/cancel
  app.patch(
    "/:id/cancel",
    { preHandler: [authenticate, requirePermission("assignments:write")] },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const existing = await prisma.assignment.findUnique({ where: { id } });
      if (!existing) return reply.status(404).send({ message: "Asignación no encontrada" });
      if (existing.status === "COMPLETED") {
        return reply.status(409).send({ message: "No se puede cancelar una asignación completada" });
      }

      const assignment = await prisma.assignment.update({ where: { id }, data: { status: "CANCELLED" } });

      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.assignment,
        entityId: id,
        action: "CANCEL",
        changedBy: request.authUser!.email,
        before: { status: existing.status },
        after: { status: "CANCELLED" },
        request,
      });

      return { data: serializar(assignment) };
    },
  );

  // DELETE /api/assignments/:id  (solo PLANNED o CANCELLED)
  app.delete(
    "/:id",
    { preHandler: [authenticate, requirePermission("assignments:write")] },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const existing = await prisma.assignment.findUnique({ where: { id } });
      if (!existing) return reply.status(404).send({ message: "Asignación no encontrada" });
      if (!["PLANNED", "CANCELLED"].includes(existing.status)) {
        return reply.status(409).send({ message: "Solo se pueden eliminar asignaciones en estado PLANNED o CANCELLED" });
      }

      try {
        await prisma.assignment.delete({ where: { id } });

        await writeAudit(prisma, {
          entity: AUDIT_ENTITIES.assignment,
          entityId: id,
          action: "DELETE",
          changedBy: request.authUser!.email,
          before: paraAuditoria(existing),
          request,
        });

        return reply.status(204).send();
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === "P2003" || code === "P2014") {
          return reply.status(409).send({ message: "No se puede eliminar la asignación: tiene otros registros relacionados" });
        }
        throw err;
      }
    },
  );
}

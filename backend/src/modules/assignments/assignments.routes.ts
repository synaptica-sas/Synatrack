import { AppRole, AllocationMode, AssignmentStatus } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, authorize } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";
import { AUDIT_ENTITIES, writeAudit } from "../../utils/audit.js";

const assignmentPayloadSchema = z
  .object({
    projectId: z.string().min(1),
    consultantId: z.string().min(1),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    allocationMode: z.nativeEnum(AllocationMode).default("PERCENTAGE"),
    allocationPct: z.coerce.number().min(0).max(200).optional(),
    hoursPerPeriod: z.coerce.number().positive().optional(),
    periodUnit: z.enum(["week", "month"]).optional(),
    role: z.string().trim().optional(),
    note: z.string().trim().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.endDate < val.startDate) {
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "endDate must be after startDate" });
    }
    if (val.allocationMode === "PERCENTAGE" && val.allocationPct == null) {
      ctx.addIssue({ code: "custom", path: ["allocationPct"], message: "allocationPct required for PERCENTAGE mode" });
    }
    if (val.allocationMode === "HOURS" && val.hoursPerPeriod == null) {
      ctx.addIssue({ code: "custom", path: ["hoursPerPeriod"], message: "hoursPerPeriod required for HOURS mode" });
    }
  });

const listQuerySchema = z.object({
  consultantId: z.string().optional(),
  projectId: z.string().optional(),
  status: z.nativeEnum(AssignmentStatus).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

const idSchema = z.object({ id: z.string().min(1) });

export async function assignmentsRoutes(app: FastifyInstance) {
  // GET /api/assignments
  app.get(
    "/",
    { preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE, AppRole.VIEWER])] },
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
                  query.from ? { endDate: { gte: query.from } } : {},
                  query.to ? { startDate: { lte: query.to } } : {},
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

      return { data: assignments };
    },
  );

  // POST /api/assignments
  app.post(
    "/",
    { preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM])] },
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

      // Check overload if PERCENTAGE mode
      if (payload.allocationMode === "PERCENTAGE" && payload.allocationPct) {
        const existing = await prisma.assignment.findMany({
          where: {
            consultantId: payload.consultantId,
            status: { in: ["ACTIVE", "PARTIAL", "PLANNED"] },
            startDate: { lte: payload.endDate },
            endDate: { gte: payload.startDate },
          },
        });
        const totalPct = existing.reduce((s, a) => s + Number(a.allocationPct ?? 0), 0);
        if (totalPct + payload.allocationPct > 110) {
          return reply.status(409).send({
            message: `El consultor ya tiene ${totalPct}% asignado en ese período. Nueva asignación de ${payload.allocationPct}% supera el límite de 110%.`,
          });
        }
      }

      const now = new Date();
      const status: AssignmentStatus =
        payload.startDate <= now && payload.endDate >= now ? "ACTIVE" : payload.startDate > now ? "PLANNED" : "COMPLETED";

      const assignment = await prisma.assignment.create({
        data: { ...payload, status },
        include: {
          project: { select: { id: true, name: true } },
          consultant: { select: { id: true, fullName: true } },
        },
      });

      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.assignment,
        entityId: assignment.id,
        action: "CREATE",
        changedBy: performedBy,
        after: assignment as Record<string, unknown>,
        request,
      });

      return reply.status(201).send({ data: assignment });
    },
  );

  // GET /api/assignments/:id
  app.get(
    "/:id",
    { preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE, AppRole.VIEWER])] },
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
      return { data: assignment };
    },
  );

  // PUT /api/assignments/:id
  app.put(
    "/:id",
    { preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM])] },
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

      // Validar sobrecarga excluyendo la propia asignación
      if (payload.allocationMode === "PERCENTAGE" && payload.allocationPct) {
        const otherAssignments = await prisma.assignment.findMany({
          where: {
            consultantId: payload.consultantId,
            id: { not: id },
            status: { in: ["ACTIVE", "PARTIAL", "PLANNED"] },
            startDate: { lte: payload.endDate },
            endDate: { gte: payload.startDate },
          },
        });
        const totalPct = otherAssignments.reduce((s, a) => s + Number(a.allocationPct ?? 0), 0);
        if (totalPct + payload.allocationPct > 110) {
          return reply.status(409).send({
            message: `El consultor ya tiene ${totalPct}% asignado en ese período. Nueva asignación de ${payload.allocationPct}% supera el límite de 110%.`,
          });
        }
      }

      try {
        const assignment = await prisma.assignment.update({
          where: { id },
          data: payload,
          include: {
            project: { select: { id: true, name: true } },
            consultant: { select: { id: true, fullName: true } },
          },
        });

        await writeAudit(prisma, {
          entity: AUDIT_ENTITIES.assignment,
          entityId: id,
          action: "UPDATE",
          changedBy: performedBy,
          before: existing as Record<string, unknown>,
          after: assignment as Record<string, unknown>,
          request,
        });

        return { data: assignment };
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
    { preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM])] },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const existing = await prisma.assignment.findUnique({ where: { id } });
      if (!existing) return reply.status(404).send({ message: "Asignación no encontrada" });
      if (existing.status === "CANCELLED") {
        return reply.status(409).send({ message: "No se puede completar una asignación cancelada" });
      }

      const assignment = await prisma.assignment.update({
        where: { id },
        data: { status: "COMPLETED", endDate: new Date() },
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

      return { data: assignment };
    },
  );

  // PATCH /api/assignments/:id/cancel
  app.patch(
    "/:id/cancel",
    { preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM])] },
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

      return { data: assignment };
    },
  );

  // DELETE /api/assignments/:id  (solo PLANNED o CANCELLED)
  app.delete(
    "/:id",
    { preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM])] },
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
          before: existing as Record<string, unknown>,
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

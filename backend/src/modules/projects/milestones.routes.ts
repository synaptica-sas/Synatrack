import { AppRole, MilestoneStatus } from "@prisma/client";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { authenticate, authorize } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";
import { AUDIT_ENTITIES, writeAudit } from "../../utils/audit.js";

const projectIdSchema = z.object({ projectId: z.string().min(1) });
const idSchema = z.object({ projectId: z.string().min(1), id: z.string().min(1) });

const milestonePayloadSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  plannedDate: z.coerce.date(),
  weight: z.coerce.number().min(0).max(100).default(0),
  deliverable: z.string().optional(),
  note: z.string().optional(),
});

/** Auditoría de hitos: mover un hito cambia el avance ponderado del proyecto. */
async function auditarHito(
  request: FastifyRequest,
  action: "CREATE" | "UPDATE" | "DELETE" | "COMPLETE",
  id: string,
  before: object | null,
  after: object | null,
) {
  await writeAudit(prisma, {
    entity: AUDIT_ENTITIES.milestone,
    entityId: id,
    action,
    changedBy: request.authUser!.email,
    before: before as Record<string, unknown> | null,
    after: after as Record<string, unknown> | null,
    request,
  });
}

export async function milestonesRoutes(app: FastifyInstance) {
  // GET /api/projects/:projectId/milestones
  app.get(
    "/:projectId/milestones",
    { preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE, AppRole.VIEWER])] },
    async (request, reply) => {
      const { projectId } = projectIdSchema.parse(request.params);
      const project = await prisma.project.findUnique({ where: { id: projectId } });
      if (!project) return reply.status(404).send({ message: "Proyecto no encontrado" });
      const milestones = await prisma.milestone.findMany({ where: { projectId }, orderBy: { plannedDate: "asc" } });
      return { data: milestones };
    },
  );

  // POST /api/projects/:projectId/milestones
  app.post(
    "/:projectId/milestones",
    { preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM])] },
    async (request, reply) => {
      const { projectId } = projectIdSchema.parse(request.params);
      const payload = milestonePayloadSchema.parse(request.body);
      const project = await prisma.project.findUnique({ where: { id: projectId } });
      if (!project) return reply.status(404).send({ message: "Proyecto no encontrado" });
      const milestone = await prisma.milestone.create({
        data: { projectId, ...payload, createdBy: request.authUser!.email },
      });
      await auditarHito(request, "CREATE", milestone.id, null, milestone);
      return reply.status(201).send({ data: milestone });
    },
  );

  // PUT /api/projects/:projectId/milestones/:id
  app.put(
    "/:projectId/milestones/:id",
    { preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM])] },
    async (request, reply) => {
      const { projectId, id } = idSchema.parse(request.params);
      const payload = milestonePayloadSchema.parse(request.body);
      const existing = await prisma.milestone.findFirst({ where: { id, projectId } });
      if (!existing) return reply.status(404).send({ message: "Hito no encontrado" });
      
      try {
        const milestone = await prisma.milestone.update({ where: { id }, data: payload });

        // Recalculate project completionPct after update
        const remaining = await prisma.milestone.findMany({ where: { projectId } });
        const totalWeight = remaining.reduce((s, m) => s + Number(m.weight), 0);
        if (totalWeight > 0) {
          const completedWeight = remaining
            .filter((m) => m.status === "COMPLETED")
            .reduce((s, m) => s + Number(m.weight), 0);
          await prisma.project.update({ where: { id: projectId }, data: { completionPct: (completedWeight / totalWeight) * 100 } });
        } else {
          await prisma.project.update({ where: { id: projectId }, data: { completionPct: 0 } });
        }

        await auditarHito(request, "UPDATE", id, existing, milestone);
        return { data: milestone };
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === "P2003" || code === "P2014") {
          return reply.status(409).send({ message: "No se puede actualizar el hito debido a un conflicto de registros relacionados" });
        }
        throw err;
      }
    },
  );

  // PATCH /api/projects/:projectId/milestones/:id/complete
  app.patch(
    "/:projectId/milestones/:id/complete",
    { preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM])] },
    async (request, reply) => {
      const { projectId, id } = idSchema.parse(request.params);
      const { acceptedBy } = z.object({ acceptedBy: z.string().optional() }).parse(request.body ?? {});
      const existing = await prisma.milestone.findFirst({ where: { id, projectId } });
      if (!existing) return reply.status(404).send({ message: "Hito no encontrado" });
      const milestone = await prisma.milestone.update({
        where: { id },
        data: { status: "COMPLETED", actualDate: new Date(), acceptedBy: acceptedBy ?? request.authUser!.email },
      });
      await auditarHito(request, "COMPLETE", id, existing, milestone);

      // Recalculate project completionPct from weighted milestones
      const allMilestones = await prisma.milestone.findMany({ where: { projectId } });
      const totalWeight = allMilestones.reduce((s, m) => s + Number(m.weight), 0);
      if (totalWeight > 0) {
        const completedWeight = allMilestones
          .filter((m) => m.status === "COMPLETED")
          .reduce((s, m) => s + Number(m.weight), 0);
        const completionPct = (completedWeight / totalWeight) * 100;
        await prisma.project.update({ where: { id: projectId }, data: { completionPct } });
      }

      return { data: milestone };
    },
  );

  // PATCH /api/projects/:projectId/milestones/:id/status
  app.patch(
    "/:projectId/milestones/:id/status",
    { preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM])] },
    async (request, reply) => {
      const { projectId, id } = idSchema.parse(request.params);
      const { status } = z.object({ status: z.nativeEnum(MilestoneStatus) }).parse(request.body);
      const existing = await prisma.milestone.findFirst({ where: { id, projectId } });
      if (!existing) return reply.status(404).send({ message: "Hito no encontrado" });
      const milestone = await prisma.milestone.update({ where: { id }, data: { status } });
      await auditarHito(request, "UPDATE", id, existing, milestone);

      // Recalculate completionPct whenever a milestone status changes
      const allMilestones = await prisma.milestone.findMany({ where: { projectId } });
      const totalWeight = allMilestones.reduce((s, m) => s + Number(m.weight), 0);
      if (totalWeight > 0) {
        const completedWeight = allMilestones
          .filter((m) => (m.id === id ? status === "COMPLETED" : m.status === "COMPLETED"))
          .reduce((s, m) => s + Number(m.weight), 0);
        await prisma.project.update({ where: { id: projectId }, data: { completionPct: (completedWeight / totalWeight) * 100 } });
      }

      return { data: milestone };
    },
  );

  // DELETE /api/projects/:projectId/milestones/:id
  app.delete(
    "/:projectId/milestones/:id",
    { preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM])] },
    async (request, reply) => {
      const { projectId, id } = idSchema.parse(request.params);
      const existing = await prisma.milestone.findFirst({ where: { id, projectId } });
      if (!existing) return reply.status(404).send({ message: "Hito no encontrado" });
      
      try {
        await prisma.milestone.delete({ where: { id } });
        await auditarHito(request, "DELETE", id, existing, null);

        // Recalculate completionPct after deletion
        const remaining = await prisma.milestone.findMany({ where: { projectId } });
        const totalWeight = remaining.reduce((s, m) => s + Number(m.weight), 0);
        if (totalWeight > 0) {
          const completedWeight = remaining
            .filter((m) => m.status === "COMPLETED")
            .reduce((s, m) => s + Number(m.weight), 0);
          await prisma.project.update({ where: { id: projectId }, data: { completionPct: (completedWeight / totalWeight) * 100 } });
        } else if (remaining.length === 0) {
          // No milestones left — reset to 0
          await prisma.project.update({ where: { id: projectId }, data: { completionPct: 0 } });
        }

        return reply.status(204).send();
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === "P2003" || code === "P2014") {
          return reply.status(409).send({ message: "No se puede eliminar el hito: tiene otros registros relacionados" });
        }
        throw err;
      }
    },
  );
}

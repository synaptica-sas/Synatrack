import { AppRole, ChangeRequestStatus, ChangeRequestType } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, authorize } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";
import { AUDIT_ENTITIES, writeAudit } from "../../utils/audit.js";

const projectIdSchema = z.object({ projectId: z.string().min(1) });
const idSchema = z.object({ projectId: z.string().min(1), id: z.string().min(1) });

const changePayloadSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1),
  type: z.nativeEnum(ChangeRequestType),
  impactScope: z.string().optional(),
  impactBudget: z.coerce.number().optional(),
  impactDays: z.coerce.number().int().optional(),
});

export async function changeRequestsRoutes(app: FastifyInstance) {
  app.get(
    "/:projectId/changes",
    { preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE, AppRole.VIEWER])] },
    async (request, reply) => {
      const { projectId } = projectIdSchema.parse(request.params);
      const project = await prisma.project.findUnique({ where: { id: projectId } });
      if (!project) return reply.status(404).send({ message: "Proyecto no encontrado" });
      const changes = await prisma.changeRequest.findMany({ where: { projectId }, orderBy: { createdAt: "desc" } });
      return { data: changes };
    },
  );

  app.post(
    "/:projectId/changes",
    { preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE])] },
    async (request, reply) => {
      const { projectId } = projectIdSchema.parse(request.params);
      const payload = changePayloadSchema.parse(request.body);
      const project = await prisma.project.findUnique({ where: { id: projectId } });
      if (!project) return reply.status(404).send({ message: "Proyecto no encontrado" });
      const change = await prisma.changeRequest.create({
        data: { projectId, ...payload, requestedBy: request.authUser!.email },
      });
      return reply.status(201).send({ data: change });
    },
  );

  app.patch(
    "/:projectId/changes/:id/approve",
    { preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM])] },
    async (request, reply) => {
      const { projectId, id } = idSchema.parse(request.params);
      const { resolution } = z.object({ resolution: z.string().optional() }).parse(request.body ?? {});
      const existing = await prisma.changeRequest.findFirst({ where: { id, projectId } });
      if (!existing) return reply.status(404).send({ message: "Cambio no encontrado" });
      if (existing.status !== "PENDING") return reply.status(409).send({ message: "Solo se pueden aprobar cambios pendientes" });

      const change = await prisma.changeRequest.update({
        where: { id },
        data: { status: "APPROVED", reviewedBy: request.authUser!.email, resolvedAt: new Date(), resolution },
      });

      const performedBy = request.authUser!.email;

      // Apply budget delta if applicable
      if (existing.type === "BUDGET" && existing.impactBudget) {
        const project = await prisma.project.findUnique({ where: { id: projectId } });
        if (project) {
          const oldBudget = Number(project.budget);
          const newBudget = oldBudget + Number(existing.impactBudget);
          await prisma.project.update({ where: { id: projectId }, data: { budget: newBudget } });
          await writeAudit(prisma, {
            entity: AUDIT_ENTITIES.project,
            entityId: projectId,
            action: "UPDATE",
            changedBy: performedBy,
            before: { budget: oldBudget } as Record<string, unknown>,
            after: { budget: newBudget, changeRequestId: id } as Record<string, unknown>,
            request,
          });
        }
      }

      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.changeRequest,
        entityId: id,
        action: "APPROVE",
        changedBy: performedBy,
        after: { status: "APPROVED", title: existing.title, type: existing.type } as Record<string, unknown>,
        request,
      });

      return { data: change };
    },
  );

  app.patch(
    "/:projectId/changes/:id/reject",
    { preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM])] },
    async (request, reply) => {
      const { projectId, id } = idSchema.parse(request.params);
      const { resolution } = z.object({ resolution: z.string().optional() }).parse(request.body ?? {});
      const existing = await prisma.changeRequest.findFirst({ where: { id, projectId } });
      if (!existing) return reply.status(404).send({ message: "Cambio no encontrado" });
      if (existing.status !== "PENDING") return reply.status(409).send({ message: "Solo se pueden rechazar cambios pendientes" });
      const change = await prisma.changeRequest.update({
        where: { id },
        data: { status: "REJECTED", reviewedBy: request.authUser!.email, resolvedAt: new Date(), resolution },
      });

      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.changeRequest,
        entityId: id,
        action: "REJECT",
        changedBy: request.authUser!.email,
        after: { status: "REJECTED", title: existing.title, type: existing.type } as Record<string, unknown>,
        request,
      });

      return { data: change };
    },
  );

  app.delete(
    "/:projectId/changes/:id",
    { preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM])] },
    async (request, reply) => {
      const { projectId, id } = idSchema.parse(request.params);
      const existing = await prisma.changeRequest.findFirst({ where: { id, projectId } });
      if (!existing) return reply.status(404).send({ message: "Cambio no encontrado" });
      if (existing.status !== "PENDING") return reply.status(409).send({ message: "Solo se pueden eliminar cambios pendientes" });
      
      try {
        await prisma.changeRequest.delete({ where: { id } });
        return reply.status(204).send();
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === "P2003" || code === "P2014") {
          return reply.status(409).send({ message: "No se puede eliminar la solicitud de cambio: tiene registros relacionados" });
        }
        throw err;
      }
    },
  );
}

import type { FastifyInstance } from "fastify";
import { AppRole } from "@prisma/client";
import { z } from "zod";
import { authenticate, authorize } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";
import { AUDIT_ENTITIES, writeAudit } from "../../utils/audit.js";

const delegationPayloadSchema = z.object({
  projectId: z.string().min(1),
  toUserEmail: z.string().email().toLowerCase(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
});

const idParamsSchema = z.object({ id: z.string().min(1) });

export async function delegationsRoutes(app: FastifyInstance) {
  // 1. List delegations (Admins, PMs, Finance can view)
  app.get(
    "/",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE])],
    },
    async (request) => {
      const user = request.authUser!;
      const email = user.email.toLowerCase();
      const isAdminOrFinance = user.roles.includes(AppRole.ADMIN) || user.roles.includes(AppRole.FINANCE);

      let delegations;
      if (isAdminOrFinance) {
        delegations = await prisma.approvalDelegation.findMany({
          include: { project: true },
          orderBy: { createdAt: "desc" },
        });
      } else {
        // PM only sees delegations they created
        delegations = await prisma.approvalDelegation.findMany({
          where: { fromUserEmail: email },
          include: { project: true },
          orderBy: { createdAt: "desc" },
        });
      }

      return { data: delegations };
    },
  );

  // 2. Create delegation
  app.post(
    "/",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM])],
    },
    async (request, reply) => {
      const payload = delegationPayloadSchema.parse(request.body);
      const user = request.authUser!;
      const fromEmail = user.email.toLowerCase();

      // Check project manager permissions if not ADMIN
      const project = await prisma.project.findUnique({
        where: { id: payload.projectId },
      });

      if (!project) {
        return reply.status(404).send({ message: "Proyecto no encontrado" });
      }

      const isPM = project.projectManagerEmail?.toLowerCase() === fromEmail;
      const isAdmin = user.roles.includes(AppRole.ADMIN);

      if (!isPM && !isAdmin) {
        return reply.status(403).send({
          message: "Solo el PM asignado a este proyecto o el Administrador pueden delegar la aprobación.",
        });
      }

      // Check target user email exists
      const targetUser = await prisma.user.findUnique({
        where: { email: payload.toUserEmail },
      });

      if (!targetUser) {
        return reply.status(400).send({
          message: `El consultor con correo ${payload.toUserEmail} no está registrado en el sistema.`,
        });
      }

      if (payload.endDate < payload.startDate) {
        return reply.status(400).send({
          message: "La fecha de fin no puede ser anterior a la fecha de inicio.",
        });
      }

      const delegation = await prisma.approvalDelegation.create({
        data: {
          projectId: payload.projectId,
          fromUserEmail: fromEmail,
          toUserEmail: payload.toUserEmail,
          startDate: payload.startDate,
          endDate: payload.endDate,
        },
        include: { project: true },
      });

      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.approvalDelegation,
        entityId: delegation.id,
        action: "CREATE",
        changedBy: fromEmail,
        after: delegation as unknown as Record<string, unknown>,
        request,
      });

      return reply.status(201).send({ data: delegation });
    },
  );

  // 3. Delete/Cancel delegation
  app.delete(
    "/:id",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM])],
    },
    async (request, reply) => {
      const { id } = idParamsSchema.parse(request.params);
      const user = request.authUser!;
      const email = user.email.toLowerCase();
      const isAdmin = user.roles.includes(AppRole.ADMIN);

      const existing = await prisma.approvalDelegation.findUnique({
        where: { id },
      });

      if (!existing) {
        return reply.status(404).send({ message: "Delegación no encontrada" });
      }

      if (existing.fromUserEmail !== email && !isAdmin) {
        return reply.status(403).send({
          message: "Solo el creador de la delegación o el Administrador pueden eliminarla.",
        });
      }

      await prisma.approvalDelegation.delete({ where: { id } });

      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.approvalDelegation,
        entityId: id,
        action: "DELETE",
        changedBy: email,
        before: existing as unknown as Record<string, unknown>,
        request,
      });

      return reply.status(204).send();
    },
  );
}

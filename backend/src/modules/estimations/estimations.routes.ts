import type { FastifyInstance } from "fastify";
import { AppRole } from "@prisma/client";
import { z } from "zod";
import { authenticate, authorize } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";
import { AUDIT_ENTITIES, writeAudit } from "../../utils/audit.js";

const estimationPayloadSchema = z.object({
  projectId: z.string().optional().nullable(),
  projectName: z.string().min(1),
  totalIdealHours: z.coerce.number().positive(),
  totalAdjustedHours: z.coerce.number().positive(),
  bufferPercentage: z.coerce.number().min(0).max(100),
  riskLevel: z.string().min(1),
  confidenceLevel: z.coerce.number().min(0).max(100),
  rawDataJson: z.string().min(1),
});

const idParamsSchema = z.object({ id: z.string().min(1) });
const projectIdParamsSchema = z.object({ projectId: z.string().min(1) });

export async function estimationsRoutes(app: FastifyInstance) {
  // 1. Obtener todas las estimaciones
  app.get(
    "/",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE, AppRole.VIEWER])],
    },
    async () => {
      const estimations = await prisma.estimation.findMany({
        include: {
          project: true,
        },
        orderBy: { createdAt: "desc" },
      });
      return { data: estimations };
    },
  );

  // 2. Obtener estimaciones por proyecto
  app.get(
    "/project/:projectId",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE, AppRole.VIEWER])],
    },
    async (request) => {
      const { projectId } = projectIdParamsSchema.parse(request.params);
      const estimations = await prisma.estimation.findMany({
        where: { projectId },
        include: {
          project: true,
        },
        orderBy: { createdAt: "desc" },
      });
      return { data: estimations };
    },
  );

  // 3. Crear una nueva estimación
  app.post(
    "/",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM])],
    },
    async (request, reply) => {
      const payload = estimationPayloadSchema.parse(request.body);

      // Si hay projectId, validar que exista
      if (payload.projectId) {
        const project = await prisma.project.findUnique({ where: { id: payload.projectId } });
        if (!project) {
          return reply.status(400).send({ message: "Proyecto no válido" });
        }
      }

      const estimation = await prisma.estimation.create({
        data: {
          projectId: payload.projectId,
          projectName: payload.projectName,
          totalIdealHours: payload.totalIdealHours,
          totalAdjustedHours: payload.totalAdjustedHours,
          bufferPercentage: payload.bufferPercentage,
          riskLevel: payload.riskLevel,
          confidenceLevel: payload.confidenceLevel,
          rawDataJson: payload.rawDataJson,
        },
        include: {
          project: true,
        },
      });

      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.estimation,
        entityId: estimation.id,
        action: "CREATE",
        changedBy: request.authUser!.email,
        after: estimation as unknown as Record<string, unknown>,
        request,
      });

      return reply.status(201).send({ data: estimation });
    },
  );

  // 4. Eliminar estimación
  app.delete(
    "/:id",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM])],
    },
    async (request, reply) => {
      const { id } = idParamsSchema.parse(request.params);

      const existing = await prisma.estimation.findUnique({ where: { id } });
      if (!existing) {
        return reply.status(404).send({ message: "Estimación no encontrada" });
      }

      await prisma.estimation.delete({ where: { id } });

      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.estimation,
        entityId: id,
        action: "DELETE",
        changedBy: request.authUser!.email,
        before: existing as unknown as Record<string, unknown>,
        request,
      });

      return reply.status(204).send();
    },
  );
}

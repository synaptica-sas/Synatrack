import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, authorize } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";
import { AUDIT_ENTITIES, writeAudit } from "../../utils/audit.js";

const revenuePayloadSchema = z.object({
  projectId: z.string().min(1),
  entryDate: z.coerce.date(),
  amount: z.coerce.number().positive(),
  currency: z.string().trim().toUpperCase().length(3),
  description: z.string().trim().optional(),
});

const idParamsSchema = z.object({ id: z.string().min(1) });
const projectIdParamsSchema = z.object({ projectId: z.string().min(1) });

// FinancialEntry -> forma pública de RevenueEntry: oculta `type` y `category`
// (esta última solo existe para EXPENSE), para no cambiar el contrato del frontend.
function toRevenueDto<T extends { type: unknown; category: unknown }>(row: T) {
  const { type, category, ...rest } = row;
  return rest;
}

export async function revenueRoutes(app: FastifyInstance) {
  // GET /api/revenue?projectId=... — listado por proyecto
  app.get(
    "/",
    {
      preHandler: [
        authenticate,
        authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE, AppRole.VIEWER]),
      ],
    },
    async (request) => {
      const { projectId } = projectIdParamsSchema.partial().parse(request.query);

      const entries = await prisma.financialEntry.findMany({
        where: { type: "REVENUE", projectId },
        include: { project: { select: { id: true, name: true, currency: true } } },
        orderBy: { entryDate: "desc" },
      });

      return { data: entries.map(toRevenueDto) };
    },
  );

  // POST /api/revenue — registrar ingreso
  app.post(
    "/",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE])],
    },
    async (request, reply) => {
      const payload = revenuePayloadSchema.parse(request.body);

      const project = await prisma.project.findUnique({ where: { id: payload.projectId } });
      if (!project) {
        return reply.status(400).send({ message: "Proyecto no encontrado" });
      }

      const entry = await prisma.financialEntry.create({ data: { ...payload, type: "REVENUE" } });

      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.revenueEntry,
        entityId: entry.id,
        action: "CREATE",
        changedBy: request.authUser!.email,
        after: entry as unknown as Record<string, unknown>,
        request,
      });

      return reply.status(201).send({ data: toRevenueDto(entry) });
    },
  );

  // PUT /api/revenue/:id — editar ingreso
  app.put(
    "/:id",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE])],
    },
    async (request, reply) => {
      const { id } = idParamsSchema.parse(request.params);
      const payload = revenuePayloadSchema.parse(request.body);

      const existing = await prisma.financialEntry.findUnique({ where: { id } });
      if (!existing || existing.type !== "REVENUE") {
        return reply.status(404).send({ message: "Ingreso no encontrado" });
      }

      const project = await prisma.project.findUnique({ where: { id: payload.projectId } });
      if (!project) {
        return reply.status(400).send({ message: "Proyecto no encontrado" });
      }

      try {
        const entry = await prisma.financialEntry.update({ where: { id }, data: payload });

        await writeAudit(prisma, {
          entity: AUDIT_ENTITIES.revenueEntry,
          entityId: entry.id,
          action: "UPDATE",
          changedBy: request.authUser!.email,
          before: existing as unknown as Record<string, unknown>,
          after: entry as unknown as Record<string, unknown>,
          request,
        });

        return { data: toRevenueDto(entry) };
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === "P2003" || code === "P2014") {
          return reply.status(409).send({ message: "No se puede actualizar el ingreso debido a un conflicto de registros relacionados" });
        }
        throw err;
      }
    },
  );

  // DELETE /api/revenue/:id — eliminar ingreso
  app.delete(
    "/:id",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE])],
    },
    async (request, reply) => {
      const { id } = idParamsSchema.parse(request.params);

      const existing = await prisma.financialEntry.findUnique({ where: { id } });
      if (!existing || existing.type !== "REVENUE") {
        return reply.status(404).send({ message: "Ingreso no encontrado" });
      }

      try {
        await prisma.financialEntry.delete({ where: { id } });

        await writeAudit(prisma, {
          entity: AUDIT_ENTITIES.revenueEntry,
          entityId: id,
          action: "DELETE",
          changedBy: request.authUser!.email,
          before: existing as unknown as Record<string, unknown>,
          request,
        });

        return reply.status(204).send();
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === "P2003" || code === "P2014") {
          return reply.status(409).send({ message: "No se puede eliminar el ingreso: tiene otros registros relacionados" });
        }
        throw err;
      }
    },
  );
}

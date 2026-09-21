import { AppRole, BlockType } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, authorize } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";
import { AUDIT_ENTITIES, writeAudit } from "../../utils/audit.js";

const blockPayloadSchema = z
  .object({
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    blockType: z.nativeEnum(BlockType).default("OTHER"),
    note: z.string().trim().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.endDate < val.startDate) {
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "endDate must be after startDate" });
    }
  });

const paramsSchema = z.object({ consultantId: z.string().min(1) });
const blockIdSchema = z.object({ consultantId: z.string().min(1), blockId: z.string().min(1) });

export async function blocksRoutes(app: FastifyInstance) {
  // GET /api/consultants/:consultantId/blocks
  app.get(
    "/:consultantId/blocks",
    { preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE, AppRole.VIEWER])] },
    async (request, reply) => {
      const { consultantId } = paramsSchema.parse(request.params);
      const consultant = await prisma.consultant.findUnique({ where: { id: consultantId } });
      if (!consultant) return reply.status(404).send({ message: "Consultor no encontrado" });

      const blocks = await prisma.consultantBlock.findMany({
        where: { consultantId },
        orderBy: { startDate: "asc" },
      });
      return { data: blocks };
    },
  );

  // POST /api/consultants/:consultantId/blocks
  app.post(
    "/:consultantId/blocks",
    { preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM])] },
    async (request, reply) => {
      const { consultantId } = paramsSchema.parse(request.params);
      const payload = blockPayloadSchema.parse(request.body);

      const consultant = await prisma.consultant.findUnique({ where: { id: consultantId } });
      if (!consultant) return reply.status(404).send({ message: "Consultor no encontrado" });

      const block = await prisma.consultantBlock.create({ data: { consultantId, ...payload } });
      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.consultantBlock,
        entityId: block.id,
        action: "CREATE",
        changedBy: request.authUser!.email,
        after: block as unknown as Record<string, unknown>,
        request,
      });

      return reply.status(201).send({ data: block });
    },
  );

  // DELETE /api/consultants/:consultantId/blocks/:blockId
  app.delete(
    "/:consultantId/blocks/:blockId",
    { preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM])] },
    async (request, reply) => {
      const { consultantId, blockId } = blockIdSchema.parse(request.params);
      const block = await prisma.consultantBlock.findFirst({ where: { id: blockId, consultantId } });
      if (!block) return reply.status(404).send({ message: "Bloqueo no encontrado" });

      try {
        await prisma.consultantBlock.delete({ where: { id: blockId } });

        await writeAudit(prisma, {
          entity: AUDIT_ENTITIES.consultantBlock,
          entityId: blockId,
          action: "DELETE",
          changedBy: request.authUser!.email,
          before: block as unknown as Record<string, unknown>,
          request,
        });

        return reply.status(204).send();
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === "P2003" || code === "P2014") {
          return reply.status(409).send({ message: "No se puede eliminar el bloqueo: tiene otros registros relacionados" });
        }
        throw err;
      }
    },
  );
}

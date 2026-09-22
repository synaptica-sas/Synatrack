import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, authorize } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";
import { AUDIT_ENTITIES, writeAudit } from "../../utils/audit.js";

const expensePayloadSchema = z.object({
  projectId: z.string().min(1),
  expenseDate: z.coerce.date(),
  category: z.string().trim().min(1),
  amount: z.coerce.number().positive(),
  currency: z
    .string()
    .trim()
    .length(3, "currency must be a 3-letter ISO code")
    .transform((value) => value.toUpperCase()),
  description: z.string().trim().optional(),
});

const idParamsSchema = z.object({ id: z.string().min(1) });

export async function expensesRoutes(app: FastifyInstance) {
  app.get(
    "/",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE, AppRole.VIEWER])],
    },
    async () => {
    const expenses = await prisma.expense.findMany({
      include: { project: true },
      orderBy: { expenseDate: "desc" },
    });

      return { data: expenses };
    },
  );

  app.post(
    "/",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE])],
    },
    async (request, reply) => {
    const payload = expensePayloadSchema.parse(request.body);

    const project = await prisma.project.findUnique({ where: { id: payload.projectId } });
    if (!project) {
      return reply.status(400).send({ message: "Invalid projectId" });
    }

    const expense = await prisma.expense.create({
      data: payload,
    });

    await writeAudit(prisma, {
      entity: AUDIT_ENTITIES.expense,
      entityId: expense.id,
      action: "CREATE",
      changedBy: request.authUser!.email,
      after: expense as unknown as Record<string, unknown>,
      request,
    });

      return reply.status(201).send({ data: expense });
    },
  );

  app.put(
    "/:id",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE])],
    },
    async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const payload = expensePayloadSchema.parse(request.body);

    const existing = await prisma.expense.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ message: "Expense not found" });
    }

    const project = await prisma.project.findUnique({ where: { id: payload.projectId } });
    if (!project) {
      return reply.status(400).send({ message: "Invalid projectId" });
    }

    const expense = await prisma.expense.update({
      where: { id },
      data: payload,
    });

    await writeAudit(prisma, {
      entity: AUDIT_ENTITIES.expense,
      entityId: expense.id,
      action: "UPDATE",
      changedBy: request.authUser!.email,
      before: existing as unknown as Record<string, unknown>,
      after: expense as unknown as Record<string, unknown>,
      request,
    });

      return { data: expense };
    },
  );

  app.delete(
    "/:id",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE])],
    },
    async (request, reply) => {
      const { id } = idParamsSchema.parse(request.params);

      const existing = await prisma.expense.findUnique({ where: { id } });
      if (!existing) {
        return reply.status(404).send({ message: "Expense not found" });
      }

      try {
        await prisma.expense.delete({ where: { id } });

        await writeAudit(prisma, {
          entity: AUDIT_ENTITIES.expense,
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
          return reply.status(409).send({ message: "No se puede eliminar el gasto: tiene registros relacionados" });
        }
        throw err;
      }
    },
  );
}

import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, authorize } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";
import { AUDIT_ENTITIES, writeAudit } from "../../utils/audit.js";
import {
  conversionStatus,
  convertAmountDatedDetailed,
  createConversionLedger,
  recordDatedQuality,
} from "../../utils/currency.js";
import { cargarLibroDeTasas } from "../fx/rate-book.service.js";

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

/**
 * Moneda en la que se quiere ver el listado (R-026). Si no se pide ninguna se
 * usa la base de la aplicación, igual que hacen `/stats/overview` y `/portfolio`.
 */
const listQuerySchema = z.object({
  base: z
    .string()
    .trim()
    .length(3, "base must be a 3-letter ISO code")
    .transform((value) => value.toUpperCase())
    .optional(),
});

// FinancialEntry -> forma pública de Expense: expone `expenseDate` (no `entryDate`)
// y oculta el discriminador `type`, para no cambiar el contrato que ya consume el frontend.
function toExpenseDto<T extends { entryDate: Date; type: unknown }>(row: T) {
  const { entryDate, type, ...rest } = row;
  return { ...rest, expenseDate: entryDate };
}

export async function expensesRoutes(app: FastifyInstance) {
  app.get(
    "/",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE, AppRole.VIEWER])],
    },
    async (request) => {
      const query = listQuerySchema.parse(request.query);

      // R-026: la conversión de la pantalla de Gastos se hace AQUÍ, no en el
      // cliente. Hasta ahora `gastosUtils.convertToBase` reconvertía cada
      // importe con la tasa de HOY, así que los mismos gastos sumaban distinto
      // en Gastos que en el Tablero, que ya valora cada movimiento a la tasa de
      // su propia fecha (R-008/R-012). Se devuelve el importe ya convertido para
      // que el cliente solo tenga que sumar: una sola aritmética, la del backend.
      const { rateBook, baseCurrency: basePorDefecto } = await cargarLibroDeTasas(prisma);
      const baseCurrency = query.base ?? basePorDefecto;
      const ledger = createConversionLedger();

      const expenses = await prisma.financialEntry.findMany({
        where: { type: "EXPENSE" },
        include: { project: true },
        orderBy: { entryDate: "desc" },
      });

      const data = expenses.map((row) => {
        const { amount, quality } = convertAmountDatedDetailed(
          Number(row.amount),
          row.currency,
          baseCurrency,
          row.entryDate,
          rateBook,
        );
        // Mismo criterio que DEP-32: un importe de 0 no ensucia el libro.
        if (Number(row.amount) !== 0) {
          recordDatedQuality(ledger, quality, row.currency, baseCurrency);
        }
        return {
          ...toExpenseDto(row),
          baseCurrency,
          baseAmount: amount,
          conversionQuality: quality,
        };
      });

      // `conversion` cubre TODO lo devuelto. La pantalla filtra en el cliente, así
      // que para rotular el subconjunto a la vista usa las marcas por gasto
      // (`conversionQuality`); este consolidado es el del listado completo y
      // mantiene el mismo contrato que el resto de endpoints.
      return { data, conversion: conversionStatus(ledger), baseCurrency };
    },
  );

  app.post(
    "/",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE])],
    },
    async (request, reply) => {
      const { expenseDate, ...payload } = expensePayloadSchema.parse(request.body);

      const project = await prisma.project.findUnique({ where: { id: payload.projectId } });
      if (!project) {
        return reply.status(400).send({ message: "Invalid projectId" });
      }

      const expense = await prisma.financialEntry.create({
        data: { ...payload, type: "EXPENSE", entryDate: expenseDate },
      });

      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.expense,
        entityId: expense.id,
        action: "CREATE",
        changedBy: request.authUser!.email,
        after: expense as unknown as Record<string, unknown>,
        request,
      });

      return reply.status(201).send({ data: toExpenseDto(expense) });
    },
  );

  app.put(
    "/:id",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE])],
    },
    async (request, reply) => {
      const { id } = idParamsSchema.parse(request.params);
      const { expenseDate, ...payload } = expensePayloadSchema.parse(request.body);

      const existing = await prisma.financialEntry.findUnique({ where: { id } });
      if (!existing || existing.type !== "EXPENSE") {
        return reply.status(404).send({ message: "Expense not found" });
      }

      const project = await prisma.project.findUnique({ where: { id: payload.projectId } });
      if (!project) {
        return reply.status(400).send({ message: "Invalid projectId" });
      }

      const expense = await prisma.financialEntry.update({
        where: { id },
        data: { ...payload, entryDate: expenseDate },
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

      return { data: toExpenseDto(expense) };
    },
  );

  app.delete(
    "/:id",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE])],
    },
    async (request, reply) => {
      const { id } = idParamsSchema.parse(request.params);

      const existing = await prisma.financialEntry.findUnique({ where: { id } });
      if (!existing || existing.type !== "EXPENSE") {
        return reply.status(404).send({ message: "Expense not found" });
      }

      try {
        await prisma.financialEntry.delete({ where: { id } });

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

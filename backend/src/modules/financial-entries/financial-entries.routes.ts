import { AppRole, FinancialEntryType } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, authorize } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";

// Lectura unificada de gastos e ingresos (tabla FinancialEntry), pensada para
// reportería que necesite ambos tipos de movimiento juntos. Los paneles de
// Gastos e Ingresos siguen usando /api/expenses y /api/revenue por separado;
// este endpoint no tiene escritura propia.
const listQuerySchema = z
  .object({
    projectId: z.string().trim().optional(),
    type: z.nativeEnum(FinancialEntryType).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    // Mismo contrato de paginación que `/api/audit`.
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(50),
  })
  .superRefine((value, ctx) => {
    if (value.from && value.to && value.to < value.from) {
      ctx.addIssue({ code: "custom", path: ["to"], message: "to date cannot be before from date" });
    }
  });

export async function financialEntriesRoutes(app: FastifyInstance) {
  app.get(
    "/",
    {
      preHandler: [
        authenticate,
        authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE, AppRole.VIEWER]),
      ],
    },
    async (request) => {
      const query = listQuerySchema.parse(request.query);

      const where = {
        projectId: query.projectId || undefined,
        type: query.type,
        entryDate: { gte: query.from, lte: query.to },
      };
      const skip = (query.page - 1) * query.pageSize;

      // El desempate por `id` mantiene estable el orden entre páginas: varios
      // movimientos comparten la misma `entryDate`.
      const [entries, total] = await Promise.all([
        prisma.financialEntry.findMany({
          where,
          include: { project: { select: { id: true, name: true, currency: true } } },
          orderBy: [{ entryDate: "desc" }, { id: "desc" }],
          skip,
          take: query.pageSize,
        }),
        prisma.financialEntry.count({ where }),
      ]);

      return {
        data: entries,
        meta: {
          total,
          page: query.page,
          pageSize: query.pageSize,
          totalPages: Math.ceil(total / query.pageSize),
        },
      };
    },
  );
}

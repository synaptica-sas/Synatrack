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

      const entries = await prisma.financialEntry.findMany({
        where: {
          projectId: query.projectId || undefined,
          type: query.type,
          entryDate: { gte: query.from, lte: query.to },
        },
        include: { project: { select: { id: true, name: true, currency: true } } },
        orderBy: { entryDate: "desc" },
      });

      return { data: entries };
    },
  );
}

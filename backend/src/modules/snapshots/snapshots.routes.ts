import { AppRole, TimeEntryStatus } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, authorize } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";
import { buildRateMap, convertAmountFallback } from "../../utils/currency.js";
import { AUDIT_ENTITIES, writeAudit } from "../../utils/audit.js";

const closePayloadSchema = z.object({
  projectId: z.string().min(1),
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  baseCurrency: z.string().trim().toUpperCase().length(3).default("USD"),
});

const listQuerySchema = z.object({
  projectId: z.string().optional(),
  year: z.coerce.number().int().optional(),
  month: z.coerce.number().int().optional(),
});

export async function snapshotsRoutes(app: FastifyInstance) {
  // POST /api/snapshots/close — cierra el mes para un proyecto
  app.post(
    "/close",
    { preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.FINANCE])] },
    async (request, reply) => {
      const payload = closePayloadSchema.parse(request.body);
      const { projectId, year, month, baseCurrency } = payload;
      const performedBy = request.authUser!.email;

      const existing = await prisma.monthlySnapshot.findUnique({
        where: { projectId_year_month: { projectId, year, month } },
      });
      if (existing) {
        return reply.status(409).send({
          message: `Ya existe un cierre para este proyecto en ${year}-${String(month).padStart(2, "0")}`,
        });
      }

      const project = await prisma.project.findUnique({ where: { id: projectId } });
      if (!project) return reply.status(404).send({ message: "Proyecto no encontrado" });

      const startOfMonth = new Date(Date.UTC(year, month - 1, 1));
      const endOfMonth = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

      const [fxConfigs, timeEntries, expenses, revenueEntries] = await Promise.all([
        prisma.fxConfig.findMany(),
        prisma.timeEntry.findMany({
          where: {
            projectId,
            status: TimeEntryStatus.APPROVED,
            workDate: { gte: startOfMonth, lte: endOfMonth },
          },
          include: { consultant: { select: { hourlyRate: true, rateCurrency: true } } },
        }),
        prisma.expense.findMany({
          where: { projectId, expenseDate: { gte: startOfMonth, lte: endOfMonth } },
        }),
        prisma.revenueEntry.findMany({
          where: { projectId, entryDate: { gte: startOfMonth, lte: endOfMonth } },
        }),
      ]);

      const rateMap = buildRateMap(fxConfigs);

      const laborCostActual = timeEntries.reduce((s, e) => {
        const rate = Number(e.consultant.hourlyRate ?? 0);
        return s + convertAmountFallback(Number(e.hours) * rate, e.consultant.rateCurrency, baseCurrency, rateMap);
      }, 0);

      const expensesActual = expenses.reduce(
        (s, e) => s + convertAmountFallback(Number(e.amount), e.currency, baseCurrency, rateMap),
        0,
      );

      const revenueRecognized = revenueEntries.reduce(
        (s, r) => s + convertAmountFallback(Number(r.amount), r.currency, baseCurrency, rateMap),
        0,
      );

      const contractValue = project.sellPrice
        ? convertAmountFallback(Number(project.sellPrice), project.sellCurrency, baseCurrency, rateMap)
        : 0;

      const totalCostActual = laborCostActual + expensesActual;
      const grossMargin = revenueRecognized - totalCostActual;
      const grossMarginPct = revenueRecognized > 0 ? (grossMargin / revenueRecognized) * 100 : 0;
      const hoursApproved = timeEntries.reduce((s, e) => s + Number(e.hours), 0);

      // Snapshot de tasas FX en el momento del cierre
      const fxSnapshotJson: Record<string, number> = {};
      for (const fx of fxConfigs) {
        fxSnapshotJson[`${fx.baseCode}->${fx.quoteCode}`] = Number(fx.rate);
      }

      const snapshot = await prisma.monthlySnapshot.create({
        data: {
          projectId,
          year,
          month,
          baseCurrency,
          laborCostActual,
          expensesActual,
          totalCostActual,
          revenueRecognized,
          contractValue,
          grossMargin,
          grossMarginPct,
          hoursApproved,
          fxSnapshotJson,
          closedBy: performedBy,
          closedAt: new Date(),
        },
      });

      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.monthlySnapshot,
        entityId: snapshot.id,
        action: "CLOSE",
        changedBy: performedBy,
        after: { projectId, year, month, baseCurrency, grossMargin, grossMarginPct } as Record<string, unknown>,
        request,
      });

      return reply.status(201).send({ data: snapshot });
    },
  );

  // GET /api/snapshots
  app.get(
    "/",
    { preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE, AppRole.VIEWER])] },
    async (request) => {
      const query = listQuerySchema.parse(request.query);
      const snapshots = await prisma.monthlySnapshot.findMany({
        where: {
          projectId: query.projectId,
          year: query.year,
          month: query.month,
        },
        include: { project: { select: { id: true, name: true, company: true } } },
        orderBy: [{ year: "desc" }, { month: "desc" }],
      });
      return { data: snapshots };
    },
  );

  // GET /api/snapshots/trend/:projectId
  app.get(
    "/trend/:projectId",
    { preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE, AppRole.VIEWER])] },
    async (request, reply) => {
      const { projectId } = z.object({ projectId: z.string().min(1) }).parse(request.params);
      const query = z
        .object({ from: z.string().regex(/^\d{4}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}$/).optional() })
        .parse(request.query);

      const project = await prisma.project.findUnique({ where: { id: projectId } });
      if (!project) return reply.status(404).send({ message: "Proyecto no encontrado" });

      const snapshots = await prisma.monthlySnapshot.findMany({
        where: { projectId },
        orderBy: [{ year: "asc" }, { month: "asc" }],
      });

      const filtered = snapshots.filter((s) => {
        const key = `${s.year}-${String(s.month).padStart(2, "0")}`;
        if (query.from && key < query.from) return false;
        if (query.to && key > query.to) return false;
        return true;
      });

      return { data: { project: { id: project.id, name: project.name }, trend: filtered } };
    },
  );
}

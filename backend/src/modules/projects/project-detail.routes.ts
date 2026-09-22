import { AppRole, HealthStatus, ProjectPhase } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, authorize } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";
import { buildRateMap, convertAmountFallback } from "../../utils/currency.js";
import { computeEVM } from "../../utils/evm.js";
import { computeProjectFinancials, toFinancialsInput } from "../../utils/financial.js";
import { computeHealthStatus, countDelayedMilestones, countOpenHighRisks } from "../../utils/health.js";
import { AUDIT_ENTITIES, writeAudit } from "../../utils/audit.js";

const idSchema = z.object({ id: z.string().min(1) });

export async function projectDetailRoutes(app: FastifyInstance) {
  // GET /api/projects/:id/detail — vista completa de un proyecto
  app.get(
    "/:id/detail",
    { preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE, AppRole.VIEWER])] },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);

      const project = await prisma.project.findUnique({
        where: { id },
        include: {
          milestones: { orderBy: { plannedDate: "asc" } },
          risks: { orderBy: [{ riskScore: "desc" }, { createdBy: "asc" }] },
          issues: { orderBy: [{ severity: "desc" }, { createdAt: "desc" }] },
          changeRequests: { orderBy: { createdAt: "desc" } },
          assignments: {
            where: { status: { in: ["ACTIVE", "PARTIAL", "PLANNED"] } },
            include: { consultant: { select: { id: true, fullName: true, role: true, country: true } } },
          },
          timeEntries: {
            where: { status: "APPROVED" },
            include: { consultant: { select: { hourlyRate: true, rateCurrency: true } } },
          },
          financialEntries: true,
          forecasts: { include: { consultant: { select: { hourlyRate: true, rateCurrency: true } } } },
        },
      });

      if (!project) return reply.status(404).send({ message: "Proyecto no encontrado" });

      const fxConfigs = await prisma.fxConfig.findMany();
      const rateMap = buildRateMap(fxConfigs);
      const baseCurrency = fxConfigs[0]?.baseCode ?? "USD";

      // Un solo "ahora" por petición; las utilidades no leen el reloj.
      const now = new Date();

      // Cálculo financiero unificado (utils/financial.ts): exactamente la misma
      // fórmula que /api/stats/overview y /api/stats/portfolio.
      // ANTES esta ruta ignoraba los forecasts (que ya venían cargados) y
      // calculaba `alertLevel` solo sobre el gasto real, por lo que un proyecto
      // con desvío proyectado salía "ok" aquí y "warning"/"exceeded" allá.
      const fin = computeProjectFinancials(
        toFinancialsInput(project, project.timeEntries, rateMap, baseCurrency),
      );

      const budget = fin.budget;
      const laborCostActual = fin.laborCostActual;
      const expensesActual = fin.expensesActual;
      const totalCostActual = fin.totalCostActual;
      const revenueRecognized = fin.revenueRecognized;
      const approvedHours = fin.approvedHours;
      const usedBudgetPct = fin.budgetConsumedPct;
      const alertLevel = fin.alertLevel;
      const grossMarginActual = fin.grossMarginActual;
      const grossMarginActualPct = fin.grossMarginActualPct;

      const evm = computeEVM({
        budget,
        completionPct: project.completionPct ? Number(project.completionPct) : null,
        startDate: project.startDate,
        endDate: project.endDate,
        totalCostActual,
      });

      const openHighRisks = countOpenHighRisks(project.risks);
      // ANTES: solo `status === "DELAYED"` (hay que marcarlo a mano), mientras
      // stats lo derivaba de la fecha planeada. Criterio homologado en health.ts.
      const delayedMilestones = countDelayedMilestones(project.milestones, now);

      const healthStatus = computeHealthStatus({
        alertLevel,
        grossMarginActualPct,
        marginThreshold: fin.marginThreshold,
        openHighRisks,
        delayedMilestones,
        cpi: evm.cpi,
        spi: evm.spi,
        utilizationPct: 0,
      });

      // Auto-update healthStatus if it changed
      if (healthStatus !== project.healthStatus) {
        await prisma.project.update({ where: { id }, data: { healthStatus } });
      }

      return {
        data: {
          project: {
            id: project.id,
            name: project.name,
            company: project.company,
            country: project.country,
            currency: project.currency,
            status: project.status,
            projectType: project.projectType,
            phase: project.phase,
            healthStatus,
            completionPct: project.completionPct ? Number(project.completionPct) : null,
            projectManagerEmail: project.projectManagerEmail,
            startDate: project.startDate,
            endDate: project.endDate,
            baselineBudget: project.baselineBudget ? Number(project.baselineBudget) : null,
            baselineStartDate: project.baselineStartDate,
            baselineEndDate: project.baselineEndDate,
            baselineSetAt: project.baselineSetAt,
            baselineSetBy: project.baselineSetBy,
          },
          financials: {
            displayCurrency: baseCurrency,
            budget,
            spent: totalCostActual,
            laborCostActual,
            expensesActual,
            remainingBudget: budget - totalCostActual,
            usedBudgetPercent: usedBudgetPct,
            projectedPct: fin.projectedPct,
            projectedTotal: fin.totalCostProjected,
            alertLevel,
            contractValue: fin.contractValue,
            revenueRecognized,
            grossMarginActual,
            grossMarginActualPct,
            marginThreshold: fin.marginThreshold,
            approvedHours,
          },
          evm,
          milestones: project.milestones,
          risks: project.risks,
          issues: project.issues,
          changeRequests: project.changeRequests,
          assignments: project.assignments,
          summary: {
            totalMilestones: project.milestones.length,
            completedMilestones: project.milestones.filter((m) => m.status === "COMPLETED").length,
            delayedMilestones,
            openRisks: project.risks.filter((r) => r.status === "OPEN").length,
            openHighRisks,
            openIssues: project.issues.filter((i) => i.status === "OPEN" || i.status === "IN_PROGRESS").length,
            pendingChanges: project.changeRequests.filter((c) => c.status === "PENDING").length,
          },
        },
      };
    },
  );

  // PATCH /api/projects/:id/health
  app.patch(
    "/:id/health",
    { preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM])] },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const { healthStatus } = z.object({ healthStatus: z.nativeEnum(HealthStatus) }).parse(request.body);
      const project = await prisma.project.findUnique({ where: { id } });
      if (!project) return reply.status(404).send({ message: "Proyecto no encontrado" });
      const updated = await prisma.project.update({ where: { id }, data: { healthStatus } });
      return { data: updated };
    },
  );

  // PATCH /api/projects/:id/completion
  app.patch(
    "/:id/completion",
    { preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM])] },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const { completionPct } = z.object({ completionPct: z.coerce.number().min(0).max(100) }).parse(request.body);
      const project = await prisma.project.findUnique({ where: { id } });
      if (!project) return reply.status(404).send({ message: "Proyecto no encontrado" });
      const updated = await prisma.project.update({ where: { id }, data: { completionPct } });
      return { data: updated };
    },
  );

  // PATCH /api/projects/:id/baseline
  app.patch(
    "/:id/baseline",
    { preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM])] },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const performedBy = request.authUser!.email;

      const project = await prisma.project.findUnique({ where: { id } });
      if (!project) return reply.status(404).send({ message: "Proyecto no encontrado" });
      if (project.baselineSetAt) return reply.status(409).send({ message: "La línea base ya fue establecida. Use un cambio de alcance para modificarla." });

      const updated = await prisma.project.update({
        where: { id },
        data: {
          baselineBudget: project.budget,
          baselineStartDate: project.startDate,
          baselineEndDate: project.endDate,
          baselineSetAt: new Date(),
          baselineSetBy: performedBy,
        },
      });

      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.project,
        entityId: id,
        action: "UPDATE",
        changedBy: performedBy,
        after: { baselineBudget: Number(project.budget), baselineStartDate: project.startDate, baselineEndDate: project.endDate } as Record<string, unknown>,
        request,
      });

      return { data: updated };
    },
  );

  // GET /api/projects/:id/timeline — datos temporales para burndown EVM
  app.get(
    "/:id/timeline",
    { preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE, AppRole.VIEWER])] },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);

      const project = await prisma.project.findUnique({
        where: { id },
        include: {
          timeEntries: {
            where: { status: "APPROVED" },
            orderBy: { workDate: "asc" },
            include: { consultant: { select: { hourlyRate: true, rateCurrency: true } } },
          },
          financialEntries: { where: { type: "EXPENSE" }, orderBy: { entryDate: "asc" } },
        },
      });

      if (!project) return reply.status(404).send({ message: "Proyecto no encontrado" });

      const fxConfigs = await prisma.fxConfig.findMany();
      const rateMap = buildRateMap(fxConfigs);
      const baseCurrency = fxConfigs[0]?.baseCode ?? "USD";

      const budget = convertAmountFallback(Number(project.budget), project.currency, baseCurrency, rateMap);
      const bac = budget;
      const start = project.startDate;
      const end = project.endDate;
      const totalDays = Math.max(
        Math.ceil((end.getTime() - start.getTime()) / 86_400_000),
        1,
      );

      // Collect cost events by date
      const costByDate = new Map<string, number>();
      for (const entry of project.timeEntries) {
        const dateKey = entry.workDate.toISOString().slice(0, 10);
        const rate = Number(entry.consultant.hourlyRate ?? 0);
        const cost = convertAmountFallback(Number(entry.hours) * rate, entry.consultant.rateCurrency, baseCurrency, rateMap);
        costByDate.set(dateKey, (costByDate.get(dateKey) ?? 0) + cost);
      }
      for (const expense of project.financialEntries) {
        const dateKey = expense.entryDate.toISOString().slice(0, 10);
        const cost = convertAmountFallback(Number(expense.amount), expense.currency, baseCurrency, rateMap);
        costByDate.set(dateKey, (costByDate.get(dateKey) ?? 0) + cost);
      }

      // Build cumulative actual cost series (monthly buckets)
      const monthBuckets = new Map<string, number>();
      for (const [dateKey, cost] of costByDate) {
        const monthKey = dateKey.slice(0, 7); // YYYY-MM
        monthBuckets.set(monthKey, (monthBuckets.get(monthKey) ?? 0) + cost);
      }

      const sortedMonths = Array.from(monthBuckets.keys()).sort();
      let cumulative = 0;
      const actualCost: { month: string; ac: number }[] = sortedMonths.map((month) => {
        cumulative += monthBuckets.get(month) ?? 0;
        return { month, ac: Math.round(cumulative * 100) / 100 };
      });

      // Build planned value series (linear interpolation from start to end)
      const plannedValue: { month: string; pv: number }[] = [];
      if (bac > 0 && totalDays > 0) {
        const startYear = start.getFullYear();
        const startMonth = start.getMonth();
        const endYear = end.getFullYear();
        const endMonth = end.getMonth();
        const totalMonths = (endYear - startYear) * 12 + (endMonth - startMonth) + 1;
        for (let i = 0; i < totalMonths; i++) {
          const d = new Date(startYear, startMonth + i, 1);
          const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
          const elapsedDays = Math.min(
            Math.ceil((new Date(d.getFullYear(), d.getMonth() + 1, 0).getTime() - start.getTime()) / 86_400_000),
            totalDays,
          );
          const pv = Math.round((Math.max(elapsedDays, 0) / totalDays) * bac * 100) / 100;
          plannedValue.push({ month: monthKey, pv });
        }
      }

      return {
        data: {
          projectId: id,
          projectName: project.name,
          baseCurrency,
          bac,
          startDate: start,
          endDate: end,
          completionPct: project.completionPct ? Number(project.completionPct) : null,
          actualCost,
          plannedValue,
        },
      };
    },
  );

  // PATCH /api/projects/:id/phase
  app.patch(
    "/:id/phase",
    { preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM])] },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const { phase } = z.object({ phase: z.nativeEnum(ProjectPhase) }).parse(request.body);
      const project = await prisma.project.findUnique({ where: { id } });
      if (!project) return reply.status(404).send({ message: "Proyecto no encontrado" });
      const updated = await prisma.project.update({ where: { id }, data: { phase } });
      return { data: updated };
    },
  );
}

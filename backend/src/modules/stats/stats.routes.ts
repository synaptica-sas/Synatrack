import type { FastifyInstance } from "fastify";
import { AppRole, TimeEntryStatus } from "@prisma/client";
import { z } from "zod";
import { authenticate, authorize } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";
import { buildRateMap } from "../../utils/currency.js";
import { computeProjectFinancials, toFinancialsInput } from "../../utils/financial.js";
import { computeEVM } from "../../utils/evm.js";
import { computeHealthStatus, countDelayedMilestones, countOpenHighRisks } from "../../utils/health.js";

const statsQuerySchema = z
  .object({
    company: z.string().trim().optional(),
    projectId: z.string().trim().optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    baseCurrency: z.string().trim().toUpperCase().length(3).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.from && value.to && value.to < value.from) {
      ctx.addIssue({
        code: "custom",
        path: ["to"],
        message: "to date cannot be before from date",
      });
    }
  });

export async function statsRoutes(app: FastifyInstance) {
  app.get(
    "/overview",
    {
      preHandler: [
        authenticate,
        authorize([AppRole.ADMIN, AppRole.PM, AppRole.CONSULTANT, AppRole.FINANCE, AppRole.VIEWER]),
      ],
    },
    async (request) => {
      const query = statsQuerySchema.parse(request.query);

      const fxConfigs = await prisma.fxConfig.findMany();
      const rateMap = buildRateMap(fxConfigs);
      const baseCurrency = query.baseCurrency ?? fxConfigs[0]?.baseCode ?? "USD";
      // Un solo "ahora" por petición; las utilidades no leen el reloj.
      const now = new Date();

      const projects = await prisma.project.findMany({
        where: {
          id: query.projectId || undefined,
          company: query.company ? { equals: query.company, mode: "insensitive" } : undefined,
        },
        include: {
          timeEntries: {
            where: { workDate: { gte: query.from, lte: query.to } },
            include: { consultant: { select: { hourlyRate: true, rateCurrency: true } } },
          },
          expenses: {
            where: { expenseDate: { gte: query.from, lte: query.to } },
          },
          forecasts: {
            include: { consultant: { select: { hourlyRate: true, rateCurrency: true } } },
          },
          revenueEntries: true,
          milestones: { select: { status: true, plannedDate: true, weight: true } },
          risks: { select: { riskScore: true, status: true } },
        },
      });

      const byProject = projects.map((project) => {
        const approvedEntries = project.timeEntries.filter(
          (e) => e.status === TimeEntryStatus.APPROVED,
        );
        const totalHours = project.timeEntries.reduce((s, e) => s + Number(e.hours), 0);

        // Cálculo financiero unificado (utils/financial.ts) — misma fórmula que
        // /portfolio, el detalle del proyecto y el motor de alertas.
        const fin = computeProjectFinancials(
          toFinancialsInput(project, approvedEntries, rateMap, baseCurrency),
        );

        const spent = fin.totalCostActual;
        const budget = fin.budget;
        const totalProjected = fin.totalCostProjected;
        const alertLevel = fin.alertLevel;

        // EVM
        const evm = project.startDate && project.endDate
          ? computeEVM({
              budget,
              completionPct: project.completionPct ? Number(project.completionPct) : null,
              startDate: project.startDate,
              endDate: project.endDate,
              totalCostActual: spent,
            })
          : null;

        // Riesgos e hitos con el criterio homologado de health.ts
        const openHighRisks = countOpenHighRisks(project.risks ?? []);
        const delayedMilestones = countDelayedMilestones(project.milestones ?? [], now);

        // RAG health — el umbral sale SIEMPRE de project.marginThreshold
        const healthStatus = computeHealthStatus({
          alertLevel,
          grossMarginActualPct: fin.grossMarginActualPct,
          marginThreshold: fin.marginThreshold,
          openHighRisks,
          delayedMilestones,
          spi: evm?.spi ?? null,
          cpi: evm?.cpi ?? null,
          utilizationPct: 0,
        });

        return {
          projectId: project.id,
          projectName: project.name,
          company: project.company,
          currency: project.currency,
          projectType: project.projectType,
          status: project.status,
          phase: project.phase,
          completionPct: project.completionPct ? Number(project.completionPct) : 0,
          healthStatus,
          displayCurrency: baseCurrency,
          // Presupuesto
          budget,
          spent,
          remainingBudget: budget - spent,
          usedBudgetPercent: fin.budgetConsumedPct,
          projectedCost: fin.laborCostForecast,
          projectedTotal: totalProjected,
          projectedPct: fin.projectedPct,
          estimateAtCompletion: fin.estimateAtCompletion,
          budgetVariance: fin.budgetVariance,
          // Ingresos y margen
          contractValue: fin.contractValue,
          revenueRecognized: fin.revenueRecognized,
          grossMarginActual: fin.grossMarginActual,
          grossMarginActualPct: fin.grossMarginActualPct,
          grossMarginProjected: fin.grossMarginProjected,
          grossMarginProjectedPct: fin.grossMarginProjectedPct,
          marginThreshold: fin.marginThreshold,
          // Horas
          totalHours,
          approvedHours: fin.approvedHours,
          // Desglose de gasto
          laborCostActual: fin.laborCostActual,
          expensesActual: fin.expensesActual,
          // Alerta
          alertLevel,
          // EVM
          evm,
        };
      });

      // Totales consolidados
      const totals = {
        budget: byProject.reduce((s, p) => s + p.budget, 0),
        spent: byProject.reduce((s, p) => s + p.spent, 0),
        laborCostActual: byProject.reduce((s, p) => s + p.laborCostActual, 0),
        expensesActual: byProject.reduce((s, p) => s + p.expensesActual, 0),
        projectedCost: byProject.reduce((s, p) => s + p.projectedCost, 0),
        contractValue: byProject.reduce((s, p) => s + p.contractValue, 0),
        revenueRecognized: byProject.reduce((s, p) => s + p.revenueRecognized, 0),
        grossMarginActual: byProject.reduce((s, p) => s + p.grossMarginActual, 0),
        totalHours: byProject.reduce((s, p) => s + p.totalHours, 0),
        approvedHours: byProject.reduce((s, p) => s + p.approvedHours, 0),
        alertCount: byProject.filter((p) => p.alertLevel !== "ok").length,
        byHealth: {
          GREEN: byProject.filter((p) => p.healthStatus === "GREEN").length,
          YELLOW: byProject.filter((p) => p.healthStatus === "YELLOW").length,
          RED: byProject.filter((p) => p.healthStatus === "RED").length,
        },
        avgCpi: (() => {
          const withCpi = byProject.filter((p) => p.evm?.cpi != null);
          if (withCpi.length === 0) return null;
          return Number((withCpi.reduce((s, p) => s + (p.evm!.cpi ?? 0), 0) / withCpi.length).toFixed(2));
        })(),
        avgSpi: (() => {
          const withSpi = byProject.filter((p) => p.evm?.spi != null);
          if (withSpi.length === 0) return null;
          return Number((withSpi.reduce((s, p) => s + (p.evm!.spi ?? 0), 0) / withSpi.length).toFixed(2));
        })(),
      };

      // Desglose por tipo de proyecto
      const projectTypes = ["FIXED_PRICE", "TIME_AND_MATERIAL", "STAFFING"] as const;
      const byProjectType = Object.fromEntries(
        projectTypes.map((type) => {
          const group = byProject.filter((p) => p.projectType === type);
          return [
            type,
            {
              count: group.length,
              budget: group.reduce((s, p) => s + p.budget, 0),
              spent: group.reduce((s, p) => s + p.spent, 0),
              revenueRecognized: group.reduce((s, p) => s + p.revenueRecognized, 0),
              grossMarginActual: group.reduce((s, p) => s + p.grossMarginActual, 0),
              grossMarginActualPct: (() => {
                const rev = group.reduce((s, p) => s + p.revenueRecognized, 0);
                const margin = group.reduce((s, p) => s + p.grossMarginActual, 0);
                return rev > 0 ? Number(((margin / rev) * 100).toFixed(2)) : null;
              })(),
              approvedHours: group.reduce((s, p) => s + p.approvedHours, 0),
            },
          ];
        }),
      );

      return { data: { baseCurrency, projects: byProject, totals, byProjectType } };
    },
  );

  // ── Portfolio PMO endpoint ──────────────────────────────────────────────────
  app.get(
    "/portfolio",
    {
      preHandler: [
        authenticate,
        authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE, AppRole.VIEWER]),
      ],
    },
    async (request) => {
      const query = statsQuerySchema.parse(request.query);

      const fxConfigs = await prisma.fxConfig.findMany();
      const rateMap = buildRateMap(fxConfigs);
      const baseCurrency = query.baseCurrency ?? fxConfigs[0]?.baseCode ?? "USD";
      // Un solo "ahora" por petición; las utilidades no leen el reloj.
      const now = new Date();

      const projects = await prisma.project.findMany({
        where: {
          id: query.projectId || undefined,
          company: query.company ? { equals: query.company, mode: "insensitive" } : undefined,
        },
        include: {
          timeEntries: {
            include: { consultant: { select: { hourlyRate: true, rateCurrency: true } } },
          },
          expenses: true,
          forecasts: {
            include: { consultant: { select: { hourlyRate: true, rateCurrency: true } } },
          },
          revenueEntries: true,
          milestones: { select: { status: true, plannedDate: true, weight: true } },
          risks: { select: { riskScore: true, status: true } },
          issues: { select: { status: true, severity: true } },
        },
      });

      const portfolioProjects = projects.map((project) => {
        const approvedEntries = project.timeEntries.filter(
          (e) => e.status === TimeEntryStatus.APPROVED,
        );

        // Mismo cálculo unificado que /overview y el detalle del proyecto.
        // ANTES: este endpoint sumaba `hoursProjected * consultant.hourlyRate`
        // sin descontar lo ya aprobado, ignorando `forecast.hourlyRate` y
        // convirtiendo desde la moneda del consultor en vez de la del forecast.
        const fin = computeProjectFinancials(
          toFinancialsInput(project, approvedEntries, rateMap, baseCurrency),
        );

        const spent = fin.totalCostActual;
        const budget = fin.budget;
        const alertLevel = fin.alertLevel;

        const evm =
          project.startDate && project.endDate
            ? computeEVM({
                budget,
                completionPct: project.completionPct ? Number(project.completionPct) : null,
                startDate: project.startDate,
                endDate: project.endDate,
                totalCostActual: spent,
              })
            : null;

        const openHighRisks = countOpenHighRisks(project.risks);
        const delayedMilestones = countDelayedMilestones(project.milestones, now);
        const completedMilestones = project.milestones.filter(
          (m) => m.status === "COMPLETED",
        ).length;
        const openIssues = project.issues.filter(
          (i) => i.status !== "RESOLVED" && i.status !== "CLOSED",
        ).length;
        const criticalIssues = project.issues.filter(
          (i) => i.severity === "CRITICAL" && i.status !== "RESOLVED" && i.status !== "CLOSED",
        ).length;

        const healthStatus = computeHealthStatus({
          alertLevel,
          grossMarginActualPct: fin.grossMarginActualPct,
          marginThreshold: fin.marginThreshold,
          openHighRisks,
          delayedMilestones,
          spi: evm?.spi ?? null,
          cpi: evm?.cpi ?? null,
          utilizationPct: 0,
        });

        return {
          projectId: project.id,
          projectName: project.name,
          company: project.company,
          projectType: project.projectType,
          status: project.status,
          phase: project.phase,
          projectManagerEmail: project.projectManagerEmail,
          startDate: project.startDate,
          endDate: project.endDate,
          completionPct: project.completionPct ? Number(project.completionPct) : 0,
          healthStatus,
          displayCurrency: baseCurrency,
          budget,
          spent,
          usedBudgetPercent: fin.budgetConsumedPct,
          projectedPct: fin.projectedPct,
          revenueRecognized: fin.revenueRecognized,
          grossMarginActual: fin.grossMarginActual,
          grossMarginActualPct: fin.grossMarginActualPct,
          marginThreshold: fin.marginThreshold,
          alertLevel,
          evm,
          // Counts for dashboard badges
          totalMilestones: project.milestones.length,
          completedMilestones,
          delayedMilestones,
          totalRisks: project.risks.length,
          openHighRisks,
          openIssues,
          criticalIssues,
        };
      });

      // Portfolio KPI summary
      const summary = {
        totalProjects: portfolioProjects.length,
        byHealth: {
          GREEN: portfolioProjects.filter((p) => p.healthStatus === "GREEN").length,
          YELLOW: portfolioProjects.filter((p) => p.healthStatus === "YELLOW").length,
          RED: portfolioProjects.filter((p) => p.healthStatus === "RED").length,
        },
        byStatus: {
          ACTIVE: portfolioProjects.filter((p) => p.status === "ACTIVE").length,
          PAUSED: portfolioProjects.filter((p) => p.status === "PAUSED").length,
          CLOSED: portfolioProjects.filter((p) => p.status === "CLOSED").length,
        },
        totalBudget: portfolioProjects.reduce((s, p) => s + p.budget, 0),
        totalSpent: portfolioProjects.reduce((s, p) => s + p.spent, 0),
        totalRevenue: portfolioProjects.reduce((s, p) => s + p.revenueRecognized, 0),
        totalGrossMargin: portfolioProjects.reduce((s, p) => s + p.grossMarginActual, 0),
        criticalCount: portfolioProjects.filter((p) => p.healthStatus === "RED").length,
        alertCount: portfolioProjects.filter((p) => p.alertLevel !== "ok").length,
      };

      return { data: { baseCurrency, projects: portfolioProjects, summary } };
    },
  );
}

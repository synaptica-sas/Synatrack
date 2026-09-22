import type { FastifyInstance } from "fastify";
import { AppRole, TimeEntryStatus } from "@prisma/client";
import { z } from "zod";
import { authenticate, authorize } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";
import { buildRateMap, convertAmountFallback } from "../../utils/currency.js";
import { getAdjustedForecastCost, getAdjustedForecastRevenue } from "../../utils/financial.js";
import { computeEVM } from "../../utils/evm.js";
import { computeHealthStatus } from "../../utils/health.js";

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
          financialEntries: true,
          forecasts: {
            include: { consultant: { select: { hourlyRate: true, rateCurrency: true } } },
          },
          milestones: { select: { status: true, plannedDate: true, weight: true } },
          risks: { select: { riskScore: true, status: true } },
        },
      });

      const byProject = projects.map((project) => {
        // Gastos filtrados por rango de fecha (comportamiento previo, replicado en JS
        // porque ahora vienen de la misma relación que los ingresos, que no se filtran).
        const expensesInRange = project.financialEntries.filter((e) => {
          if (e.type !== "EXPENSE") return false;
          if (query.from && e.entryDate < query.from) return false;
          if (query.to && e.entryDate > query.to) return false;
          return true;
        });
        const revenueEntries = project.financialEntries.filter((e) => e.type === "REVENUE");
        const approvedEntries = project.timeEntries.filter(
          (e) => e.status === TimeEntryStatus.APPROVED,
        );
        const approvedHours = approvedEntries.reduce((s, e) => s + Number(e.hours), 0);
        const totalHours = project.timeEntries.reduce((s, e) => s + Number(e.hours), 0);

        // Costo laboral real: horas aprobadas * tarifa consultor, convertido a base
        const laborCostActual = approvedEntries.reduce((s, e) => {
          const rate = Number(e.consultant.hourlyRate ?? 0);
          const costLocal = Number(e.hours) * rate;
          return s + convertAmountFallback(costLocal, e.consultant.rateCurrency, baseCurrency, rateMap);
        }, 0);

        // Gastos reales en base
        const expensesActual = expensesInRange.reduce((s, e) => {
          return s + convertAmountFallback(Number(e.amount), e.currency, baseCurrency, rateMap);
        }, 0);

        const spent = laborCostActual + expensesActual;

        // Presupuesto en base
        const budget = convertAmountFallback(Number(project.budget), project.currency, baseCurrency, rateMap);

        // Precio de venta en base
        const contractValue = project.sellPrice
          ? convertAmountFallback(Number(project.sellPrice), project.sellCurrency, baseCurrency, rateMap)
          : 0;

        // Ingresos reconocidos
        const revenueRecognized = revenueEntries.reduce((s, r) => {
          return s + convertAmountFallback(Number(r.amount), r.currency, baseCurrency, rateMap);
        }, 0);

        // Forecast ajustado: descuenta horas ya aprobadas por período
        let projectedCost = 0;
        let projectedRevenue = revenueRecognized;

        for (const forecast of project.forecasts) {
          const rangeStart = new Date(forecast.startDate + "T00:00:00Z");
          const rangeEnd   = new Date(forecast.endDate   + "T23:59:59Z");

          const approvedInPeriod = approvedEntries
            .filter(
              (e) =>
                e.consultantId === forecast.consultantId &&
                e.workDate >= rangeStart &&
                e.workDate <= rangeEnd,
            )
            .reduce((s, e) => s + Number(e.hours), 0);

          projectedCost += getAdjustedForecastCost(
            {
              hoursProjected: Number(forecast.hoursProjected),
              hourlyRate: forecast.hourlyRate ? Number(forecast.hourlyRate) : null,
              sellRate: forecast.sellRate ? Number(forecast.sellRate) : null,
              currency: forecast.currency,
            },
            {
              hourlyRate: forecast.consultant.hourlyRate ? Number(forecast.consultant.hourlyRate) : null,
              rateCurrency: forecast.consultant.rateCurrency,
            },
            approvedInPeriod,
            rateMap,
            baseCurrency,
          );

          projectedRevenue += getAdjustedForecastRevenue(
            {
              hoursProjected: Number(forecast.hoursProjected),
              hourlyRate: forecast.hourlyRate ? Number(forecast.hourlyRate) : null,
              sellRate: forecast.sellRate ? Number(forecast.sellRate) : null,
              currency: forecast.currency,
            },
            approvedInPeriod,
            rateMap,
            baseCurrency,
          );
        }

        const totalProjected = spent + projectedCost;
        const projectedPct = budget > 0 ? Number(((totalProjected / budget) * 100).toFixed(2)) : 0;

        // Margen bruto actual y proyectado
        const grossMarginActual = revenueRecognized - spent;
        const grossMarginActualPct =
          revenueRecognized > 0
            ? Number(((grossMarginActual / revenueRecognized) * 100).toFixed(2))
            : null;

        const grossMarginProjected = projectedRevenue - totalProjected;
        const grossMarginProjectedPct =
          projectedRevenue > 0
            ? Number(((grossMarginProjected / projectedRevenue) * 100).toFixed(2))
            : null;

        // Alerta de desvío
        const alertLevel =
          projectedPct > 100 ? "exceeded" : projectedPct > 90 ? "warning" : "ok";

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

        // Riesgos de alto impacto abiertos
        const openHighRisks = (project.risks ?? []).filter(
          (r) => r.riskScore >= 6 && r.status === "OPEN",
        ).length;

        // Hitos atrasados
        const today = new Date();
        const delayedMilestones = (project.milestones ?? []).filter(
          (m) => m.status !== "COMPLETED" && m.plannedDate < today,
        ).length;

        // RAG health
        const healthStatus = computeHealthStatus({
          alertLevel,
          grossMarginActualPct,
          marginThreshold: 15,
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
          usedBudgetPercent: budget > 0 ? Number(((spent / budget) * 100).toFixed(2)) : 0,
          projectedCost,
          projectedTotal: totalProjected,
          projectedPct,
          estimateAtCompletion: totalProjected,
          budgetVariance: budget - totalProjected,
          // Ingresos y margen
          contractValue,
          revenueRecognized,
          grossMarginActual,
          grossMarginActualPct,
          grossMarginProjected,
          grossMarginProjectedPct,
          // Horas
          totalHours,
          approvedHours,
          // Desglose de gasto
          laborCostActual,
          expensesActual,
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

      const projects = await prisma.project.findMany({
        where: {
          id: query.projectId || undefined,
          company: query.company ? { equals: query.company, mode: "insensitive" } : undefined,
        },
        include: {
          timeEntries: {
            include: { consultant: { select: { hourlyRate: true, rateCurrency: true } } },
          },
          financialEntries: true,
          forecasts: {
            include: { consultant: { select: { hourlyRate: true, rateCurrency: true } } },
          },
          milestones: { select: { status: true, plannedDate: true, weight: true } },
          risks: { select: { riskScore: true, status: true } },
          issues: { select: { status: true, severity: true } },
        },
      });

      const portfolioProjects = projects.map((project) => {
        const approvedEntries = project.timeEntries.filter(
          (e) => e.status === TimeEntryStatus.APPROVED,
        );

        const laborCostActual = approvedEntries.reduce((s, e) => {
          const rate = Number(e.consultant.hourlyRate ?? 0);
          return s + convertAmountFallback(Number(e.hours) * rate, e.consultant.rateCurrency, baseCurrency, rateMap);
        }, 0);

        const expensesActual = project.financialEntries
          .filter((e) => e.type === "EXPENSE")
          .reduce((s, e) => {
            return s + convertAmountFallback(Number(e.amount), e.currency, baseCurrency, rateMap);
          }, 0);

        const spent = laborCostActual + expensesActual;
        const budget = convertAmountFallback(Number(project.budget), project.currency, baseCurrency, rateMap);

        const revenueRecognized = project.financialEntries
          .filter((e) => e.type === "REVENUE")
          .reduce((s, r) => {
            return s + convertAmountFallback(Number(r.amount), r.currency, baseCurrency, rateMap);
          }, 0);

        const grossMarginActual = revenueRecognized - spent;
        const grossMarginActualPct =
          revenueRecognized > 0
            ? Number(((grossMarginActual / revenueRecognized) * 100).toFixed(2))
            : null;

        // Costo proyectado: horas forecast pendientes de aprobación
        const laborCostForecast = project.forecasts.reduce((s, f) => {
          const rate = Number(f.consultant.hourlyRate ?? 0);
          return s + convertAmountFallback(Number(f.hoursProjected) * rate, f.consultant.rateCurrency, baseCurrency, rateMap);
        }, 0);
        const totalProjected = spent + laborCostForecast;
        const projectedPct = budget > 0 ? (totalProjected / budget) * 100 : 0;
        const alertLevel =
          projectedPct > 100 ? "exceeded" : projectedPct > 90 ? "warning" : "ok";

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

        const today = new Date();
        const openHighRisks = project.risks.filter(
          (r) => r.riskScore >= 6 && r.status === "OPEN",
        ).length;
        const delayedMilestones = project.milestones.filter(
          (m) => m.status !== "COMPLETED" && m.plannedDate < today,
        ).length;
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
          grossMarginActualPct,
          marginThreshold: 15,
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
          usedBudgetPercent: budget > 0 ? Number(((spent / budget) * 100).toFixed(2)) : 0,
          revenueRecognized,
          grossMarginActual,
          grossMarginActualPct,
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

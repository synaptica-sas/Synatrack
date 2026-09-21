import type { PrismaClient } from "@prisma/client";
import { buildRateMap, convertAmountFallback } from "../../utils/currency.js";
import { addDays } from "../../utils/capacity.js";
import { computeEVM } from "../../utils/evm.js";
import { getLogger } from "../../infra/logger.js";

async function upsertAlert(
  prisma: PrismaClient,
  options: {
    type: "BUDGET_WARNING" | "BUDGET_EXCEEDED" | "ASSIGNMENT_ENDING" | "CONSULTANT_OVERLOADED" | "MARGIN_BELOW_THRESHOLD" | "FORECAST_DEVIATION";
    severity: "INFO" | "WARNING" | "CRITICAL";
    projectId?: string;
    consultantId?: string;
    message: string;
    metadata?: Record<string, unknown>;
  },
) {
  // Verificar si ya existe una alerta activa del mismo tipo para la misma entidad
  const existing = await prisma.alert.findFirst({
    where: {
      type: options.type,
      projectId: options.projectId ?? null,
      consultantId: options.consultantId ?? null,
      resolvedAt: null,
    },
  });

  if (existing) {
    // Actualizar mensaje si cambió
    await prisma.alert.update({
      where: { id: existing.id },
      data: { message: options.message, severity: options.severity, metadata: options.metadata ? JSON.parse(JSON.stringify(options.metadata)) : undefined },
    });
    return;
  }

  await prisma.alert.create({
    data: {
      type: options.type,
      severity: options.severity,
      projectId: options.projectId,
      consultantId: options.consultantId,
      message: options.message,
      metadata: options.metadata ? JSON.parse(JSON.stringify(options.metadata)) : undefined,
    },
  });
}

async function resolveAlert(
  prisma: PrismaClient,
  type: string,
  projectId?: string,
  consultantId?: string,
) {
  await prisma.alert.updateMany({
    where: {
      type: type as never,
      projectId: projectId ?? null,
      consultantId: consultantId ?? null,
      resolvedAt: null,
    },
    data: { resolvedAt: new Date(), resolvedBy: "system" },
  });
}

export async function runAlertEngine(prisma: PrismaClient): Promise<void> {
  const fxConfigs = await prisma.fxConfig.findMany();
  const rateMap = buildRateMap(fxConfigs);
  const baseCurrency = fxConfigs[0]?.baseCode ?? "USD";

  // ── 1. Alertas de presupuesto por proyecto ──────────────────────────
  const projects = await prisma.project.findMany({
    where: { status: "ACTIVE" },
    include: {
      timeEntries: {
        where: { status: "APPROVED" },
        include: { consultant: { select: { hourlyRate: true, rateCurrency: true } } },
      },
      expenses: true,
    },
  });

  for (const project of projects) {
    const budget = convertAmountFallback(Number(project.budget), project.currency, baseCurrency, rateMap);
    if (budget === 0) continue;

    const laborCost = project.timeEntries.reduce((s, e) => {
      const rate = Number(e.consultant.hourlyRate ?? 0);
      return s + convertAmountFallback(Number(e.hours) * rate, e.consultant.rateCurrency, baseCurrency, rateMap);
    }, 0);

    const expensesCost = project.expenses.reduce(
      (s, e) => s + convertAmountFallback(Number(e.amount), e.currency, baseCurrency, rateMap),
      0,
    );

    const spent = laborCost + expensesCost;
    const usedPct = (spent / budget) * 100;
    const alertThreshold = Number(project.budgetAlertPct ?? 90);

    if (usedPct > 100) {
      await upsertAlert(prisma, {
        type: "BUDGET_EXCEEDED",
        severity: "CRITICAL",
        projectId: project.id,
        message: `Proyecto "${project.name}" ha superado el presupuesto (${usedPct.toFixed(1)}% usado)`,
        metadata: { usedPct, spent, budget, currency: baseCurrency },
      });
      await resolveAlert(prisma, "BUDGET_WARNING", project.id);
    } else if (usedPct >= alertThreshold) {
      await upsertAlert(prisma, {
        type: "BUDGET_WARNING",
        severity: "WARNING",
        projectId: project.id,
        message: `Proyecto "${project.name}" ha consumido ${usedPct.toFixed(1)}% del presupuesto`,
        metadata: { usedPct, spent, budget, currency: baseCurrency },
      });
      await resolveAlert(prisma, "BUDGET_EXCEEDED", project.id);
    } else {
      // Proyecto en orden, resolver alertas previas si las hay
      await resolveAlert(prisma, "BUDGET_WARNING", project.id);
      await resolveAlert(prisma, "BUDGET_EXCEEDED", project.id);
    }
  }

  // ── 2. Alertas de margen bruto y CPI por proyecto ──────────────────
  const projectsWithRevenue = await prisma.project.findMany({
    where: { status: "ACTIVE" },
    include: {
      timeEntries: {
        where: { status: "APPROVED" },
        include: { consultant: { select: { hourlyRate: true, rateCurrency: true } } },
      },
      expenses: true,
      revenueEntries: true,
    },
  });

  for (const project of projectsWithRevenue) {
    const budget = convertAmountFallback(Number(project.budget), project.currency, baseCurrency, rateMap);

    const laborCost = project.timeEntries.reduce((s, e) => {
      const rate = Number(e.consultant.hourlyRate ?? 0);
      return s + convertAmountFallback(Number(e.hours) * rate, e.consultant.rateCurrency, baseCurrency, rateMap);
    }, 0);

    const expensesCost = project.expenses.reduce(
      (s, e) => s + convertAmountFallback(Number(e.amount), e.currency, baseCurrency, rateMap),
      0,
    );

    const spent = laborCost + expensesCost;

    const revenueRecognized = project.revenueEntries.reduce((s, r) => {
      return s + convertAmountFallback(Number(r.amount), r.currency, baseCurrency, rateMap);
    }, 0);

    // Margin alert (threshold 15%)
    if (revenueRecognized > 0) {
      const marginPct = ((revenueRecognized - spent) / revenueRecognized) * 100;
      const threshold = 15;
      if (marginPct < threshold) {
        await upsertAlert(prisma, {
          type: "MARGIN_BELOW_THRESHOLD",
          severity: marginPct < threshold * 0.5 ? "CRITICAL" : "WARNING",
          projectId: project.id,
          message: `Proyecto "${project.name}" tiene margen bruto de ${marginPct.toFixed(1)}% (umbral ${threshold}%)`,
          metadata: { marginPct, revenueRecognized, spent, threshold, currency: baseCurrency },
        });
      } else {
        await resolveAlert(prisma, "MARGIN_BELOW_THRESHOLD", project.id);
      }
    }

    // CPI alert (using FORECAST_DEVIATION type)
    if (project.startDate && project.endDate) {
      const evm = computeEVM({
        budget,
        completionPct: project.completionPct ? Number(project.completionPct) : null,
        startDate: project.startDate,
        endDate: project.endDate,
        totalCostActual: spent,
      });

      if (evm.cpi !== null && evm.cpi < 0.85) {
        await upsertAlert(prisma, {
          type: "FORECAST_DEVIATION",
          severity: evm.cpi < 0.75 ? "CRITICAL" : "WARNING",
          projectId: project.id,
          message: `Proyecto "${project.name}" tiene CPI de ${evm.cpi.toFixed(2)} — rendimiento de costo bajo umbral (0.85)`,
          metadata: { cpi: evm.cpi, spi: evm.spi, eac: evm.eac, currency: baseCurrency },
        });
      } else {
        await resolveAlert(prisma, "FORECAST_DEVIATION", project.id);
      }
    }
  }

  // ── 3. Asignaciones que terminan en 7 días ──────────────────────────
  const endingSoon = await prisma.assignment.findMany({
    where: {
      status: { in: ["ACTIVE", "PARTIAL"] },
      endDate: { gte: new Date(), lte: addDays(new Date(), 7) },
    },
    include: { consultant: { select: { fullName: true } }, project: { select: { name: true } } },
  });

  for (const assignment of endingSoon) {
    const daysLeft = Math.ceil((assignment.endDate.getTime() - Date.now()) / 86_400_000);
    await upsertAlert(prisma, {
      type: "ASSIGNMENT_ENDING",
      severity: "INFO",
      consultantId: assignment.consultantId,
      projectId: assignment.projectId,
      message: `La asignación de "${assignment.consultant.fullName}" en "${assignment.project.name}" termina en ${daysLeft} días`,
      metadata: { daysLeft, endDate: assignment.endDate },
    });
  }

  getLogger().info("[AlertEngine] Motor de alertas completado");
}

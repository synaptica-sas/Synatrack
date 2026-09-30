import type { PrismaClient } from "@prisma/client";
import {
  buildRateMap,
  conversionStatus,
  createConversionLedger,
  convertAmountFallback,
  describeMissingRates,
  type ConversionStatus,
} from "../../utils/currency.js";
import { addDays } from "../../utils/capacity.js";
import { computeEVM } from "../../utils/evm.js";
import { computeProjectFinancials, toFinancialsInput } from "../../utils/financial.js";
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

/**
 * Sufijo para el texto de una alerta cuyas cifras salieron de una conversión
 * incompleta (DEP-32). El motor de alertas no devuelve una respuesta HTTP: su
 * lector es la fila `Alert`, así que la advertencia tiene que viajar en el
 * propio mensaje y en `metadata`, que es Json libre y no exige migración.
 */
function sufijoConversion(estado: ConversionStatus): string {
  if (!estado.incomplete) return "";
  return ` ⚠ Cifras aproximadas: faltan tasas de cambio (${estado.missingPairs.join(", ")}).`;
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
      financialEntries: { where: { type: "EXPENSE" } },
    },
  });

  for (const project of projects) {
    // Un libro por proyecto (DEP-32): la alerta habla de ESTE proyecto.
    const ledger = createConversionLedger();

    const budget = convertAmountFallback(Number(project.budget), project.currency, baseCurrency, rateMap, ledger);
    if (budget === 0) continue;

    const laborCost = project.timeEntries.reduce((s, e) => {
      const rate = Number(e.consultant.hourlyRate ?? 0);
      return s + convertAmountFallback(Number(e.hours) * rate, e.consultant.rateCurrency, baseCurrency, rateMap, ledger);
    }, 0);

    const expensesCost = project.financialEntries.reduce(
      (s, e) => s + convertAmountFallback(Number(e.amount), e.currency, baseCurrency, rateMap, ledger),
      0,
    );

    const spent = laborCost + expensesCost;
    const usedPct = (spent / budget) * 100;
    const alertThreshold = Number(project.budgetAlertPct ?? 90);

    const conversion = conversionStatus(ledger);
    if (conversion.incomplete) {
      getLogger().warn(
        { motor: "alert-engine", regla: "presupuesto", projectId: project.id, baseCurrency, missingPairs: conversion.missingPairs },
        describeMissingRates(conversion.missingPairs),
      );
    }
    const avisoFx = sufijoConversion(conversion);

    if (usedPct > 100) {
      await upsertAlert(prisma, {
        type: "BUDGET_EXCEEDED",
        severity: "CRITICAL",
        projectId: project.id,
        message: `Proyecto "${project.name}" ha superado el presupuesto (${usedPct.toFixed(1)}% usado)${avisoFx}`,
        metadata: { usedPct, spent, budget, currency: baseCurrency, conversion },
      });
      await resolveAlert(prisma, "BUDGET_WARNING", project.id);
    } else if (usedPct >= alertThreshold) {
      await upsertAlert(prisma, {
        type: "BUDGET_WARNING",
        severity: "WARNING",
        projectId: project.id,
        message: `Proyecto "${project.name}" ha consumido ${usedPct.toFixed(1)}% del presupuesto${avisoFx}`,
        metadata: { usedPct, spent, budget, currency: baseCurrency, conversion },
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
      financialEntries: true,
      forecasts: {
        include: { consultant: { select: { hourlyRate: true, rateCurrency: true } } },
      },
    },
  });

  for (const project of projectsWithRevenue) {
    // Mismo cálculo unificado que /stats y el detalle del proyecto.
    const fin = computeProjectFinancials(
      toFinancialsInput(project, project.timeEntries, rateMap, baseCurrency),
    );
    const budget = fin.budget;
    const spent = fin.totalCostActual;

    if (fin.conversion.incomplete) {
      getLogger().warn(
        { motor: "alert-engine", regla: "margen-cpi", projectId: project.id, baseCurrency, missingPairs: fin.conversion.missingPairs },
        describeMissingRates(fin.conversion.missingPairs),
      );
    }
    const avisoFxFin = sufijoConversion(fin.conversion);

    // Alerta de margen. El umbral sale SIEMPRE de `project.marginThreshold`;
    // ANTES estaba hardcodeado a 15 aquí, ignorando el valor por proyecto.
    if (fin.grossMarginActualPct !== null) {
      const marginPct = fin.grossMarginActualPct;
      const threshold = fin.marginThreshold;
      if (fin.belowMarginThreshold) {
        await upsertAlert(prisma, {
          type: "MARGIN_BELOW_THRESHOLD",
          severity: marginPct < threshold * 0.5 ? "CRITICAL" : "WARNING",
          projectId: project.id,
          message: `Proyecto "${project.name}" tiene margen bruto de ${marginPct.toFixed(1)}% (umbral ${threshold}%)${avisoFxFin}`,
          metadata: { marginPct, revenueRecognized: fin.revenueRecognized, spent, threshold, currency: baseCurrency, conversion: fin.conversion },
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
          message: `Proyecto "${project.name}" tiene CPI de ${evm.cpi.toFixed(2)} — rendimiento de costo bajo umbral (0.85)${avisoFxFin}`,
          metadata: { cpi: evm.cpi, spi: evm.spi, eac: evm.eac, currency: baseCurrency, conversion: fin.conversion },
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

/**
 * Pruebas del cálculo financiero unificado (R10).
 *
 * Cubre los casos borde obligatorios: presupuesto cero, sin horas aprobadas,
 * sin riesgos, margen negativo, umbrales de margen nulos y moneda sin tasa de
 * conversión disponible.
 */

import { describe, expect, it } from "vitest";
import { buildRateBook, createConversionLedger, missingRatePairs } from "../currency.js";
import {
  DEFAULT_BUDGET_ALERT_PCT,
  DEFAULT_MARGIN_CRITICAL_PCT,
  DEFAULT_MARGIN_WARNING_PCT,
  computeProjectFinancials,
  resolveBudgetAlertPct,
  resolveMarginThresholds,
  toFinancialsInput,
  type ProjectFinancialsInput,
} from "../financial.js";
import { computeHealthStatus, countDelayedMilestones, countOpenHighRisks } from "../health.js";
import { UMBRALES_SALUD_POR_DEFECTO } from "../healthThresholds.js";

// Sin histórico: el libro resuelve siempre a la tasa actual, igual que antes.
const rateBook = buildRateBook([{ baseCode: "USD", quoteCode: "COP", rate: 4000 }], []);
const FECHA = new Date("2026-01-15T00:00:00Z");


/** Proyecto de referencia: 100k de presupuesto, 50k facturados, 30k gastados. */
const base: ProjectFinancialsInput = {
  budget: 100_000,
  budgetCurrency: "USD",
  sellPrice: 120_000,
  sellCurrency: "USD",
  marginWarningPct: null,
  marginCriticalPct: null,
  budgetAlertPct: null,
  healthThresholds: UMBRALES_SALUD_POR_DEFECTO,
  revenueEntries: [{ amount: 50_000, currency: "USD", entryDate: FECHA }],
  approvedTimeEntries: [
    {
      consultantId: "c1",
      hours: 400,
      workDate: new Date("2026-04-15T00:00:00Z"),
      hourlyRate: 70,
      rateCurrency: "USD",
    },
  ],
  expenses: [{ amount: 2_000, currency: "USD", entryDate: FECHA }],
  risks: [],
  rateBook,
  valuationDate: FECHA,
  baseCurrency: "USD",
};

// ─── Resolución de umbrales ──────────────────────────────────────────────────

describe("resolveMarginThresholds", () => {
  it("respeta los umbrales configurados por proyecto", () => {
    expect(resolveMarginThresholds(40, 25)).toEqual({ warningPct: 40, criticalPct: 25 });
    expect(resolveMarginThresholds(10, 0)).toEqual({ warningPct: 10, criticalPct: 0 });
  });

  it("usa los defaults con nombre cuando el proyecto no los define", () => {
    expect(resolveMarginThresholds(null, null)).toEqual({
      warningPct: DEFAULT_MARGIN_WARNING_PCT,
      criticalPct: DEFAULT_MARGIN_CRITICAL_PCT,
    });
    expect(resolveMarginThresholds(undefined, undefined)).toEqual({ warningPct: 30, criticalPct: 15 });
    expect(resolveMarginThresholds(Number.NaN, Number.NaN)).toEqual({ warningPct: 30, criticalPct: 15 });
  });

  it("los defaults declarados son 30 de advertencia y 15 de crítico (D-2)", () => {
    expect(DEFAULT_MARGIN_WARNING_PCT).toBe(30);
    expect(DEFAULT_MARGIN_CRITICAL_PCT).toBe(15);
  });

  it("un crítico por encima de la advertencia sube la advertencia hasta él", () => {
    // Proyecto heredado con suelo del 40 % y advertencia sin configurar: la
    // banda de aviso queda vacía en vez de producir un semáforo imposible.
    expect(resolveMarginThresholds(null, 40)).toEqual({ warningPct: 40, criticalPct: 40 });
  });
});

describe("resolveBudgetAlertPct", () => {
  it("respeta el valor configurado y cae al default si es nulo", () => {
    expect(resolveBudgetAlertPct(80)).toBe(80);
    expect(resolveBudgetAlertPct(null)).toBe(DEFAULT_BUDGET_ALERT_PCT);
    expect(DEFAULT_BUDGET_ALERT_PCT).toBe(90);
  });
});

// ─── Cálculo base ────────────────────────────────────────────────────────────

describe("computeProjectFinancials — costos e ingresos", () => {
  it("costo real = horas aprobadas * tarifa + gastos", () => {
    const f = computeProjectFinancials(base);
    expect(f.laborCostActual).toBe(400 * 70); // 28 000
    expect(f.expensesActual).toBe(2_000);
    expect(f.totalCostActual).toBe(30_000);
    expect(f.approvedHours).toBe(400);
  });

  it("margen real = ingreso reconocido - costo real", () => {
    const f = computeProjectFinancials(base);
    expect(f.grossMarginActual).toBe(20_000);
    expect(f.grossMarginActualPct).toBe(40);
  });

  it("valor contractual e ingreso pendiente", () => {
    const f = computeProjectFinancials(base);
    expect(f.contractValue).toBe(120_000);
    expect(f.revenuePending).toBe(70_000);
  });

  it("consumo y proyección de presupuesto", () => {
    const f = computeProjectFinancials(base);
    expect(f.budgetConsumedPct).toBe(30);
    expect(f.projectedPct).toBe(30); // sin riesgos, proyectado = real
    expect(f.estimateAtCompletion).toBe(30_000);
    expect(f.budgetVariance).toBe(70_000);
  });
});

// ─── Exposición de riesgos (R-009) ───────────────────────────────────────────

describe("computeProjectFinancials — exposición de riesgos", () => {
  it("un riesgo OPEN con costo suma al proyectado, no al real", () => {
    const f = computeProjectFinancials({
      ...base,
      risks: [{ amount: 10_000, currency: "USD", status: "OPEN", identifiedAt: FECHA }],
    });
    expect(f.riskExposure).toBe(10_000);
    expect(f.totalCostActual).toBe(30_000); // sin cambio: no es gasto incurrido
    expect(f.totalCostProjected).toBe(40_000);
  });

  it("un riesgo ACCEPTED también cuenta como exposición vigente", () => {
    const f = computeProjectFinancials({
      ...base,
      risks: [{ amount: 5_000, currency: "USD", status: "ACCEPTED", identifiedAt: FECHA }],
    });
    expect(f.riskExposure).toBe(5_000);
  });

  it("un riesgo MITIGATED o CLOSED no afecta el presupuesto", () => {
    const f = computeProjectFinancials({
      ...base,
      risks: [
        { amount: 10_000, currency: "USD", status: "MITIGATED", identifiedAt: FECHA },
        { amount: 10_000, currency: "USD", status: "CLOSED", identifiedAt: FECHA },
      ],
    });
    expect(f.riskExposure).toBe(0);
    expect(f.totalCostProjected).toBe(f.totalCostActual);
  });

  it("convierte el costo del riesgo a la moneda base", () => {
    const f = computeProjectFinancials({
      ...base,
      risks: [{ amount: 400_000, currency: "COP", status: "OPEN", identifiedAt: FECHA }],
    });
    expect(f.riskExposure).toBeCloseTo(100, 6); // 400 000 / 4000
  });
});

// ─── Casos borde obligatorios ────────────────────────────────────────────────

describe("computeProjectFinancials — casos borde", () => {
  it("presupuesto cero: los porcentajes son 0 y no hay división por cero", () => {
    const f = computeProjectFinancials({ ...base, budget: 0 });
    expect(f.budget).toBe(0);
    expect(f.budgetConsumedPct).toBe(0);
    expect(f.projectedPct).toBe(0);
    expect(Number.isFinite(f.budgetVariance)).toBe(true);
    expect(f.alertLevel).toBe("ok");
  });

  it("sin horas aprobadas: costo laboral 0, el margen sigue siendo medible", () => {
    const f = computeProjectFinancials({ ...base, approvedTimeEntries: [] });
    expect(f.laborCostActual).toBe(0);
    expect(f.approvedHours).toBe(0);
    expect(f.totalCostActual).toBe(2_000);
    expect(f.grossMarginActualPct).toBe(96);
  });

  it("sin riesgos: proyectado = real", () => {
    const f = computeProjectFinancials({ ...base, risks: [] });
    expect(f.riskExposure).toBe(0);
    expect(f.totalCostProjected).toBe(f.totalCostActual);
  });

  it("sin ingresos reconocidos: el margen % es null (no medible), nunca 0", () => {
    const f = computeProjectFinancials({ ...base, revenueEntries: [] });
    expect(f.grossMarginActualPct).toBeNull();
    expect(f.grossMarginActual).toBe(-30_000);
    // Y por tanto NO hay veredicto de margen: no hay nada que medir.
    expect(f.marginLevel).toBe("ok");
  });

  it("margen negativo: porcentaje negativo y veredicto crítico", () => {
    const f = computeProjectFinancials({
      ...base,
      revenueEntries: [{ amount: 10_000, currency: "USD", entryDate: FECHA }],
    });
    expect(f.grossMarginActual).toBe(-20_000);
    expect(f.grossMarginActualPct).toBe(-200);
    expect(f.marginLevel).toBe("critical");
  });

  it("umbrales nulos: caen a los defaults con nombre, no se ignora el margen", () => {
    const f = computeProjectFinancials({
      ...base,
      marginWarningPct: null,
      marginCriticalPct: null,
      revenueEntries: [{ amount: 31_000, currency: "USD", entryDate: FECHA }], // margen ~3,2 %
    });
    expect(f.marginWarningPct).toBe(DEFAULT_MARGIN_WARNING_PCT);
    expect(f.marginCriticalPct).toBe(DEFAULT_MARGIN_CRITICAL_PCT);
    expect(f.marginLevel).toBe("critical");
  });

  it("un crítico de 25 vuelve crítico lo que con 15 solo era advertencia", () => {
    const input = { ...base, revenueEntries: [{ amount: 150_000, currency: "USD", entryDate: FECHA }] };
    // 150 000 - 30 000 = 120 000 → 80 %: por encima de cualquiera de los dos.
    expect(
      computeProjectFinancials({ ...input, marginWarningPct: 40, marginCriticalPct: 25 }).marginLevel,
    ).toBe("ok");

    // Margen del 20 %: advertencia con crítico 15, crítico con crítico 25.
    const veinte = { ...base, revenueEntries: [{ amount: 37_500, currency: "USD", entryDate: FECHA }] };
    expect(computeProjectFinancials({ ...veinte, marginCriticalPct: 15 }).grossMarginActualPct).toBe(20);
    expect(computeProjectFinancials({ ...veinte, marginCriticalPct: 15 }).marginLevel).toBe("warning");
    expect(
      computeProjectFinancials({ ...veinte, marginWarningPct: 40, marginCriticalPct: 25 }).marginLevel,
    ).toBe("critical");
  });

  it("moneda sin tasa de conversión: usa el monto original como fallback", () => {
    const f = computeProjectFinancials({
      ...base,
      expenses: [{ amount: 5_000, currency: "JPY", entryDate: FECHA }], // no hay par JPY->USD
    });
    // Fallback documentado de convertAmountFallback: el monto queda sin convertir.
    expect(f.expensesActual).toBe(5_000);
    // DEP-32: y el resultado lo dice, en vez de parecer un total correcto.
    expect(f.conversion).toEqual({
      incomplete: true,
      missingPairs: ["JPY->USD"],
      // Sin par JPY->USD no hay ni tasa actual ni histórica: el fallo es duro,
      // no una aproximación de fecha.
      approximateDates: false,
      undatedPairs: [],
    });
  });

  it("moneda con tasa: convierte a la base", () => {
    const f = computeProjectFinancials({
      ...base,
      expenses: [{ amount: 4_000_000, currency: "COP", entryDate: FECHA }],
    });
    expect(f.expensesActual).toBeCloseTo(1_000, 6);
    // R-008: este libro no tiene histórico, así que el gasto se valoró con la
    // tasa ACTUAL. El importe es correcto, pero se revaluará cada día: por eso
    // `approximateDates` lo denuncia aunque `incomplete` siga en false.
    expect(f.conversion).toEqual({
      incomplete: false,
      missingPairs: [],
      approximateDates: true,
      undatedPairs: ["COP->USD"],
    });
  });
});

// ─── DEP-32: conversión incompleta en el cálculo unificado ───────────────────

describe("computeProjectFinancials — marca de conversión incompleta", () => {
  it("todo convertible: conversion.incomplete es false", () => {
    const f = computeProjectFinancials({
      ...base,
      expenses: [{ amount: 4_000_000, currency: "COP", entryDate: FECHA }],
      revenueEntries: [{ amount: 200_000_000, currency: "COP", entryDate: FECHA }],
    });
    expect(f.conversion.incomplete).toBe(false);
    expect(f.conversion.missingPairs).toEqual([]);
  });

  it("un total mezclado con un par sin tasa queda marcado como incompleto", () => {
    const f = computeProjectFinancials({
      ...base,
      // 2.000 USD (convertibles) + 5.000 JPY (sin par JPY->USD).
      expenses: [
        { amount: 2_000, currency: "USD", entryDate: FECHA },
        { amount: 5_000, currency: "JPY", entryDate: FECHA },
      ],
    });
    // El número sigue saliendo (degradar, no caer)...
    expect(f.expensesActual).toBe(7_000);
    // ...pero ya no miente en silencio.
    expect(f.conversion.incomplete).toBe(true);
    expect(f.conversion.missingPairs).toEqual(["JPY->USD"]);
  });

  it("acumula los faltantes de todos los conceptos del proyecto", () => {
    const f = computeProjectFinancials({
      ...base,
      budgetCurrency: "BRL",
      expenses: [{ amount: 5_000, currency: "JPY", entryDate: FECHA }],
      revenueEntries: [{ amount: 1_000, currency: "CLP", entryDate: FECHA }],
    });
    expect(f.conversion.missingPairs).toEqual(["BRL->USD", "CLP->USD", "JPY->USD"]);
  });

  it("vuelca los faltantes en el libro del llamador sin contaminar su propio estado", () => {
    const consolidado = createConversionLedger();

    const limpio = computeProjectFinancials({ ...base, ledger: consolidado });
    expect(limpio.conversion.incomplete).toBe(false);

    const sucio = computeProjectFinancials({
      ...base,
      expenses: [{ amount: 5_000, currency: "JPY", entryDate: FECHA }],
      ledger: consolidado,
    });
    expect(sucio.conversion.missingPairs).toEqual(["JPY->USD"]);

    // Un tercer proyecto limpio NO hereda el faltante del anterior...
    const otroLimpio = computeProjectFinancials({ ...base, ledger: consolidado });
    expect(otroLimpio.conversion.incomplete).toBe(false);

    // ...pero el consolidado de la petición sí lo conserva.
    expect(missingRatePairs(consolidado)).toEqual(["JPY->USD"]);
  });

  it("el riesgo en moneda sin tasa también marca el total", () => {
    const f = computeProjectFinancials({
      ...base,
      risks: [{ amount: 1_000, currency: "JPY", status: "OPEN", identifiedAt: FECHA }],
    });
    expect(f.conversion.incomplete).toBe(true);
    expect(f.conversion.missingPairs).toEqual(["JPY->USD"]);
  });
});

// ─── alertLevel ──────────────────────────────────────────────────────────────

describe("computeProjectFinancials — alertLevel", () => {
  const sinIngreso = { ...base, revenueEntries: [] };

  it("ok cuando lo proyectado está por debajo del umbral de alerta", () => {
    expect(computeProjectFinancials(sinIngreso).alertLevel).toBe("ok");
  });

  it("warning al alcanzar budgetAlertPct, contando la exposición de riesgos", () => {
    const f = computeProjectFinancials({
      ...sinIngreso,
      risks: [{ amount: 60_000, currency: "USD", status: "OPEN", identifiedAt: FECHA }],
    });
    // 30 000 real + 60 000 de riesgo = 90 000 sobre 100 000 → 90 %
    expect(f.projectedPct).toBe(90);
    expect(f.alertLevel).toBe("warning");
  });

  it("exceeded por encima del 100 % proyectado", () => {
    const f = computeProjectFinancials({
      ...sinIngreso,
      expenses: [{ amount: 120_000, currency: "USD", entryDate: FECHA }],
    });
    expect(f.alertLevel).toBe("exceeded");
  });

  it("respeta el budgetAlertPct configurado por proyecto", () => {
    const f = computeProjectFinancials({ ...sinIngreso, budgetAlertPct: 25 });
    expect(f.budgetAlertPct).toBe(25);
    expect(f.projectedPct).toBe(30);
    expect(f.alertLevel).toBe("warning");
  });
});

// ─── Consistencia entre pantallas: el objetivo de R10 ────────────────────────

describe("consistencia tablero / portafolio / detalle", () => {
  it("con umbrales 40/25 los tres semáforos coinciden", () => {
    // Margen real del 20 %: por encima del viejo 15 hardcodeado, por debajo del 25 real.
    const input: ProjectFinancialsInput = {
      ...base,
      marginWarningPct: 40,
      marginCriticalPct: 25,
      revenueEntries: [{ amount: 37_500, currency: "USD", entryDate: FECHA }],
    };
    const f = computeProjectFinancials(input);
    expect(f.grossMarginActualPct).toBe(20);

    const health = computeHealthStatus({
      alertLevel: f.alertLevel,
      grossMarginActualPct: f.grossMarginActualPct,
      marginWarningPct: f.marginWarningPct,
      marginCriticalPct: f.marginCriticalPct,
      openHighRisks: 0,
      delayedMilestones: 0,
      spi: null,
      cpi: null,
      utilizationPct: 0,
      thresholds: UMBRALES_SALUD_POR_DEFECTO,
    });
    // 20 % está por debajo del crítico de 25 → RED.
    expect(health).toBe("RED");

    // Con el 15 hardcodeado de antes habría salido GREEN en tablero y portafolio.
    const conUmbralViejo = computeHealthStatus({
      alertLevel: f.alertLevel,
      grossMarginActualPct: f.grossMarginActualPct,
      marginWarningPct: 15,
      marginCriticalPct: 15,
      openHighRisks: 0,
      delayedMilestones: 0,
      spi: null,
      cpi: null,
      utilizationPct: 0,
      thresholds: UMBRALES_SALUD_POR_DEFECTO,
    });
    expect(conUmbralViejo).toBe("GREEN");
  });
});

// ─── Adaptador de filas Prisma ───────────────────────────────────────────────

describe("toFinancialsInput", () => {
  it("convierte Decimal (string) a number y preserva los nulos", () => {
    const input = toFinancialsInput(
      {
        budget: "100000.00",
        currency: "USD",
        startDate: FECHA,
        sellPrice: null,
        sellCurrency: "USD",
        marginWarningPct: "40.00",
        marginCriticalPct: "25.00",
        budgetAlertPct: "90.00",
        // Tras la fusión de tablas, gastos e ingresos llegan en una sola relación
        // con discriminador `type`; la partición la hace `splitFinancialEntries`.
        financialEntries: [
          { type: "REVENUE" as const, amount: "1000.00", currency: "USD", entryDate: FECHA },
          { type: "EXPENSE" as const, amount: "50.00", currency: "USD", entryDate: FECHA },
        ],
        risks: [],
      },
      [
        {
          consultantId: "c1",
          hours: "8.00",
          workDate: new Date("2026-04-01T00:00:00Z"),
          consultant: { hourlyRate: null, rateCurrency: "USD" },
        },
      ],
      rateBook,
      "USD",
      UMBRALES_SALUD_POR_DEFECTO,
      FECHA,
    );

    expect(input.budget).toBe(100_000);
    expect(input.sellPrice).toBeNull();
    expect(input.marginWarningPct).toBe(40);
    expect(input.marginCriticalPct).toBe(25);
    expect(input.approvedTimeEntries[0]!.hours).toBe(8);
    expect(input.approvedTimeEntries[0]!.hourlyRate).toBeNull();
    expect(input.revenueEntries).toEqual([{ amount: 1000, currency: "USD", entryDate: FECHA }]);
    expect(input.expenses).toEqual([{ amount: 50, currency: "USD", entryDate: FECHA }]);
  });

  it("un umbral = 0 en BD NO se convierte en el default (0 es un valor válido)", () => {
    const input = toFinancialsInput(
      {
        budget: "1000.00",
        currency: "USD",
        startDate: FECHA,
        sellPrice: null,
        sellCurrency: "USD",
        marginWarningPct: "0.00",
        marginCriticalPct: "0.00",
        budgetAlertPct: null,
        financialEntries: [],
        risks: [],
      },
      [],
      rateBook,
      "USD",
      UMBRALES_SALUD_POR_DEFECTO,
      FECHA,
    );
    expect(input.marginWarningPct).toBe(0);
    expect(input.marginCriticalPct).toBe(0);
    expect(computeProjectFinancials(input).marginCriticalPct).toBe(0);
  });
});

// ─── Homologación de hitos y riesgos ─────────────────────────────────────────

describe("countDelayedMilestones / countOpenHighRisks", () => {
  const hoy = new Date("2026-09-21T00:00:00Z");

  it("cuenta el hito vencido aunque nadie lo haya marcado DELAYED", () => {
    expect(
      countDelayedMilestones(
        [{ status: "PENDING", plannedDate: new Date("2026-08-01T00:00:00Z") }],
        hoy,
      ),
    ).toBe(1);
  });

  it("cuenta el hito marcado DELAYED aunque su fecha aún no haya llegado", () => {
    expect(
      countDelayedMilestones(
        [{ status: "DELAYED", plannedDate: new Date("2026-12-01T00:00:00Z") }],
        hoy,
      ),
    ).toBe(1);
  });

  it("un hito COMPLETED nunca cuenta como atrasado", () => {
    expect(
      countDelayedMilestones(
        [{ status: "COMPLETED", plannedDate: new Date("2026-01-01T00:00:00Z") }],
        hoy,
      ),
    ).toBe(0);
  });

  it("un hito futuro pendiente no cuenta", () => {
    expect(
      countDelayedMilestones(
        [{ status: "PENDING", plannedDate: new Date("2026-12-01T00:00:00Z") }],
        hoy,
      ),
    ).toBe(0);
  });

  it("riesgos altos abiertos: score >= 6 y estado OPEN", () => {
    expect(
      countOpenHighRisks([
        { riskScore: 9, status: "OPEN" },
        { riskScore: 6, status: "OPEN" },
        { riskScore: 5, status: "OPEN" },
        { riskScore: 9, status: "CLOSED" },
      ]),
    ).toBe(2);
  });
});

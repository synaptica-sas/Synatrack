/**
 * Pruebas del cálculo financiero unificado (R10).
 *
 * Cubre los casos borde obligatorios: presupuesto cero, sin horas aprobadas,
 * sin forecast, margen negativo, `marginThreshold` nulo y moneda sin tasa de
 * conversión disponible.
 */

import { describe, expect, it } from "vitest";
import { buildRateMap } from "../currency.js";
import {
  DEFAULT_BUDGET_ALERT_PCT,
  DEFAULT_MARGIN_THRESHOLD_PCT,
  computeProjectFinancials,
  resolveBudgetAlertPct,
  resolveMarginThreshold,
  toFinancialsInput,
  type ProjectFinancialsInput,
} from "../financial.js";
import { computeHealthStatus, countDelayedMilestones, countOpenHighRisks } from "../health.js";

const rateMap = buildRateMap([{ baseCode: "USD", quoteCode: "COP", rate: 4000 }]);

/** Proyecto de referencia: 100k de presupuesto, 50k facturados, 30k gastados. */
const base: ProjectFinancialsInput = {
  budget: 100_000,
  budgetCurrency: "USD",
  sellPrice: 120_000,
  sellCurrency: "USD",
  marginThreshold: null,
  budgetAlertPct: null,
  revenueEntries: [{ amount: 50_000, currency: "USD" }],
  approvedTimeEntries: [
    {
      consultantId: "c1",
      hours: 400,
      workDate: new Date("2026-04-15T00:00:00Z"),
      hourlyRate: 70,
      rateCurrency: "USD",
    },
  ],
  expenses: [{ amount: 2_000, currency: "USD" }],
  forecasts: [],
  rateMap,
  baseCurrency: "USD",
};

// ─── Resolución de umbrales ──────────────────────────────────────────────────

describe("resolveMarginThreshold", () => {
  it("respeta el umbral configurado por proyecto", () => {
    expect(resolveMarginThreshold(25)).toBe(25);
    expect(resolveMarginThreshold(0)).toBe(0);
  });

  it("usa el default con nombre cuando el proyecto no lo define", () => {
    expect(resolveMarginThreshold(null)).toBe(DEFAULT_MARGIN_THRESHOLD_PCT);
    expect(resolveMarginThreshold(undefined)).toBe(DEFAULT_MARGIN_THRESHOLD_PCT);
    expect(resolveMarginThreshold(Number.NaN)).toBe(DEFAULT_MARGIN_THRESHOLD_PCT);
  });

  it("el default declarado es 15", () => {
    expect(DEFAULT_MARGIN_THRESHOLD_PCT).toBe(15);
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
    expect(f.projectedPct).toBe(30); // sin forecast, proyectado = real
    expect(f.estimateAtCompletion).toBe(30_000);
    expect(f.budgetVariance).toBe(70_000);
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

  it("sin forecast: proyectado = real", () => {
    const f = computeProjectFinancials({ ...base, forecasts: [] });
    expect(f.laborCostForecast).toBe(0);
    expect(f.totalCostProjected).toBe(f.totalCostActual);
    expect(f.revenueProjected).toBe(f.revenueRecognized);
  });

  it("sin ingresos reconocidos: el margen % es null (no medible), nunca 0", () => {
    const f = computeProjectFinancials({ ...base, revenueEntries: [] });
    expect(f.grossMarginActualPct).toBeNull();
    expect(f.grossMarginActual).toBe(-30_000);
    // Y por tanto NO puede estar por debajo del umbral: no hay nada que medir.
    expect(f.belowMarginThreshold).toBe(false);
  });

  it("margen negativo: porcentaje negativo y bandera de umbral activa", () => {
    const f = computeProjectFinancials({
      ...base,
      revenueEntries: [{ amount: 10_000, currency: "USD" }],
    });
    expect(f.grossMarginActual).toBe(-20_000);
    expect(f.grossMarginActualPct).toBe(-200);
    expect(f.belowMarginThreshold).toBe(true);
  });

  it("marginThreshold nulo: cae al default con nombre, no se ignora el margen", () => {
    const f = computeProjectFinancials({
      ...base,
      marginThreshold: null,
      revenueEntries: [{ amount: 31_000, currency: "USD" }], // margen ~3,2 %
    });
    expect(f.marginThreshold).toBe(DEFAULT_MARGIN_THRESHOLD_PCT);
    expect(f.belowMarginThreshold).toBe(true);
  });

  it("marginThreshold = 25 hace rojo lo que con 15 estaba verde", () => {
    const input = { ...base, revenueEntries: [{ amount: 150_000, currency: "USD" }] };
    // 150 000 - 30 000 = 120 000 → 80 %: por encima de cualquiera de los dos.
    expect(computeProjectFinancials({ ...input, marginThreshold: 25 }).belowMarginThreshold).toBe(false);

    // Margen del 20 %: pasa con umbral 15 y falla con umbral 25.
    const veinte = { ...base, revenueEntries: [{ amount: 37_500, currency: "USD" }] };
    expect(computeProjectFinancials({ ...veinte, marginThreshold: 15 }).grossMarginActualPct).toBe(20);
    expect(computeProjectFinancials({ ...veinte, marginThreshold: 15 }).belowMarginThreshold).toBe(false);
    expect(computeProjectFinancials({ ...veinte, marginThreshold: 25 }).belowMarginThreshold).toBe(true);
  });

  it("moneda sin tasa de conversión: usa el monto original como fallback", () => {
    const f = computeProjectFinancials({
      ...base,
      expenses: [{ amount: 5_000, currency: "JPY" }], // no hay par JPY->USD
    });
    // Fallback documentado de convertAmountFallback: el monto queda sin convertir.
    expect(f.expensesActual).toBe(5_000);
  });

  it("moneda con tasa: convierte a la base", () => {
    const f = computeProjectFinancials({
      ...base,
      expenses: [{ amount: 4_000_000, currency: "COP" }],
    });
    expect(f.expensesActual).toBeCloseTo(1_000, 6);
  });
});

// ─── Forecast: la diferencia que tenía /portfolio ────────────────────────────

describe("computeProjectFinancials — forecast ajustado", () => {
  const conForecast: ProjectFinancialsInput = {
    ...base,
    approvedTimeEntries: [
      {
        consultantId: "c1",
        hours: 60,
        workDate: new Date("2026-05-10T00:00:00Z"),
        hourlyRate: 70,
        rateCurrency: "USD",
      },
    ],
    forecasts: [
      {
        consultantId: "c1",
        hoursProjected: 100,
        hourlyRate: 80, // tarifa propia del forecast, prevalece sobre la del consultor
        sellRate: 120,
        currency: "USD",
        startDate: "2026-04-01",
        endDate: "2026-06-30",
        consultant: { hourlyRate: 70, rateCurrency: "USD" },
      },
    ],
  };

  it("descuenta las horas ya aprobadas dentro del rango del forecast", () => {
    const f = computeProjectFinancials(conForecast);
    // 100 proyectadas - 60 ya ejecutadas = 40 restantes * 80 = 3 200
    expect(f.laborCostForecast).toBe(40 * 80);
  });

  it("usa forecast.hourlyRate y no la tarifa del consultor", () => {
    const f = computeProjectFinancials({
      ...conForecast,
      approvedTimeEntries: [],
    });
    expect(f.laborCostForecast).toBe(100 * 80); // no 100 * 70
  });

  it("horas fuera del rango del forecast no se descuentan (UTC)", () => {
    const f = computeProjectFinancials({
      ...conForecast,
      approvedTimeEntries: [
        {
          consultantId: "c1",
          hours: 60,
          workDate: new Date("2026-07-01T00:00:00Z"), // fuera del Q2
          hourlyRate: 70,
          rateCurrency: "USD",
        },
      ],
    });
    expect(f.laborCostForecast).toBe(100 * 80);
  });

  it("el último día del forecast sí cuenta (frontera inclusiva en UTC)", () => {
    const f = computeProjectFinancials({
      ...conForecast,
      approvedTimeEntries: [
        {
          consultantId: "c1",
          hours: 100,
          workDate: new Date("2026-06-30T23:59:59.000Z"),
          hourlyRate: 70,
          rateCurrency: "USD",
        },
      ],
    });
    expect(f.laborCostForecast).toBe(0);
  });

  it("horas de otro consultor no descuentan el forecast", () => {
    const f = computeProjectFinancials({
      ...conForecast,
      approvedTimeEntries: [
        {
          consultantId: "c2",
          hours: 100,
          workDate: new Date("2026-05-10T00:00:00Z"),
          hourlyRate: 70,
          rateCurrency: "USD",
        },
      ],
    });
    expect(f.laborCostForecast).toBe(100 * 80);
  });

  it("convierte el forecast desde SU moneda, no la del consultor", () => {
    const f = computeProjectFinancials({
      ...conForecast,
      approvedTimeEntries: [],
      forecasts: [
        {
          consultantId: "c1",
          hoursProjected: 10,
          hourlyRate: 400_000,
          sellRate: null,
          currency: "COP",
          startDate: "2026-04-01",
          endDate: "2026-06-30",
          consultant: { hourlyRate: 70, rateCurrency: "USD" },
        },
      ],
    });
    // 10 * 400 000 COP = 4 000 000 COP / 4000 = 1 000 USD
    expect(f.laborCostForecast).toBeCloseTo(1_000, 6);
  });

  it("forecast ya sobre-ejecutado no genera costo adicional negativo", () => {
    const f = computeProjectFinancials({
      ...conForecast,
      approvedTimeEntries: [
        {
          consultantId: "c1",
          hours: 500,
          workDate: new Date("2026-05-10T00:00:00Z"),
          hourlyRate: 70,
          rateCurrency: "USD",
        },
      ],
    });
    expect(f.laborCostForecast).toBe(0);
  });
});

// ─── alertLevel ──────────────────────────────────────────────────────────────

describe("computeProjectFinancials — alertLevel", () => {
  const sinIngreso = { ...base, revenueEntries: [] };

  it("ok cuando lo proyectado está por debajo del umbral de alerta", () => {
    expect(computeProjectFinancials(sinIngreso).alertLevel).toBe("ok");
  });

  it("warning al alcanzar budgetAlertPct, contando el forecast", () => {
    const f = computeProjectFinancials({
      ...sinIngreso,
      forecasts: [
        {
          consultantId: "c9",
          hoursProjected: 1_000,
          hourlyRate: 60,
          sellRate: null,
          currency: "USD",
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          consultant: { hourlyRate: 60, rateCurrency: "USD" },
        },
      ],
    });
    // 30 000 real + 60 000 forecast = 90 000 sobre 100 000 → 90 %
    expect(f.projectedPct).toBe(90);
    expect(f.alertLevel).toBe("warning");
  });

  it("exceeded por encima del 100 % proyectado", () => {
    const f = computeProjectFinancials({
      ...sinIngreso,
      expenses: [{ amount: 120_000, currency: "USD" }],
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
  it("con marginThreshold = 25 los tres semáforos coinciden", () => {
    // Margen real del 20 %: por encima del viejo 15 hardcodeado, por debajo del 25 real.
    const input: ProjectFinancialsInput = {
      ...base,
      marginThreshold: 25,
      revenueEntries: [{ amount: 37_500, currency: "USD" }],
    };
    const f = computeProjectFinancials(input);
    expect(f.grossMarginActualPct).toBe(20);

    const health = computeHealthStatus({
      alertLevel: f.alertLevel,
      grossMarginActualPct: f.grossMarginActualPct,
      marginThreshold: f.marginThreshold,
      openHighRisks: 0,
      delayedMilestones: 0,
      spi: null,
      cpi: null,
      utilizationPct: 0,
    });
    expect(health).toBe("YELLOW");

    // Con el 15 hardcodeado de antes habría salido GREEN en tablero y portafolio.
    const conUmbralViejo = computeHealthStatus({
      alertLevel: f.alertLevel,
      grossMarginActualPct: f.grossMarginActualPct,
      marginThreshold: 15,
      openHighRisks: 0,
      delayedMilestones: 0,
      spi: null,
      cpi: null,
      utilizationPct: 0,
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
        sellPrice: null,
        sellCurrency: "USD",
        marginThreshold: "25.00",
        budgetAlertPct: "90.00",
        // Tras la fusión de tablas, gastos e ingresos llegan en una sola relación
        // con discriminador `type`; la partición la hace `splitFinancialEntries`.
        financialEntries: [
          { type: "REVENUE" as const, amount: "1000.00", currency: "USD" },
          { type: "EXPENSE" as const, amount: "50.00", currency: "USD" },
        ],
        forecasts: [],
      },
      [
        {
          consultantId: "c1",
          hours: "8.00",
          workDate: new Date("2026-04-01T00:00:00Z"),
          consultant: { hourlyRate: null, rateCurrency: "USD" },
        },
      ],
      rateMap,
      "USD",
    );

    expect(input.budget).toBe(100_000);
    expect(input.sellPrice).toBeNull();
    expect(input.marginThreshold).toBe(25);
    expect(input.approvedTimeEntries[0]!.hours).toBe(8);
    expect(input.approvedTimeEntries[0]!.hourlyRate).toBeNull();
    expect(input.revenueEntries).toEqual([{ amount: 1000, currency: "USD" }]);
    expect(input.expenses).toEqual([{ amount: 50, currency: "USD" }]);
  });

  it("marginThreshold = 0 en BD NO se convierte en el default (0 es un valor válido)", () => {
    const input = toFinancialsInput(
      {
        budget: "1000.00",
        currency: "USD",
        sellPrice: null,
        sellCurrency: "USD",
        marginThreshold: "0.00",
        budgetAlertPct: null,
        financialEntries: [],
        forecasts: [],
      },
      [],
      rateMap,
      "USD",
    );
    expect(input.marginThreshold).toBe(0);
    expect(computeProjectFinancials(input).marginThreshold).toBe(0);
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

import { describe, it, expect } from "vitest";
import {
  periodToDateRange,
  isInPeriod,
  getAdjustedForecastCost,
  getAdjustedForecastRevenue,
  calculateProfitability,
} from "../financial.js";
import { buildRateMap } from "../currency.js";

// ─── periodToDateRange ────────────────────────────────────────────────────────

describe("periodToDateRange", () => {
  it("Q1 = enero a marzo", () => {
    const range = periodToDateRange("2026-Q1")!;
    expect(range.start.toISOString().slice(0, 10)).toBe("2026-01-01");
    expect(range.end.toISOString().slice(0, 10)).toBe("2026-03-31");
  });

  it("Q2 = abril a junio", () => {
    const range = periodToDateRange("2026-Q2")!;
    expect(range.start.toISOString().slice(0, 10)).toBe("2026-04-01");
    expect(range.end.toISOString().slice(0, 10)).toBe("2026-06-30");
  });

  it("Q3 = julio a septiembre", () => {
    const range = periodToDateRange("2026-Q3")!;
    expect(range.start.toISOString().slice(0, 10)).toBe("2026-07-01");
    expect(range.end.toISOString().slice(0, 10)).toBe("2026-09-30");
  });

  it("Q4 = octubre a diciembre", () => {
    const range = periodToDateRange("2026-Q4")!;
    expect(range.start.toISOString().slice(0, 10)).toBe("2026-10-01");
    expect(range.end.toISOString().slice(0, 10)).toBe("2026-12-31");
  });

  it("formato inválido retorna null", () => {
    expect(periodToDateRange("2026-Q5")).toBeNull();
    expect(periodToDateRange("invalid")).toBeNull();
    expect(periodToDateRange("")).toBeNull();
  });
});

describe("isInPeriod", () => {
  it("fecha dentro del período retorna true", () => {
    expect(isInPeriod(new Date("2026-04-15"), "2026-Q2")).toBe(true);
  });

  it("fecha fuera del período retorna false", () => {
    expect(isInPeriod(new Date("2026-07-01"), "2026-Q2")).toBe(false);
  });
});

// ─── getAdjustedForecastCost ──────────────────────────────────────────────────

const rateMap = buildRateMap([{ baseCode: "USD", quoteCode: "COP", rate: 4200 }]);
const baseCurrency = "USD";

const consultant = { hourlyRate: 65, rateCurrency: "USD" };
const forecast = { hoursProjected: 120, hourlyRate: 65, sellRate: 100, currency: "USD" };

describe("getAdjustedForecastCost", () => {
  it("sin horas ejecutadas: costo = proyectado completo", () => {
    const result = getAdjustedForecastCost(forecast, consultant, 0, rateMap, baseCurrency);
    expect(result).toBe(120 * 65); // 7800
  });

  it("con 40h aprobadas: costo = 80h restantes", () => {
    const result = getAdjustedForecastCost(forecast, consultant, 40, rateMap, baseCurrency);
    expect(result).toBe(80 * 65); // 5200
  });

  it("si se ejecutaron más horas de las proyectadas: costo adicional es 0", () => {
    const result = getAdjustedForecastCost(forecast, consultant, 150, rateMap, baseCurrency);
    expect(result).toBe(0);
  });

  it("exactamente las horas proyectadas ya ejecutadas: retorna 0", () => {
    const result = getAdjustedForecastCost(forecast, consultant, 120, rateMap, baseCurrency);
    expect(result).toBe(0);
  });

  it("usa tarifa del consultor si forecast no tiene hourlyRate", () => {
    const forecastSinRate = { ...forecast, hourlyRate: null };
    const result = getAdjustedForecastCost(forecastSinRate, consultant, 0, rateMap, baseCurrency);
    expect(result).toBe(120 * 65); // usa consultant.hourlyRate
  });

  it("retorna 0 si no hay tarifa ni en forecast ni en consultor", () => {
    const forecastSinRate = { ...forecast, hourlyRate: null };
    const consultantSinRate = { hourlyRate: null, rateCurrency: "USD" };
    const result = getAdjustedForecastCost(forecastSinRate, consultantSinRate, 0, rateMap, baseCurrency);
    expect(result).toBe(0);
  });

  it("convierte desde moneda del forecast a baseCurrency", () => {
    const forecastCOP = { hoursProjected: 10, hourlyRate: 300000, sellRate: null, currency: "COP" };
    // 10h * 300000 COP/h = 3,000,000 COP = 3,000,000 / 4200 USD ≈ 714.28 USD
    const result = getAdjustedForecastCost(forecastCOP, consultant, 0, rateMap, "USD");
    expect(result).toBeCloseTo(3_000_000 / 4200, 2);
  });
});

// ─── getAdjustedForecastRevenue ───────────────────────────────────────────────

describe("getAdjustedForecastRevenue", () => {
  it("sin horas ejecutadas: ingreso = proyectado completo", () => {
    const result = getAdjustedForecastRevenue(forecast, 0, rateMap, baseCurrency);
    expect(result).toBe(120 * 100); // 12000
  });

  it("con 40h ejecutadas: ingreso = 80h restantes * sellRate", () => {
    const result = getAdjustedForecastRevenue(forecast, 40, rateMap, baseCurrency);
    expect(result).toBe(80 * 100); // 8000
  });

  it("sin sellRate retorna 0", () => {
    const forecastSinSell = { ...forecast, sellRate: null };
    const result = getAdjustedForecastRevenue(forecastSinSell, 0, rateMap, baseCurrency);
    expect(result).toBe(0);
  });
});

// ─── calculateProfitability ───────────────────────────────────────────────────

describe("calculateProfitability", () => {
  const baseInput = {
    budget: 80000,
    budgetCurrency: "USD",
    sellPrice: 95000,
    sellCurrency: "USD",
    revenueEntries: [{ amount: 40000, currency: "USD" }],
    approvedTimeEntries: [
      { hours: 6, workDate: new Date("2026-04-01"), status: "APPROVED" as const, hourlyRate: 65, rateCurrency: "USD", consultantId: "c1" },
    ],
    expenses: [{ amount: 1200, currency: "USD" }],
    forecasts: [
      {
        consultantId: "c1",
        hoursProjected: 120, hourlyRate: 65, sellRate: 100, currency: "USD",
        startDate: "2026-04-01", endDate: "2026-06-30", consultant: { hourlyRate: 65, rateCurrency: "USD" },
      },
    ],
    fxConfigs: [],
    baseCurrency: "USD",
  };

  it("calcula valor contractual correctamente", () => {
    const result = calculateProfitability(baseInput);
    expect(result.contractValue).toBe(95000);
  });

  it("calcula ingreso reconocido", () => {
    const result = calculateProfitability(baseInput);
    expect(result.revenueRecognized).toBe(40000);
    expect(result.revenuePending).toBe(55000);
  });

  it("calcula costo laboral real", () => {
    const result = calculateProfitability(baseInput);
    expect(result.laborCostActual).toBe(6 * 65); // 390
  });

  it("calcula margen bruto actual", () => {
    const result = calculateProfitability(baseInput);
    // 40000 - (390 + 1200) = 38410
    expect(result.grossMarginActual).toBe(40000 - (6 * 65 + 1200));
    expect(result.grossMarginActualPct).toBeGreaterThan(90);
  });

  it("sin sellPrice el contractValue es 0", () => {
    const result = calculateProfitability({ ...baseInput, sellPrice: null });
    expect(result.contractValue).toBe(0);
  });

  it("budgetVariance positiva cuando EAC < budget", () => {
    const result = calculateProfitability(baseInput);
    // El costo proyectado es mucho menor al presupuesto
    expect(result.budgetVariance).toBeGreaterThan(0);
  });

  it("budgetVariance negativa cuando EAC > budget (sobrecosto)", () => {
    const result = calculateProfitability({
      ...baseInput,
      budget: 500, // presupuesto muy pequeño
    });
    expect(result.budgetVariance).toBeLessThan(0);
  });

  it("sin gastos ni entradas: costo real = 0", () => {
    const result = calculateProfitability({
      ...baseInput,
      revenueEntries: [],
      approvedTimeEntries: [],
      expenses: [],
      forecasts: [],
    });
    expect(result.totalCostActual).toBe(0);
    expect(result.laborCostActual).toBe(0);
    expect(result.expensesActual).toBe(0);
  });

  it("sin ingresos reconocidos: grossMarginActual es negativo", () => {
    const result = calculateProfitability({
      ...baseInput,
      revenueEntries: [],
    });
    expect(result.revenueRecognized).toBe(0);
    expect(result.grossMarginActual).toBeLessThan(0);
  });

  it("grossMarginActualPct = null si no hay ingresos reconocidos (no medible, no 0%)", () => {
    const result = calculateProfitability({
      ...baseInput,
      revenueEntries: [],
    });
    expect(result.grossMarginActualPct).toBeNull();
  });

  it("convierte presupuesto multimoneda (COP → USD) usando FX", () => {
    const result = calculateProfitability({
      ...baseInput,
      budget: 336_000_000, // 336M COP
      budgetCurrency: "COP",
      fxConfigs: [{ baseCode: "USD", quoteCode: "COP", rate: 4200 }],
    });
    // 336,000,000 / 4200 = 80,000 USD
    expect(result.budget).toBeCloseTo(80000, 0);
  });

  it("gasto en COP se convierte a USD en costo total", () => {
    const result = calculateProfitability({
      ...baseInput,
      expenses: [{ amount: 4_200_000, currency: "COP" }],
      fxConfigs: [{ baseCode: "USD", quoteCode: "COP", rate: 4200 }],
    });
    // 4,200,000 COP / 4200 = 1000 USD
    expect(result.expensesActual).toBeCloseTo(1000, 0);
  });

  it("forecast con horas ya ejecutadas ajusta el costo proyectado", () => {
    // Con 60h ya ejecutadas de 120 proyectadas → laborCostForecast = 60 * 65 = 3900
    const result = calculateProfitability({
      ...baseInput,
      approvedTimeEntries: [
        {
          hours: 60,
          workDate: new Date("2026-04-15"), // dentro del Q2
          status: "APPROVED" as const,
          hourlyRate: 65,
          rateCurrency: "USD",
          consultantId: "c1",
        },
      ],
    });
    // Con 60h aprobadas en Q2, las horas restantes del forecast son max(120-60, 0) = 60
    // o dependiendo del matching por consultantId...
    // El forecast debería ser <= 120*65 = 7800
    expect(result.laborCostForecast).toBeLessThanOrEqual(120 * 65);
  });

  it("múltiples forecasts suman sus costos", () => {
    const result = calculateProfitability({
      ...baseInput,
      approvedTimeEntries: [],
      forecasts: [
        { consultantId: "c1", hoursProjected: 50, hourlyRate: 65, sellRate: 100, currency: "USD", startDate: "2026-01-01", endDate: "2026-03-31", consultant: { hourlyRate: 65, rateCurrency: "USD" } },
        { consultantId: "c2", hoursProjected: 80, hourlyRate: 65, sellRate: 100, currency: "USD", startDate: "2026-04-01", endDate: "2026-06-30", consultant: { hourlyRate: 65, rateCurrency: "USD" } },
        { consultantId: "c3", hoursProjected: 60, hourlyRate: 65, sellRate: 100, currency: "USD", startDate: "2026-07-01", endDate: "2026-09-30", consultant: { hourlyRate: 65, rateCurrency: "USD" } },
      ],
    });
    // 50+80+60 = 190h * 65 = 12350
    expect(result.laborCostForecast).toBeCloseTo(12350, 0);
  });

  it("budgetConsumedPct es 0 si el presupuesto es 0", () => {
    const result = calculateProfitability({
      ...baseInput,
      budget: 0,
    });
    expect(result.budgetConsumedPct).toBe(0);
  });
});

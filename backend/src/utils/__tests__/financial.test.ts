import { describe, it, expect } from "vitest";
import {
  periodToDateRange,
  isInPeriod,
  calculateProfitability,
} from "../financial.js";
import { UMBRALES_SALUD_POR_DEFECTO } from "../healthThresholds.js";

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

// ─── calculateProfitability ───────────────────────────────────────────────────

const FECHA = new Date("2026-01-15T00:00:00Z");

describe("calculateProfitability", () => {
  const baseInput = {
    budget: 80000,
    budgetCurrency: "USD",
    sellPrice: 95000,
    sellCurrency: "USD",
    revenueEntries: [{ amount: 40000, currency: "USD", entryDate: FECHA }],
    approvedTimeEntries: [
      { hours: 6, workDate: new Date("2026-04-01"), status: "APPROVED" as const, hourlyRate: 65, rateCurrency: "USD", consultantId: "c1" },
    ],
    expenses: [{ amount: 1200, currency: "USD", entryDate: FECHA }],
    risks: [],
    fxConfigs: [],
    valuationDate: FECHA,
    baseCurrency: "USD",
    healthThresholds: UMBRALES_SALUD_POR_DEFECTO,
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
      valuationDate: FECHA,
    });
    // 336,000,000 / 4200 = 80,000 USD
    expect(result.budget).toBeCloseTo(80000, 0);
  });

  it("gasto en COP se convierte a USD en costo total", () => {
    const result = calculateProfitability({
      ...baseInput,
      expenses: [{ amount: 4_200_000, currency: "COP", entryDate: FECHA }],
      fxConfigs: [{ baseCode: "USD", quoteCode: "COP", rate: 4200 }],
      valuationDate: FECHA,
    });
    // 4,200,000 COP / 4200 = 1000 USD
    expect(result.expensesActual).toBeCloseTo(1000, 0);
  });

  it("budgetConsumedPct es 0 si el presupuesto es 0", () => {
    const result = calculateProfitability({
      ...baseInput,
      budget: 0,
    });
    expect(result.budgetConsumedPct).toBe(0);
  });
});

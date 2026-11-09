import { describe, expect, it } from "vitest";
import {
  buildRateBook,
  convertContractAmount,
  createConversionLedger,
  hasUndatedRates,
  negotiatedFxFromProject,
} from "../currency.js";
import { computeProjectFinancials } from "../financial.js";
import { UMBRALES_SALUD_POR_DEFECTO } from "../healthThresholds.js";

/**
 * Tasa negociada por proyecto: presupuesto y precio de venta se valoran con la
 * tasa pactada con el cliente; horas, gastos e ingresos siguen con la de su fecha.
 */
const hoy = [{ baseCode: "USD", quoteCode: "COP", rate: 4000 }];
const libro = () =>
  buildRateBook(hoy, [{ baseCode: "USD", quoteCode: "COP", rate: 3800, effectiveDate: new Date("2026-01-01") }]);
const fecha = new Date("2026-03-01");

describe("negotiatedFxFromProject", () => {
  it("lee la tasa de la fila del proyecto", () => {
    expect(negotiatedFxFromProject({ negotiatedFxRate: "3500.5", negotiatedFxCurrency: "COP" })).toEqual({
      currency: "COP",
      rate: 3500.5,
    });
  });
  it("null si falta la tasa, la moneda o la tasa no es positiva", () => {
    expect(negotiatedFxFromProject({ negotiatedFxRate: null, negotiatedFxCurrency: "COP" })).toBeNull();
    expect(negotiatedFxFromProject({ negotiatedFxRate: 3500, negotiatedFxCurrency: null })).toBeNull();
    expect(negotiatedFxFromProject({ negotiatedFxRate: 0, negotiatedFxCurrency: "COP" })).toBeNull();
    expect(negotiatedFxFromProject({})).toBeNull();
  });
});

describe("convertContractAmount", () => {
  it("sin tasa negociada usa el histórico a la fecha (comportamiento de siempre)", () => {
    expect(convertContractAmount(3_800_000, "COP", "USD", fecha, libro(), null)).toBeCloseTo(1000, 6);
  });

  it("con tasa negociada la usa en vez del histórico", () => {
    expect(convertContractAmount(3_500_000, "COP", "USD", fecha, libro(), { currency: "COP", rate: 3500 })).toBeCloseTo(1000, 6);
  });

  it("también en sentido USD -> moneda negociada", () => {
    expect(convertContractAmount(1000, "USD", "COP", fecha, libro(), { currency: "COP", rate: 3500 })).toBeCloseTo(3_500_000, 6);
  });

  it("no afecta importes en otra moneda", () => {
    const b = buildRateBook([...hoy, { baseCode: "USD", quoteCode: "MXN", rate: 20 }], []);
    expect(convertContractAmount(2000, "MXN", "USD", fecha, b, { currency: "COP", rate: 3500 })).toBeCloseTo(100, 6);
  });

  it("no marca la conversión como aproximada aunque no haya histórico", () => {
    const ledger = createConversionLedger();
    convertContractAmount(3_500_000, "COP", "USD", fecha, buildRateBook(hoy, []), { currency: "COP", rate: 3500 }, ledger);
    expect(hasUndatedRates(ledger)).toBe(false);
  });
});

describe("computeProjectFinancials con tasa negociada", () => {
  const base = {
    budget: 3_500_000,
    budgetCurrency: "COP",
    sellPrice: 7_000_000,
    sellCurrency: "COP",
    marginWarningPct: null,
    marginCriticalPct: null,
    budgetAlertPct: null,
    healthThresholds: UMBRALES_SALUD_POR_DEFECTO,
    revenueEntries: [{ amount: 3_800_000, currency: "COP", entryDate: fecha }],
    approvedTimeEntries: [
      { consultantId: "c1", hours: 10, workDate: fecha, hourlyRate: 38_000, rateCurrency: "COP" },
    ],
    expenses: [],
    risks: [],
    valuationDate: fecha,
    baseCurrency: "USD",
  };

  it("presupuesto y contrato con la tasa pactada; horas e ingresos con la de su fecha", () => {
    const f = computeProjectFinancials({ ...base, rateBook: libro(), negotiatedFx: { currency: "COP", rate: 3500 } });
    expect(f.budget).toBeCloseTo(1000, 6);
    expect(f.contractValue).toBeCloseTo(2000, 6);
    expect(f.revenueRecognized).toBeCloseTo(1000, 6); // 3.8 M / 3800
    expect(f.laborCostActual).toBeCloseTo(100, 6); // 380 000 / 3800
  });

  it("sin tasa negociada el presupuesto sale del histórico", () => {
    const f = computeProjectFinancials({ ...base, rateBook: libro() });
    expect(f.budget).toBeCloseTo(3_500_000 / 3800, 6);
  });
});

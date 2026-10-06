import { describe, it, expect } from 'vitest';
import { getBudgetStatus, monedaBasePorDefecto, toMonthKey, formatMonthKey, prevPeriod, tooltipConversion } from '../features/expenses/gastosUtils';
import type { Expense } from '../services/api';

/**
 * R-026: `convertToBase` ya no existe. Convertía en el navegador con las tasas
 * de HOY, era una segunda implementación de la conversión y daba otro número
 * que el backend. Sus pruebas se fueron con ella; lo que queda que probar aquí
 * es el texto que EXPLICA la conversión que hizo el servidor.
 */

describe('getBudgetStatus', () => {
  it('returns "ok" when budget is 0', () => {
    expect(getBudgetStatus(1000, 0)).toBe("ok");
  });

  it('returns "ok" when spent < 85% of budget', () => {
    expect(getBudgetStatus(80, 100)).toBe("ok");
  });

  it('returns "warning" when spent is between 85% and 99%', () => {
    expect(getBudgetStatus(90, 100)).toBe("warning");
    expect(getBudgetStatus(85, 100)).toBe("warning");
  });

  it('returns "exceeded" when spent >= 100% of budget', () => {
    expect(getBudgetStatus(100, 100)).toBe("exceeded");
    expect(getBudgetStatus(150, 100)).toBe("exceeded");
  });
});

describe('toMonthKey', () => {
  it('extracts YYYY-MM from ISO date string', () => {
    expect(toMonthKey("2026-04-15")).toBe("2026-04");
    expect(toMonthKey("2025-12-01T00:00:00.000Z")).toBe("2025-12");
  });
});

describe('formatMonthKey', () => {
  it('formats YYYY-MM as localized month and year', () => {
    const result = formatMonthKey("2026-04");
    expect(result).toMatch(/abril/i);
    expect(result).toContain("2026");
  });
});

describe('prevPeriod', () => {
  it('shifts a range back by its own duration', () => {
    // Range: Jan 1-31 (31 days) → prev: Dec 1-31
    const prev = prevPeriod("2026-01-01", "2026-01-31");
    expect(prev.to).toBe("2025-12-31");
    // Duration of Jan: 30 days (Jan31 - Jan1 in ms = 30 days)
    const durMs = new Date("2026-01-31").getTime() - new Date("2026-01-01").getTime();
    const expectedFrom = new Date(new Date("2025-12-31").getTime() - durMs).toISOString().slice(0, 10);
    expect(prev.from).toBe(expectedFrom);
  });
});

// ── Moneda de presentación por defecto (R-026) ──────────────────────────────

describe('monedaBasePorDefecto (R-026)', () => {
  const gasto = (currency: string | null) =>
    ({ project: currency === null ? null : { currency } }) as Parameters<typeof monedaBasePorDefecto>[0][number];

  it('usa la moneda del proyecto cuando todos los gastos comparten una', () => {
    expect(monedaBasePorDefecto([gasto('COP'), gasto('COP')], 'USD')).toBe('COP');
  });

  it('no se queda en USD solo porque USD sea el respaldo', () => {
    // El defecto que reportó el usuario: un proyecto en pesos se leía en dólares.
    expect(monedaBasePorDefecto([gasto('COP')], 'USD')).not.toBe('USD');
  });

  it('cae al respaldo si se mezclan proyectos de monedas distintas', () => {
    expect(monedaBasePorDefecto([gasto('COP'), gasto('EUR')], 'USD')).toBe('USD');
  });

  it('cae al respaldo sin gastos a la vista', () => {
    expect(monedaBasePorDefecto([], 'USD')).toBe('USD');
  });

  it('ignora los gastos sin proyecto cargado en vez de romperse', () => {
    expect(monedaBasePorDefecto([gasto(null), gasto('PEN')], 'USD')).toBe('PEN');
  });
});

// ── Explicación de la conversión (R-026) ────────────────────────────────────

describe('tooltipConversion (R-026)', () => {
  const gasto = (o: Partial<Expense>) =>
    ({
      amount: "4650000",
      currency: "COP",
      baseAmount: 1068.9655,
      baseCurrency: "USD",
      conversionQuality: "dated",
      expenseDate: "2026-08-14",
      ...o,
    }) as Parameters<typeof tooltipConversion>[0];

  it('dice la tasa implícita y que es la vigente en la fecha del gasto', () => {
    const t = tooltipConversion(gasto({}));
    expect(t).toContain("vigente el");
    expect(t).toContain("14/08/2026");
    // La tasa implícita es el resultado ÷ el origen, no una conversión nueva.
    expect(t).toContain("0,0002298");
  });

  it('avisa cuando se valoró con la tasa de hoy por no haber histórico', () => {
    const t = tooltipConversion(gasto({ conversionQuality: "undated" }));
    expect(t).toContain("tasa de HOY");
    expect(t).not.toContain("vigente el");
  });

  it('dice que el importe NO se convirtió cuando falta la tasa', () => {
    const t = tooltipConversion(gasto({ conversionQuality: "missing", baseAmount: 4650000 }));
    expect(t).toContain("Sin tasa de COP a USD");
    expect(t).toContain("SIN convertir");
  });

  it('no inventa una tasa cuando la moneda ya es la base', () => {
    const t = tooltipConversion(gasto({ currency: "USD", baseCurrency: "USD", amount: "100", baseAmount: 100 }));
    expect(t).toContain("misma moneda");
  });
});

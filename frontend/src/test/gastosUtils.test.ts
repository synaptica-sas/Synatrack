import { describe, it, expect } from 'vitest';
import { convertToBase, getBudgetStatus, monedaBasePorDefecto, toMonthKey, formatMonthKey, prevPeriod } from '../features/expenses/gastosUtils';
import type { FxConfig } from '../services/api';

// ── Mock FX configs ─────────────────────────────────────────────────────────
// base=USD, quote=COP, rate=4000  →  1 USD = 4000 COP
// base=USD, quote=EUR, rate=0.92  →  1 USD = 0.92 EUR
const fxConfigs: FxConfig[] = [
  { id: "1", baseCode: "USD", quoteCode: "COP", rate: "4000", createdAt: "", updatedAt: "" },
  { id: "2", baseCode: "USD", quoteCode: "EUR", rate: "0.92", createdAt: "", updatedAt: "" },
];

describe('convertToBase', () => {
  it('same currency returns amount unchanged with rate=1', () => {
    const result = convertToBase(100, "USD", "USD", fxConfigs);
    expect(result.value).toBe(100);
    expect(result.rate).toBe(1);
  });

  it('COP → USD via direct lookup (amount / rate)', () => {
    // 5,000,000 COP / 4000 = 1250 USD
    const result = convertToBase(5_000_000, "COP", "USD", fxConfigs);
    expect(result.value).toBeCloseTo(1250, 2);
    expect(result.rate).toBeCloseTo(1 / 4000, 8);
  });

  it('EUR → USD via inverse lookup (amount * rate)', () => {
    // base=USD, quote=EUR, rate=0.92  →  inverse: base=EUR, quote=USD, rate=1/0.92
    // But we store only USD→EUR, so we need base=EUR quote=USD.
    // Let's add it:
    const cfgs: FxConfig[] = [
      { id: "3", baseCode: "EUR", quoteCode: "USD", rate: "1.087", createdAt: "", updatedAt: "" },
    ];
    const result = convertToBase(100, "EUR", "USD", cfgs);
    expect(result.value).toBeCloseTo(108.7, 1);
  });

  it('returns original amount with null rate when no FX config found', () => {
    const result = convertToBase(100, "GBP", "USD", fxConfigs);
    expect(result.value).toBe(100);
    expect(result.rate).toBeNull();
    expect(result.tooltip).toContain("Sin tasa FX");
  });

  it('includes tooltip with formula', () => {
    const result = convertToBase(4000, "COP", "USD", fxConfigs);
    expect(result.tooltip).toContain("÷");
    expect(result.tooltip).toContain("4.000");
  });
});

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

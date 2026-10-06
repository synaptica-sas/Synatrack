import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useGastosGrouped } from '../features/expenses/useGastosGrouped';
import type { Expense, Project } from '../services/api';

// ── Fixtures ────────────────────────────────────────────────────────────────
//
// R-026: el hook ya NO convierte. Los gastos llegan del backend con
// `baseAmount` resuelto a la tasa de la fecha de cada uno, así que las fixtures
// traen ese importe hecho y el hook solo tiene que sumarlo.

const mockProject = (id: string, name: string, budget: string): Project => ({
  id,
  name,
  company: "ACME",
  country: "",
  currency: "USD",
  projectType: "TIME_AND_MATERIAL",
  status: "ACTIVE",
  budget,
  startDate: "",
  endDate: "",
  description: null,
  sellPrice: null,
  sellCurrency: "",
  createdAt: "",
  updatedAt: "",
});

const p1 = mockProject("proj-1", "Proyecto Alpha", "10000");
const p2 = mockProject("proj-2", "Proyecto Beta",  "1000");

function makeExpense(overrides: Partial<Expense> & Pick<Expense, 'id' | 'projectId' | 'amount' | 'currency' | 'expenseDate' | 'category' | 'baseAmount'>): Expense {
  return {
    description: null,
    createdAt: "",
    updatedAt: "",
    baseCurrency: "USD",
    conversionQuality: "dated",
    project: overrides.projectId === "proj-1" ? p1 : p2,
    ...overrides,
  };
}

const expenses: Expense[] = [
  makeExpense({ id: "e1", projectId: "proj-1", amount: "500",   currency: "USD", baseAmount: 500,  expenseDate: "2026-04-01", category: "Viajes" }),
  // 4.000 COP valorados a la tasa VIGENTE EL 14/04 (4.000 COP por USD) = 1 USD.
  makeExpense({ id: "e2", projectId: "proj-1", amount: "4000",  currency: "COP", baseAmount: 1,    expenseDate: "2026-04-14", category: "Licencias" }),
  makeExpense({ id: "e3", projectId: "proj-2", amount: "1200",  currency: "USD", baseAmount: 1200, expenseDate: "2026-03-15", category: "Viajes" }),
];

// ── Tests ────────────────────────────────────────────────────────────────────

describe('useGastosGrouped — group by project', () => {
  it('creates one group per project', () => {
    const { result } = renderHook(() =>
      useGastosGrouped(expenses, "project", "USD", [p1, p2])
    );
    expect(result.current.groups).toHaveLength(2);
  });

  it('suma el importe ya convertido por el backend, sin reconvertir', () => {
    const { result } = renderHook(() =>
      useGastosGrouped(expenses, "project", "USD", [p1, p2])
    );
    const alpha = result.current.groups.find((g) => g.key === "proj-1");
    expect(alpha).toBeDefined();
    // 500 USD + 1 USD (los 4.000 COP a la tasa de SU fecha) = 501 USD
    expect(alpha!.totalBase).toBeCloseTo(501, 2);
    expect(alpha!.count).toBe(2);
  });

  it('sets status "exceeded" when spent > budget', () => {
    const { result } = renderHook(() =>
      useGastosGrouped(expenses, "project", "USD", [p1, p2])
    );
    const beta = result.current.groups.find((g) => g.key === "proj-2");
    // Beta budget=1000, spent=1200 → exceeded
    expect(beta!.status).toBe("exceeded");
  });

  it('sets status "ok" when well under budget', () => {
    const { result } = renderHook(() =>
      useGastosGrouped(expenses, "project", "USD", [p1, p2])
    );
    const alpha = result.current.groups.find((g) => g.key === "proj-1");
    // Alpha budget=10000, spent=501 → ok
    expect(alpha!.status).toBe("ok");
  });

  it('uses most recent expenseDate as lastDate', () => {
    const { result } = renderHook(() =>
      useGastosGrouped(expenses, "project", "USD", [p1, p2])
    );
    const alpha = result.current.groups.find((g) => g.key === "proj-1");
    expect(alpha!.lastDate).toBe("2026-04-14");
  });

  it('totals sum all groups', () => {
    const { result } = renderHook(() =>
      useGastosGrouped(expenses, "project", "USD", [p1, p2])
    );
    const { totals } = result.current;
    expect(totals.count).toBe(3);
    expect(totals.totalBase).toBeCloseTo(501 + 1200, 1);
  });
});

describe('useGastosGrouped — group by category', () => {
  it('creates one group per category', () => {
    const { result } = renderHook(() =>
      useGastosGrouped(expenses, "category", "USD", [p1, p2])
    );
    expect(result.current.groups).toHaveLength(2); // Viajes, Licencias
    const cats = result.current.groups.map((g) => g.key);
    expect(cats).toContain("Viajes");
    expect(cats).toContain("Licencias");
  });

  it('status is always "ok" for category grouping (no budget context)', () => {
    const { result } = renderHook(() =>
      useGastosGrouped(expenses, "category", "USD", [p1, p2])
    );
    result.current.groups.forEach((g) => {
      expect(g.status).toBe("ok");
    });
  });
});

describe('useGastosGrouped — group by month', () => {
  it('creates one group per month', () => {
    const { result } = renderHook(() =>
      useGastosGrouped(expenses, "month", "USD", [p1, p2])
    );
    expect(result.current.groups).toHaveLength(2); // 2026-04, 2026-03
  });

  it('returns empty groups when expenses array is empty', () => {
    const { result } = renderHook(() =>
      useGastosGrouped([], "project", "USD", [p1, p2])
    );
    expect(result.current.groups).toHaveLength(0);
    expect(result.current.totals.count).toBe(0);
    expect(result.current.totals.totalBase).toBe(0);
  });
});

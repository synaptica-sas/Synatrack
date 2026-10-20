import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  monthToQuarter,
  quarterToMonthRange,
  monthYearToQuarter,
  quarterToMonthYear,
  formatPeriodLabel,
  compareMY,
  addMonths,
  monthsBetween,
  presetCurrentQuarter,
  presetNextQuarter,
  presetThisMonth,
  presetNext6Months,
  presetRestOfYear,
} from '../utils/periodUtils';

// ── monthToQuarter ───────────────────────────────────────────────────────────

describe('monthToQuarter', () => {
  it.each([
    [1, "Q1"], [2, "Q1"], [3, "Q1"],
    [4, "Q2"], [5, "Q2"], [6, "Q2"],
    [7, "Q3"], [8, "Q3"], [9, "Q3"],
    [10, "Q4"], [11, "Q4"], [12, "Q4"],
  ])('month %i → %s', (month, expected) => {
    expect(monthToQuarter(month)).toBe(expected);
  });
});

// ── quarterToMonthRange ──────────────────────────────────────────────────────

describe('quarterToMonthRange', () => {
  it('Q1 spans Jan–Mar', () => expect(quarterToMonthRange("Q1")).toEqual({ startMonth: 1,  endMonth: 3  }));
  it('Q2 spans Apr–Jun', () => expect(quarterToMonthRange("Q2")).toEqual({ startMonth: 4,  endMonth: 6  }));
  it('Q3 spans Jul–Sep', () => expect(quarterToMonthRange("Q3")).toEqual({ startMonth: 7,  endMonth: 9  }));
  it('Q4 spans Oct–Dec', () => expect(quarterToMonthRange("Q4")).toEqual({ startMonth: 10, endMonth: 12 }));
});

// ── monthYearToQuarter ───────────────────────────────────────────────────────

describe('monthYearToQuarter', () => {
  it('April 2026 → 2026-Q2', () => expect(monthYearToQuarter({ month: 4, year: 2026 })).toBe("2026-Q2"));
  it('January 2027 → 2027-Q1', () => expect(monthYearToQuarter({ month: 1, year: 2027 })).toBe("2027-Q1"));
  it('December 2025 → 2025-Q4', () => expect(monthYearToQuarter({ month: 12, year: 2025 })).toBe("2025-Q4"));
});

// ── quarterToMonthYear ───────────────────────────────────────────────────────

describe('quarterToMonthYear', () => {
  it('2026-Q2 → April 2026', () => expect(quarterToMonthYear("2026-Q2")).toEqual({ month: 4, year: 2026 }));
  it('2025-Q4 → October 2025', () => expect(quarterToMonthYear("2025-Q4")).toEqual({ month: 10, year: 2025 }));
  it('invalid string falls back to current month', () => {
    const result = quarterToMonthYear("invalid");
    expect(result.month).toBeGreaterThanOrEqual(1);
    expect(result.month).toBeLessThanOrEqual(12);
  });
});

// ── formatPeriodLabel ────────────────────────────────────────────────────────

describe('formatPeriodLabel', () => {
  it('2026-Q1 → "Ene–Mar 2026"', () => expect(formatPeriodLabel("2026-Q1")).toBe("Ene–Mar 2026"));
  it('2026-Q2 → "Abr–Jun 2026"', () => expect(formatPeriodLabel("2026-Q2")).toBe("Abr–Jun 2026"));
  it('2026-Q3 → "Jul–Sep 2026"', () => expect(formatPeriodLabel("2026-Q3")).toBe("Jul–Sep 2026"));
  it('2026-Q4 → "Oct–Dic 2026"', () => expect(formatPeriodLabel("2026-Q4")).toBe("Oct–Dic 2026"));
  it('returns original string for unrecognized format', () => {
    expect(formatPeriodLabel("invalid")).toBe("invalid");
  });
});

// ── compareMY ────────────────────────────────────────────────────────────────

describe('compareMY', () => {
  it('same returns 0', () => expect(compareMY({ month: 4, year: 2026 }, { month: 4, year: 2026 })).toBe(0));
  it('a before b returns negative', () => expect(compareMY({ month: 3, year: 2026 }, { month: 4, year: 2026 })).toBeLessThan(0));
  it('a after b returns positive', () => expect(compareMY({ month: 5, year: 2026 }, { month: 4, year: 2026 })).toBeGreaterThan(0));
  it('handles year boundary', () => expect(compareMY({ month: 1, year: 2027 }, { month: 12, year: 2026 })).toBeGreaterThan(0));
});

// ── addMonths ────────────────────────────────────────────────────────────────

describe('addMonths', () => {
  it('adds within same year', () => expect(addMonths({ month: 4, year: 2026 }, 2)).toEqual({ month: 6, year: 2026 }));
  it('crosses year boundary', () => expect(addMonths({ month: 11, year: 2026 }, 3)).toEqual({ month: 2, year: 2027 }));
  it('adds 0 months', () => expect(addMonths({ month: 4, year: 2026 }, 0)).toEqual({ month: 4, year: 2026 }));
});

// ── monthsBetween ────────────────────────────────────────────────────────────

describe('monthsBetween', () => {
  it('same month = 1', () => expect(monthsBetween({ month: 4, year: 2026 }, { month: 4, year: 2026 })).toBe(1));
  it('Jan to Dec same year = 12', () => expect(monthsBetween({ month: 1, year: 2026 }, { month: 12, year: 2026 })).toBe(12));
  it('Apr 2026 to Sep 2026 = 6', () => expect(monthsBetween({ month: 4, year: 2026 }, { month: 9, year: 2026 })).toBe(6));
});

// ── Presets ───────────────────────────────────────────────────────────────────

describe('preset functions', () => {
  beforeEach(() => {
    // Pin date to April 15, 2026
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 15)); // month is 0-indexed
  });

  afterEach(() => vi.useRealTimers());

  it('presetThisMonth returns April 2026', () => {
    const { from, to } = presetThisMonth();
    expect(from).toEqual({ month: 4, year: 2026 });
    expect(to).toEqual({ month: 4, year: 2026 });
  });

  it('presetCurrentQuarter returns Q2: Apr–Jun 2026', () => {
    const { from, to } = presetCurrentQuarter();
    expect(from).toEqual({ month: 4, year: 2026 });
    expect(to).toEqual({ month: 6, year: 2026 });
  });

  it('presetNextQuarter returns Q3: Jul–Sep 2026', () => {
    const { from, to } = presetNextQuarter();
    expect(from).toEqual({ month: 7, year: 2026 });
    expect(to).toEqual({ month: 9, year: 2026 });
  });

  it('presetNext6Months returns Apr–Sep 2026', () => {
    const { from, to } = presetNext6Months();
    expect(from).toEqual({ month: 4, year: 2026 });
    expect(to).toEqual({ month: 9, year: 2026 });
  });

  it('presetRestOfYear returns Apr–Dec 2026', () => {
    const { from, to } = presetRestOfYear();
    expect(from).toEqual({ month: 4, year: 2026 });
    expect(to).toEqual({ month: 12, year: 2026 });
  });

  it('presetNextQuarter crosses year when in Q4', () => {
    vi.setSystemTime(new Date(2026, 10, 1)); // November → Q4
    const { from, to } = presetNextQuarter();
    expect(from).toEqual({ month: 1, year: 2027 });
    expect(to).toEqual({ month: 3, year: 2027 });
  });
});

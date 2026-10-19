// ── Types ────────────────────────────────────────────────────────────────────

export type MonthYear = { month: number; year: number }; // month: 1-12

// ── Month name helpers ────────────────────────────────────────────────────────

export const MONTHS_LONG_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
] as const;

const MONTHS_SHORT_ES = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
] as const;

export function monthLong(m: number): string {
  return MONTHS_LONG_ES[(m - 1) % 12] ?? String(m);
}

export function monthShort(m: number): string {
  return MONTHS_SHORT_ES[(m - 1) % 12] ?? String(m);
}

// ── Quarter ↔ Month conversions ───────────────────────────────────────────────

export type Quarter = "Q1" | "Q2" | "Q3" | "Q4";

export function monthToQuarter(month: number): Quarter {
  if (month <= 3)  return "Q1";
  if (month <= 6)  return "Q2";
  if (month <= 9)  return "Q3";
  return "Q4";
}

export function quarterToMonthRange(q: Quarter): { startMonth: number; endMonth: number } {
  const map: Record<Quarter, { startMonth: number; endMonth: number }> = {
    Q1: { startMonth: 1,  endMonth: 3  },
    Q2: { startMonth: 4,  endMonth: 6  },
    Q3: { startMonth: 7,  endMonth: 9  },
    Q4: { startMonth: 10, endMonth: 12 },
  };
  return map[q];
}

/** MonthYear → "2026-Q2" */
export function monthYearToQuarter(my: MonthYear): string {
  return `${my.year}-${monthToQuarter(my.month)}`;
}

/** "2026-Q2" → MonthYear (returns start month of that quarter) */
export function quarterToMonthYear(period: string): MonthYear {
  const match = period.match(/^(\d{4})-Q([1-4])$/);
  if (!match) {
    const now = new Date();
    return { month: now.getMonth() + 1, year: now.getFullYear() };
  }
  const year = parseInt(match[1]);
  const q = `Q${match[2]}` as Quarter;
  return { month: quarterToMonthRange(q).startMonth, year };
}

// ── MonthYear arithmetic ──────────────────────────────────────────────────────

/** Compare two MonthYear values. Returns negative, 0, or positive. */
export function compareMY(a: MonthYear, b: MonthYear): number {
  return (a.year * 12 + a.month) - (b.year * 12 + b.month);
}

/** Add N months to a MonthYear */
export function addMonths(my: MonthYear, n: number): MonthYear {
  const total = my.year * 12 + my.month - 1 + n;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

/** Duration in months between two MonthYear values (inclusive) */
export function monthsBetween(from: MonthYear, to: MonthYear): number {
  return (to.year - from.year) * 12 + (to.month - from.month) + 1;
}

// ── Period label formatting ───────────────────────────────────────────────────

/**
 * Format a stored "YYYY-Qn" period string into a human-readable label.
 * "2026-Q2" → "Abr–Jun 2026"
 */
export function formatPeriodLabel(period: string): string {
  const match = period.match(/^(\d{4})-Q([1-4])$/);
  if (!match) return period;
  const year = match[1];
  const q = `Q${match[2]}` as Quarter;
  const { startMonth, endMonth } = quarterToMonthRange(q);
  return `${monthShort(startMonth)}–${monthShort(endMonth)} ${year}`;
}

/**
 * Format a MonthYear as "Abr 2026".
 */
export function formatMY(my: MonthYear): string {
  return `${monthShort(my.month)} ${my.year}`;
}

// ── ISO date utilities ────────────────────────────────────────────────────────

function pad(n: number): string { return String(n).padStart(2, "0"); }

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Today as "yyyy-mm-dd" */
export function todayISO(): string { return isoDate(new Date()); }

/** "2026-04-11" → "11 Abr 2026" */
export function formatISODate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${monthShort(m)} ${y}`;
}

/**
 * Format an ISO date range as "1 Abr – 30 Jun 2026"
 * or "1 Dic 2026 – 31 Mar 2027" when years differ.
 */
export function formatISODateRange(from: string, to: string): string {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  if (fy === ty) {
    return `${fd} ${monthShort(fm)} – ${td} ${monthShort(tm)} ${fy}`;
  }
  return `${fd} ${monthShort(fm)} ${fy} – ${td} ${monthShort(tm)} ${ty}`;
}

/**
 * Describe duration between two ISO dates.
 * "80 días (2 meses, 19 días)"
 */
export function describeDuration(from: string, to: string): string {
  const d1 = new Date(from + "T00:00:00");
  const d2 = new Date(to   + "T00:00:00");
  const totalDays = Math.round((d2.getTime() - d1.getTime()) / 86400000);
  if (totalDays < 0) return "";
  if (totalDays === 0) return "1 día";

  // Whole months between the two dates
  let months = (d2.getFullYear() - d1.getFullYear()) * 12 + d2.getMonth() - d1.getMonth();
  const afterMonths = new Date(d1.getFullYear(), d1.getMonth() + months, d1.getDate());
  if (afterMonths > d2) months--;
  const afterMonthsDate = new Date(d1.getFullYear(), d1.getMonth() + months, d1.getDate());
  const remDays = Math.round((d2.getTime() - afterMonthsDate.getTime()) / 86400000);

  if (months === 0) {
    return `${totalDays} día${totalDays !== 1 ? "s" : ""}`;
  }
  const parts: string[] = [`${months} mes${months !== 1 ? "es" : ""}`];
  if (remDays > 0) parts.push(`${remDays} día${remDays !== 1 ? "s" : ""}`);
  return `${totalDays} días (${parts.join(", ")})`;
}

/**
 * Convert ISO date to quarter string.
 * "2026-04-11" → "2026-Q2"
 */
export function isoDateToQuarter(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return monthYearToQuarter({ month: m, year: y });
}

/**
 * Convert stored "YYYY-Qn" period to its ISO start/end date range.
 * "2026-Q2" → { from: "2026-04-01", to: "2026-06-30" }
 */
export function quarterToDateRange(period: string): { from: string; to: string } | null {
  const match = period.match(/^(\d{4})-Q([1-4])$/);
  if (!match) return null;
  const year = parseInt(match[1]);
  const q = `Q${match[2]}` as Quarter;
  const { startMonth, endMonth } = quarterToMonthRange(q);
  const lastDay = new Date(year, endMonth, 0).getDate();
  return {
    from: `${year}-${pad(startMonth)}-01`,
    to:   `${year}-${pad(endMonth)}-${pad(lastDay)}`,
  };
}

// ── ISO Date range presets ────────────────────────────────────────────────────

export type ISODatePreset = { from: string; to: string };

/** Este mes: 01/MM/YYYY – último día del mes */
export function presetThisMonthDates(): ISODatePreset {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to   = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: isoDate(from), to: isoDate(to) };
}

/** Trimestre actual: primer y último día */
export function presetCurrentQuarterDates(): ISODatePreset {
  const now = new Date();
  const q = monthToQuarter(now.getMonth() + 1);
  const { startMonth, endMonth } = quarterToMonthRange(q);
  const year = now.getFullYear();
  const from = new Date(year, startMonth - 1, 1);
  const to   = new Date(year, endMonth, 0);
  return { from: isoDate(from), to: isoDate(to) };
}

/** Próximo trimestre: primer y último día */
export function presetNextQuarterDates(): ISODatePreset {
  const now = new Date();
  const year = now.getFullYear();
  const curNum = parseInt(monthToQuarter(now.getMonth() + 1)[1]);
  const nextNum = curNum === 4 ? 1 : curNum + 1;
  const nextYear = curNum === 4 ? year + 1 : year;
  const nextQ = `Q${nextNum}` as Quarter;
  const { startMonth, endMonth } = quarterToMonthRange(nextQ);
  const from = new Date(nextYear, startMonth - 1, 1);
  const to   = new Date(nextYear, endMonth, 0);
  return { from: isoDate(from), to: isoDate(to) };
}

/** Próximos 6 meses: hoy → hoy + 6 meses */
export function presetNext6MonthsDates(): ISODatePreset {
  const now = new Date();
  const to6 = new Date(now.getFullYear(), now.getMonth() + 6, now.getDate());
  return { from: isoDate(now), to: isoDate(to6) };
}

/** Resto del año: hoy → 31/12/año actual */
export function presetRestOfYearDates(): ISODatePreset {
  const now = new Date();
  return { from: isoDate(now), to: `${now.getFullYear()}-12-31` };
}

// ── Legacy MonthYear-based presets (kept for compatibility) ──────────────────

export type DatePresetLegacy = { from: MonthYear; to: MonthYear };

export function presetThisMonth(): DatePresetLegacy {
  const now = new Date();
  const m = { month: now.getMonth() + 1, year: now.getFullYear() };
  return { from: m, to: m };
}

export function presetCurrentQuarter(): DatePresetLegacy {
  const now = new Date();
  const year = now.getFullYear();
  const q = monthToQuarter(now.getMonth() + 1);
  const { startMonth, endMonth } = quarterToMonthRange(q);
  return { from: { month: startMonth, year }, to: { month: endMonth, year } };
}

export function presetNextQuarter(): DatePresetLegacy {
  const now = new Date();
  const year = now.getFullYear();
  const curQ = monthToQuarter(now.getMonth() + 1);
  const curNum = parseInt(curQ[1]);
  const nextNum = curNum === 4 ? 1 : curNum + 1;
  const nextYear = curNum === 4 ? year + 1 : year;
  const nextQ = `Q${nextNum}` as Quarter;
  const { startMonth, endMonth } = quarterToMonthRange(nextQ);
  return { from: { month: startMonth, year: nextYear }, to: { month: endMonth, year: nextYear } };
}

export function presetNext6Months(): DatePresetLegacy {
  const now = new Date();
  const from = { month: now.getMonth() + 1, year: now.getFullYear() };
  const to = addMonths(from, 5);
  return { from, to };
}

export function presetRestOfYear(): DatePresetLegacy {
  const now = new Date();
  const from = { month: now.getMonth() + 1, year: now.getFullYear() };
  const to = { month: 12, year: now.getFullYear() };
  return { from, to };
}

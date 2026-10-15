/**
 * Utilidades de fecha calendario ("YYYY-MM-DD") y de mes ("YYYY-MM"), siempre en UTC.
 *
 * Una `IsoDate` es un día del calendario, no un instante: no tiene hora ni zona. Toda conversión
 * a/desde `Date` se hace con `Date.UTC` y los getters `getUTC*`, para que el resultado sea el mismo
 * en un servidor en UTC, en Quito o en Madrid (CONTRATO §2: prohibido usar hora local).
 *
 * Internamente se usa el "número de día" (días desde 1970-01-01) para aritmética rápida.
 */

export type IsoDate = string; // "YYYY-MM-DD"
export type MonthKey = string; // "YYYY-MM"

const DAY_MS = 86_400_000;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_KEY_RE = /^(\d{4})-(\d{2})$/;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function pad4(n: number): string {
  return String(n).padStart(4, "0");
}

/** Días de un mes (month 1-12). */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** `true` si el texto es una fecha "YYYY-MM-DD" que existe en el calendario. */
export function isValidIsoDate(value: string): boolean {
  const m = ISO_DATE_RE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

/** `true` si el texto es un mes "YYYY-MM" válido. */
export function isValidMonthKey(value: string): boolean {
  const m = MONTH_KEY_RE.exec(value);
  if (!m) return false;
  const month = Number(m[2]);
  return month >= 1 && month <= 12;
}

function assertIsoDate(value: string): void {
  if (!isValidIsoDate(value)) throw new Error(`Fecha inválida: "${value}" (se espera YYYY-MM-DD)`);
}

function assertMonthKey(value: string): void {
  if (!isValidMonthKey(value)) throw new Error(`Mes inválido: "${value}" (se espera YYYY-MM)`);
}

/** Fecha calendario UTC de un `Date` (un `@db.Date` de Prisma llega como medianoche UTC). */
export function toIsoDate(date: Date): IsoDate {
  if (Number.isNaN(date.getTime())) throw new Error("Fecha inválida: Date sin valor");
  return `${pad4(date.getUTCFullYear())}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/** `Date` a la medianoche UTC del día indicado. Lanza si la fecha no existe. */
export function fromIsoDate(iso: IsoDate): Date {
  assertIsoDate(iso);
  return new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))));
}

/** Número de día UTC (días desde 1970-01-01). Útil para aritmética y sets de feriados. */
export function isoToDayNumber(iso: IsoDate): number {
  return Math.round(fromIsoDate(iso).getTime() / DAY_MS);
}

/** Inversa de `isoToDayNumber`. */
export function dayNumberToIso(dayNumber: number): IsoDate {
  return toIsoDate(new Date(dayNumber * DAY_MS));
}

/** Día de la semana de un número de día: 0 = domingo … 6 = sábado (1970-01-01 fue jueves). */
export function weekdayOfDayNumber(dayNumber: number): number {
  return (((dayNumber + 4) % 7) + 7) % 7;
}

/** Suma (o resta) días calendario. */
export function addDaysIso(iso: IsoDate, days: number): IsoDate {
  return dayNumberToIso(isoToDayNumber(iso) + days);
}

/** Lunes a viernes. No mira feriados. */
export function isWeekdayIso(iso: IsoDate): boolean {
  const dow = weekdayOfDayNumber(isoToDayNumber(iso));
  return dow >= 1 && dow <= 5;
}

/** Mes "YYYY-MM" al que pertenece una fecha. */
export function monthKeyOf(iso: IsoDate): MonthKey {
  assertIsoDate(iso);
  return iso.slice(0, 7);
}

/** Primer día del mes. */
export function monthStart(month: MonthKey): IsoDate {
  assertMonthKey(month);
  return `${month}-01`;
}

/** Último día del mes (considera bisiestos). */
export function monthEnd(month: MonthKey): IsoDate {
  assertMonthKey(month);
  return `${month}-${pad2(daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7))))}`;
}

/** Suma (o resta) meses a un "YYYY-MM". */
export function addMonthsKey(month: MonthKey, months: number): MonthKey {
  assertMonthKey(month);
  const index = Number(month.slice(0, 4)) * 12 + (Number(month.slice(5, 7)) - 1) + months;
  return `${pad4(Math.floor(index / 12))}-${pad2((index % 12) + 1)}`;
}

/** Todos los días de `from` a `to`, ambos incluidos. Vacío si `to < from`. */
export function eachDayIso(from: IsoDate, to: IsoDate): IsoDate[] {
  const start = isoToDayNumber(from);
  const end = isoToDayNumber(to);
  const out: IsoDate[] = [];
  for (let d = start; d <= end; d++) out.push(dayNumberToIso(d));
  return out;
}

/**
 * Mayor/menor de dos fechas ISO. Con el formato "YYYY-MM-DD" el orden lexicográfico es el
 * cronológico, así que se comparan como texto (se validan primero).
 */
export function maxIso(a: IsoDate, b: IsoDate): IsoDate {
  assertIsoDate(a);
  assertIsoDate(b);
  return a >= b ? a : b;
}

export function minIso(a: IsoDate, b: IsoDate): IsoDate {
  assertIsoDate(a);
  assertIsoDate(b);
  return a <= b ? a : b;
}

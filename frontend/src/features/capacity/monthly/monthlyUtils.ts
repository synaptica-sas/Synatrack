import type {
  CapacityStatus,
  MonthlyCapacity,
  MonthlyCapacityConsultantRow,
  MonthlyCapacityParams,
  MonthlyCapacityWarning,
} from "../../../services/api";
import type { CapacityFilters } from "./PeriodSelector";
import { monthShort } from "../../../utils/periodUtils";

/** Máximo de meses que admite el contrato en una consulta. */
export const MAX_MONTHS = 24;

/** Mes en formato "YYYY-MM". */
export type MonthKey = string;

export function toMonthKey(year: number, month: number): MonthKey {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function parseMonthKey(key: MonthKey): { year: number; month: number } {
  const [y, m] = key.split("-");
  return { year: Number(y), month: Number(m) };
}

/** Índice absoluto de meses (año*12 + mes-1) para comparar y restar sin fechas. */
function monthIndex(key: MonthKey): number {
  const { year, month } = parseMonthKey(key);
  return year * 12 + (month - 1);
}

function fromIndex(index: number): MonthKey {
  return toMonthKey(Math.floor(index / 12), (index % 12) + 1);
}

export function addMonths(key: MonthKey, delta: number): MonthKey {
  return fromIndex(monthIndex(key) + delta);
}

/** Cantidad de meses del rango, ambos extremos incluidos. */
export function countMonths(from: MonthKey, to: MonthKey): number {
  return monthIndex(to) - monthIndex(from) + 1;
}

/** Desplaza el rango completo `delta` meses (◀ = -1, ▶ = +1). Cruza de año sin problema. */
export function shiftRange(from: MonthKey, to: MonthKey, delta: number): { from: MonthKey; to: MonthKey } {
  return { from: addMonths(from, delta), to: addMonths(to, delta) };
}

/** Devuelve el mensaje de error del rango, o `null` si es válido. */
export function validateRange(from: MonthKey, to: MonthKey): string | null {
  const n = countMonths(from, to);
  if (n < 1) return "El mes inicial no puede ser posterior al final.";
  if (n > MAX_MONTHS) return `El periodo no puede superar ${MAX_MONTHS} meses (seleccionaste ${n}).`;
  return null;
}

export type PeriodPreset = "currentYear" | "next6" | "next12";

export const PERIOD_PRESET_LABELS: Record<PeriodPreset, string> = {
  currentYear: "Año actual",
  next6: "Próximos 6 meses",
  next12: "Próximos 12 meses",
};

/** Rango de un atajo, calculado respecto de `today` (mes en curso incluido). */
export function presetRange(preset: PeriodPreset, today: Date = new Date()): { from: MonthKey; to: MonthKey } {
  const year = today.getFullYear();
  const current = toMonthKey(year, today.getMonth() + 1);
  if (preset === "currentYear") return { from: toMonthKey(year, 1), to: toMonthKey(year, 12) };
  if (preset === "next6") return { from: current, to: addMonths(current, 5) };
  return { from: current, to: addMonths(current, 11) };
}

/** "ene 26" para el encabezado de columna. */
export function monthHeader(key: MonthKey): string {
  const { year, month } = parseMonthKey(key);
  return `${monthShort(month).toLowerCase()} ${String(year).slice(2)}`;
}

/** Modificador visual de una celda según su estado; `null` = sin dato. */
export function statusTone(status: CapacityStatus | null): "over" | "ok" | "under" | "none" {
  if (status === "OVER") return "over";
  if (status === "OK") return "ok";
  if (status === "UNDER") return "under";
  return "none";
}

export const STATUS_LABELS: Record<CapacityStatus, string> = {
  OVER: "Sobreasignado",
  OK: "En rango",
  UNDER: "Subutilizado",
};

/** Texto de un porcentaje sin decimales, o "—" si no hay dato. */
export function formatPct(pct: number | null): string {
  return pct === null ? "—" : `${Math.round(pct)}%`;
}

/** Horas con un decimal y coma, como el resto de la interfaz en español. */
export function formatHours(hours: number): string {
  return new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 }).format(hours);
}

/** Máximo del eje Y de la gráfica: al menos 120 %, y siempre por encima del mayor valor y del umbral de sobreasignación. */
export function chartMax(values: (number | null)[], overPct: number): number {
  const top = Math.max(120, overPct + 20, ...values.map((v) => v ?? 0));
  return Math.ceil(top / 20) * 20;
}

/** Convierte los filtros de pantalla en los parámetros de la API (lo no elegido se omite). */
export function buildParams(filters: CapacityFilters): MonthlyCapacityParams {
  const params: MonthlyCapacityParams = { from: filters.from, to: filters.to };
  if (filters.includeProbables !== null) params.includeProbables = filters.includeProbables;
  if (filters.excludeInternal) params.internal = "exclude";
  if (filters.country) params.country = filters.country;
  if (filters.city) params.city = filters.city;
  return params;
}

/** Agrupa los avisos del cálculo en frases legibles. */
export function warningMessages(warnings: MonthlyCapacityWarning[], data: MonthlyCapacity): string[] {
  const messages: string[] = [];
  for (const w of warnings) {
    if (w.code === "HOLIDAYS_NOT_CONFIRMED") {
      messages.push(`Feriados de ${w.country} ${w.year} sin confirmar: el cálculo puede estar incompleto.`);
    }
  }
  const withoutCountry = warnings.filter(
    (w): w is Extract<MonthlyCapacityWarning, { code: "CONSULTANT_WITHOUT_COUNTRY" }> =>
      w.code === "CONSULTANT_WITHOUT_COUNTRY",
  );
  if (withoutCountry.length > 0) {
    const names = withoutCountry.map(
      (w) => w.fullName ?? data.consultants.find((c) => c.id === w.consultantId)?.fullName ?? w.consultantId,
    );
    messages.push(
      `${names.length === 1 ? "1 consultor sin país" : `${names.length} consultores sin país`} no entra en el equipo y se muestra sin capacidad: ${names.join(", ")}.`,
    );
  }
  return messages;
}

export type SortKey = "name" | "country" | "period";
export type SortDir = "asc" | "desc";

function compare(a: MonthlyCapacityConsultantRow, b: MonthlyCapacityConsultantRow, key: SortKey): number {
  if (key === "name") return a.fullName.localeCompare(b.fullName, "es");
  if (key === "country") {
    return (a.country ?? "").localeCompare(b.country ?? "", "es") || a.fullName.localeCompare(b.fullName, "es");
  }
  // Sin capacidad (pct null) se trata como el valor más bajo.
  return (a.period.pct ?? -Infinity) - (b.period.pct ?? -Infinity);
}

export function sortConsultants(
  rows: MonthlyCapacityConsultantRow[],
  key: SortKey,
  dir: SortDir,
): MonthlyCapacityConsultantRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => sign * compare(a, b, key));
}

/** Clave de sessionStorage con el periodo y filtros de la vista mensual. */
export const FILTERS_STORAGE_KEY = "synatrack.capacity.monthly.filters";

const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Lee los filtros guardados; devuelve `null` si no hay, están corruptos o el storage no está disponible. */
export function loadStoredFilters(storage: Pick<Storage, "getItem"> | undefined = safeSession()): CapacityFilters | null {
  try {
    const raw = storage?.getItem(FILTERS_STORAGE_KEY);
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null) return null;
    const o = v as Record<string, unknown>;
    if (typeof o.from !== "string" || typeof o.to !== "string") return null;
    if (!MONTH_KEY_RE.test(o.from) || !MONTH_KEY_RE.test(o.to)) return null;
    return {
      from: o.from,
      to: o.to,
      includeProbables: typeof o.includeProbables === "boolean" ? o.includeProbables : null,
      excludeInternal: o.excludeInternal === true,
      country: typeof o.country === "string" ? o.country : "",
      city: typeof o.city === "string" ? o.city : "",
    };
  } catch {
    return null;
  }
}

/** Guarda los filtros; es una conveniencia, así que cualquier fallo se ignora. */
export function saveStoredFilters(
  filters: CapacityFilters,
  storage: Pick<Storage, "setItem"> | undefined = safeSession(),
): void {
  try {
    storage?.setItem(FILTERS_STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // Modo privado o cuota llena: no se persiste y ya.
  }
}

function safeSession(): Storage | undefined {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : undefined;
  } catch {
    return undefined;
  }
}

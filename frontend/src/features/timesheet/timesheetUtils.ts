/**
 * Utilidades compartidas por el Timesheet (grilla semanal) y el Tracker
 * (cronómetro).
 *
 * Convención de fechas: `workDate` viaja y se guarda como `YYYY-MM-DD` y el
 * backend lo ancla a medianoche UTC. Aquí se trabaja siempre con esa cadena
 * como clave de día, nunca con objetos Date, para que un consultor en Bogotá y
 * otro en Madrid vean la hora en la misma columna del calendario.
 */

/** Día ISO (`YYYY-MM-DD`) a partir de la fecha *local* del navegador. */
export function toIsoDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Día ISO de hoy. */
export function todayIso(): string {
  return toIsoDay(new Date());
}

/**
 * Lunes de la semana a la que pertenece `isoDay`. La semana laboral arranca en
 * lunes, igual que en el resto de la aplicación.
 */
export function startOfWeek(isoDay: string): string {
  const [y, m, d] = isoDay.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  // getDay(): 0 = domingo. Se convierte a 0 = lunes.
  const offset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offset);
  return toIsoDay(date);
}

/** Suma (o resta, con valores negativos) días a un día ISO. */
export function addDays(isoDay: string, days: number): string {
  const [y, m, d] = isoDay.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return toIsoDay(date);
}

/** Los 7 días ISO de la semana que empieza en `weekStart` (lunes → domingo). */
export function weekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

const WEEKDAY_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"] as const;

/** Etiqueta corta del día de la semana para la cabecera de la grilla. */
export function weekdayLabel(index: number): string {
  return WEEKDAY_LABELS[index] ?? "";
}

/** Número de día del mes, para la segunda línea de la cabecera. */
export function dayOfMonth(isoDay: string): string {
  return isoDay.slice(8, 10);
}

/** ¿Es sábado o domingo? Se usa para atenuar esas columnas. */
export function isWeekend(index: number): boolean {
  return index >= 5;
}

const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "15 sep – 21 sep 2026", omitiendo el mes repetido cuando coincide. */
export function formatWeekRange(weekStart: string): string {
  const end = addDays(weekStart, 6);
  const [, sm, sd] = weekStart.split("-");
  const [ey, em, ed] = end.split("-");
  const startLabel = `${Number(sd)} ${MONTHS_SHORT[Number(sm) - 1]}`;
  const endLabel = `${Number(ed)} ${MONTHS_SHORT[Number(em) - 1]} ${ey}`;
  return `${startLabel} – ${endLabel}`;
}

// ── Duraciones ───────────────────────────────────────────────────────────────

/** Segundos → "HH:MM:SS", el reloj grande del tracker. */
export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Horas decimales → "8:30". Devuelve cadena vacía para 0, para no ensuciar la grilla. */
export function formatHoursShort(hours: number): string {
  if (!hours) return "";
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

/** Horas decimales → "8:30", mostrando también el cero (para los totales). */
export function formatHoursTotal(hours: number): string {
  const totalMinutes = Math.round(Math.max(0, hours) * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

/**
 * Interpreta lo que el usuario escribe en una celda de la grilla. Acepta los
 * mismos formatos que Clockify:
 *
 *   "1:30" → 1.5    "1,5" → 1.5    "1.5" → 1.5
 *   "90m"  → 1.5    "2h"  → 2      ""    → 0 (borra la celda)
 *
 * Devuelve `null` si el texto no es interpretable, para poder avisar sin
 * guardar basura.
 */
export function parseHoursInput(raw: string): number | null {
  const text = raw.trim().toLowerCase().replace(",", ".");
  if (!text) return 0;

  // "1:30"
  const colon = text.match(/^(\d+):([0-5]?\d)$/);
  if (colon) {
    return Number(colon[1]) + Number(colon[2]) / 60;
  }

  // "90m" / "90min"
  const minutes = text.match(/^(\d+(?:\.\d+)?)\s*m(?:in)?$/);
  if (minutes) {
    return Number(minutes[1]) / 60;
  }

  // "2h" / "2.5 h"
  const hours = text.match(/^(\d+(?:\.\d+)?)\s*h$/);
  if (hours) {
    return Number(hours[1]);
  }

  // Decimal simple
  const decimal = text.match(/^\d+(?:\.\d+)?$/);
  if (decimal) {
    return Number(text);
  }

  return null;
}

/** Redondea a 2 decimales, que es la precisión que guarda la base de datos. */
export function roundHours(hours: number): number {
  return Math.round(hours * 100) / 100;
}

/** `Decimal` de Prisma llega como string; esto lo convierte sin romperse. */
export function numberish(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

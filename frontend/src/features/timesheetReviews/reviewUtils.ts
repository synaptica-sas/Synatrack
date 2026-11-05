/**
 * Lógica pura de la pantalla "Aprobación de horas" (R15): etiquetas de las
 * novedades, selección de filas y traducción de errores por ítem.
 */
import {
  ApiError,
  type ReviewFlag,
  type WeekReviewDay,
  type WeekReviewItem,
  type WeekReviewRow,
} from "../../services/api";

/** Texto accesible de cada novedad: nunca se comunica solo con color. */
export const FLAG_LABELS: Record<ReviewFlag, string> = {
  EXTRA: "Horas extra",
  EXCESS: "Excedente",
  ABSENCE: "Ausencia",
  NON_WORKING_DAY: "Fin de semana/festivo",
  OVER_JORNADA: "Supera jornada",
};

/** Abreviatura que acompaña al color en la celda. */
export const FLAG_SYMBOLS: Record<ReviewFlag, string> = {
  EXTRA: "HE",
  EXCESS: "EX",
  ABSENCE: "AU",
  NON_WORKING_DAY: "FS",
  OVER_JORNADA: "▲",
};

/** Orden estable en que se listan las novedades. */
export const FLAG_ORDER: ReviewFlag[] = ["EXTRA", "EXCESS", "ABSENCE", "NON_WORKING_DAY", "OVER_JORNADA"];

export function sortFlags(flags: readonly ReviewFlag[]): ReviewFlag[] {
  return FLAG_ORDER.filter((f) => flags.includes(f));
}

/** Horas decimales -> "H:MM" (8,5 -> "8:30"); vacío para 0. */
export function formatHm(hours: number): string {
  if (!hours || hours <= 0) return "";
  const totalMinutes = Math.round(hours * 60);
  return `${Math.floor(totalMinutes / 60)}:${String(totalMinutes % 60).padStart(2, "0")}`;
}

/** Igual que `formatHm` pero mostrando el cero ("0:00"), para totales. */
export function formatHmTotal(hours: number): string {
  return formatHm(hours) || "0:00";
}

/** Jornada del día; `null` = el consultor no tiene jornada configurada. */
export function formatJornada(jornada: number | null): string {
  return jornada === null ? "Sin jornada" : formatHmTotal(jornada);
}

/** Etiquetas de las novedades de un día; OVER_JORNADA lleva total vs jornada. */
export function dayFlagLabels(day: WeekReviewDay): string[] {
  return sortFlags(day.flags).map((flag) =>
    flag === "OVER_JORNADA"
      ? `${FLAG_LABELS[flag]}: ${formatHmTotal(day.consultantTotal)} de ${formatJornada(day.jornada)}`
      : FLAG_LABELS[flag],
  );
}

/** Texto del title/aria-label de una celda de día. */
export function dayCellTitle(day: WeekReviewDay): string {
  const labels = dayFlagLabels(day);
  const base = `${day.date}: ${formatHmTotal(day.hours)} h`;
  return labels.length > 0 ? `${base} · ${labels.join(" · ")}` : base;
}

export function rowKey(row: Pick<WeekReviewRow, "consultantId" | "projectId" | "weekStart">): string {
  return `${row.consultantId}|${row.projectId}|${row.weekStart}`;
}

/** Solo se seleccionan filas enviadas que el usuario puede revisar. */
export function isSelectable(row: WeekReviewRow): boolean {
  return row.canReview && row.status === "SUBMITTED";
}

export function toItems(rows: readonly WeekReviewRow[], selected: ReadonlySet<string>): WeekReviewItem[] {
  return rows
    .filter((r) => selected.has(rowKey(r)) && isSelectable(r))
    .map((r) => ({ consultantId: r.consultantId, projectId: r.projectId, weekStart: r.weekStart }));
}

export const REVIEW_STATUS_PILL: Record<WeekReviewRow["status"], { label: string; tone: "warn" | "ok" | "error" }> = {
  SUBMITTED: { label: "Enviada", tone: "warn" },
  APPROVED: { label: "Aprobada", tone: "ok" },
  RETURNED: { label: "Devuelta", tone: "error" },
  PENDING: { label: "Sin enviar", tone: "warn" },
  REJECTED: { label: "Rechazada", tone: "error" },
};

/**
 * Mensaje de un error de aprobación. Si el backend señala el ítem culpable
 * (`item.index`), se nombra el consultor, proyecto y semana de esa fila.
 */
export function approveErrorMessage(
  err: unknown,
  items: readonly WeekReviewItem[],
  rows: readonly WeekReviewRow[],
): string {
  if (!(err instanceof ApiError)) return err instanceof Error ? err.message : "No se pudo aprobar";
  const item = err.details.item;
  const index = item && typeof item === "object" ? (item as { index?: unknown }).index : undefined;
  if (typeof index !== "number") return err.message;
  const target = items[index];
  const row = target
    ? rows.find(
        (r) =>
          r.consultantId === target.consultantId &&
          r.projectId === target.projectId &&
          r.weekStart === target.weekStart,
      )
    : undefined;
  if (!row) return err.message;
  return `${row.consultantName} · ${row.projectName} · semana del ${row.weekStart}: ${err.message}`;
}

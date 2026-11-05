/**
 * Lógica pura del estado de la semana del timesheet (R15): qué dice la barra
 * de estado, qué proyectos siguen editables y por qué no se puede enviar.
 * Sin React ni red, para poder probarla suelta.
 */
import type { TimesheetWeekStatus, WeekProjectReview } from "../../services/api";
import { formatHoursTotal, weekdayLabel, weekDays } from "./timesheetUtils";

/** Estado global de la semana, derivado del estado de cada proyecto. */
export type WeekState = "EMPTY" | "PENDING" | "SUBMITTED" | "APPROVED" | "PARTIAL" | "RETURNED";

export const WEEK_STATE_LABELS: Record<WeekState, string> = {
  EMPTY: "Sin registros",
  PENDING: "Pendiente",
  SUBMITTED: "Enviada",
  APPROVED: "Aprobada",
  PARTIAL: "Parcialmente aprobada",
  RETURNED: "Devuelta",
};

export const REVIEW_STATUS_LABELS: Record<WeekProjectReview["status"], string> = {
  SUBMITTED: "Enviado",
  APPROVED: "Aprobado",
  RETURNED: "Devuelto",
};

/**
 * Sin revisiones la semana sigue "Pendiente" (nada enviado). Un proyecto
 * devuelto manda sobre el resto: el consultor tiene trabajo por hacer.
 */
export function deriveWeekState(
  reviews: readonly WeekProjectReview[] | undefined,
  /**
   * Registros de la semana. Las semanas anteriores a R15 no tienen revisiones
   * aunque sus registros estén aprobados: ahí manda el estado de los registros.
   * Si no se pasan, se asume que no se conocen y se cae en "Pendiente".
   */
  entries?: readonly { status: string }[],
): WeekState {
  if (!reviews || reviews.length === 0) {
    if (!entries) return "PENDING";
    if (entries.length === 0) return "EMPTY";
    if (entries.every((e) => e.status === "APPROVED")) return "APPROVED";
    if (entries.every((e) => e.status === "SUBMITTED")) return "SUBMITTED";
    return "PENDING";
  }
  if (reviews.some((r) => r.status === "RETURNED")) return "RETURNED";
  const approved = reviews.filter((r) => r.status === "APPROVED").length;
  if (approved === reviews.length) return "APPROVED";
  if (approved > 0) return "PARTIAL";
  return "SUBMITTED";
}

/** Un proyecto se escribe si la semana no está bloqueada o si fue devuelto. */
export function isProjectEditable(
  status: Pick<TimesheetWeekStatus, "locked" | "editableProjectIds"> | null | undefined,
  projectId: string,
): boolean {
  if (!status) return true;
  return !status.locked || status.editableProjectIds.includes(projectId);
}

/** Devoluciones vigentes, para el aviso de arriba de la semana. */
export function returnedReviews(reviews: readonly WeekProjectReview[] | undefined): WeekProjectReview[] {
  return (reviews ?? []).filter((r) => r.status === "RETURNED");
}

/** "El PM Ana devolvió Proyecto X: «nota»". */
export function returnedMessage(review: WeekProjectReview): string {
  const nombre = review.reviewedByName ?? review.reviewedBy;
  const sujeto = nombre ? `El PM ${nombre}` : "El revisor";
  const nota = review.note?.trim();
  return `${sujeto} devolvió ${review.projectName}${nota ? `: «${nota}»` : "."}`;
}

export type MissingDay = { date: string; label: string; missingHours: number; future: boolean };

export type SubmissionSummary = {
  canSubmit: boolean;
  /** Faltan días laborables que aún no han transcurrido. */
  inProgress: boolean;
  missingDays: MissingDay[];
  /** Errores que no son un día incompleto (p. ej. nada que enviar). */
  otherMessages: string[];
};

/** Resume `submission` para pintarlo: días que faltan, cuánto, y si la semana sigue en curso. */
export function summarizeSubmission(status: TimesheetWeekStatus | null | undefined): SubmissionSummary {
  if (!status) return { canSubmit: false, inProgress: false, missingDays: [], otherMessages: [] };
  const { submission, weekStart, today } = status;
  const dates = weekDays(weekStart);
  const missingDays: MissingDay[] = submission.days
    .filter((d) => d.isWorkday && !d.complete && d.missing > 0)
    .map((d) => ({
      date: d.date,
      label: weekdayLabel(Math.max(0, dates.indexOf(d.date))),
      missingHours: d.missing,
      future: d.date > today,
    }));
  const otherMessages = submission.errors
    .filter((e) => e.date === undefined || !missingDays.some((m) => m.date === e.date))
    .map((e) => e.message);
  return {
    canSubmit: submission.ok,
    inProgress: missingDays.some((m) => m.future),
    missingDays,
    otherMessages,
  };
}

/** "Mié 12: faltan 02:30:00" */
export function formatMissingDay(day: MissingDay): string {
  return `${day.label} ${day.date.slice(8, 10)}: faltan ${formatHoursTotal(day.missingHours)}`;
}

/**
 * Mensajes de un envío rechazado (400 WEEK_NOT_SUBMITTABLE / 409): el cuerpo
 * trae `errors: [{ message }]` con un día incompleto por elemento.
 */
export function submitErrorMessages(details: Record<string, unknown> | undefined): string[] {
  const errors = details?.errors;
  if (!Array.isArray(errors)) return [];
  return errors
    .map((e) => (e && typeof e === "object" ? (e as { message?: unknown }).message : undefined))
    .filter((m): m is string => typeof m === "string" && m.length > 0);
}

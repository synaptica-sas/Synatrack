import { ApiError, type StopTimerResult } from "../../services/api";
import { timeOfDay } from "../timesheet/timesheetGrid";

/** Horas decimales → "2 h 15 min", "2 h" o "45 min". */
export function formatHorasLargas(hours: number): string {
  const totalMin = Math.round(Math.max(0, hours) * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0 && m > 0) return `${h} h ${m} min`;
  if (h > 0) return `${h} h`;
  return `${m} min`;
}

/**
 * Aviso tras detener el cronómetro. El servidor registra solo horas REGULARES hasta
 * el tope de la jornada y descarta lo que sobra (haya o no horas extra aprobadas),
 * así que el consultor debe registrar a mano en el timesheet lo que fueran extras.
 * Devuelve `null` si no se descartó nada.
 */
export function avisoDescartado(
  resultado: Pick<StopTimerResult, "discardedHours" | "discardedFrom" | "discardedTo">,
): string | null {
  if (!(resultado.discardedHours > 0)) return null;
  const duracion = formatHorasLargas(resultado.discardedHours);
  let franja = "";
  if (resultado.discardedFrom) {
    const desde = new Date(resultado.discardedFrom);
    const hasta = resultado.discardedTo
      ? new Date(resultado.discardedTo)
      : new Date(desde.getTime() + Math.round(resultado.discardedHours * 3600) * 1000);
    const a = timeOfDay(desde.toISOString());
    const b = timeOfDay(hasta.toISOString());
    if (a && b) franja = ` (${a} – ${b})`;
  }
  return `El cronómetro marcó ${duracion} por encima de tu jornada${franja} y no se guardaron. Si fueron horas extra, regístralas manualmente en el timesheet.`;
}

/** Avisos efímeros (toast) tras detener el cronómetro. */
export function avisosAlDetener(
  resultado: Pick<StopTimerResult, "discardedHours" | "discardedFrom" | "discardedTo">,
): Array<{ message: string; type: "warning" | "info" }> {
  const mensaje = avisoDescartado(resultado);
  return mensaje ? [{ type: "warning", message: mensaje }] : [];
}

/** El servidor rechazó la operación porque la semana ya fue enviada (R15, `WEEK_LOCKED`). */
export function isWeekLockedError(err: unknown): err is ApiError {
  return err instanceof ApiError && err.code === "WEEK_LOCKED";
}

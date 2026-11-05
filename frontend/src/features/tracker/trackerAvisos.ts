import { ApiError, type StopTimerResult } from "../../services/api";
import { formatDuration, numberish } from "../timesheet/timesheetUtils";

/**
 * Avisos tras detener el cronómetro. El servidor parte la franja contra la
 * jornada: lo que sobra sin horas extra aprobadas se descarta, y lo que pasa del
 * saldo aprobado queda como excedente a la espera del PM.
 */
export function avisosAlDetener(
  resultado: Pick<StopTimerResult, "entries" | "discardedHours">,
): Array<{ message: string; type: "warning" | "info" }> {
  const avisos: Array<{ message: string; type: "warning" | "info" }> = [];
  if (resultado.discardedHours > 0) {
    avisos.push({
      type: "warning",
      message: `${formatDuration(resultado.discardedHours)} quedaron fuera: superan la jornada del día y no hay una solicitud de horas extra aprobada.`,
    });
  }
  const excedente = resultado.entries.filter((e) => e.isExcess);
  if (excedente.length > 0) {
    const horas = excedente.reduce((sum, e) => sum + numberish(e.hours), 0);
    avisos.push({
      type: "info",
      message: `${formatDuration(horas)} superan lo aprobado en la solicitud de horas extra: quedan como excedente pendiente de aprobación del PM.`,
    });
  }
  return avisos;
}

/** El servidor rechazó la operación porque la semana ya fue enviada (R15, `WEEK_LOCKED`). */
export function isWeekLockedError(err: unknown): err is ApiError {
  return err instanceof ApiError && err.code === "WEEK_LOCKED";
}

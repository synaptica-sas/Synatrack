/**
 * Programación del resumen semanal. El backend razona en UTC (CONTRATO §5.4: "ahora UTC está
 * en `digestWeekday` y >= `digestHourUtc`"), pero quien administra piensa en hora de
 * Bogotá/Quito (UTC-5, sin horario de verano). Aquí se convierte entre las dos.
 *
 * Ojo con el día: pasada la medianoche UTC cambia de día. Las 21:00 del lunes en Bogotá son
 * las 02:00 del martes UTC, así que el día también se desplaza.
 */

/** Horas que Bogotá/Quito van por detrás de UTC. */
export const LOCAL_UTC_OFFSET_HOURS = 5;

/** Día ISO: 1 = lunes … 7 = domingo. */
export type Schedule = { weekday: number; hour: number };

export const WEEKDAY_LABELS: Record<number, string> = {
  1: "Lunes",
  2: "Martes",
  3: "Miércoles",
  4: "Jueves",
  5: "Viernes",
  6: "Sábado",
  7: "Domingo",
};

/** De hora local de Bogotá/Quito a UTC. `digestHourUtc = (local + 5) mod 24`. */
export function localToUtc({ weekday, hour }: Schedule): Schedule {
  const total = hour + LOCAL_UTC_OFFSET_HOURS;
  return { weekday: total >= 24 ? (weekday % 7) + 1 : weekday, hour: total % 24 };
}

/** De UTC a hora local de Bogotá/Quito. */
export function utcToLocal({ weekday, hour }: Schedule): Schedule {
  const total = hour - LOCAL_UTC_OFFSET_HOURS;
  return { weekday: total < 0 ? ((weekday + 5) % 7) + 1 : weekday, hour: (total + 24) % 24 };
}

export function formatHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

export type AlertsForm = { horizon: string; weekday: number; hour: number };

/** Valida el formulario de alertas y resumen. Devuelve el error o `null`. */
export function validarAlertas({ horizon, weekday, hour }: AlertsForm): string | null {
  const h = Number(horizon.replace(",", "."));
  if (horizon.trim() === "" || !Number.isInteger(h) || h < 1 || h > 12) {
    return "El horizonte de alertas debe ser un número entero de meses entre 1 y 12.";
  }
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) return "Elige un día de la semana válido.";
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return "Elige una hora válida (0 a 23).";
  return null;
}

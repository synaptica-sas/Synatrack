import type { TimeEntry } from "../../services/api";
import { numberish } from "./timesheetUtils";

/**
 * Lógica pura de la grilla semanal: cómo se agrupan los registros en filas,
 * qué se muestra en el letrero de cada celda, qué se copia de la semana
 * anterior y cómo se traduce la franja horaria de la ventana "Editar tiempo".
 * Vive aparte de la pantalla para poder probarla sin montar React.
 */

/**
 * Una fila por proyecto. Cada celda reúne TODOS los registros de ese proyecto
 * en ese día, sea cual sea su descripción: lo que se hizo se ve en el letrero
 * al pasar el ratón y se edita en la ventana de la celda, no en filas aparte.
 */
export type ProjectRow = {
  projectId: string;
  /**
   * Registros por día ISO. Normalmente uno; el cronómetro puede dejar varios
   * el mismo día (uno por cada vez que se arranca y se detiene).
   */
  cells: Record<string, TimeEntry[] | undefined>;
};

/** Agrupa los registros de la semana en una fila por proyecto. */
export function buildProjectRows(entries: TimeEntry[]): Map<string, ProjectRow> {
  const byProject = new Map<string, ProjectRow>();
  for (const entry of entries) {
    let row = byProject.get(entry.projectId);
    if (!row) {
      row = { projectId: entry.projectId, cells: {} };
      byProject.set(entry.projectId, row);
    }
    const day = entry.workDate.slice(0, 10);
    row.cells[day] = [...(row.cells[day] ?? []), entry];
  }
  return byProject;
}

/** Horas de una celda; 0 si está vacía. */
export function cellHours(entries: TimeEntry[] | undefined): number {
  return (entries ?? []).reduce((sum, e) => sum + numberish(e.hours), 0);
}

/**
 * Actividades de una celda para el letrero: cada línea de la descripción es
 * una actividad. Se quitan las vacías y las repetidas (sin distinguir
 * mayúsculas), conservando el orden en que se escribieron.
 */
export function cellActivities(entries: TimeEntry[] | undefined): string[] {
  const vistas = new Set<string>();
  const lista: string[] = [];
  for (const entry of entries ?? []) {
    for (const linea of (entry.description ?? "").split(/\r?\n/)) {
      const texto = linea.trim();
      const clave = texto.toLowerCase();
      if (!texto || vistas.has(clave)) continue;
      vistas.add(clave);
      lista.push(texto);
    }
  }
  return lista;
}

/**
 * Proyectos de otra semana que aún no están en esta, para traerlos como filas
 * vacías. Se devuelven en el orden en que aparecen.
 */
export function projectsToCopy(previousWeek: TimeEntry[], existing: Set<string>): string[] {
  const ids: string[] = [];
  for (const entry of previousWeek) {
    if (existing.has(entry.projectId) || ids.includes(entry.projectId)) continue;
    ids.push(entry.projectId);
  }
  return ids;
}

// ── Franja horaria de la ventana "Editar tiempo" ─────────────────────────────

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** "HH:MM" en hora local de un instante ISO; "" si no hay instante. */
export function timeOfDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** ¿Es una hora "HH:MM" válida? Acepta "9:05". */
export function isValidTime(value: string): boolean {
  return HHMM.test(value.trim());
}

/** Minutos desde medianoche de una hora "HH:MM" válida. */
function minutesOf(value: string): number {
  const [, h, m] = HHMM.exec(value.trim())!;
  return Number(h) * 60 + Number(m);
}

/** Instante ISO de una hora local "HH:MM" en el día ISO dado. */
export function combineDayTime(day: string, time: string): string {
  const mins = minutesOf(time);
  const [y, mo, d] = day.split("-").map(Number);
  return new Date(y, mo - 1, d, Math.floor(mins / 60), mins % 60).toISOString();
}

/** Hora "HH:MM" que resulta de sumar una duración a una hora de inicio. */
export function endTimeFrom(start: string, hours: number): string {
  const total = minutesOf(start) + Math.round(hours * 60);
  const mins = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

/**
 * Horas entre dos horas "HH:MM" del mismo día; `null` si el fin no va después
 * del inicio (la franja no cruza la medianoche).
 */
export function hoursBetween(start: string, end: string): number | null {
  const diff = minutesOf(end) - minutesOf(start);
  return diff > 0 ? diff / 60 : null;
}

/**
 * Franja a guardar a partir de la hora de inicio y la duración: el fin se
 * calcula desde la duración exacta (con sus segundos), no desde el "HH:MM"
 * redondeado que se ve en pantalla. Sin hora de inicio no hay franja.
 */
export function rangeFor(
  day: string,
  start: string,
  hours: number,
): { startedAt: string | null; endedAt: string | null } {
  if (!start.trim()) return { startedAt: null, endedAt: null };
  const startedAt = combineDayTime(day, start);
  const endedAt = new Date(new Date(startedAt).getTime() + Math.round(hours * 3600) * 1000).toISOString();
  return { startedAt, endedAt };
}

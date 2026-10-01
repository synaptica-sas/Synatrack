import type { TimeEntry } from "../../services/api";
import { numberish } from "./timesheetUtils";

/**
 * Lógica pura de la grilla semanal: cómo se agrupan los registros en filas,
 * qué proyectos se abren al llegar, en qué orden van las tareas y qué filas se
 * copian de la semana anterior. Vive aparte de la pantalla para poder probarla
 * sin montar React.
 */

/**
 * Una fila de la grilla agrupa todas las horas de la semana que comparten
 * proyecto, actividad y descripción. La clave se construye con esos tres
 * campos para que escribir la misma tarea dos días seguidos caiga en la misma
 * fila, igual que en Clockify.
 */
export type TimesheetRow = {
  key: string;
  projectId: string;
  activityId: string | null;
  description: string;
  /**
   * Entradas de horas por día ISO. Normalmente hay una sola, pero el tracker
   * puede generar varias el mismo día sobre la misma tarea (una por cada vez
   * que se arranca y se detiene el cronómetro). En ese caso la celda muestra
   * la suma y se bloquea, porque no habría forma de repartir un valor nuevo
   * entre los registros originales sin inventarse el criterio.
   */
  cells: Record<string, TimeEntry[] | undefined>;
};

/** Mayúsculas y espacios de más no crean una fila nueva. */
export function rowKeyOf(projectId: string, activityId: string | null, description: string) {
  return `${projectId}::${activityId ?? ""}::${description.trim().toLowerCase()}`;
}

/** Agrupa los registros de la semana en filas de la grilla. */
export function buildRows(entries: TimeEntry[]): Map<string, TimesheetRow> {
  const byKey = new Map<string, TimesheetRow>();
  for (const entry of entries) {
    const description = entry.description ?? "";
    const key = rowKeyOf(entry.projectId, entry.activityId, description);
    let row = byKey.get(key);
    if (!row) {
      row = { key, projectId: entry.projectId, activityId: entry.activityId, description, cells: {} };
      byKey.set(key, row);
    }
    const day = entry.workDate.slice(0, 10);
    row.cells[day] = [...(row.cells[day] ?? []), entry];
  }
  return byKey;
}

/** Horas totales de una fila en la semana. */
export function rowHours(row: TimesheetRow): number {
  let total = 0;
  for (const lista of Object.values(row.cells)) {
    for (const e of lista ?? []) total += numberish(e.hours);
  }
  return total;
}

/**
 * Proyectos que tienen horas ese día. Son los que se despliegan al llegar a la
 * semana actual: lo que estás tocando hoy queda a la vista, y el resto plegado.
 */
export function projectsWithHoursOn(rows: Iterable<TimesheetRow>, day: string): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    const horas = (row.cells[day] ?? []).reduce((s, e) => s + numberish(e.hours), 0);
    if (horas > 0) ids.add(row.projectId);
  }
  return ids;
}

/**
 * Orden de las tareas: de más a menos horas en la semana, para que lo
 * importante quede arriba.
 *
 * Se calcula como una FOTO al cargar la semana, no en vivo. Si se reordenara
 * con cada celda guardada, la fila se movería mientras la estás editando y el
 * tabulador acabaría en la celda de otra tarea.
 */
export function rankByHours(rows: Iterable<TimesheetRow>): Map<string, number> {
  const ordenadas = [...rows].sort(
    (a, b) => rowHours(b) - rowHours(a) || a.description.localeCompare(b.description),
  );
  return new Map(ordenadas.map((row, i) => [row.key, i]));
}

/** Ordena las tareas de un proyecto según la foto; las nuevas van al final. */
export function sortByRank(tareas: TimesheetRow[], rank: Map<string, number>): TimesheetRow[] {
  return [...tareas].sort((a, b) => {
    const ra = rank.get(a.key) ?? Number.POSITIVE_INFINITY;
    const rb = rank.get(b.key) ?? Number.POSITIVE_INFINITY;
    return ra - rb || a.description.localeCompare(b.description);
  });
}

/**
 * Filas vacías a partir de las tareas de otra semana, listas para rellenar.
 * Se omiten las que ya existen en la semana actual, para no duplicarlas.
 */
export function rowsToCopy(
  previousWeek: TimeEntry[],
  existingKeys: Set<string>,
): TimesheetRow[] {
  const copiadas: TimesheetRow[] = [];
  for (const row of buildRows(previousWeek).values()) {
    if (existingKeys.has(row.key)) continue;
    copiadas.push({ ...row, cells: {} });
  }
  return copiadas;
}

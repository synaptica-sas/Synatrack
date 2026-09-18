/** Format a number as currency using Intl.NumberFormat */
export function fmt(value: number, currency = "USD") {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export type DeltaResult = { pct: number; dir: "up" | "down" | "flat" } | null;

export function calcDelta(current: number, previous: number): DeltaResult {
  if (previous === 0) return null;
  const raw = ((current - previous) / Math.abs(previous)) * 100;
  const dir = raw > 0.5 ? "up" : raw < -0.5 ? "down" : "flat";
  return { pct: Math.abs(raw), dir };
}

export function calcEVM(budget: number, ev: number, spent: number, cpi: number | null | undefined) {
  const bac = budget;
  const ac = spent;
  const effectiveCpi = cpi ?? (ac > 0 ? ev / ac : null);
  const eac = effectiveCpi && effectiveCpi > 0 ? bac / effectiveCpi : null;
  const vac = eac != null ? bac - eac : null;
  const cv = ev - ac;
  const tcpi = bac - ac > 0 ? (bac - ev) / (bac - ac) : null;
  return { bac, ev, ac, eac, vac, cv, tcpi };
}

/* ── Orden de la tabla de proyectos del Tablero de Control ───────────────── */

/** Nivel de alerta de presupuesto de una fila de la tabla de proyectos. */
export type ProjectAlertLevel = "ok" | "warning" | "exceeded";

/** Columnas por las que se puede ordenar la tabla de proyectos. */
export type ProjectSortField =
  | "budget"
  | "spent"
  | "remainingBudget"
  | "revenueRecognized"
  | "grossMarginActual"
  | "projectedTotal"
  | "projectedPct"
  | "alertLevel";

/**
 * Peso de cada nivel de alerta. Menor número = más crítico, de modo que el
 * orden ascendente deja primero los proyectos con presupuesto excedido.
 */
export const ALERT_LEVEL_ORDER: Record<ProjectAlertLevel, number> = {
  exceeded: 0,
  warning: 1,
  ok: 2,
};

/**
 * Ordena las filas de la tabla de proyectos sin mutar el arreglo original.
 * Las columnas numéricas comparan su valor (los nulos cuentan como 0) y la
 * columna de alerta usa el peso de `ALERT_LEVEL_ORDER`.
 */
export function sortProjectRows<T extends { alertLevel: ProjectAlertLevel }>(
  rows: readonly T[],
  sortField: ProjectSortField,
  sortDir: "asc" | "desc",
): T[] {
  return [...rows].sort((a, b) => {
    let av: number;
    let bv: number;
    if (sortField === "alertLevel") {
      av = ALERT_LEVEL_ORDER[a.alertLevel];
      bv = ALERT_LEVEL_ORDER[b.alertLevel];
    } else {
      av = (a[sortField as keyof T] as number) ?? 0;
      bv = (b[sortField as keyof T] as number) ?? 0;
    }
    return sortDir === "asc" ? av - bv : bv - av;
  });
}

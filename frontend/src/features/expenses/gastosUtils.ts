import type { ConversionQuality } from "../../services/api";

// ── Formateo ──────────────────────────────────────────────────────────────────

export function fmtMoney(value: number, currency: string): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

export function numberish(v: string | number | null | undefined): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ── Explicación de la conversión (R-026) ─────────────────────────────────────
//
// Aquí vivía `convertToBase`, que reconvertía cada importe en el navegador con
// las tasas de HOY (`FxConfig`). Era una SEGUNDA implementación de la conversión
// de moneda, y daba otro número que la del backend, que valora cada movimiento a
// la tasa de su propia fecha (R-008/R-012): los mismos gastos sumaban distinto en
// Gastos que en el Tablero. Se eliminó. Ahora el importe convertido llega en
// `expense.baseAmount` y aquí solo se EXPLICA, sin recalcular nada.

/**
 * Texto del tooltip del importe convertido: de cuánto se partió, con qué tasa
 * implícita se llegó y de qué fecha salió esa tasa.
 *
 * La "tasa implícita" se deduce dividiendo el resultado entre el origen; no es
 * una conversión, es leer al revés la que ya hizo el servidor.
 */
export function tooltipConversion(expense: {
  amount: string | number;
  currency: string;
  baseAmount: number;
  baseCurrency: string;
  conversionQuality: ConversionQuality;
  expenseDate: string;
}): string {
  const original = numberish(expense.amount);

  if (expense.currency === expense.baseCurrency) {
    return `${fmtMoney(original, expense.currency)} (misma moneda)`;
  }

  if (expense.conversionQuality === "missing") {
    return (
      `Sin tasa de ${expense.currency} a ${expense.baseCurrency}: ` +
      `el importe se muestra SIN convertir (${fmtMoney(original, expense.currency)}).`
    );
  }

  const tasa = original !== 0 ? expense.baseAmount / original : 0;
  const detalle =
    `${fmtMoney(original, expense.currency)} × ${tasa.toLocaleString("es-CO", {
      maximumFractionDigits: 8,
    })} = ${fmtMoney(expense.baseAmount, expense.baseCurrency)}`;

  return expense.conversionQuality === "dated"
    ? `${detalle} (tasa vigente el ${fmtDate(expense.expenseDate)})`
    : `${detalle} — valorado con la tasa de HOY: no hay tasa anterior al ${fmtDate(expense.expenseDate)}.`;
}

// ── Moneda de presentación por defecto (R-026) ───────────────────────────────

/**
 * Decide en qué moneda se muestra la vista agrupada de Gastos **antes** de que
 * el usuario toque el selector.
 *
 * Hasta R-026 la respuesta era `USD` fija, sin mirar el dato: un proyecto que
 * factura y gasta en pesos se leía convertido a dólares sin que nadie lo
 * hubiera pedido. Ahora manda la moneda del proyecto, que es la moneda en la
 * que ese gasto se discute de verdad.
 *
 * Solo hay una respuesta buena cuando **todos** los gastos a la vista
 * pertenecen a proyectos que comparten moneda —el caso normal al filtrar por un
 * proyecto—. Si se mezclan varias, ninguna de ellas es "la del proyecto" y se
 * cae al respaldo (la moneda base de la aplicación), porque elegir una al azar
 * sería peor que elegir siempre la misma.
 *
 * Es una decisión de presentación: no cambia ningún importe, solo la moneda a
 * la que se convierten para sumarlos.
 */
export function monedaBasePorDefecto(
  expenses: { project?: { currency?: string | null } | null }[],
  respaldo: string,
): string {
  const monedas = new Set<string>();
  for (const gasto of expenses) {
    const moneda = gasto.project?.currency;
    if (moneda) monedas.add(moneda);
  }
  return monedas.size === 1 ? [...monedas][0] : respaldo;
}

// ── Estado presupuestal ───────────────────────────────────────────────────────

export type BudgetStatus = "ok" | "warning" | "exceeded";

export function getBudgetStatus(spent: number, budget: number): BudgetStatus {
  if (budget <= 0) return "ok";
  const pct = (spent / budget) * 100;
  if (pct >= 100) return "exceeded";
  if (pct >= 85) return "warning";
  return "ok";
}

// ── Agrupamiento de fechas ────────────────────────────────────────────────────

export function toMonthKey(dateStr: string): string {
  return dateStr.slice(0, 7); // "2026-04"
}

export function formatMonthKey(key: string): string {
  const [y, m] = key.split("-");
  const date = new Date(Number(y), Number(m) - 1, 1);
  return date.toLocaleDateString("es-CO", { month: "long", year: "numeric" });
}

// ── Fecha formateada ──────────────────────────────────────────────────────────

/**
 * Fecha de un gasto, formateada.
 *
 * Se lee y se formatea en **UTC**, que es como el backend las guarda y las
 * compara. `new Date("2026-08-14")` se interpreta como medianoche UTC, pero
 * `toLocaleDateString` sin zona la imprimía en la hora local: en Colombia
 * (UTC-5) un gasto del 14 se mostraba como "13/08/2026". El desfase afectaba a
 * la columna "Última fecha" y al detalle, y con R-026 habría llegado a decir
 * que se usó la tasa de un día que no es.
 */
export function fmtDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("es-CO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
}

// ── Período anterior (para delta KPI) ────────────────────────────────────────

export function prevPeriod(from: string, to: string): { from: string; to: string } {
  const msFrom = new Date(from).getTime();
  const msTo = new Date(to).getTime();
  const duration = msTo - msFrom;
  const prevTo = new Date(msFrom - 1);
  const prevFrom = new Date(prevTo.getTime() - duration);
  return {
    from: prevFrom.toISOString().slice(0, 10),
    to: prevTo.toISOString().slice(0, 10),
  };
}

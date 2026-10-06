import type { FxConfig } from "../../services/api";

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

// ── Conversión FX ─────────────────────────────────────────────────────────────
// FxConfig.rate = quoteCode per 1 baseCode  (ej. base=USD, quote=COP, rate=4000)

export type ConversionResult = {
  value: number;
  rate: number | null;
  tooltip: string;
};

export function convertToBase(
  amount: number,
  fromCurrency: string,
  baseCurrency: string,
  fxConfigs: FxConfig[],
): ConversionResult {
  if (fromCurrency === baseCurrency) {
    return {
      value: amount,
      rate: 1,
      tooltip: `${fmtMoney(amount, fromCurrency)} (misma moneda)`,
    };
  }

  // Directo: base=baseCurrency, quote=fromCurrency → amount / rate
  const direct = fxConfigs.find(
    (f) => f.baseCode === baseCurrency && f.quoteCode === fromCurrency,
  );
  if (direct) {
    const rate = numberish(direct.rate);
    if (rate === 0) return { value: 0, rate: null, tooltip: "Tasa FX = 0" };
    const converted = amount / rate;
    return {
      value: converted,
      rate: 1 / rate,
      tooltip: `${fmtMoney(amount, fromCurrency)} ÷ ${rate.toLocaleString("es-CO")} = ${fmtMoney(converted, baseCurrency)}`,
    };
  }

  // Inverso: base=fromCurrency, quote=baseCurrency → amount * rate
  const inverse = fxConfigs.find(
    (f) => f.baseCode === fromCurrency && f.quoteCode === baseCurrency,
  );
  if (inverse) {
    const rate = numberish(inverse.rate);
    if (rate === 0) return { value: 0, rate: null, tooltip: "Tasa FX = 0" };
    const converted = amount * rate;
    return {
      value: converted,
      rate,
      tooltip: `${fmtMoney(amount, fromCurrency)} × ${rate.toLocaleString("es-CO")} = ${fmtMoney(converted, baseCurrency)}`,
    };
  }

  // Tasa cruzada vía USD
  if (fromCurrency !== "USD" && baseCurrency !== "USD") {
    const toUSD = convertToBase(amount, fromCurrency, "USD", fxConfigs);
    const toBase = convertToBase(toUSD.value, "USD", baseCurrency, fxConfigs);
    if (toUSD.rate != null && toBase.rate != null) {
      return {
        value: toBase.value,
        rate: null,
        tooltip: `${fmtMoney(amount, fromCurrency)} → USD → ${baseCurrency} (tasa cruzada)`,
      };
    }
  }

  // Sin tasa disponible: devolver el monto sin convertir
  return {
    value: amount,
    rate: null,
    tooltip: `Sin tasa FX para ${fromCurrency} → ${baseCurrency}`,
  };
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

export function fmtDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" });
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

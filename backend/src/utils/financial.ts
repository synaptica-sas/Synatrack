/**
 * Lógica financiera centralizada.
 * Todos los cálculos de margen, rentabilidad y forecast viven aquí —
 * fuera del frontend y fuera de las rutas, para que sean testeables.
 */

import { convertAmountFallback, type FxRateRecord, buildRateMap } from "./currency.js";

export type { FxRateRecord };

// ─── Tipos de entrada ─────────────────────────────────────────────────────────

export type ForecastInput = {
  hoursProjected: number;
  hourlyRate: number | null;   // costo consultor
  sellRate: number | null;     // tarifa de venta al cliente
  currency: string;
};

export type ConsultantInput = {
  hourlyRate: number | null;
  rateCurrency: string;
};

export type TimeEntryInput = {
  hours: number;
  workDate: Date;
  status: "PENDING" | "APPROVED" | "REJECTED";
};

export type ExpenseInput = {
  amount: number;
  currency: string;
};

export type RevenueEntryInput = {
  amount: number;
  currency: string;
};

// ─── Utilidad de período ──────────────────────────────────────────────────────

/**
 * Convierte un período YYYY-Qn al rango de fechas [start, end].
 * Ej: "2026-Q2" → { start: 2026-04-01, end: 2026-06-30 }
 */
export function periodToDateRange(period: string): { start: Date; end: Date } | null {
  const match = period.match(/^(\d{4})-Q([1-4])$/);
  if (!match) return null;

  const year = Number(match[1]);
  const quarter = Number(match[2]);
  const startMonth = (quarter - 1) * 3;

  return {
    start: new Date(Date.UTC(year, startMonth, 1)),
    end: new Date(Date.UTC(year, startMonth + 3, 0, 23, 59, 59, 999)),
  };
}

/**
 * Verifica si una fecha cae dentro del rango de un período.
 */
export function isInPeriod(date: Date, period: string): boolean {
  const range = periodToDateRange(period);
  if (!range) return false;
  return date >= range.start && date <= range.end;
}

// ─── Cálculo de forecast ajustado ────────────────────────────────────────────

/**
 * Calcula el costo proyectado de un forecast descontando las horas ya aprobadas.
 *
 * ANTES (bug): projectedCost = hoursProjected * hourlyRate  (ignora lo ya ejecutado)
 * AHORA:       projectedCost = (hoursProjected - approvedHours) * hourlyRate
 *
 * Si ya se ejecutaron más horas de las proyectadas, el costo adicional es 0.
 */
export function getAdjustedForecastCost(
  forecast: ForecastInput,
  consultant: ConsultantInput,
  approvedHoursInPeriod: number,
  rateMap: Map<string, number>,
  baseCurrency: string,
): number {
  const effectiveCostRate = forecast.hourlyRate ?? consultant.hourlyRate ?? 0;
  const remainingHours = Math.max(forecast.hoursProjected - approvedHoursInPeriod, 0);
  const costInForecastCurrency = remainingHours * effectiveCostRate;
  return convertAmountFallback(costInForecastCurrency, forecast.currency, baseCurrency, rateMap);
}

/**
 * Calcula el ingreso proyectado de un forecast (usando sellRate).
 * Solo aplica para TIME_AND_MATERIAL y STAFFING.
 */
export function getAdjustedForecastRevenue(
  forecast: ForecastInput,
  approvedHoursInPeriod: number,
  rateMap: Map<string, number>,
  baseCurrency: string,
): number {
  if (!forecast.sellRate) return 0;
  const remainingHours = Math.max(forecast.hoursProjected - approvedHoursInPeriod, 0);
  const revenueInForecastCurrency = remainingHours * forecast.sellRate;
  return convertAmountFallback(revenueInForecastCurrency, forecast.currency, baseCurrency, rateMap);
}

// ─── Umbrales por defecto (un solo sitio, con nombre) ────────────────────────

/**
 * Umbral de margen bruto (%) que se aplica cuando el proyecto NO tiene
 * `marginThreshold` configurado.
 *
 * DECISIÓN EXPLÍCITA (R10): `marginThreshold = null` significa "no configurado",
 * NO "sin control de margen". Antes `/stats/overview`, `/stats/portfolio` y el
 * motor de alertas usaban `15` literal, mientras el detalle del proyecto
 * ignoraba el margen por completo cuando el campo era nulo. Unificar hacia
 * "ignorar" habría apagado en silencio el control de margen para casi todo el
 * portafolio (el campo está vacío en la mayoría de proyectos), así que se
 * conserva el 15 que ya era el comportamiento de facto en 3 de los 4 sitios,
 * pero declarado aquí una sola vez y sobreescribible por proyecto.
 */
export const DEFAULT_MARGIN_THRESHOLD_PCT = 15;

/**
 * % de consumo de presupuesto a partir del cual se alerta cuando el proyecto no
 * define `budgetAlertPct`. Coincide con el `@default(90)` del schema Prisma.
 */
export const DEFAULT_BUDGET_ALERT_PCT = 90;

/** Resuelve el umbral de margen efectivo de un proyecto. */
export function resolveMarginThreshold(value: number | null | undefined): number {
  return value === null || value === undefined || !Number.isFinite(value)
    ? DEFAULT_MARGIN_THRESHOLD_PCT
    : value;
}

/** Resuelve el umbral de alerta de presupuesto efectivo de un proyecto. */
export function resolveBudgetAlertPct(value: number | null | undefined): number {
  return value === null || value === undefined || !Number.isFinite(value)
    ? DEFAULT_BUDGET_ALERT_PCT
    : value;
}

// ─── Cálculo financiero unificado por proyecto ───────────────────────────────

/** Redondeo a 2 decimales, el mismo criterio en todos los porcentajes. */
function round2(value: number): number {
  return Number(value.toFixed(2));
}

export type ApprovedTimeEntryInput = {
  consultantId: string;
  hours: number;
  workDate: Date;
  hourlyRate: number | null;
  rateCurrency: string;
};

export type ProjectForecastInput = ForecastInput & {
  consultantId: string;
  consultant: ConsultantInput;
  startDate: string; // "YYYY-MM-DD"
  endDate: string;   // "YYYY-MM-DD"
};

export type ProjectFinancialsInput = {
  budget: number;
  budgetCurrency: string;
  sellPrice: number | null;
  sellCurrency: string;
  /** `project.marginThreshold` tal cual viene de BD (puede ser null). */
  marginThreshold: number | null;
  /** `project.budgetAlertPct` tal cual viene de BD (puede ser null). */
  budgetAlertPct: number | null;
  revenueEntries: RevenueEntryInput[];
  /** SOLO entradas ya aprobadas. El filtrado por estado es del llamador. */
  approvedTimeEntries: ApprovedTimeEntryInput[];
  expenses: ExpenseInput[];
  forecasts: ProjectForecastInput[];
  rateMap: Map<string, number>;
  baseCurrency: string;
};

export type ProjectFinancialsResult = {
  // Presupuesto
  budget: number;
  budgetConsumed: number;      // = totalCostActual
  budgetConsumedPct: number;   // gasto real / presupuesto
  projectedPct: number;        // (gasto real + forecast) / presupuesto
  estimateAtCompletion: number;
  budgetVariance: number;

  // Ingresos
  contractValue: number;
  revenueRecognized: number;
  revenuePending: number;
  revenueProjected: number;

  // Costos
  laborCostActual: number;
  laborCostForecast: number;
  expensesActual: number;
  totalCostActual: number;
  totalCostProjected: number;

  // Horas
  approvedHours: number;

  // Márgenes (null = sin ingresos reconocidos, NO medible)
  grossMarginActual: number;
  grossMarginActualPct: number | null;
  grossMarginProjected: number;
  grossMarginProjectedPct: number | null;

  // Umbrales resueltos y veredictos
  marginThreshold: number;
  budgetAlertPct: number;
  belowMarginThreshold: boolean;
  alertLevel: "ok" | "warning" | "exceeded";
};

/**
 * ÚNICA fuente de verdad del cálculo financiero de un proyecto.
 *
 * Función pura: no toca Prisma, ni el entorno, ni el reloj. Todo entra por
 * parámetros (incluido el `rateMap` ya construido y el `baseCurrency`).
 *
 * La consumen `/api/stats/overview`, `/api/stats/portfolio`,
 * `/api/projects/:id/detail`, `/api/projects/:id/profitability` y
 * `alerts.service.ts`, para que el mismo proyecto no dé dos semáforos distintos.
 */
export function computeProjectFinancials(input: ProjectFinancialsInput): ProjectFinancialsResult {
  const {
    budget,
    budgetCurrency,
    sellPrice,
    sellCurrency,
    revenueEntries,
    approvedTimeEntries,
    expenses,
    forecasts,
    rateMap,
    baseCurrency,
  } = input;

  const marginThreshold = resolveMarginThreshold(input.marginThreshold);
  const budgetAlertPct = resolveBudgetAlertPct(input.budgetAlertPct);

  // Presupuesto y valor contractual en moneda base
  const budgetBase = convertAmountFallback(budget, budgetCurrency, baseCurrency, rateMap);
  const contractValue = sellPrice
    ? convertAmountFallback(sellPrice, sellCurrency, baseCurrency, rateMap)
    : 0;

  // Ingresos reconocidos
  const revenueRecognized = revenueEntries.reduce(
    (sum, r) => sum + convertAmountFallback(r.amount, r.currency, baseCurrency, rateMap),
    0,
  );
  const revenuePending = Math.max(contractValue - revenueRecognized, 0);

  // Costo laboral real: horas aprobadas * tarifa del consultor
  const laborCostActual = approvedTimeEntries.reduce((sum, entry) => {
    const rate = entry.hourlyRate ?? 0;
    return sum + convertAmountFallback(entry.hours * rate, entry.rateCurrency, baseCurrency, rateMap);
  }, 0);

  const approvedHours = approvedTimeEntries.reduce((sum, entry) => sum + entry.hours, 0);

  // Gastos reales
  const expensesActual = expenses.reduce(
    (sum, e) => sum + convertAmountFallback(e.amount, e.currency, baseCurrency, rateMap),
    0,
  );

  const totalCostActual = laborCostActual + expensesActual;

  // Forecast ajustado: descuenta las horas ya aprobadas del mismo consultor
  // dentro del rango del forecast (UTC), para no contar dos veces lo ejecutado.
  let laborCostForecast = 0;
  let revenueProjected = revenueRecognized;

  for (const forecast of forecasts) {
    const rangeStart = new Date(`${forecast.startDate}T00:00:00Z`);
    const rangeEnd = new Date(`${forecast.endDate}T23:59:59.999Z`);

    const approvedInPeriod = approvedTimeEntries
      .filter(
        (e) =>
          e.consultantId === forecast.consultantId &&
          e.workDate >= rangeStart &&
          e.workDate <= rangeEnd,
      )
      .reduce((sum, e) => sum + e.hours, 0);

    laborCostForecast += getAdjustedForecastCost(
      forecast,
      forecast.consultant,
      approvedInPeriod,
      rateMap,
      baseCurrency,
    );

    revenueProjected += getAdjustedForecastRevenue(
      forecast,
      approvedInPeriod,
      rateMap,
      baseCurrency,
    );
  }

  const totalCostProjected = totalCostActual + laborCostForecast;
  const budgetConsumedPct = budgetBase > 0 ? round2((totalCostActual / budgetBase) * 100) : 0;
  const projectedPct = budgetBase > 0 ? round2((totalCostProjected / budgetBase) * 100) : 0;

  // Márgenes. Sin ingresos reconocidos el porcentaje es NULL (no medible),
  // nunca 0: un 0 se compararía contra el umbral y pintaría de rojo proyectos
  // que simplemente todavía no han facturado.
  const grossMarginActual = revenueRecognized - totalCostActual;
  const grossMarginActualPct =
    revenueRecognized > 0 ? round2((grossMarginActual / revenueRecognized) * 100) : null;

  const grossMarginProjected = revenueProjected - totalCostProjected;
  const grossMarginProjectedPct =
    revenueProjected > 0 ? round2((grossMarginProjected / revenueProjected) * 100) : null;

  // Alerta de desvío presupuestal, sobre el TOTAL PROYECTADO (real + forecast).
  const alertLevel: "ok" | "warning" | "exceeded" =
    projectedPct > 100 ? "exceeded" : projectedPct >= budgetAlertPct ? "warning" : "ok";

  return {
    budget: budgetBase,
    budgetConsumed: totalCostActual,
    budgetConsumedPct,
    projectedPct,
    estimateAtCompletion: totalCostProjected,
    budgetVariance: budgetBase - totalCostProjected,
    contractValue,
    revenueRecognized,
    revenuePending,
    revenueProjected,
    laborCostActual,
    laborCostForecast,
    expensesActual,
    totalCostActual,
    totalCostProjected,
    approvedHours,
    grossMarginActual,
    grossMarginActualPct,
    grossMarginProjected,
    grossMarginProjectedPct,
    marginThreshold,
    budgetAlertPct,
    belowMarginThreshold: grossMarginActualPct !== null && grossMarginActualPct < marginThreshold,
    alertLevel,
  };
}

// ─── Adaptador de filas Prisma → insumo del cálculo ─────────────────────────

/**
 * Fila cruda de `FinancialEntry` tal como la devuelve Prisma (los `Decimal`
 * llegan como objeto, por eso `amount` es `unknown`).
 */
export type FinancialEntryRow = {
  type: "EXPENSE" | "REVENUE";
  amount: unknown;
  currency: string;
};

/**
 * ÚNICO sitio donde se parte `FinancialEntry` por su discriminador `type`.
 *
 * El modelo de datos fusionó `Expense` y `RevenueEntry` en una sola tabla, pero
 * el cálculo financiero sigue necesitando las dos listas por separado (un gasto
 * resta y un ingreso suma). En vez de repetir el `filter((e) => e.type === ...)`
 * en cada ruta, la partición vive aquí, junto al cálculo que la consume.
 */
export function splitFinancialEntries(entries: FinancialEntryRow[]): {
  expenses: ExpenseInput[];
  revenueEntries: RevenueEntryInput[];
} {
  const expenses: ExpenseInput[] = [];
  const revenueEntries: RevenueEntryInput[] = [];
  for (const entry of entries) {
    const row = { amount: Number(entry.amount), currency: entry.currency };
    if (entry.type === "EXPENSE") expenses.push(row);
    else revenueEntries.push(row);
  }
  return { expenses, revenueEntries };
}

/**
 * Adapta las filas de Prisma al insumo del cálculo unificado de `financial.ts`.
 * Vive aquí (capa de ruta) para que la utilidad siga siendo pura.
 */
type ProjectRowForFinancials = {
  budget: unknown;
  currency: string;
  sellPrice: unknown;
  sellCurrency: string;
  marginThreshold: unknown;
  budgetAlertPct: unknown;
  financialEntries: FinancialEntryRow[];
  forecasts: Array<{
    consultantId: string;
    hoursProjected: unknown;
    hourlyRate: unknown;
    sellRate: unknown;
    currency: string;
    startDate: string;
    endDate: string;
    consultant: { hourlyRate: unknown; rateCurrency: string };
  }>;
};

export function toFinancialsInput(
  project: ProjectRowForFinancials,
  approvedEntries: Array<{
    consultantId: string;
    hours: unknown;
    workDate: Date;
    consultant: { hourlyRate: unknown; rateCurrency: string };
  }>,
  rateMap: Map<string, number>,
  baseCurrency: string,
): ProjectFinancialsInput {
  const split = splitFinancialEntries(project.financialEntries);
  return {
    budget: Number(project.budget),
    budgetCurrency: project.currency,
    sellPrice: project.sellPrice != null ? Number(project.sellPrice) : null,
    sellCurrency: project.sellCurrency,
    marginThreshold: project.marginThreshold != null ? Number(project.marginThreshold) : null,
    budgetAlertPct: project.budgetAlertPct != null ? Number(project.budgetAlertPct) : null,
    revenueEntries: split.revenueEntries,
    approvedTimeEntries: approvedEntries.map((e) => ({
      consultantId: e.consultantId,
      hours: Number(e.hours),
      workDate: e.workDate,
      hourlyRate: e.consultant.hourlyRate != null ? Number(e.consultant.hourlyRate) : null,
      rateCurrency: e.consultant.rateCurrency,
    })),
    expenses: split.expenses,
    forecasts: project.forecasts.map((f) => ({
      consultantId: f.consultantId,
      hoursProjected: Number(f.hoursProjected),
      hourlyRate: f.hourlyRate != null ? Number(f.hourlyRate) : null,
      sellRate: f.sellRate != null ? Number(f.sellRate) : null,
      currency: f.currency,
      startDate: f.startDate,
      endDate: f.endDate,
      consultant: {
        hourlyRate: f.consultant.hourlyRate != null ? Number(f.consultant.hourlyRate) : null,
        rateCurrency: f.consultant.rateCurrency,
      },
    })),
    rateMap,
    baseCurrency,
  };
}

// ─── Cálculo de rentabilidad por proyecto ────────────────────────────────────

export type ProfitabilityResult = {
  // Ingresos
  contractValue: number;      // sellPrice del proyecto (en baseCurrency)
  revenueRecognized: number;  // sum(RevenueEntry) en baseCurrency
  revenuePending: number;     // contractValue - revenueRecognized
  revenueProjected: number;   // ingresos proyectados de forecasts no ejecutados

  // Costos
  laborCostActual: number;    // horas aprobadas * hourlyRate en baseCurrency
  laborCostForecast: number;  // forecast pendiente (ajustado) en baseCurrency
  expensesActual: number;     // gastos reales en baseCurrency
  totalCostActual: number;    // laborCostActual + expensesActual
  totalCostProjected: number; // totalCostActual + laborCostForecast

  // Presupuesto
  budget: number;
  budgetConsumed: number;
  budgetConsumedPct: number;
  estimateAtCompletion: number; // EAC
  budgetVariance: number;       // budget - EAC (positivo = bien, negativo = sobrecosto)

  // Márgenes (null = sin ingresos reconocidos, no medible)
  grossMarginActual: number;
  grossMarginActualPct: number | null;
  grossMarginProjected: number;
  grossMarginProjectedPct: number | null;

  // Umbral de margen resuelto y veredictos (R10)
  marginThreshold: number;
  belowMarginThreshold: boolean;
  alertLevel: "ok" | "warning" | "exceeded";
};

export type ProfitabilityInput = {
  budget: number;
  budgetCurrency: string;
  sellPrice: number | null;
  sellCurrency: string;
  /** `project.marginThreshold` de BD; si se omite se usa DEFAULT_MARGIN_THRESHOLD_PCT. */
  marginThreshold?: number | null;
  /** `project.budgetAlertPct` de BD; si se omite se usa DEFAULT_BUDGET_ALERT_PCT. */
  budgetAlertPct?: number | null;
  revenueEntries: RevenueEntryInput[];
  approvedTimeEntries: Array<TimeEntryInput & { consultantId: string; hourlyRate: number | null; rateCurrency: string }>;
  expenses: ExpenseInput[];
  forecasts: Array<ForecastInput & { consultantId: string; consultant: ConsultantInput; startDate: string; endDate: string }>;
  fxConfigs: FxRateRecord[];
  baseCurrency: string;
};

export function calculateProfitability(input: ProfitabilityInput): ProfitabilityResult {
  // Delega en el núcleo unificado: aquí solo se adapta la forma del resultado
  // para no romper el contrato del endpoint /api/projects/:id/profitability.
  const f = computeProjectFinancials({
    budget: input.budget,
    budgetCurrency: input.budgetCurrency,
    sellPrice: input.sellPrice,
    sellCurrency: input.sellCurrency,
    marginThreshold: input.marginThreshold ?? null,
    budgetAlertPct: input.budgetAlertPct ?? null,
    revenueEntries: input.revenueEntries,
    approvedTimeEntries: input.approvedTimeEntries,
    expenses: input.expenses,
    forecasts: input.forecasts,
    rateMap: buildRateMap(input.fxConfigs),
    baseCurrency: input.baseCurrency,
  });

  return {
    contractValue: f.contractValue,
    revenueRecognized: f.revenueRecognized,
    revenuePending: f.revenuePending,
    revenueProjected: f.revenueProjected,
    laborCostActual: f.laborCostActual,
    laborCostForecast: f.laborCostForecast,
    expensesActual: f.expensesActual,
    totalCostActual: f.totalCostActual,
    totalCostProjected: f.totalCostProjected,
    budget: f.budget,
    budgetConsumed: f.budgetConsumed,
    budgetConsumedPct: f.budgetConsumedPct,
    estimateAtCompletion: f.estimateAtCompletion,
    budgetVariance: f.budgetVariance,
    grossMarginActual: f.grossMarginActual,
    grossMarginActualPct: f.grossMarginActualPct,
    grossMarginProjected: f.grossMarginProjected,
    grossMarginProjectedPct: f.grossMarginProjectedPct,
    marginThreshold: f.marginThreshold,
    belowMarginThreshold: f.belowMarginThreshold,
    alertLevel: f.alertLevel,
  };
}

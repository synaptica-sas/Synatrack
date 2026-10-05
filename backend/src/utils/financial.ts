/**
 * Lógica financiera centralizada.
 * Todos los cálculos de margen, rentabilidad y forecast viven aquí —
 * fuera del frontend y fuera de las rutas, para que sean testeables.
 */

import {
  convertAmountFallbackOnDate,
  conversionStatus,
  createConversionLedger,
  mergeConversionLedger,
  buildRateBook,
  type ConversionLedger,
  type ConversionStatus,
  type FxRateRecord,
  type FxHistoryRecord,
  type RateBook,
} from "./currency.js";
import {
  clasificarUsoPresupuesto,
  type NivelIndicador,
  type UmbralesSalud,
} from "./healthThresholds.js";

export type { FxRateRecord, FxHistoryRecord, RateBook, ConversionLedger, ConversionStatus };

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
  /**
   * Fecha del gasto (`FinancialEntry.entryDate`). Es la fecha a la que se
   * valora: el hecho económico ocurrió ese día y a la tasa de ese día (R-008).
   */
  entryDate: Date;
};

export type RevenueEntryInput = {
  amount: number;
  currency: string;
  /**
   * Fecha del ingreso (`FinancialEntry.entryDate`), entendida como fecha de
   * reconocimiento/factura. Ver la nota de R-034 sobre factura vs. pago en
   * `computeProjectFinancials`.
   */
  entryDate: Date;
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
  /** Fecha a la que se valora el forecast: el inicio de su periodo. */
  valuationDate: Date,
  rateBook: RateBook,
  baseCurrency: string,
  ledger?: ConversionLedger,
): number {
  const effectiveCostRate = forecast.hourlyRate ?? consultant.hourlyRate ?? 0;
  const remainingHours = Math.max(forecast.hoursProjected - approvedHoursInPeriod, 0);
  const costInForecastCurrency = remainingHours * effectiveCostRate;
  return convertAmountFallbackOnDate(
    costInForecastCurrency,
    forecast.currency,
    baseCurrency,
    valuationDate,
    rateBook,
    ledger,
  );
}

/**
 * Calcula el ingreso proyectado de un forecast (usando sellRate).
 * Solo aplica para TIME_AND_MATERIAL y STAFFING.
 */
export function getAdjustedForecastRevenue(
  forecast: ForecastInput,
  approvedHoursInPeriod: number,
  /** Fecha a la que se valora el forecast: el inicio de su periodo. */
  valuationDate: Date,
  rateBook: RateBook,
  baseCurrency: string,
  ledger?: ConversionLedger,
): number {
  if (!forecast.sellRate) return 0;
  const remainingHours = Math.max(forecast.hoursProjected - approvedHoursInPeriod, 0);
  const revenueInForecastCurrency = remainingHours * forecast.sellRate;
  return convertAmountFallbackOnDate(
    revenueInForecastCurrency,
    forecast.currency,
    baseCurrency,
    valuationDate,
    rateBook,
    ledger,
  );
}

// ─── Umbrales por defecto (un solo sitio, con nombre) ────────────────────────

/**
 * Umbrales de margen bruto (%) que se aplican cuando el proyecto NO tiene los
 * suyos propios. Son DOS niveles, por decisión de negocio D-2:
 *
 *  · advertencia (30 %) — el margen va bajando y conviene vigilarlo.
 *  · crítico (15 %)     — el suelo que no se debe cruzar.
 *
 * DECISIÓN EXPLÍCITA (R10, vigente): un umbral nulo significa "no configurado",
 * NO "sin control de margen". El campo está vacío en la mayoría de proyectos;
 * interpretarlo como "sin control" apagaría el semáforo de casi todo el
 * portafolio. Por eso siempre se resuelve a un número.
 *
 * ANTES de D-2 solo existía `DEFAULT_MARGIN_THRESHOLD_PCT = 15` y el segundo
 * nivel se improvisaba multiplicando por 0,5 dentro de `health.ts`. Ese 7,5 no
 * lo eligió nadie: era un artefacto del código.
 */
export const DEFAULT_MARGIN_WARNING_PCT = 30;
export const DEFAULT_MARGIN_CRITICAL_PCT = 15;

/**
 * % de consumo de presupuesto a partir del cual se alerta cuando NO hay ni
 * umbral del proyecto ni fila general en `HealthThresholdConfig`.
 *
 * Desde D-7 es el **tercer** escalón, no el primero: la precedencia es
 * `Project.budgetAlertPct` → `HealthThresholdConfig.budgetWarningPct` → esta
 * constante. Si este valor se usa es porque la base está sin sembrar; se
 * conserva con nombre para que ese caso sea visible y no un 90 escondido.
 *
 * Coincide a propósito con `UMBRALES_SALUD_POR_DEFECTO.budgetWarningPct`.
 */
export const DEFAULT_BUDGET_ALERT_PCT = 90;

/** Nivel de margen de un proyecto frente a sus dos umbrales. */
export type MarginLevel = "ok" | "warning" | "critical";

/** Par de umbrales ya resueltos a número y garantizados coherentes. */
export type ResolvedMarginThresholds = {
  warningPct: number;
  criticalPct: number;
};

/**
 * Resuelve los dos umbrales efectivos de un proyecto (D-2).
 *
 * Cada uno cae a su valor por defecto de empresa si viene nulo o no finito; el
 * cero es un valor válido y NO cae al default. Al final se fuerza el invariante
 * `criticalPct <= warningPct`: si un proyecto declara un suelo por encima de su
 * advertencia (o por encima del 30 % por defecto), la advertencia se sube hasta
 * el suelo, con lo que la banda de aviso queda vacía y todo lo que baje del
 * suelo es crítico. Es lo que su configuración ya estaba diciendo, y evita que
 * un dato incoherente produzca un semáforo imposible.
 */
export function resolveMarginThresholds(
  warningPct: number | null | undefined,
  criticalPct: number | null | undefined,
): ResolvedMarginThresholds {
  const warning =
    warningPct === null || warningPct === undefined || !Number.isFinite(warningPct)
      ? DEFAULT_MARGIN_WARNING_PCT
      : warningPct;
  const critical =
    criticalPct === null || criticalPct === undefined || !Number.isFinite(criticalPct)
      ? DEFAULT_MARGIN_CRITICAL_PCT
      : criticalPct;

  return { warningPct: Math.max(warning, critical), criticalPct: critical };
}

/**
 * Clasifica un margen bruto contra los dos umbrales ya resueltos.
 *
 * Los bordes son EXACTOS y no se solapan: el umbral pertenece a la banda buena.
 * Un margen de 30,00 con advertencia 30 está "ok"; 29,99 está en advertencia.
 * Un margen de 15,00 con crítico 15 está en advertencia; 14,99 es crítico.
 *
 * `null` = margen no medible (sin ingresos reconocidos): no se inventa un
 * veredicto, devuelve "ok" para que el semáforo no pinte rojo por falta de datos.
 */
export function classifyMargin(
  grossMarginActualPct: number | null,
  thresholds: ResolvedMarginThresholds,
): MarginLevel {
  if (grossMarginActualPct === null) return "ok";
  if (grossMarginActualPct < thresholds.criticalPct) return "critical";
  if (grossMarginActualPct < thresholds.warningPct) return "warning";
  return "ok";
}

/**
 * ¿Es coherente el par de umbrales que llega de un formulario? Se evalúa sobre
 * los valores YA resueltos, porque dejar uno vacío significa "usa el de la
 * empresa" y ese también participa de la comparación: poner crítico 40 y dejar
 * la advertencia vacía es incoherente aunque el campo esté en blanco.
 */
export function marginThresholdsAreCoherent(
  warningPct: number | null | undefined,
  criticalPct: number | null | undefined,
): boolean {
  const warning =
    warningPct === null || warningPct === undefined || !Number.isFinite(warningPct)
      ? DEFAULT_MARGIN_WARNING_PCT
      : warningPct;
  const critical =
    criticalPct === null || criticalPct === undefined || !Number.isFinite(criticalPct)
      ? DEFAULT_MARGIN_CRITICAL_PCT
      : criticalPct;
  return critical <= warning;
}

/**
 * Resuelve el umbral de **aviso** de presupuesto efectivo de un proyecto, con
 * la precedencia de D-7:
 *
 * 1. `Project.budgetAlertPct`, si el proyecto lo tiene puesto.
 * 2. El `budgetWarningPct` general de `HealthThresholdConfig`.
 * 3. `DEFAULT_BUDGET_ALERT_PCT`, solo si no se pasan umbrales generales.
 *
 * Es la misma forma de convivir que ya tienen los umbrales de margen (D-2): lo
 * del proyecto manda sobre lo de la empresa. El nivel **crítico** no entra aquí
 * porque no se configura por proyecto.
 */
export function resolveBudgetAlertPct(
  value: number | null | undefined,
  generales?: Pick<UmbralesSalud, "budgetWarningPct">,
): number {
  if (value !== null && value !== undefined && Number.isFinite(value)) return value;
  return generales?.budgetWarningPct ?? DEFAULT_BUDGET_ALERT_PCT;
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
  /** `project.marginWarningPct` tal cual viene de BD (puede ser null). */
  marginWarningPct: number | null;
  /** `project.marginCriticalPct` tal cual viene de BD (puede ser null). */
  marginCriticalPct: number | null;
  /**
   * `project.budgetAlertPct` tal cual viene de BD. `null` = el proyecto no
   * define umbral propio y hereda el general de `HealthThresholdConfig` (D-7).
   */
  budgetAlertPct: number | null;
  /**
   * Umbrales generales ya resueltos por `resolverUmbralesSalud` (D-7).
   * **Obligatorio a propósito**: el corte de "presupuesto excedido" estaba
   * escrito como un `> 100` dentro de esta función. Exigirlo en la firma es lo
   * que impide que un llamador nuevo vuelva a calcular sin la configuración.
   */
  healthThresholds: UmbralesSalud;
  revenueEntries: RevenueEntryInput[];
  /** SOLO entradas ya aprobadas. El filtrado por estado es del llamador. */
  approvedTimeEntries: ApprovedTimeEntryInput[];
  expenses: ExpenseInput[];
  forecasts: ProjectForecastInput[];
  /**
   * Libro de tasas con dimensión temporal (R-008/R-012). Sustituye al
   * `rateMap` único de las tasas de hoy: cada importe se convierte con la tasa
   * vigente en SU fecha. El llamador lo construye una sola vez por petición con
   * `buildRateBook(fxConfigs, fxHistory)`.
   */
  rateBook: RateBook;
  /**
   * Fecha a la que se valoran las magnitudes **contractuales** del proyecto
   * —presupuesto (`budget`) y precio de venta (`sellPrice`)—, que no son
   * movimientos y por tanto no tienen fecha propia. Es la fecha de contratación
   * del proyecto; en la práctica `Project.startDate` (ver R-033 en
   * `computeProjectFinancials`).
   */
  valuationDate: Date;
  baseCurrency: string;
  /**
   * Libro de faltantes compartido (DEP-32). Opcional: el cálculo siempre lleva
   * el suyo propio y devuelve su estado en `conversion`; si se pasa uno, además
   * vuelca ahí sus faltantes, que es lo que permite a `/stats/overview` y
   * `/stats/portfolio` acumular los de todos los proyectos en un solo indicador.
   */
  ledger?: ConversionLedger;
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
  marginWarningPct: number;
  marginCriticalPct: number;
  /** Veredicto de margen de D-2: "ok" | "warning" | "critical". */
  marginLevel: MarginLevel;
  /** Umbral de aviso de presupuesto efectivo: el del proyecto, o el general. */
  budgetAlertPct: number;
  /** Umbral general a partir del cual se considera excedido (no es por proyecto). */
  budgetCriticalPct: number;
  /**
   * Nivel del gasto **real** contra el presupuesto (`budgetConsumedPct`). Es lo
   * que pinta la barra de "Uso presupuesto" del Portafolio, que antes se
   * coloreaba con un 90/100 escrito en el `.tsx`.
   */
  budgetUseLevel: Exclude<NivelIndicador, "no-medible">;
  /**
   * Nivel del gasto **proyectado** (real + forecast) contra el presupuesto.
   * Es el que alimenta el semáforo de salud. Mismo criterio y misma función que
   * `budgetUseLevel`, pero sobre otra métrica: por eso se devuelven los dos.
   */
  alertLevel: "ok" | "warning" | "exceeded";

  /**
   * Estado de la conversión a `baseCurrency` (DEP-32). `incomplete: true`
   * significa que al menos un importe se sumó SIN convertir por falta de tasa,
   * así que TODOS los montos de este resultado son aproximados.
   */
  conversion: ConversionStatus;
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
    rateBook,
    valuationDate,
    baseCurrency,
  } = input;

  const marginThresholds = resolveMarginThresholds(input.marginWarningPct, input.marginCriticalPct);
  const budgetAlertPct = resolveBudgetAlertPct(input.budgetAlertPct, input.healthThresholds);

  // Libro PROPIO (DEP-32): si se usara directamente el del llamador, el
  // `conversion` de este proyecto arrastraría los faltantes de los anteriores.
  // Al final se vuelca en el del llamador, si lo hay.
  const ledger = createConversionLedger();

  // ── QUÉ FECHA VALORA QUÉ (R-008 / R-012 / R-026 / R-033 / R-034) ─────────
  //
  // Hasta aquí todo se convertía con la tasa de HOY. El criterio que se aplica
  // ahora, movimiento a movimiento, es el contable de "valorar al tipo de
  // cambio de la fecha de la transacción":
  //
  //  · Presupuesto y precio de venta → `valuationDate` (fecha de contratación,
  //    hoy `Project.startDate`). NO son movimientos: son el valor pactado en un
  //    contrato que se firmó una vez. Reexpresarlos cada día con la tasa del
  //    momento es justo lo que R-033 pide que deje de pasar. Con esto, un
  //    presupuesto de 400 M COP firmado en marzo vale siempre lo que valía en
  //    marzo, y el semáforo del proyecto deja de moverse solo.
  //  · Gastos e ingresos → su propio `entryDate` (R-008, R-026).
  //  · Costo de las horas → el `workDate` de cada registro: la hora se consumió
  //    ese día y a la tarifa y la tasa de ese día. Se valora registro a
  //    registro y no por periodo, porque el dato lo permite y promediar un mes
  //    volvería a inventar una fecha que nadie eligió.
  //  · Forecast → el inicio de su periodo. Para periodos futuros no existe tasa
  //    posterior a hoy, así que la búsqueda cae en la última conocida, que es
  //    lo mejor disponible para proyectar.
  //
  // Cuando no hay tasa histórica anterior a la fecha de un movimiento se usa la
  // actual (mismo respaldo que `GET /api/fx/rate`) y queda anotado en el libro
  // como `undated`: el importe está convertido, pero se revalúa cada día.

  // Presupuesto y valor contractual en moneda base, a la fecha de contratación
  const budgetBase = convertAmountFallbackOnDate(
    budget, budgetCurrency, baseCurrency, valuationDate, rateBook, ledger,
  );
  const contractValue = sellPrice
    ? convertAmountFallbackOnDate(sellPrice, sellCurrency, baseCurrency, valuationDate, rateBook, ledger)
    : 0;

  // Ingresos reconocidos, cada uno a la tasa de su fecha de reconocimiento
  const revenueRecognized = revenueEntries.reduce(
    (sum, r) =>
      sum + convertAmountFallbackOnDate(r.amount, r.currency, baseCurrency, r.entryDate, rateBook, ledger),
    0,
  );
  const revenuePending = Math.max(contractValue - revenueRecognized, 0);

  // Costo laboral real: horas aprobadas * tarifa del consultor
  const laborCostActual = approvedTimeEntries.reduce((sum, entry) => {
    const rate = entry.hourlyRate ?? 0;
    return (
      sum +
      convertAmountFallbackOnDate(
        entry.hours * rate, entry.rateCurrency, baseCurrency, entry.workDate, rateBook, ledger,
      )
    );
  }, 0);

  const approvedHours = approvedTimeEntries.reduce((sum, entry) => sum + entry.hours, 0);

  // Gastos reales
  const expensesActual = expenses.reduce(
    (sum, e) =>
      sum + convertAmountFallbackOnDate(e.amount, e.currency, baseCurrency, e.entryDate, rateBook, ledger),
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
      rangeStart,
      rateBook,
      baseCurrency,
      ledger,
    );

    revenueProjected += getAdjustedForecastRevenue(
      forecast,
      approvedInPeriod,
      rangeStart,
      rateBook,
      baseCurrency,
      ledger,
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
  // ANTES el corte de "excedido" era un `> 100` escrito aquí (D-7); ahora sale
  // de la configuración general y se aplica con la misma función que clasifica
  // el gasto real, para que las dos barras no puedan usar criterios distintos.
  const umbralesPresupuesto = {
    budgetWarningPct: budgetAlertPct,
    budgetCriticalPct: input.healthThresholds.budgetCriticalPct,
  };
  const nivelProyectado = clasificarUsoPresupuesto(projectedPct, umbralesPresupuesto);
  const alertLevel: "ok" | "warning" | "exceeded" =
    nivelProyectado === "critical" ? "exceeded" : nivelProyectado;
  const budgetUseLevel = clasificarUsoPresupuesto(budgetConsumedPct, umbralesPresupuesto);

  // Se propagan los faltantes al libro del llamador (totales agregados).
  if (input.ledger) mergeConversionLedger(input.ledger, ledger);

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
    marginWarningPct: marginThresholds.warningPct,
    marginCriticalPct: marginThresholds.criticalPct,
    marginLevel: classifyMargin(grossMarginActualPct, marginThresholds),
    budgetAlertPct,
    budgetCriticalPct: input.healthThresholds.budgetCriticalPct,
    budgetUseLevel,
    alertLevel,
    conversion: conversionStatus(ledger),
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
  /** Fecha del movimiento: es la que decide con qué tasa se valora (R-008). */
  entryDate: Date;
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
    const row = { amount: Number(entry.amount), currency: entry.currency, entryDate: entry.entryDate };
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
  /**
   * Fecha de contratación con la que se valoran presupuesto y precio de venta.
   * Hoy es `Project.startDate` (ver la nota de R-033 en `toFinancialsInput`).
   */
  startDate: Date | null;
  sellPrice: unknown;
  sellCurrency: string;
  marginWarningPct: unknown;
  marginCriticalPct: unknown;
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
  rateBook: RateBook,
  baseCurrency: string,
  /**
   * Umbrales generales de D-7. Obligatorio: es el parámetro que obliga a cada
   * ruta a traer la configuración de la base en vez de heredar un literal.
   */
  healthThresholds: UmbralesSalud,
  /**
   * "Ahora" de la petición. Solo se usa como fecha de valoración de respaldo
   * para un proyecto **sin `startDate`**, que es el único caso en el que no hay
   * ninguna fecha de contrato de la que tirar. Entra por parámetro porque estas
   * utilidades no leen el reloj.
   */
  now: Date,
): ProjectFinancialsInput {
  const split = splitFinancialEntries(project.financialEntries);
  return {
    budget: Number(project.budget),
    budgetCurrency: project.currency,
    // R-033: el presupuesto contratado se valora a la fecha del contrato, no a
    // la de hoy. `Project` no tiene un campo `contractDate` propio, así que se
    // usa `startDate`, que es la fecha de contrato más cercana que existe en el
    // modelo. Queda anotado como decisión de negocio pendiente en PENDIENTES.md
    // (§6.2, R-034): si el negocio quiere separar firma de inicio, hace falta
    // un campo nuevo. Sin `startDate` no hay nada mejor que el presente.
    valuationDate: project.startDate ?? now,
    sellPrice: project.sellPrice != null ? Number(project.sellPrice) : null,
    sellCurrency: project.sellCurrency,
    marginWarningPct: project.marginWarningPct != null ? Number(project.marginWarningPct) : null,
    marginCriticalPct: project.marginCriticalPct != null ? Number(project.marginCriticalPct) : null,
    budgetAlertPct: project.budgetAlertPct != null ? Number(project.budgetAlertPct) : null,
    healthThresholds,
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
    rateBook,
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

  // Umbrales de margen resueltos y veredicto (D-2)
  marginWarningPct: number;
  marginCriticalPct: number;
  marginLevel: MarginLevel;
  alertLevel: "ok" | "warning" | "exceeded";

  /** Estado de la conversión a `baseCurrency` (DEP-32). */
  conversion: ConversionStatus;
};

export type ProfitabilityInput = {
  budget: number;
  budgetCurrency: string;
  sellPrice: number | null;
  sellCurrency: string;
  /** `project.marginWarningPct` de BD; si se omite se usa DEFAULT_MARGIN_WARNING_PCT. */
  marginWarningPct?: number | null;
  /** `project.marginCriticalPct` de BD; si se omite se usa DEFAULT_MARGIN_CRITICAL_PCT. */
  marginCriticalPct?: number | null;
  /** `project.budgetAlertPct` de BD; si se omite se hereda el umbral general. */
  budgetAlertPct?: number | null;
  /** Umbrales generales de D-7, obligatorios igual que en el cálculo unificado. */
  healthThresholds: UmbralesSalud;
  revenueEntries: RevenueEntryInput[];
  approvedTimeEntries: Array<TimeEntryInput & { consultantId: string; hourlyRate: number | null; rateCurrency: string }>;
  expenses: ExpenseInput[];
  forecasts: Array<ForecastInput & { consultantId: string; consultant: ConsultantInput; startDate: string; endDate: string }>;
  fxConfigs: FxRateRecord[];
  /** Histórico de `FxRateHistory` para valorar cada importe a su fecha (R-008). */
  fxHistory?: FxHistoryRecord[];
  /** Fecha de contratación con la que se valoran presupuesto y precio de venta. */
  valuationDate: Date;
  baseCurrency: string;
  /** Libro de faltantes compartido (DEP-32). Ver `ProjectFinancialsInput`. */
  ledger?: ConversionLedger;
};

export function calculateProfitability(input: ProfitabilityInput): ProfitabilityResult {
  // Delega en el núcleo unificado: aquí solo se adapta la forma del resultado
  // para no romper el contrato del endpoint /api/projects/:id/profitability.
  const f = computeProjectFinancials({
    budget: input.budget,
    budgetCurrency: input.budgetCurrency,
    sellPrice: input.sellPrice,
    sellCurrency: input.sellCurrency,
    marginWarningPct: input.marginWarningPct ?? null,
    marginCriticalPct: input.marginCriticalPct ?? null,
    budgetAlertPct: input.budgetAlertPct ?? null,
    healthThresholds: input.healthThresholds,
    revenueEntries: input.revenueEntries,
    approvedTimeEntries: input.approvedTimeEntries,
    expenses: input.expenses,
    forecasts: input.forecasts,
    rateBook: buildRateBook(input.fxConfigs, input.fxHistory ?? []),
    valuationDate: input.valuationDate,
    baseCurrency: input.baseCurrency,
    ledger: input.ledger,
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
    marginWarningPct: f.marginWarningPct,
    marginCriticalPct: f.marginCriticalPct,
    marginLevel: f.marginLevel,
    alertLevel: f.alertLevel,
    conversion: f.conversion,
  };
}

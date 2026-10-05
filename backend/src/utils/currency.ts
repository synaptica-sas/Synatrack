/**
 * Utilidad de conversión de monedas.
 * Usa los FxConfig almacenados en BD para convertir entre pares de monedas.
 * Las tasas se almacenan como: 1 baseCode = rate quoteCode (ej: 1 USD = 4000 COP).
 */

export type FxRateRecord = {
  baseCode: string;
  quoteCode: string;
  rate: { toString(): string } | number;
};

/**
 * Construye un mapa de conversión bidireccional a partir de los registros FxConfig.
 * Clave: "FROM->TO", Valor: multiplicador para convertir.
 */
export function buildRateMap(configs: FxRateRecord[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const config of configs) {
    const rate = Number(config.rate);
    if (!Number.isFinite(rate) || rate <= 0) continue;

    // Directo: 1 baseCode = rate quoteCode
    map.set(`${config.baseCode}->${config.quoteCode}`, rate);
    // Inverso: 1 quoteCode = 1/rate baseCode
    map.set(`${config.quoteCode}->${config.baseCode}`, 1 / rate);
  }
  return map;
}

/**
 * Devuelve las claves del mapa que hay que multiplicar, EN ORDEN, para pasar de
 * `from` a `to`. `[]` si son la misma moneda; `null` si no hay camino.
 *
 * Se extrajo de `convertAmount` (sin cambiar su recorrido ni su orden de
 * búsqueda) porque la conversión fechada necesita saber **qué tasas usó** para
 * poder decir si alguna salió del respaldo. La aritmética se aplica después, en
 * el mismo orden de izquierda a derecha que tenía la expresión original
 * (`amount * rate * pivotToTarget`), para que los números salgan bit a bit
 * idénticos a los de antes.
 */
export function findConversionPath(
  from: string,
  to: string,
  rateMap: Map<string, number>,
): string[] | null {
  if (from === to) return [];

  const directKey = `${from}->${to}`;
  if (rateMap.has(directKey)) return [directKey];

  // Conversión con pivote (ej: COP -> EUR via USD). Mismo recorrido de siempre:
  // el primer pivote que cierre el camino, en orden de inserción del mapa.
  for (const key of rateMap.keys()) {
    const parts = key.split("->");
    if (parts[0] !== from) continue;
    const pivotKey = `${parts[1]}->${to}`;
    if (rateMap.has(pivotKey)) return [key, pivotKey];
  }

  return null;
}

/** Aplica el camino al monto, multiplicando en orden. */
function applyConversionPath(amount: number, path: string[], rateMap: Map<string, number>): number {
  let result = amount;
  for (const key of path) result = result * (rateMap.get(key) as number);
  return result;
}

/**
 * Convierte un monto de una moneda a otra.
 * Primero intenta conversión directa; si no existe, busca conversión via pivote (ej. USD).
 * Retorna null si no hay tasa disponible para el par solicitado.
 */
export function convertAmount(
  amount: number,
  from: string,
  to: string,
  rateMap: Map<string, number>,
): number | null {
  const path = findConversionPath(from, to, rateMap);
  if (path === null) return null;
  return applyConversionPath(amount, path, rateMap);
}

// ─── Registro de conversiones incompletas (DEP-32) ───────────────────────────

/**
 * Acumulador de pares de moneda que no se pudieron convertir durante el cálculo
 * de un total.
 *
 * POR QUÉ EXISTE (DEP-32): `convertAmountFallback` devuelve el monto **sin
 * convertir** cuando no hay tasa, así que un importe en COP se sumaba a un total
 * en USD como si fuera USD y el resultado salía rotulado con la moneda base. El
 * número era incorrecto y nadie se enteraba: ni excepción, ni aviso, ni marca en
 * la respuesta.
 *
 * La solución no es reventar (un endpoint caído por una tasa faltante es peor que
 * un número aproximado) sino que **el fallo viaje con el dato**: la conversión
 * anota aquí cada par sin tasa y quien arma la respuesta publica esa lista junto
 * al total, para que el lector sepa que ese número está incompleto.
 *
 * El libro es un objeto mutable a propósito: es lo que permite que una reducción
 * de cientos de importes acumule los faltantes sin cambiar la firma de cada suma.
 * Las funciones de `utils/` siguen siendo puras respecto del entorno (no leen
 * reloj, ni entorno, ni BD) y no escriben en ningún log: el log es cosa del
 * llamador, que es quien tiene contexto (proyecto, petición, usuario).
 */
export type ConversionLedger = {
  readonly missing: Set<string>;
  /**
   * Pares que SÍ se convirtieron, pero con la tasa **actual** porque no había
   * ninguna tasa histórica con `effectiveDate <= fecha del movimiento` (R-008 /
   * R-012). El número está convertido, no es basura como en `missing`, pero se
   * valoró con la tasa de hoy en vez de con la de su fecha: es la aproximación
   * silenciosa que estos dos ítems vinieron a eliminar, así que viaja aparte y
   * no se mezcla con los faltantes duros.
   */
  readonly undated: Set<string>;
};

/** Crea un libro de faltantes vacío. */
export function createConversionLedger(): ConversionLedger {
  return { missing: new Set<string>(), undated: new Set<string>() };
}

/** Anota un par sin tasa en el libro. Clave: "FROM->TO". */
export function recordMissingRate(ledger: ConversionLedger, from: string, to: string): void {
  ledger.missing.add(`${from}->${to}`);
}

/**
 * Anota un par que se convirtió con la tasa actual por falta de histórico para
 * su fecha. Clave: "FROM->TO".
 */
export function recordUndatedRate(ledger: ConversionLedger, from: string, to: string): void {
  ledger.undated.add(`${from}->${to}`);
}

/** Vuelca los faltantes de `source` dentro de `target` (ambos canales). */
export function mergeConversionLedger(target: ConversionLedger, source: ConversionLedger): void {
  for (const pair of source.missing) target.missing.add(pair);
  for (const pair of source.undated) target.undated.add(pair);
}

/** Los pares valorados con la tasa de hoy por falta de histórico, ordenados. */
export function undatedRatePairs(ledger: ConversionLedger): string[] {
  return Array.from(ledger.undated).sort();
}

/** `true` si algún importe se valoró con la tasa de hoy en vez de la de su fecha. */
export function hasUndatedRates(ledger: ConversionLedger): boolean {
  return ledger.undated.size > 0;
}

/** Los pares sin tasa, ordenados, para poder compararlos y serializarlos. */
export function missingRatePairs(ledger: ConversionLedger): string[] {
  return Array.from(ledger.missing).sort();
}

/** `true` si algún importe quedó sin convertir. */
export function hasMissingRates(ledger: ConversionLedger): boolean {
  return ledger.missing.size > 0;
}

/**
 * Forma con la que las respuestas de la API publican el estado de la conversión.
 * `incomplete: false` con `missingPairs: []` es el caso normal.
 */
export type ConversionStatus = {
  /** `true` si al menos un importe se sumó SIN convertir. El total es aproximado. */
  incomplete: boolean;
  /** Pares "FROM->TO" para los que no había tasa. */
  missingPairs: string[];
  /**
   * `true` si al menos un importe se convirtió con la tasa **de hoy** por no
   * haber tasa histórica para su fecha (R-008/R-012). Más leve que
   * `incomplete`: el importe sí está convertido.
   */
  approximateDates: boolean;
  /** Pares "FROM->TO" valorados con la tasa de hoy por falta de histórico. */
  undatedPairs: string[];
};

/** Traduce el libro a la forma que se expone en la API. */
export function conversionStatus(ledger: ConversionLedger): ConversionStatus {
  return {
    incomplete: hasMissingRates(ledger),
    missingPairs: missingRatePairs(ledger),
    approximateDates: hasUndatedRates(ledger),
    undatedPairs: undatedRatePairs(ledger),
  };
}

/** Mensaje en español para el log del servidor sobre la aproximación de fecha. */
export function describeUndatedRates(undatedPairs: string[]): string {
  return (
    "[FX] Valoración aproximada: no hay tasa histórica anterior a la fecha de los " +
    `movimientos para ${undatedPairs.join(", ")}. Esos importes se convirtieron con la ` +
    "tasa actual, así que se revalúan cada día."
  );
}

/** Mensaje en español para el log del servidor. Puro: no escribe, solo formatea. */
export function describeMissingRates(missingPairs: string[]): string {
  return (
    "[FX] Conversión incompleta: faltan tasas para " +
    `${missingPairs.join(", ")}. Los importes de esos pares se sumaron SIN convertir, ` +
    "así que el total es aproximado."
  );
}

/**
 * Convierte con fallback al monto original si no hay tasa disponible.
 * Útil para cálculos de totales donde preferimos un número a null.
 *
 * ⚠ El fallback devuelve el monto **sin convertir**: el número resultante está en
 * la moneda de origen aunque se rotule con la base. Por eso, siempre que el total
 * vaya a salir por la API, hay que pasar un `ledger` y publicar su estado
 * (`conversionStatus`). Sin `ledger` el comportamiento es el de antes, y eso solo
 * es aceptable donde el resultado no se presenta como un total convertido.
 *
 * No se anota el par cuando el monto es exactamente 0: un 0 aporta 0 al total,
 * convertido o no, así que marcar el total como incompleto por su causa sería una
 * falsa alarma y le restaría valor al indicador.
 */
export function convertAmountFallback(
  amount: number,
  from: string,
  to: string,
  rateMap: Map<string, number>,
  ledger?: ConversionLedger,
): number {
  const converted = convertAmount(amount, from, to, rateMap);
  if (converted !== null) return converted;
  if (ledger && amount !== 0) recordMissingRate(ledger, from, to);
  return amount;
}

// ─── Tasas por fecha: el libro fechado (R-008 / R-012 / R-026 / R-033 / R-034) ──

/**
 * UNA fila de `FxRateHistory`: la misma forma que `FxRateRecord` más la fecha
 * desde la que esa tasa estuvo vigente.
 */
export type FxHistoryRecord = FxRateRecord & { effectiveDate: Date };

/**
 * Mapa de tasas resuelto PARA UNA FECHA concreta, con la trazabilidad de de
 * dónde salió cada una.
 */
export type DatedRateMap = {
  /** Mismo formato que `buildRateMap`: clave "FROM->TO", valor multiplicador. */
  readonly rates: Map<string, number>;
  /**
   * Claves cuya tasa salió del **histórico** para esa fecha. Las que no están
   * aquí vienen de `FxConfig` (la tasa de hoy) y son, por tanto, una
   * aproximación que hay que anotar en el libro.
   */
  readonly dated: Set<string>;
};

/**
 * Libro de tasas con dimensión temporal.
 *
 * POR QUÉ EXISTE (R-008 + R-012): hasta ahora todo el cálculo financiero
 * convertía con `buildRateMap(fxConfig)`, es decir con la tasa **de hoy**, sin
 * importar cuándo ocurrió el movimiento. Un gasto en pesos de marzo se valoraba
 * con la tasa de octubre y el presupuesto de un contrato firmado hace un año se
 * reexpresaba cada mañana: los números cambiaban solos sin que nadie tocara
 * nada. El libro guarda, por par de monedas, la serie de tasas históricas
 * ordenada por fecha, más las tasas actuales como respaldo.
 *
 * RENDIMIENTO: el llamador carga `FxConfig` y `FxRateHistory` **una vez por
 * petición** y construye el libro; después, cada fecha distinta que aparezca
 * resuelve su propio mapa en memoria y queda cacheada por día UTC. Un
 * `/stats/overview` con miles de movimientos construye tantos mapas como días
 * distintos haya, no tantos como movimientos, y cero consultas adicionales.
 *
 * El libro es mutable solo en su caché, que es memoización pura: el resultado
 * de `rateMapForDate` no depende de nada más que de sus entradas. La utilidad
 * sigue sin leer reloj, entorno ni BD.
 */
export type RateBook = {
  /** Tasas actuales (`FxConfig`). El último respaldo, igual que hoy. */
  readonly current: Map<string, number>;
  /** Por clave "FROM->TO": tramos ordenados por fecha ascendente. */
  readonly history: Map<string, Array<{ at: number; rate: number }>>;
  /** Memoización de `rateMapForDate`, por día UTC "YYYY-MM-DD". */
  readonly cache: Map<string, DatedRateMap>;
};

/** Clave de caché: el día UTC del movimiento. Las tasas son diarias. */
function utcDayKey(date: Date): string {
  const t = date.getTime();
  if (!Number.isFinite(t)) return "invalid";
  return date.toISOString().slice(0, 10);
}

/** Inserta un tramo en la serie de un par, manteniéndola ordenada por fecha. */
function pushRate(
  history: Map<string, Array<{ at: number; rate: number }>>,
  key: string,
  at: number,
  rate: number,
): void {
  const serie = history.get(key);
  if (serie) serie.push({ at, rate });
  else history.set(key, [{ at, rate }]);
}

/**
 * Construye el libro a partir de las tasas actuales y del histórico.
 *
 * Las reglas de descarte son las mismas de `buildRateMap` (tasas no finitas o
 * no positivas fuera) y cada fila alimenta el par directo y el inverso, para
 * que `COP->USD` siga existiendo aunque solo se haya cargado `USD->COP`.
 */
export function buildRateBook(configs: FxRateRecord[], history: FxHistoryRecord[]): RateBook {
  const serie = new Map<string, Array<{ at: number; rate: number }>>();

  for (const row of history) {
    const rate = Number(row.rate);
    if (!Number.isFinite(rate) || rate <= 0) continue;
    const at = row.effectiveDate.getTime();
    if (!Number.isFinite(at)) continue;
    pushRate(serie, `${row.baseCode}->${row.quoteCode}`, at, rate);
    pushRate(serie, `${row.quoteCode}->${row.baseCode}`, at, 1 / rate);
  }

  for (const tramos of serie.values()) tramos.sort((a, b) => a.at - b.at);

  return { current: buildRateMap(configs), history: serie, cache: new Map() };
}

/**
 * La tasa vigente para `key` en `at`: el tramo más reciente con
 * `effectiveDate <= at`. Búsqueda binaria sobre la serie ya ordenada.
 *
 * Es exactamente el criterio que ya aplicaba `GET /api/fx/rate?date=`
 * (`fx.routes.ts`, "Tasa histórica más reciente <= fecha solicitada"); aquí se
 * reutiliza en memoria en vez de consultar la base una vez por movimiento.
 */
function rateAt(
  tramos: Array<{ at: number; rate: number }>,
  at: number,
): number | undefined {
  let lo = 0;
  let hi = tramos.length - 1;
  let found: number | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (tramos[mid].at <= at) {
      found = tramos[mid].rate;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * Resuelve el mapa de conversión vigente en `date`.
 *
 * Orden de resolución, idéntico al de `GET /api/fx/rate`:
 *   1. la tasa histórica más reciente con `effectiveDate <= date`;
 *   2. si no hay ninguna para ese par, la tasa actual de `FxConfig`.
 *
 * El caso 2 queda fuera de `dated`, que es lo que permite a la conversión
 * anotarlo en el libro en vez de dejarlo pasar en silencio.
 */
export function rateMapForDate(book: RateBook, date: Date): DatedRateMap {
  const key = utcDayKey(date);
  const cached = book.cache.get(key);
  if (cached) return cached;

  const rates = new Map(book.current);
  const dated = new Set<string>();
  const at = date.getTime();

  for (const [pair, tramos] of book.history) {
    const rate = Number.isFinite(at) ? rateAt(tramos, at) : undefined;
    if (rate === undefined) continue;
    rates.set(pair, rate);
    dated.add(pair);
  }

  const resolved: DatedRateMap = { rates, dated };
  book.cache.set(key, resolved);
  return resolved;
}

/**
 * Convierte usando la tasa vigente en `date`. `null` si no hay tasa por ningún
 * camino, igual que `convertAmount`.
 */
export function convertAmountOnDate(
  amount: number,
  from: string,
  to: string,
  date: Date,
  book: RateBook,
): number | null {
  return convertAmount(amount, from, to, rateMapForDate(book, date).rates);
}

/**
 * Conversión fechada con respaldo, la que usan todos los totales.
 *
 * Tres desenlaces, y los tres quedan registrados:
 *  · hay tasa histórica para esa fecha → convierte y no anota nada;
 *  · no hay histórica pero sí actual   → convierte con la de hoy y lo anota en
 *    `undated` (el total es correcto en magnitud pero se revalúa cada día);
 *  · no hay ninguna                    → devuelve el monto SIN convertir y lo
 *    anota en `missing`, el comportamiento de DEP-32 que ya existía.
 *
 * Igual que en DEP-32, un monto exactamente 0 no ensucia el libro: aporta 0 al
 * total lo conviertas o no, y marcarlo sería una falsa alarma.
 */
export function convertAmountFallbackOnDate(
  amount: number,
  from: string,
  to: string,
  date: Date,
  book: RateBook,
  ledger?: ConversionLedger,
): number {
  if (from === to) return amount;

  const { rates, dated } = rateMapForDate(book, date);
  const path = findConversionPath(from, to, rates);

  if (path === null) {
    if (ledger && amount !== 0) recordMissingRate(ledger, from, to);
    return amount;
  }

  // Basta con que UNA pata del camino venga de la tasa actual para que el
  // resultado dependa de la tasa de hoy: la conversión vía pivote no es mejor
  // que su eslabón más débil.
  if (ledger && amount !== 0 && path.some((k) => !dated.has(k))) {
    recordUndatedRate(ledger, from, to);
  }

  return applyConversionPath(amount, path, rates);
}

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
  if (from === to) return amount;

  // Conversión directa
  const directRate = rateMap.get(`${from}->${to}`);
  if (directRate !== undefined) {
    return amount * directRate;
  }

  // Conversión con pivote (ej: COP -> EUR via USD)
  for (const [key, rate] of rateMap.entries()) {
    const parts = key.split("->");
    if (parts[0] !== from) continue;
    const pivot = parts[1];
    const pivotToTarget = rateMap.get(`${pivot}->${to}`);
    if (pivotToTarget !== undefined) {
      return amount * rate * pivotToTarget;
    }
  }

  return null;
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
};

/** Crea un libro de faltantes vacío. */
export function createConversionLedger(): ConversionLedger {
  return { missing: new Set<string>() };
}

/** Anota un par sin tasa en el libro. Clave: "FROM->TO". */
export function recordMissingRate(ledger: ConversionLedger, from: string, to: string): void {
  ledger.missing.add(`${from}->${to}`);
}

/** Vuelca los faltantes de `source` dentro de `target`. */
export function mergeConversionLedger(target: ConversionLedger, source: ConversionLedger): void {
  for (const pair of source.missing) target.missing.add(pair);
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
};

/** Traduce el libro a la forma que se expone en la API. */
export function conversionStatus(ledger: ConversionLedger): ConversionStatus {
  return { incomplete: hasMissingRates(ledger), missingPairs: missingRatePairs(ledger) };
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

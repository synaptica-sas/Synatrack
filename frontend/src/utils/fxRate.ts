/**
 * fxRate.ts
 * Búsqueda de la tasa de cambio entre dos monedas sobre los `FxConfig` que el
 * frontend ya tiene cargados: directa, inversa o triangulada vía una moneda
 * pivote.
 *
 * DUPLICACIÓN DELIBERADA (DEP-18). El backend resuelve la misma regla en
 * `backend/src/utils/currency.ts` y la expone en `GET /api/fx/rate`, pero el
 * conversor del cajón lateral recalcula en cada pulsación del usuario (moneda
 * origen, moneda destino y monto), así que llamar a la API por pulsación sería
 * una petición por tecla. Se mantiene el cálculo en el cliente, extraído aquí
 * para poder probarlo.
 *
 * DEP-39 (R11): hasta ahora la triangulación solo arrancaba desde monedas que
 * aparecían como `baseCode`, así que con `USD→COP` y `USD→MXN` cargadas el
 * backend resolvía `COP→MXN` y el frontend decía "sin tasa". Se replica el
 * algoritmo del backend: primero se construye un mapa **bidireccional**
 * (`buildRateMap`) y después se busca el pivote sobre ese mapa, con lo que da
 * igual de qué lado del par esté cada moneda.
 *
 * Si la regla de triangulación cambia en el backend, hay que cambiarla también
 * aquí y en `fxRate.test.ts`.
 */

/** Lo mínimo que se necesita de un `FxConfig`: 1 baseCode = rate quoteCode. */
export type FxRateSource = {
  baseCode: string;
  quoteCode: string;
  rate: string | number;
};

/**
 * Mapa de conversión bidireccional, con la misma clave `"FROM->TO"` que
 * `buildRateMap` del backend. Las tasas no finitas o no positivas se descartan
 * igual que allá.
 */
function construirMapaTasas(fxConfigs: FxRateSource[]): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const config of fxConfigs) {
    const rate = Number(config.rate);
    if (!Number.isFinite(rate) || rate <= 0) continue;
    mapa.set(`${config.baseCode}->${config.quoteCode}`, rate);
    mapa.set(`${config.quoteCode}->${config.baseCode}`, 1 / rate);
  }
  return mapa;
}

/**
 * Devuelve el multiplicador para convertir de `from` a `to`, o `null` si no hay
 * forma de calcularlo con las tasas disponibles.
 */
export function findFxRate(fxConfigs: FxRateSource[], from: string, to: string): number | null {
  if (from === to) return 1;

  const mapa = construirMapaTasas(fxConfigs);

  const directa = mapa.get(`${from}->${to}`);
  if (directa !== undefined) return directa;

  // Pivote: cualquier moneda alcanzable desde `from` que a su vez alcance `to`.
  for (const [clave, tasa] of mapa.entries()) {
    const [origen, pivote] = clave.split("->");
    if (origen !== from) continue;
    const pivoteADestino = mapa.get(`${pivote}->${to}`);
    if (pivoteADestino !== undefined) return tasa * pivoteADestino;
  }

  return null;
}

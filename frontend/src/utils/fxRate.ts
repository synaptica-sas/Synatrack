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
 * desde `App.tsx` para poder probarlo.
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
 * Devuelve el multiplicador para convertir de `from` a `to`, o `null` si no hay
 * forma de calcularlo con las tasas disponibles.
 */
export function findFxRate(fxConfigs: FxRateSource[], from: string, to: string): number | null {
  if (from === to) return 1;

  const direct = fxConfigs.find((c) => c.baseCode === from && c.quoteCode === to);
  if (direct) return Number(direct.rate);

  const inverse = fxConfigs.find((c) => c.baseCode === to && c.quoteCode === from);
  if (inverse) return 1 / Number(inverse.rate);

  for (const c of fxConfigs) {
    if (c.baseCode !== from) continue;
    const pivotToTarget = fxConfigs.find((p) => p.baseCode === c.quoteCode && p.quoteCode === to);
    if (pivotToTarget) return Number(c.rate) * Number(pivotToTarget.rate);
    const pivotInverse = fxConfigs.find((p) => p.baseCode === to && p.quoteCode === c.quoteCode);
    if (pivotInverse) return Number(c.rate) / Number(pivotInverse.rate);
  }

  return null;
}

/**
 * Compuerta diaria de la sincronización de tasas FX dentro del ciclo de
 * mantenimiento (`modules/jobs/jobs.service.ts`).
 *
 * El ciclo corre cada hora (o cada `JOBS_INTERVAL_MINUTES`), pero las tasas solo
 * hace falta traerlas una vez al día. La decisión se toma con el historial
 * persistente de `JobRun` (trabajo `fx-sync`), que registran tanto el ciclo como
 * `POST /api/fx/sync` (cron de Render o botón "Actualizar ahora"). Así, si ya
 * hubo una sincronización buena hoy por cualquier vía, el ciclo no repite.
 *
 * Reglas:
 *  1. Si el último ÉXITO empezó el mismo día calendario UTC que `ahora`: no corre.
 *  2. Si no, y el último INTENTO (fallido) fue hace menos de `REINTENTO_FX_MS`:
 *     no corre, para no golpear al proveedor cada hora mientras esté caído.
 *  3. En cualquier otro caso: corre.
 *
 * Cálculo puro, sin base de datos: las fechas entran por parámetro.
 */

/** Espera mínima entre un intento fallido y el siguiente reintento. */
export const REINTENTO_FX_MS = 3 * 60 * 60 * 1000;

export interface EntradaCompuertaFx {
  /** Inicio de la última ejecución con `ok = true`, o `null` si nunca hubo. */
  ultimoExito: Date | null;
  /** Inicio de la última ejecución (buena o mala), o `null` si nunca hubo. */
  ultimoIntento: Date | null;
  ahora: Date;
}

export type DecisionCompuertaFx =
  | { ejecutar: true; motivo: string }
  | { ejecutar: false; motivo: string };

function mismoDiaUtc(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

export function decidirSincronizacionFx({
  ultimoExito,
  ultimoIntento,
  ahora,
}: EntradaCompuertaFx): DecisionCompuertaFx {
  if (ultimoExito && mismoDiaUtc(ultimoExito, ahora)) {
    return { ejecutar: false, motivo: "Ya hubo una sincronización correcta hoy (UTC)" };
  }

  // Solo cuenta como "intento reciente" si es posterior al último éxito, es
  // decir, si de verdad fue un fallo.
  const ultimoFallo =
    ultimoIntento && (!ultimoExito || ultimoIntento.getTime() > ultimoExito.getTime())
      ? ultimoIntento
      : null;

  if (ultimoFallo) {
    const transcurrido = ahora.getTime() - ultimoFallo.getTime();
    if (transcurrido >= 0 && transcurrido < REINTENTO_FX_MS) {
      return { ejecutar: false, motivo: "El último intento falló hace menos de 3 h; se reintenta más tarde" };
    }
  }

  return {
    ejecutar: true,
    motivo: ultimoExito ? "Sin sincronización correcta hoy (UTC)" : "Nunca se ha sincronizado",
  };
}

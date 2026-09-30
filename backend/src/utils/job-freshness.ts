/**
 * Frescura de los trabajos periódicos.
 *
 * Cálculo PURO: no lee el reloj (el "ahora" entra por parámetro) ni toca la
 * base. Quien consulta la base es `modules/jobs/job-runs.service.ts`; aquí solo
 * se decide, a partir de esas dos fechas, en cuál de los cuatro estados está
 * cada trabajo.
 *
 * Por qué existe: el cron de tasas de cambio apuntó durante meses a un host
 * inexistente y nadie se enteró, porque nada dentro de la aplicación sabía
 * cuándo había corrido por última vez.
 */

/** Los cuatro estados posibles, de peor a mejor. */
export type EstadoTrabajo =
  /** No hay ninguna ejecución registrada. El cron probablemente nunca se creó. */
  | "nunca"
  /** La última ejecución terminó con error. */
  | "fallido"
  /** La última ejecución exitosa es más vieja que la tolerancia del trabajo. */
  | "obsoleto"
  /** Corrió bien y dentro de plazo. */
  | "ok";

/** Estado agregado del conjunto. `ok` solo si TODOS los trabajos están `ok`. */
export type EstadoGlobalTrabajos = "ok" | "degradado";

/** Un trabajo que se espera que corra, con su plazo máximo aceptable. */
export interface TrabajoVigilado {
  nombre: string;
  /**
   * Cada cuánto debería correr, en milisegundos. Es documental: lo que decide
   * es `toleranciaMs`.
   */
  intervaloEsperadoMs: number;
  /**
   * Cuánto se tolera sin un éxito antes de marcarlo obsoleto. Siempre mayor
   * que `intervaloEsperadoMs`, para dejar margen a un cron que se retrasa o a
   * una ejecución que se salta.
   */
  toleranciaMs: number;
}

/** Una ejecución tal como quedó registrada en `JobRun`. */
export interface EjecucionRegistrada {
  jobName: string;
  origin: string;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  ok: boolean;
  error: string | null;
}

/** Lo que se sabe de un trabajo: su último intento y su último éxito. */
export interface HistorialTrabajo {
  /** Última ejecución, haya salido bien o mal. `null` si nunca corrió. */
  ultimoIntento: EjecucionRegistrada | null;
  /** Última ejecución exitosa. `null` si nunca terminó bien. */
  ultimoExito: EjecucionRegistrada | null;
}

export interface FrescuraTrabajo {
  nombre: string;
  estado: EstadoTrabajo;
  /** Inicio del último intento, en ISO. `null` si nunca corrió. */
  ultimoIntentoEn: string | null;
  /** Inicio del último éxito, en ISO. `null` si nunca terminó bien. */
  ultimoExitoEn: string | null;
  /** Antigüedad del último éxito en segundos. `null` si nunca hubo uno. */
  antiguedadExitoSegundos: number | null;
  /** Tolerancia configurada, en segundos. Para poder leer el número sin el código. */
  toleranciaSegundos: number;
  /** Duración del último intento, en milisegundos. `null` si nunca corrió. */
  ultimaDuracionMs: number | null;
  /** Mensaje del error del último intento, si falló. */
  ultimoError: string | null;
}

export interface FrescuraTrabajos {
  estado: EstadoGlobalTrabajos;
  trabajos: FrescuraTrabajo[];
}

/**
 * Evalúa el estado de un solo trabajo.
 *
 * Orden de precedencia, deliberado:
 *  1. Sin ningún registro -> `nunca`. Es distinto de "falló": significa que el
 *     cron probablemente no existe.
 *  2. Último intento fallido -> `fallido`, aunque además esté obsoleto. Se
 *     prefiere porque es lo accionable: hay un error concreto que leer.
 *  3. Sin éxito dentro de la tolerancia -> `obsoleto`. Cubre también el caso de
 *     un trabajo que solo ha fallado pero cuyo último intento aún no falla
 *     (imposible hoy, pero la rama queda definida).
 *  4. En cualquier otro caso -> `ok`.
 */
export function evaluarTrabajo(
  vigilado: TrabajoVigilado,
  historial: HistorialTrabajo,
  ahora: Date,
): FrescuraTrabajo {
  const { ultimoIntento, ultimoExito } = historial;

  const antiguedadExitoMs =
    ultimoExito === null ? null : ahora.getTime() - ultimoExito.startedAt.getTime();

  let estado: EstadoTrabajo;
  if (ultimoIntento === null) {
    estado = "nunca";
  } else if (!ultimoIntento.ok) {
    estado = "fallido";
  } else if (antiguedadExitoMs === null || antiguedadExitoMs > vigilado.toleranciaMs) {
    estado = "obsoleto";
  } else {
    estado = "ok";
  }

  return {
    nombre: vigilado.nombre,
    estado,
    ultimoIntentoEn: ultimoIntento?.startedAt.toISOString() ?? null,
    ultimoExitoEn: ultimoExito?.startedAt.toISOString() ?? null,
    antiguedadExitoSegundos:
      antiguedadExitoMs === null ? null : Math.floor(antiguedadExitoMs / 1000),
    toleranciaSegundos: Math.floor(vigilado.toleranciaMs / 1000),
    ultimaDuracionMs: ultimoIntento?.durationMs ?? null,
    ultimoError: ultimoIntento && !ultimoIntento.ok ? ultimoIntento.error : null,
  };
}

/**
 * Evalúa todos los trabajos vigilados.
 *
 * El catálogo (`vigilados`) manda: un trabajo esperado del que no hay ninguna
 * fila sale como `nunca`, que es justo el caso que se nos escapó con el cron de
 * FX. Las ejecuciones de trabajos que ya no están en el catálogo se ignoran.
 */
export function evaluarFrescura(
  vigilados: TrabajoVigilado[],
  historiales: Map<string, HistorialTrabajo>,
  ahora: Date,
): FrescuraTrabajos {
  const trabajos = vigilados.map((vigilado) =>
    evaluarTrabajo(
      vigilado,
      historiales.get(vigilado.nombre) ?? { ultimoIntento: null, ultimoExito: null },
      ahora,
    ),
  );

  return {
    estado: trabajos.every((t) => t.estado === "ok") ? "ok" : "degradado",
    trabajos,
  };
}

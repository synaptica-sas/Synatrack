import { Prisma, type PrismaClient } from "@prisma/client";
import { getLogger } from "../../infra/logger.js";
import {
  type EjecucionRegistrada,
  type FrescuraTrabajos,
  type HistorialTrabajo,
  type TrabajoVigilado,
  evaluarFrescura,
} from "../../utils/job-freshness.js";

/**
 * Registro persistente de las ejecuciones de los trabajos periódicos.
 *
 * El problema que resuelve: `jobs.service.ts` guardaba el resultado del ciclo en
 * una variable de módulo, y el Web Service corre en el plan free de Render, que
 * se duerme a los 15 minutos de inactividad. Tras cada siesta esa evidencia
 * desaparecía, así que la aplicación no podía responder "¿cuándo corrió esto por
 * última vez?" — exactamente la pregunta que nadie pudo hacerse cuando el cron
 * de tasas de cambio apuntó durante meses a un host inexistente.
 */

const MINUTO = 60_000;
const HORA = 60 * MINUTO;

/**
 * Catálogo de trabajos que SE ESPERA que corran, con su plazo máximo.
 *
 * Las cadencias salen de `render.yaml`:
 *  - `app-gestion-jobs` dispara `POST /api/jobs/run` cada hora en punto, y ese
 *    ciclo ejecuta `assignment-maintenance`, `alert-engine` y
 *    `approval-digest`.
 *  - `app-gestion-fx-sync` dispara `POST /api/fx/sync` una vez al día a las
 *    13:00 UTC.
 *
 * Las tolerancias son deliberadamente holgadas (3 ejecuciones perdidas): el
 * servicio está dormido cuando el cron lo despierta, así que el primer intento
 * puede tardar o fallar por el arranque en frío. Lo que se quiere detectar es
 * "esto lleva días sin correr", no "esta vez llegó tarde".
 *
 * Si se cambia una cadencia en `render.yaml`, hay que cambiarla también aquí.
 */
export const TRABAJOS_VIGILADOS: TrabajoVigilado[] = [
  {
    nombre: "assignment-maintenance",
    intervaloEsperadoMs: 1 * HORA,
    toleranciaMs: 3 * HORA,
  },
  {
    nombre: "alert-engine",
    intervaloEsperadoMs: 1 * HORA,
    toleranciaMs: 3 * HORA,
  },
  {
    nombre: "fx-sync",
    intervaloEsperadoMs: 24 * HORA,
    toleranciaMs: 72 * HORA,
  },
  {
    // El resumen semanal de aprobaciones (R-020 + R-022). Ojo con la cadencia:
    // lo que se vigila NO es cada cuánto sale el correo (semanal), sino cada
    // cuánto se EVALÚA si toca mandarlo, que es cada ciclo, o sea cada hora.
    // Vigilar la semana sería inútil: si el trabajo dejara de ejecutarse un
    // martes, nadie se enteraría hasta pasado el lunes siguiente, que es
    // exactamente el agujero que este sistema vino a cerrar.
    nombre: "approval-digest",
    intervaloEsperadoMs: 1 * HORA,
    toleranciaMs: 3 * HORA,
  },
];

/**
 * Cuántas ejecuciones se conservan POR TRABAJO. Es lo que acota la tabla: con
 * los cuatro trabajos de hoy el techo son 200 filas. La purga corre después de
 * cada inserción, así que no hace falta ningún proceso de limpieza aparte
 * (que, sin scheduler fiable, sería justamente el problema que se intenta
 * resolver).
 */
export const RETENCION_POR_TRABAJO = 50;

/**
 * Vida de la caché de frescura, en milisegundos.
 *
 * `/health` lo consulta Render cada pocos segundos. La caché es solo una caché:
 * la fuente de verdad sigue siendo la tabla, así que perderla en un reinicio no
 * cuesta nada. Con 15 s el peor caso son 4 consultas por minuto.
 */
const VIDA_CACHE_MS = 15_000;

export interface EjecucionARegistrar {
  jobName: string;
  origin: string;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  ok: boolean;
  error?: string | null;
}

/** Recorta el mensaje de error para que una excepción enorme no infle la fila. */
const LARGO_MAXIMO_ERROR = 1000;

/**
 * Deja constancia de una ejecución y purga lo que sobre de ese trabajo.
 *
 * NUNCA lanza. Observar no puede romper lo observado: si la base está caída
 * justo cuando termina el ciclo, se pierde el registro y se anota en el log,
 * pero el ciclo se da por terminado igual.
 *
 * @returns `true` si la fila quedó escrita.
 */
export async function registrarEjecucion(
  prisma: PrismaClient,
  ejecucion: EjecucionARegistrar,
): Promise<boolean> {
  try {
    await prisma.jobRun.create({
      data: {
        jobName: ejecucion.jobName,
        origin: ejecucion.origin,
        startedAt: ejecucion.startedAt,
        finishedAt: ejecucion.finishedAt,
        durationMs: Math.max(0, Math.round(ejecucion.durationMs)),
        ok: ejecucion.ok,
        error: ejecucion.error ? ejecucion.error.slice(0, LARGO_MAXIMO_ERROR) : null,
      },
    });

    invalidarCacheFrescura();
    await purgarHistorial(prisma, ejecucion.jobName);
    return true;
  } catch (err) {
    getLogger().error(
      { err, trabajo: ejecucion.jobName },
      "[Jobs] No se pudo registrar la ejecución en JobRun; el ciclo continúa",
    );
    return false;
  }
}

/**
 * Borra las ejecuciones de un trabajo que excedan `RETENCION_POR_TRABAJO`.
 * Tolerante a fallos por la misma razón que `registrarEjecucion`.
 */
export async function purgarHistorial(prisma: PrismaClient, jobName: string): Promise<void> {
  try {
    await prisma.$executeRaw`
      DELETE FROM "JobRun"
      WHERE "id" IN (
        SELECT "id" FROM "JobRun"
        WHERE "jobName" = ${jobName}
        ORDER BY "startedAt" DESC
        OFFSET ${RETENCION_POR_TRABAJO}
      )
    `;
  } catch (err) {
    getLogger().error({ err, trabajo: jobName }, "[Jobs] No se pudo purgar el historial de JobRun");
  }
}

type FilaHistorial = {
  clase: "intento" | "exito";
  jobName: string;
  origin: string;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  ok: boolean;
  error: string | null;
};

/**
 * Último intento y último éxito de cada trabajo, en UNA sola consulta.
 *
 * Los dos `DISTINCT ON` se resuelven por los índices
 * `("jobName","startedAt" DESC)` y `("jobName","ok","startedAt" DESC)`: devuelve
 * a lo sumo una fila por trabajo y clase, nunca recorre el historial completo.
 */
export async function obtenerHistoriales(
  prisma: PrismaClient,
): Promise<Map<string, HistorialTrabajo>> {
  const filas = await prisma.$queryRaw<FilaHistorial[]>(Prisma.sql`
    SELECT 'intento' AS "clase", i.*
      FROM (
        SELECT DISTINCT ON ("jobName")
               "jobName", "origin", "startedAt", "finishedAt", "durationMs", "ok", "error"
          FROM "JobRun"
         ORDER BY "jobName", "startedAt" DESC
      ) i
    UNION ALL
    SELECT 'exito' AS "clase", e.*
      FROM (
        SELECT DISTINCT ON ("jobName")
               "jobName", "origin", "startedAt", "finishedAt", "durationMs", "ok", "error"
          FROM "JobRun"
         WHERE "ok" = true
         ORDER BY "jobName", "startedAt" DESC
      ) e
  `);

  const historiales = new Map<string, HistorialTrabajo>();

  for (const fila of filas) {
    const actual = historiales.get(fila.jobName) ?? { ultimoIntento: null, ultimoExito: null };
    const ejecucion: EjecucionRegistrada = {
      jobName: fila.jobName,
      origin: fila.origin,
      startedAt: new Date(fila.startedAt),
      finishedAt: new Date(fila.finishedAt),
      durationMs: Number(fila.durationMs),
      ok: fila.ok,
      error: fila.error,
    };

    if (fila.clase === "intento") actual.ultimoIntento = ejecucion;
    else actual.ultimoExito = ejecucion;

    historiales.set(fila.jobName, actual);
  }

  return historiales;
}

// --- Caché de frescura ------------------------------------------------------

let cache: { expiraEn: number; valor: FrescuraTrabajos } | null = null;

/** Tira la caché. La llaman `registrarEjecucion` y las pruebas. */
export function invalidarCacheFrescura(): void {
  cache = null;
}

/**
 * Estado de frescura de todos los trabajos vigilados.
 *
 * Con caché porque `/health` se consulta cada pocos segundos. `ahora` entra por
 * parámetro para que las pruebas puedan mover el reloj; cuando se pasa un
 * `ahora` explícito la caché se ignora por completo.
 */
export async function obtenerFrescura(
  prisma: PrismaClient,
  ahora?: Date,
): Promise<FrescuraTrabajos> {
  const usarCache = ahora === undefined;
  const momento = Date.now();

  if (usarCache && cache && cache.expiraEn > momento) {
    return cache.valor;
  }

  const historiales = await obtenerHistoriales(prisma);
  const valor = evaluarFrescura(TRABAJOS_VIGILADOS, historiales, ahora ?? new Date(momento));

  if (usarCache) {
    cache = { expiraEn: momento + VIDA_CACHE_MS, valor };
  }

  return valor;
}

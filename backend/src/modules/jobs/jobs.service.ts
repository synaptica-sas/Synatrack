import type { PrismaClient } from "@prisma/client";
import { env } from "../../config/env.js";
import { getLogger } from "../../infra/logger.js";
import { runAlertEngine } from "../alerts/alerts.service.js";
import { runWeeklyApprovalDigest } from "../approvals/weekly-digest.job.js";
import { runAssignmentMaintenance } from "../assignments/assignments.job.js";
import { registrarEjecucion } from "./job-runs.service.js";

/** De dónde salió la ejecución. Solo sirve para el log y la respuesta HTTP. */
export type OrigenCiclo = "arranque" | "intervalo" | "http";

export interface ResultadoTrabajo {
  nombre: string;
  ok: boolean;
  duracionMs: number;
  error?: string;
}

export interface ResultadoCiclo {
  /** `true` cuando el ciclo no corrió porque ya había otro en curso. */
  omitido: boolean;
  origen: OrigenCiclo;
  iniciadoEn: string;
  duracionMs: number;
  trabajos: ResultadoTrabajo[];
}

interface Trabajo {
  nombre: string;
  ejecutar: (prisma: PrismaClient) => Promise<void>;
}

/**
 * Los trabajos periódicos, en orden. Primero se sincronizan los estados de
 * asignación y después corre el motor de alertas, para que las alertas de
 * "asignación que termina" vean los estados ya actualizados.
 *
 * `approval-digest` va al final porque solo observa: lee lo que está pendiente
 * de aprobar y, como mucho una vez por semana, manda un correo. No modifica
 * nada que los otros dos necesiten, y ponerlo el último evita que un fallo suyo
 * retrase el mantenimiento, que sí tiene efectos en los datos.
 *
 * El ciclo corre cada hora; que `approval-digest` sea SEMANAL lo resuelve él
 * mismo con una marca persistente, no este calendario.
 */
const TRABAJOS: Trabajo[] = [
  { nombre: "assignment-maintenance", ejecutar: runAssignmentMaintenance },
  { nombre: "alert-engine", ejecutar: runAlertEngine },
  {
    nombre: "approval-digest",
    // Se envuelve porque devuelve un resumen de lo que hizo (útil en las
    // pruebas y en el log) y el ciclo solo espera `Promise<void>`.
    ejecutar: async (prisma) => {
      await runWeeklyApprovalDigest(prisma);
    },
  },
];

/**
 * Cerrojo de no solapamiento. Es una variable de módulo a propósito: el
 * intervalo en proceso y el endpoint HTTP viven en el mismo proceso Node y
 * deben compartir el mismo cerrojo. No protege contra dos instancias del
 * servidor a la vez (ver "Riesgos" en documentacion/cambios/R8-scheduler.md).
 */
let cicloEnCurso = false;

/** Expuesto para pruebas y diagnóstico. */
export function hayCicloEnCurso(): boolean {
  return cicloEnCurso;
}

/**
 * Ejecuta un ciclo completo de mantenimiento.
 *
 * Garantías:
 *  - Nunca se solapa consigo mismo: si ya hay uno corriendo, devuelve
 *    `omitido: true` sin tocar la base.
 *  - Si un trabajo falla, los siguientes se ejecutan igual y la promesa se
 *    resuelve (nunca rechaza), así que no puede tumbar el proceso.
 *  - Cada ciclo y cada trabajo dejan su resultado y su duración en el log.
 */
export async function runMaintenanceCycle(
  prisma: PrismaClient,
  origen: OrigenCiclo,
): Promise<ResultadoCiclo> {
  const log = getLogger();
  const iniciadoEn = new Date();

  if (cicloEnCurso) {
    log.warn({ origen }, "[Jobs] Ciclo omitido: ya hay una ejecución en curso");
    return {
      omitido: true,
      origen,
      iniciadoEn: iniciadoEn.toISOString(),
      duracionMs: 0,
      trabajos: [],
    };
  }

  cicloEnCurso = true;
  const comienzo = Date.now();
  const trabajos: ResultadoTrabajo[] = [];

  try {
    for (const trabajo of TRABAJOS) {
      const inicioTrabajo = new Date();
      let resultado: ResultadoTrabajo;

      try {
        await trabajo.ejecutar(prisma);
        const duracionMs = Date.now() - inicioTrabajo.getTime();
        resultado = { nombre: trabajo.nombre, ok: true, duracionMs };
        trabajos.push(resultado);
        log.info({ trabajo: trabajo.nombre, duracionMs, origen }, "[Jobs] Trabajo completado");
      } catch (err) {
        const duracionMs = Date.now() - inicioTrabajo.getTime();
        const error = err instanceof Error ? err.message : String(err);
        resultado = { nombre: trabajo.nombre, ok: false, duracionMs, error };
        trabajos.push(resultado);
        // Se registra y se sigue con el resto: un trabajo caído no debe impedir
        // que corran los demás ni tumbar el servidor.
        log.error(
          { err, trabajo: trabajo.nombre, duracionMs, origen },
          "[Jobs] Trabajo fallido; el ciclo continúa con los demás",
        );
      }

      // Rastro PERSISTENTE, fuera del try/catch de arriba para que el resultado
      // del trabajo no dependa de si se pudo guardar. `registrarEjecucion` ya
      // se traga sus propios errores; el try es el último cerrojo para que
      // observar no pueda romper lo observado ni hacer que este ciclo rechace.
      try {
        await registrarEjecucion(prisma, {
          jobName: resultado.nombre,
          origin: origen,
          startedAt: inicioTrabajo,
          finishedAt: new Date(),
          durationMs: resultado.duracionMs,
          ok: resultado.ok,
          error: resultado.error,
        });
      } catch (err) {
        log.error(
          { err, trabajo: resultado.nombre },
          "[Jobs] No se pudo dejar rastro de la ejecución; el ciclo continúa",
        );
      }
    }
  } finally {
    cicloEnCurso = false;
  }

  const duracionMs = Date.now() - comienzo;
  const fallidos = trabajos.filter((trabajo) => !trabajo.ok).length;
  const resumen = {
    origen,
    duracionMs,
    completados: trabajos.length - fallidos,
    fallidos,
    trabajos,
  };

  if (fallidos > 0) {
    log.warn(resumen, "[Jobs] Ciclo de mantenimiento terminado CON ERRORES");
  } else {
    log.info(resumen, "[Jobs] Ciclo de mantenimiento terminado");
  }

  return {
    omitido: false,
    origen,
    iniciadoEn: iniciadoEn.toISOString(),
    duracionMs,
    trabajos,
  };
}

// --- Intervalo en proceso ---------------------------------------------------
// NO se arranca en buildApp(): solo server.ts lo enciende. Así las pruebas, que
// construyen la app decenas de veces, no dejan temporizadores colgando.

let temporizador: NodeJS.Timeout | null = null;

/**
 * Arranca el intervalo en proceso si está configurado.
 *
 * @param minutos minutos entre ciclos. `0` (el valor por defecto de
 *                `JOBS_INTERVAL_MINUTES`) lo deja apagado.
 * @returns `true` si quedó un temporizador activo.
 */
export function startJobsScheduler(
  prisma: PrismaClient,
  minutos: number = env.JOBS_INTERVAL_MINUTES,
): boolean {
  const log = getLogger();

  if (temporizador) {
    log.warn("[Jobs] El intervalo en proceso ya estaba activo; no se arranca otro");
    return true;
  }

  if (!Number.isFinite(minutos) || minutos <= 0) {
    log.info(
      "[Jobs] Intervalo en proceso DESACTIVADO (JOBS_INTERVAL_MINUTES=0). " +
        "Los trabajos solo correrán al arrancar y cuando alguien llame POST /api/jobs/run.",
    );
    return false;
  }

  const intervaloMs = Math.round(minutos * 60_000);
  temporizador = setInterval(() => {
    void runMaintenanceCycle(prisma, "intervalo").catch((err: unknown) => {
      // runMaintenanceCycle no debería rechazar nunca; este es el último cerrojo
      // para que un rechazo inesperado no se vuelva un unhandled rejection.
      getLogger().error({ err }, "[Jobs] Error inesperado en el ciclo por intervalo");
    });
  }, intervaloMs);

  log.info({ intervaloMinutos: minutos, intervaloMs }, "[Jobs] Intervalo en proceso ACTIVADO");
  return true;
}

/** Apaga el intervalo en proceso. Idempotente. */
export function stopJobsScheduler(): void {
  if (!temporizador) return;
  clearInterval(temporizador);
  temporizador = null;
  getLogger().info("[Jobs] Intervalo en proceso detenido");
}

import { AlertSeverity, AlertType } from "@prisma/client";
import { AUDIT_ENTITIES, writeAudit } from "../../utils/audit.js";
import { getActor, runWithActor } from "../../infra/actorContext.js";
import type { DbClient } from "../../infra/prisma.js";
import { decidirSincronizacionFx, type DecisionCompuertaFx } from "../../utils/fxSyncGate.js";

/**
 * Sincronización automática de tasas FX contra exchangerate-api.com (endpoint
 * público v4, sin API key — el mismo que ya usa el frontend en FxTab.tsx para
 * sugerir la tasa al llenar el formulario manual; aquí solo se automatiza el
 * guardado periódico).
 * Usa USD como moneda base/pivote (coherente con cómo `currency.ts` ya
 * triangula conversiones), y solo actualiza las monedas que el sistema
 * maneja hoy (ver CURRENCY_OPTIONS en frontend/src/App.tsx).
 */

const BASE_CURRENCY = "USD";
const TARGET_CURRENCIES = ["COP", "EUR", "MXN", "PEN", "CLP"];

type ExchangeRateApiResponse = {
  rates?: Record<string, number>;
};

export type FxSyncResult = {
  updated: string[];
  failed: string[];
};

/** Actor de la bitácora cuando la sincronización corre sin usuario (cron). */
export const ACTOR_FX_SYNC = "sistema:fx-sync";

/**
 * @param actor quién dispara la sincronización: el correo del usuario si fue el
 *   botón "Actualizar ahora", o `sistema:fx-sync` si fue el cron con token.
 */
export function runFxSync(
  prisma: DbClient,
  actor: string = ACTOR_FX_SYNC,
): Promise<FxSyncResult> {
  // El mismo actor va a createdBy/updatedBy de lo que se escriba (contexto de Prisma).
  return runWithActor(actor, () => ejecutarFxSync(prisma, actor));
}

/** Nombre del trabajo en `JobRun`; el mismo que registra `POST /api/fx/sync`. */
export const JOB_FX_SYNC = "fx-sync";

/** Lo que devuelve un trabajo del ciclo cuando decide no hacer nada. */
export type TrabajoOmitido = { omitido: true; motivo: string };

/**
 * Sincronización FX como trabajo del ciclo de mantenimiento, con compuerta
 * diaria (`utils/fxSyncGate.ts`): como mucho una sincronización correcta por día
 * UTC, venga del ciclo, del cron de Render o del botón del frontend, porque
 * todos registran `fx-sync` en `JobRun`.
 *
 * - Si la compuerta dice que no, devuelve `{ omitido: true }` y el ciclo NO
 *   escribe en `JobRun` (si lo hiciera, la omisión contaría como éxito).
 * - Si alguna moneda falla, lanza: el ciclo lo registra como `ok = false`, igual
 *   que hace la ruta HTTP, y la compuerta reintenta pasadas 3 h.
 *
 * Idempotente: si dos disparos coinciden (cron de Render y ciclo a la vez, o dos
 * instancias), ambos escriben la misma tasa en `FxConfig`; lo único que se
 * duplica es una fila de `FxRateHistory` con el mismo valor.
 */
export async function runFxSyncDiario(
  prisma: DbClient,
  ahora: Date = new Date(),
): Promise<TrabajoOmitido | FxSyncResult> {
  const [ultimoExito, ultimoIntento] = await Promise.all([
    prisma.jobRun.findFirst({
      where: { jobName: JOB_FX_SYNC, ok: true },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true },
    }),
    prisma.jobRun.findFirst({
      where: { jobName: JOB_FX_SYNC },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true },
    }),
  ]);

  const decision: DecisionCompuertaFx = decidirSincronizacionFx({
    ultimoExito: ultimoExito?.startedAt ?? null,
    ultimoIntento: ultimoIntento?.startedAt ?? null,
    ahora,
  });
  if (!decision.ejecutar) return { omitido: true, motivo: decision.motivo };

  // Si un ADMIN disparó el ciclo a mano, su correo queda como actor; si no, el
  // del sistema (el ciclo ya abre `sistema:<trabajo>`, pero se fija el de FX).
  const actor = getActor() ?? ACTOR_FX_SYNC;
  const resultado = await runFxSync(prisma, actor.startsWith("sistema:") ? ACTOR_FX_SYNC : actor);
  if (resultado.failed.length > 0) {
    throw new Error(`Sin tasa para: ${resultado.failed.join(", ")}`);
  }
  return resultado;
}

async function ejecutarFxSync(prisma: DbClient, actor: string): Promise<FxSyncResult> {
  const response = await fetch(`https://api.exchangerate-api.com/v4/latest/${BASE_CURRENCY}`);

  if (!response.ok) {
    throw new Error(`exchangerate-api respondió con estado ${response.status}`);
  }

  const data = (await response.json()) as ExchangeRateApiResponse;

  if (!data.rates) {
    throw new Error("exchangerate-api no devolvió tasas válidas");
  }

  const updated: string[] = [];
  const failed: string[] = [];

  for (const quoteCode of TARGET_CURRENCIES) {
    const rate = data.rates[quoteCode];
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
      failed.push(quoteCode);
      continue;
    }

    const existing = await prisma.fxConfig.findFirst({
      where: { baseCode: BASE_CURRENCY, quoteCode },
    });

    const saved = existing
      ? await prisma.fxConfig.update({ where: { id: existing.id }, data: { rate } })
      : await prisma.fxConfig.create({ data: { baseCode: BASE_CURRENCY, quoteCode, rate } });

    // Solo se deja rastro si la tasa cambió: una sincronización diaria que
    // devuelve el mismo valor no aporta nada a la bitácora.
    if (!existing || Number(existing.rate) !== Number(saved.rate)) {
      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.fxConfig,
        entityId: saved.id,
        action: existing ? "UPDATE" : "CREATE",
        changedBy: actor,
        before: existing as unknown as Record<string, unknown> | null,
        after: saved as unknown as Record<string, unknown>,
      });
    }

    await prisma.fxRateHistory.create({
      data: {
        baseCode: BASE_CURRENCY,
        quoteCode,
        rate,
        effectiveDate: new Date(),
        rateType: "SPOT",
        source: "auto:exchangerate-api",
        createdBy: actor,
      },
    });

    updated.push(quoteCode);
  }

  if (failed.length > 0) {
    await notifySyncFailures(prisma, failed);
  }

  return { updated, failed };
}

/** Crea una alerta FX_RATE_MISSING por cada moneda que falló, evitando duplicados. */
async function notifySyncFailures(prisma: DbClient, failed: string[]) {
  for (const quoteCode of failed) {
    const message = `No se pudo sincronizar automáticamente la tasa USD→${quoteCode} desde exchangerate-api. Cárgala manualmente en Tasas FX.`;

    const existing = await prisma.alert.findFirst({
      where: { type: AlertType.FX_RATE_MISSING, resolvedAt: null, message },
    });
    if (existing) continue;

    await prisma.alert.create({
      data: {
        type: AlertType.FX_RATE_MISSING,
        severity: AlertSeverity.WARNING,
        message,
      },
    });
  }
}

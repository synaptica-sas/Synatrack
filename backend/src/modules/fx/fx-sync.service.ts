import { AlertSeverity, AlertType } from "@prisma/client";
import { AUDIT_ENTITIES, writeAudit } from "../../utils/audit.js";
import { runWithActor } from "../../infra/actorContext.js";
import type { DbClient } from "../../infra/prisma.js";

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

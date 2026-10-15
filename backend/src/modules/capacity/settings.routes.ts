import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requirePermission } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";
import { AUDIT_ENTITIES, writeAudit } from "../../utils/audit.js";

/**
 * Parámetros de capacity (CONTRATO §3.3): umbrales de sub y sobreocupación y si
 * las asignaciones PROBABLES se incluyen por defecto. Fila única `GENERAL`.
 *
 * Leer: `capacity:read`. Escribir: `capacity:config` (solo ADMIN).
 */

const SCOPE = "GENERAL";

const settingsSchema = z
  .object({
    underThresholdPct: z.coerce.number().min(0).max(300),
    overThresholdPct: z.coerce.number().min(0).max(300),
    includeProbablesDefault: z.boolean(),
    alertsEnabled: z.boolean().optional(),
    alertHorizonMonths: z.coerce.number().int().min(1).max(12).optional(),
    digestEnabled: z.boolean().optional(),
    digestWeekday: z.coerce.number().int().min(1).max(7).optional(),
    digestHourUtc: z.coerce.number().int().min(0).max(23).optional(),
  })
  .refine((v) => v.underThresholdPct < v.overThresholdPct, {
    path: ["underThresholdPct"],
    message: "El umbral de subocupación debe ser menor que el de sobreocupación",
  });

type FilaSettings = {
  underThresholdPct: { toString(): string } | number;
  overThresholdPct: { toString(): string } | number;
  includeProbablesDefault: boolean;
  alertsEnabled: boolean;
  alertHorizonMonths: number;
  digestEnabled: boolean;
  digestWeekday: number;
  digestHourUtc: number;
  digestLastSentAt: Date | null;
  updatedBy: string | null;
  updatedAt: Date;
};

function serializar(fila: FilaSettings) {
  return {
    underThresholdPct: Number(fila.underThresholdPct),
    overThresholdPct: Number(fila.overThresholdPct),
    includeProbablesDefault: fila.includeProbablesDefault,
    alertsEnabled: fila.alertsEnabled,
    alertHorizonMonths: fila.alertHorizonMonths,
    digestEnabled: fila.digestEnabled,
    digestWeekday: fila.digestWeekday,
    digestHourUtc: fila.digestHourUtc,
    digestLastSentAt: fila.digestLastSentAt,
    updatedBy: fila.updatedBy,
    updatedAt: fila.updatedAt,
  };
}

/** Valores de fábrica cuando todavía no hay fila (no se escribe nada en un GET). */
const POR_DEFECTO = {
  underThresholdPct: 70,
  overThresholdPct: 100,
  includeProbablesDefault: false,
  alertsEnabled: true,
  alertHorizonMonths: 3,
  digestEnabled: true,
  digestWeekday: 1,
  digestHourUtc: 13,
  digestLastSentAt: null,
  updatedBy: null,
  updatedAt: null,
};

export async function capacitySettingsRoutes(app: FastifyInstance) {
  app.get(
    "/settings",
    { preHandler: [authenticate, requirePermission("capacity:read")] },
    async () => {
      const fila = await prisma.capacitySettings.findUnique({ where: { scope: SCOPE } });
      return { data: fila ? serializar(fila) : POR_DEFECTO };
    },
  );

  app.put(
    "/settings",
    { preHandler: [authenticate, requirePermission("capacity:config")] },
    async (request) => {
      const payload = settingsSchema.parse(request.body);
      const usuario = request.authUser!.email;

      const antes = await prisma.capacitySettings.findUnique({ where: { scope: SCOPE } });

      const fila = await prisma.capacitySettings.upsert({
        where: { scope: SCOPE },
        update: { ...payload, updatedBy: usuario },
        create: { scope: SCOPE, ...payload, updatedBy: usuario },
      });

      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.capacitySettings,
        entityId: SCOPE,
        action: antes ? "UPDATE" : "CREATE",
        changedBy: usuario,
        before: antes ? serializar(antes) : null,
        after: serializar(fila),
        request,
      });

      return { data: serializar(fila) };
    },
  );
}

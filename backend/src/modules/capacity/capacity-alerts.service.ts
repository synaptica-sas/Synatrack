import type { Prisma, PrismaClient } from "@prisma/client";
import { getLogger } from "../../infra/logger.js";
import {
  TIPOS_ALERTA_CAPACITY,
  calcularAlertasDeseadas,
  planAlertSync,
  type AlertaDeseada,
} from "../../utils/capacityAlerts.js";
import { addMonthsKey, monthKeyOf, toIsoDate } from "../../utils/isoDate.js";
import { cargarYCalcular } from "./monthly.service.js";

/**
 * Trabajo `capacity-alerts` (CONTRATO §5.3): mantiene al día las alertas CONSULTANT_OVERLOADED y
 * CONSULTANT_UNDERUTILIZED. Es idempotente: cada corrida compara lo que debería estar abierto con lo
 * que hay y crea, actualiza o resuelve la diferencia, todo en una transacción.
 */

export const RESUELTO_POR = "system:capacity-alerts";

export const AJUSTES_ALERTAS_POR_DEFECTO = {
  alertsEnabled: true,
  alertHorizonMonths: 3,
  underThresholdPct: 70,
  overThresholdPct: 100,
};

export interface ResultadoAlertasCapacity {
  habilitado: boolean;
  creadas: number;
  actualizadas: number;
  resueltas: number;
}

const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

export async function runCapacityAlerts(
  prisma: PrismaClient,
  ahora: Date = new Date(),
): Promise<ResultadoAlertasCapacity> {
  const fila = await prisma.capacitySettings.findUnique({ where: { scope: "GENERAL" } });
  const ajustes = fila
    ? {
        alertsEnabled: fila.alertsEnabled,
        alertHorizonMonths: fila.alertHorizonMonths,
        underThresholdPct: Number(fila.underThresholdPct),
        overThresholdPct: Number(fila.overThresholdPct),
      }
    : AJUSTES_ALERTAS_POR_DEFECTO;

  const abiertas = await prisma.alert.findMany({
    where: { type: { in: [...TIPOS_ALERTA_CAPACITY] }, resolvedAt: null },
    select: { id: true, type: true, consultantId: true, severity: true, message: true, metadata: true },
    orderBy: { createdAt: "asc" },
  });

  let deseadas: AlertaDeseada[] = [];
  if (ajustes.alertsEnabled) {
    const horizonte = Math.min(12, Math.max(1, ajustes.alertHorizonMonths));
    const primero = monthKeyOf(toIsoDate(ahora));
    const months = Array.from({ length: horizonte }, (_, i) => addMonthsKey(primero, i));
    const { consultants, result } = await cargarYCalcular({
      months,
      includeProbables: false,
      internal: "include",
      thresholds: { underPct: ajustes.underThresholdPct, overPct: ajustes.overThresholdPct },
    });
    deseadas = calcularAlertasDeseadas({
      consultants: result.consultants,
      overPct: ajustes.overThresholdPct,
      nombres: new Map(consultants.map((c) => [c.id, c.fullName])),
    });
  }

  const plan = planAlertSync(deseadas, abiertas);

  if (plan.crear.length + plan.actualizar.length + plan.resolver.length > 0) {
    await prisma.$transaction(async (tx) => {
      if (plan.resolver.length > 0) {
        await tx.alert.updateMany({
          where: { id: { in: plan.resolver }, resolvedAt: null },
          data: { resolvedAt: ahora, resolvedBy: RESUELTO_POR },
        });
      }
      for (const { id, deseada } of plan.actualizar) {
        await tx.alert.update({
          where: { id },
          data: { severity: deseada.severity, message: deseada.message, metadata: json(deseada.metadata) },
        });
      }
      if (plan.crear.length > 0) {
        await tx.alert.createMany({
          data: plan.crear.map((d) => ({
            type: d.type,
            severity: d.severity,
            consultantId: d.consultantId,
            message: d.message,
            metadata: json(d.metadata),
          })),
        });
      }
    });
  }

  getLogger().info(
    { creadas: plan.crear.length, actualizadas: plan.actualizar.length, resueltas: plan.resolver.length },
    "[CapacityAlerts] Alertas de capacity sincronizadas",
  );
  return {
    habilitado: ajustes.alertsEnabled,
    creadas: plan.crear.length,
    actualizadas: plan.actualizar.length,
    resueltas: plan.resolver.length,
  };
}

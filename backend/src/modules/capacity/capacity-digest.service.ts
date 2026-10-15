import { AppRole, type PrismaClient } from "@prisma/client";
import { env } from "../../config/env.js";
import { getLogger } from "../../infra/logger.js";
import { decidirEnvio, inicioSemanaIsoUtc } from "../../utils/approval-digest.js";
import { calcularAlertasDeseadas } from "../../utils/capacityAlerts.js";
import { construirResumenCapacity, hayNovedades, type DatosResumenCapacity } from "../../utils/capacityDigest.js";
import { addMonthsKey, monthKeyOf, toIsoDate } from "../../utils/isoDate.js";
import { sendEmail } from "../../utils/notifications.js";
import { AJUSTES_ALERTAS_POR_DEFECTO } from "./capacity-alerts.service.js";
import { cargarYCalcular } from "./monthly.service.js";

/**
 * Trabajo `capacity-digest` (CONTRATO §5.4): resumen semanal de capacity por correo a ADMIN y
 * COMMERCIAL. Mismo patrón que `approval-digest`: el ciclo corre cada hora, la periodicidad semanal
 * la da la marca `CapacitySettings.digestLastSentAt`, que se RECLAMA con un UPDATE condicional antes
 * de enviar (atómico incluso con dos instancias; un envío fallido quema la semana a propósito).
 */

export type MotivoResumenCapacity =
  | "desactivado"
  | "todavia-no"
  | "ya-enviado"
  | "sin-destinatarios"
  | "reclamado-por-otro"
  | "sin-novedades"
  | "enviado";

export interface ResultadoResumenCapacity {
  enviado: boolean;
  motivo: MotivoResumenCapacity;
  destinatarios: string[];
  sobre: number;
  sub: number;
}

const ROLES_DESTINATARIOS = [AppRole.ADMIN, AppRole.COMMERCIAL];

/** Primer origen configurado del frontend (CORS_ORIGIN) como enlace a la app; "" si no hay uno utilizable. */
function urlDeLaApp(): string {
  const origen = env.CORS_ORIGIN.split(",")[0]?.trim() ?? "";
  return origen && origen !== "*" ? origen : "";
}

export async function runCapacityDigest(
  prisma: PrismaClient,
  ahora: Date = new Date(),
): Promise<ResultadoResumenCapacity> {
  const log = getLogger();
  const vacio = (motivo: MotivoResumenCapacity, destinatarios: string[] = []): ResultadoResumenCapacity => ({
    enviado: false,
    motivo,
    destinatarios,
    sobre: 0,
    sub: 0,
  });

  // La fila tiene que existir para poder marcar la semana sobre ella.
  await prisma.capacitySettings.upsert({ where: { scope: "GENERAL" }, update: {}, create: { scope: "GENERAL" } });
  const fila = (await prisma.capacitySettings.findUnique({ where: { scope: "GENERAL" } }))!;

  const motivo = decidirEnvio({
    ahora,
    ultimoEnvioEn: fila.digestLastSentAt,
    config: {
      enabled: fila.digestEnabled,
      sendWeekday: fila.digestWeekday,
      sendHourUtc: fila.digestHourUtc,
      immediateExtraHour: false,
    },
  });
  if (motivo !== "enviar") {
    log.debug({ motivo }, "[CapacityDigest] No toca enviar en esta ejecución");
    return vacio(motivo);
  }

  const usuarios = await prisma.user.findMany({
    where: { active: true, roles: { some: { role: { name: { in: ROLES_DESTINATARIOS } } } } },
    select: { email: true },
  });
  const destinatarios = [
    ...new Set(usuarios.map((u) => u.email.trim()).filter((e) => e !== "")),
  ];
  if (destinatarios.length === 0) {
    log.info("[CapacityDigest] Sin destinatarios (ADMIN/COMMERCIAL activos con correo); no se envía ni se marca");
    return vacio("sin-destinatarios");
  }

  const reclamo = await prisma.capacitySettings.updateMany({
    where: {
      scope: "GENERAL",
      OR: [{ digestLastSentAt: null }, { digestLastSentAt: { lt: inicioSemanaIsoUtc(ahora) } }],
    },
    data: { digestLastSentAt: ahora },
  });
  if (reclamo.count === 0) {
    log.info("[CapacityDigest] Otra ejecución ya reclamó esta semana; no se envía");
    return vacio("reclamado-por-otro", destinatarios);
  }

  const horizonte = Math.min(12, Math.max(1, fila.alertHorizonMonths ?? AJUSTES_ALERTAS_POR_DEFECTO.alertHorizonMonths));
  const primero = monthKeyOf(toIsoDate(ahora));
  const months = Array.from({ length: horizonte }, (_, i) => addMonthsKey(primero, i));
  const overPct = Number(fila.overThresholdPct);
  const { consultants, result } = await cargarYCalcular({
    months,
    includeProbables: false,
    internal: "include",
    thresholds: { underPct: Number(fila.underThresholdPct), overPct },
  });
  const nombres = new Map(consultants.map((c) => [c.id, c.fullName]));
  const deseadas = calcularAlertasDeseadas({ consultants: result.consultants, overPct, nombres });
  const porNombreYMes = <T extends { nombre: string; month: string }>(a: T, b: T) =>
    a.nombre.localeCompare(b.nombre, "es") || a.month.localeCompare(b.month);

  const datos: DatosResumenCapacity = {
    equipo: result.team.months.map((m) => ({ month: m.month, pct: m.pct })),
    sobreasignados: deseadas
      .filter((d) => d.type === "CONSULTANT_OVERLOADED")
      .map((d) => ({ nombre: nombres.get(d.consultantId) ?? "Consultor", month: d.month, pct: d.metadata.pct ?? 0 }))
      .sort(porNombreYMes),
    subutilizados: deseadas
      .filter((d) => d.type === "CONSULTANT_UNDERUTILIZED")
      .map((d) => ({
        nombre: nombres.get(d.consultantId) ?? "Consultor",
        month: d.month,
        billablePct: d.metadata.billablePct ?? 0,
      }))
      .sort(porNombreYMes),
    url: urlDeLaApp(),
  };
  const sobre = datos.sobreasignados.length;
  const sub = datos.subutilizados.length;

  if (!hayNovedades(datos)) {
    log.info("[CapacityDigest] No hubo novedades de capacity esta semana; no se envía correo (semana marcada)");
    return { enviado: false, motivo: "sin-novedades", destinatarios, sobre, sub };
  }

  const { subject, text, html } = construirResumenCapacity(datos);
  let enviados = 0;
  for (const to of destinatarios) {
    try {
      await sendEmail({ to, subject, text, html });
      enviados += 1;
    } catch (err) {
      log.error({ err, to }, "[CapacityDigest] Falló el envío a un destinatario; se continúa con los demás");
    }
  }
  log.info({ enviados, sobre, sub }, "[CapacityDigest] Resumen semanal de capacity enviado");
  return { enviado: enviados > 0, motivo: "enviado", destinatarios, sobre, sub };
}

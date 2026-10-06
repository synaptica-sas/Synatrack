import { ExtraHourStatus, TimeEntryStatus, type PrismaClient } from "@prisma/client";
import { getLogger } from "../../infra/logger.js";
import {
  AMBITO_GENERAL,
  agruparPendientesPorPm,
  decidirEnvio,
  inicioSemanaIsoUtc,
  resolverConfigResumen,
  type MotivoEnvio,
  type PendienteCrudo,
} from "../../utils/approval-digest.js";
import { notifyWeeklyApprovalDigest } from "../../utils/notifications.js";

/**
 * Trabajo `approval-digest`: el resumen semanal de aprobaciones pendientes que
 * piden R-020 (horas regulares) y R-022 (horas extra).
 *
 * Corre dentro del ciclo de `jobs.service.ts`, o sea **cada hora**. La inmensa
 * mayoría de esas ejecuciones no manda nada: solo comprueban si ya llegó el
 * momento de la semana y se van. Eso es intencionado —el ciclo horario es la
 * única cadencia fiable que hay en este sistema (no existe un cron semanal), así
 * que la periodicidad semanal se consigue con una marca en la base, no con el
 * disparador—.
 */

/**
 * Lo que impide el envío duplicado, en una frase: **se reclama la semana antes
 * de enviar, con un UPDATE condicional**.
 *
 * `UPDATE … WHERE "lastSentAt" IS NULL OR "lastSentAt" < <lunes>` es atómico en
 * Postgres: de dos ejecuciones simultáneas, exactamente una ve `count = 1` y la
 * otra `count = 0`. Por eso el cerrojo vale incluso con dos instancias del
 * servidor, que es justo lo que el cerrojo en memoria de `jobs.service.ts` NO
 * cubre (lo dice su propio comentario).
 *
 * Se reclama ANTES de enviar y no después, a sabiendas de la consecuencia: si
 * el envío revienta a mitad, la semana queda quemada y ese resumen no sale.
 * Es la mitad mala elegida a propósito — un correo perdido se nota y se puede
 * forzar, mientras que un aviso duplicado cada hora durante una semana es
 * exactamente el ruido que R-022 pide eliminar.
 *
 * @returns `true` si esta ejecución se quedó con la semana.
 */
async function reclamarSemana(
  prisma: PrismaClient,
  inicioSemana: Date,
  ahora: Date,
): Promise<boolean> {
  const reclamo = await prisma.approvalDigestConfig.updateMany({
    where: {
      scope: AMBITO_GENERAL,
      OR: [{ lastSentAt: null }, { lastSentAt: { lt: inicioSemana } }],
    },
    data: { lastSentAt: ahora },
  });
  return reclamo.count > 0;
}

/** Fecha de un `DateTime` en `YYYY-MM-DD` UTC, como el resto del backend. */
function aFechaUtc(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/**
 * Horas regulares esperando aprobación, aplanadas para el agrupador.
 *
 * El `select` es deliberadamente estrecho: nombre del consultor, nombre del
 * proyecto, fecha y horas. Nada de tarifas ni importes — el correo es un
 * recordatorio de que hay trabajo que aprobar, no un documento de nómina, y
 * `Consultant.hourlyRate` no tiene por qué viajar a un buzón.
 */
async function pendientesDeHoras(prisma: PrismaClient): Promise<PendienteCrudo[]> {
  const filas = await prisma.timeEntry.findMany({
    where: { status: TimeEntryStatus.PENDING },
    select: {
      workDate: true,
      hours: true,
      consultant: { select: { fullName: true } },
      project: { select: { name: true, projectManagerEmail: true } },
    },
  });

  return filas.map((fila) => ({
    pmEmail: fila.project?.projectManagerEmail ?? null,
    consultantName: fila.consultant?.fullName ?? "Consultor",
    projectName: fila.project?.name ?? "Proyecto",
    fecha: aFechaUtc(fila.workDate),
    horas: Number(fila.hours),
  }));
}

/** Horas extra esperando la aprobación del PM (el único nivel que queda). */
async function pendientesDeHorasExtra(prisma: PrismaClient): Promise<PendienteCrudo[]> {
  const filas = await prisma.extraHourEntry.findMany({
    where: { status: ExtraHourStatus.PENDING_PM },
    select: {
      date: true,
      totalHours: true,
      consultant: { select: { fullName: true } },
      project: { select: { name: true, projectManagerEmail: true } },
    },
  });

  return filas.map((fila) => ({
    pmEmail: fila.project?.projectManagerEmail ?? null,
    consultantName: fila.consultant?.fullName ?? "Consultor",
    projectName: fila.project?.name ?? "Proyecto",
    fecha: aFechaUtc(fila.date),
    horas: Number(fila.totalHours),
  }));
}

/** Nombre para el saludo, por correo. Lo que falte caerá al propio correo. */
async function nombresDePm(
  prisma: PrismaClient,
  correos: string[],
): Promise<Map<string, string>> {
  if (correos.length === 0) return new Map();

  const usuarios = await prisma.user.findMany({
    where: { email: { in: correos, mode: "insensitive" } },
    select: { email: true, displayName: true },
  });

  return new Map(usuarios.map((u) => [u.email.toLowerCase(), u.displayName]));
}

/** Resultado de una ejecución. Expuesto para el log y para las pruebas. */
export interface ResultadoResumenSemanal {
  motivo: MotivoEnvio | "reclamado-por-otro";
  /** Cuántos correos se mandaron. */
  enviados: number;
  /** PM que no recibieron nada porque no tenían pendientes. */
  pmSinPendientes: number;
  /** Solicitudes cuyo proyecto no tiene PM: nadie a quien avisar. */
  sinDestinatario: number;
}

/**
 * Ejecuta el resumen semanal.
 *
 * Nunca lanza por un envío fallido: un buzón caído no puede impedir que los
 * demás PM reciban el suyo ni tumbar el ciclo de trabajos.
 */
export async function runWeeklyApprovalDigest(
  prisma: PrismaClient,
  ahora: Date = new Date(),
): Promise<ResultadoResumenSemanal> {
  const log = getLogger();

  // La fila tiene que existir para poder marcar la semana sobre ella. La
  // migración la siembra; este `upsert` cubre una base que nunca la recibió
  // (p. ej. creada con `db push` antes de que existiera la migración).
  await prisma.approvalDigestConfig.upsert({
    where: { scope: AMBITO_GENERAL },
    update: {},
    create: { scope: AMBITO_GENERAL },
  });

  const fila = await prisma.approvalDigestConfig.findUnique({
    where: { scope: AMBITO_GENERAL },
    select: {
      enabled: true,
      sendWeekday: true,
      sendHourUtc: true,
      immediateExtraHour: true,
      lastSentAt: true,
    },
  });

  const config = resolverConfigResumen(fila);
  const motivo = decidirEnvio({ ahora, ultimoEnvioEn: fila?.lastSentAt ?? null, config });

  if (motivo !== "enviar") {
    log.debug({ motivo, config }, "[Resumen semanal] No toca enviar en esta ejecución");
    return { motivo, enviados: 0, pmSinPendientes: 0, sinDestinatario: 0 };
  }

  if (!(await reclamarSemana(prisma, inicioSemanaIsoUtc(ahora), ahora))) {
    // Otra instancia (o este mismo ciclo, si se solapara) ya se quedó con la
    // semana entre la lectura de arriba y este reclamo.
    log.info("[Resumen semanal] Otra ejecución ya reclamó esta semana; no se envía");
    return { motivo: "reclamado-por-otro", enviados: 0, pmSinPendientes: 0, sinDestinatario: 0 };
  }

  const [horas, horasExtra] = await Promise.all([
    pendientesDeHoras(prisma),
    pendientesDeHorasExtra(prisma),
  ]);

  const correosPm = [
    ...new Set(
      [...horas, ...horasExtra]
        .map((p) => (p.pmEmail ?? "").trim().toLowerCase())
        .filter((email) => email !== ""),
    ),
  ];

  const { resumenes, sinDestinatario } = agruparPendientesPorPm({
    horas,
    horasExtra,
    nombresPorEmail: await nombresDePm(prisma, correosPm),
  });

  let enviados = 0;
  for (const resumen of resumenes) {
    try {
      await notifyWeeklyApprovalDigest(resumen);
      enviados += 1;
    } catch (err) {
      log.error(
        { err, pmEmail: resumen.pmEmail },
        "[Resumen semanal] Falló el envío a un PM; se continúa con los demás",
      );
    }
  }

  log.info(
    { enviados, sinDestinatario, totalPm: resumenes.length },
    "[Resumen semanal] Resumen de aprobaciones enviado",
  );

  // `pmSinPendientes` es 0 por construcción: `agruparPendientesPorPm` no
  // devuelve PM sin solicitudes, así que nunca sale un correo vacío. Se reporta
  // igual para dejar explícita la decisión (ver la nota en PENDIENTES, R-020).
  return { motivo: "enviar", enviados, pmSinPendientes: 0, sinDestinatario };
}

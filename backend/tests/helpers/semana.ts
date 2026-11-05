import type { FastifyInstance } from "fastify";
import { TimeEntryStatus, TimesheetReviewStatus } from "@prisma/client";
import { prisma } from "../../src/infra/prisma.js";
import { addDaysIso, fromIsoDate, toIsoDate } from "../../src/utils/isoDate.js";
import { weekStartOf } from "../../src/utils/timesheetWeek.js";

/**
 * Ayudas para las pruebas de R15 (aprobación semanal). Dejan una semana "enviada" directamente en
 * la base (sin pasar por la validación de días completos de `POST /timesheet-weeks/submit`, que se
 * prueba aparte) para ejercitar la aprobación/devolución por las rutas reales.
 */

export const lunesDe = (fecha: Date | string) => weekStartOf(typeof fecha === "string" ? fecha : toIsoDate(fecha));

/** Pasa a SUBMITTED los PENDING del consultor en ese proyecto y semana y crea/actualiza la revisión. */
export async function marcarSemanaEnviada(consultantId: string, projectId: string, fecha: Date | string) {
  const weekStart = lunesDe(fecha);
  const desde = fromIsoDate(weekStart);
  const hasta = fromIsoDate(addDaysIso(weekStart, 6));
  await prisma.timeEntry.updateMany({
    where: { consultantId, projectId, workDate: { gte: desde, lte: hasta }, status: TimeEntryStatus.PENDING },
    data: { status: TimeEntryStatus.SUBMITTED },
  });
  const suma = await prisma.timeEntry.aggregate({
    where: { consultantId, projectId, workDate: { gte: desde, lte: hasta }, status: { not: TimeEntryStatus.REJECTED } },
    _sum: { hours: true },
  });
  const hours = Number(suma._sum.hours ?? 0);
  return prisma.timesheetWeekReview.upsert({
    where: { consultantId_weekStart_projectId: { consultantId, weekStart: desde, projectId } },
    create: {
      consultantId,
      projectId,
      weekStart: desde,
      status: TimesheetReviewStatus.SUBMITTED,
      submittedAt: new Date(),
      submittedBy: "test@synaptica.test",
      hours,
    },
    update: {
      status: TimesheetReviewStatus.SUBMITTED,
      submittedAt: new Date(),
      reviewedAt: null,
      reviewedBy: null,
      note: null,
      hours,
    },
  });
}

/** Envía la semana del registro y la aprueba con los encabezados dados. Devuelve la respuesta. */
export async function aprobarSemanaDeRegistro(app: FastifyInstance, headers: Record<string, string>, entryId: string) {
  const e = await prisma.timeEntry.findUniqueOrThrow({ where: { id: entryId } });
  await marcarSemanaEnviada(e.consultantId, e.projectId, e.workDate);
  return aprobarSemana(app, headers, { consultantId: e.consultantId, projectId: e.projectId, weekStart: lunesDe(e.workDate) });
}

/** Envía la semana del registro y la devuelve con la nota dada. */
export async function devolverSemanaDeRegistro(
  app: FastifyInstance,
  headers: Record<string, string>,
  entryId: string,
  note = "Faltan detalles en la descripción",
) {
  const e = await prisma.timeEntry.findUniqueOrThrow({ where: { id: entryId } });
  await marcarSemanaEnviada(e.consultantId, e.projectId, e.workDate);
  return devolverSemana(app, headers, { consultantId: e.consultantId, projectId: e.projectId, weekStart: lunesDe(e.workDate), note });
}

export function aprobarSemana(
  app: FastifyInstance,
  headers: Record<string, string>,
  item: { consultantId: string; projectId: string; weekStart: string },
) {
  return app.inject({ method: "POST", url: "/api/timesheet-reviews/approve", headers, payload: { items: [item] } });
}

export function devolverSemana(
  app: FastifyInstance,
  headers: Record<string, string>,
  payload: { consultantId: string; projectId: string; weekStart: string; note: string },
) {
  return app.inject({ method: "POST", url: "/api/timesheet-reviews/return", headers, payload });
}

/** Borra las revisiones de unos consultores (hay que hacerlo antes de borrar el consultor: Restrict). */
export async function borrarRevisiones(consultantIds: string[]) {
  await prisma.timesheetWeekReview.deleteMany({ where: { consultantId: { in: consultantIds } } });
}

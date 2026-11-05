/**
 * Servicio compartido de la aprobación semanal del timesheet (R15,
 * `documentacion/cambios/R15-aprobacion-semanal-timesheet.md`).
 *
 * Reúne lo que necesitan a la vez las rutas de envío/revisión, las de registros y el cronómetro:
 * el candado de semana (`checkWeekEditable`), el cargado del contexto de validación del envío y la
 * resolución de quién puede ver a quién. Las reglas puras viven en `utils/timesheetWeek.ts`.
 */

import { AppRole } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { prisma } from "../../infra/prisma.js";
import { resolveCountryTimezone } from "../../utils/country.js";
import { addDaysIso, fromIsoDate, toIsoDate, type IsoDate } from "../../utils/isoDate.js";
import {
  formatDateLong,
  validateWeekSubmission,
  weekStartOf,
  type WeekEntryInput,
  type WeekSubmissionResult,
} from "../../utils/timesheetWeek.js";
import type { TimeEntryCategory, TimeEntryStatus } from "../../utils/timesheetRules.js";
import { loadDaysContext, type Db } from "../time-entries/day-context.service.js";

// ---------------------------------------------------------------------------
// Candado de semana
// ---------------------------------------------------------------------------

/**
 * Bloqueo de aviso (advisory lock) por consultor y semana, liberado al terminar la transacción.
 * Serializa envío, aprobación, devolución y toda escritura de horas de esa semana. Orden de
 * adquisición fijo: primero la semana, después el día (`lockDay`), para no provocar interbloqueos.
 */
export async function lockWeek(db: Db, consultantId: string, weekStart: IsoDate): Promise<void> {
  const key = `week:${consultantId}:${weekStart}`;
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

export interface WeekLock {
  weekStart: IsoDate;
  message: string;
}

export const WEEK_LOCKED_CODE = "WEEK_LOCKED";

/**
 * ¿Se pueden crear, editar o borrar registros del proyecto P en la semana de `workDate`?
 * (R15 §2.2) Sí solo si la semana no tiene NINGUNA revisión o la de P está DEVUELTA. Un proyecto
 * nuevo en una semana ya enviada también está bloqueado (bloqueo total).
 *
 * Devuelve `null` si es editable, o el motivo del bloqueo. Acepta una transacción: dentro de una,
 * llamar antes a `lockWeek` para que la comprobación no compita con un envío.
 */
export async function checkWeekEditable(
  db: Db,
  consultantId: string,
  projectId: string,
  workDate: Date | IsoDate,
): Promise<WeekLock | null> {
  const weekStart = weekStartOf(typeof workDate === "string" ? workDate : toIsoDate(workDate));
  const reviews = await db.timesheetWeekReview.findMany({
    where: { consultantId, weekStart: fromIsoDate(weekStart) },
    select: { projectId: true, status: true },
  });
  if (reviews.length === 0) return null;
  const own = reviews.find((r) => r.projectId === projectId);
  if (own?.status === "RETURNED") return null;
  const semana = formatDateLong(weekStart);
  const estado = own?.status === "APPROVED" ? "aprobada" : "enviada para revisión";
  return {
    weekStart,
    message: own
      ? `La semana del ${semana} ya fue ${estado} para este proyecto y no se puede modificar. Si el PM la devuelve, podrás corregirla.`
      : `La semana del ${semana} ya fue enviada y no admite registros en proyectos nuevos. Si el PM devuelve un proyecto, podrás corregir solo ese.`,
  };
}

/** Cuerpo estándar de la respuesta 409 por semana bloqueada. */
export function weekLockedBody(lock: WeekLock) {
  return { message: lock.message, code: WEEK_LOCKED_CODE, weekStart: lock.weekStart };
}

/** Día de calendario (YYYY-MM-DD) de un instante en la zona horaria del país del consultor. */
export function localCalendarDay(instant: Date, country: string | null | undefined): IsoDate {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: resolveCountryTimezone(country).timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

// ---------------------------------------------------------------------------
// Validación del envío
// ---------------------------------------------------------------------------

export interface WeekSubmissionContext {
  consultant: { id: string; fullName: string; email: string | null; country: string | null };
  today: IsoDate;
  result: WeekSubmissionResult;
}

/** Carga lo necesario y corre `validateWeekSubmission` (misma lectura para la vista previa y el envío). */
export async function evaluateWeekSubmission(
  db: Db,
  consultantId: string,
  weekStart: IsoDate,
  now: Date = new Date(),
): Promise<WeekSubmissionContext> {
  const consultant = await db.consultant.findUnique({
    where: { id: consultantId },
    select: { id: true, fullName: true, email: true, country: true, hireDate: true, exitDate: true },
  });
  if (!consultant) throw new Error("CONSULTANT_NOT_FOUND");

  const contexts = await loadDaysContext(db, consultantId, weekStart, addDaysIso(weekStart, 6));
  const jornada: Record<IsoDate, number> = {};
  const holidays = new Set<IsoDate>();
  const entries: WeekEntryInput[] = [];
  for (const [date, ctx] of contexts) {
    jornada[date] = ctx.hoursPerDay;
    if (ctx.isHoliday) holidays.add(date);
    for (const e of ctx.entries) {
      entries.push({
        id: e.id,
        projectId: e.projectId,
        workDate: date,
        category: e.category as TimeEntryCategory,
        hours: e.hours,
        status: e.status as TimeEntryStatus,
      });
    }
  }

  const reviews = await db.timesheetWeekReview.findMany({
    where: { consultantId, weekStart: fromIsoDate(weekStart) },
    select: { projectId: true, status: true },
  });

  const today = localCalendarDay(now, consultant.country);
  const result = validateWeekSubmission({
    weekStart,
    today,
    jornada,
    holidays,
    hireDate: consultant.hireDate,
    exitDate: consultant.exitDate,
    entries,
    reviews,
  });
  return { consultant, today, result };
}

// ---------------------------------------------------------------------------
// Visibilidad
// ---------------------------------------------------------------------------

export type VisibleConsultant =
  | { ok: true; consultantId: string }
  | { ok: false; status: 400 | 403 | 404; message: string };

/**
 * Qué consultor puede consultar quien hace la petición (mismo criterio que `GET /day-summary`):
 * ADMIN y VIEWER, cualquiera; un PM (sin ADMIN/VIEWER), a sí mismo o a quien tiene horas o
 * asignaciones en un proyecto que dirige; el resto, solo el suyo.
 */
export async function resolveVisibleConsultant(
  request: FastifyRequest,
  requestedId: string | undefined,
): Promise<VisibleConsultant> {
  const user = request.authUser!;
  const roles = user.roles;
  const veTodos = roles.includes(AppRole.ADMIN) || roles.includes(AppRole.VIEWER);
  const esPm = roles.includes(AppRole.PM);

  if (requestedId && (veTodos || esPm)) {
    const exists = await prisma.consultant.findUnique({ where: { id: requestedId }, select: { id: true } });
    if (!exists) return { ok: false, status: 404, message: "El consultor indicado no existe" };
    if (!veTodos && exists.id !== user.consultantId) {
      const pm = { projectManagerEmail: { equals: user.email, mode: "insensitive" as const } };
      const [horas, asignacion] = await Promise.all([
        prisma.timeEntry.findFirst({ where: { consultantId: exists.id, project: pm }, select: { id: true } }),
        prisma.assignment.findFirst({ where: { consultantId: exists.id, project: pm }, select: { id: true } }),
      ]);
      if (!horas && !asignacion) {
        return {
          ok: false,
          status: 403,
          message: "No puedes consultar el resumen de un consultor que no está en tus proyectos.",
        };
      }
    }
    return { ok: true, consultantId: exists.id };
  }

  if (!user.consultantId) {
    return { ok: false, status: 400, message: "Tu usuario no tiene una ficha de consultor enlazada." };
  }
  if (requestedId && requestedId !== user.consultantId) {
    return { ok: false, status: 403, message: "Solo puedes consultar tu propio resumen." };
  }
  return { ok: true, consultantId: user.consultantId };
}

/**
 * Toma el candado de cada semana tocada (en orden, para no interbloquearse) y comprueba que cada
 * (proyecto, fecha) sea editable. Devuelve el primer bloqueo, o `null` si todo es editable.
 * Para usar DENTRO de la transacción que escribe.
 */
export async function lockAndCheckWeeks(
  db: Db,
  consultantId: string,
  targets: { projectId: string; workDate: Date }[],
): Promise<WeekLock | null> {
  const weeks = [...new Set(targets.map((t) => weekStartOf(toIsoDate(t.workDate))))].sort();
  for (const week of weeks) await lockWeek(db, consultantId, week);
  for (const t of targets) {
    const lock = await checkWeekEditable(db, consultantId, t.projectId, t.workDate);
    if (lock) return lock;
  }
  return null;
}

/** Forma de error de `saveDayGroup` para una semana bloqueada (409 `WEEK_LOCKED`). */
export function weekLockedDayResult(lock: WeekLock) {
  return {
    ok: false as const,
    error: {
      status: 409 as const,
      code: WEEK_LOCKED_CODE,
      message: lock.message,
      index: null,
      errors: [{ index: null, code: WEEK_LOCKED_CODE, message: lock.message }],
    },
  };
}

// ---------------------------------------------------------------------------
// Candado de cierre mensual (proyecto + mes)
// ---------------------------------------------------------------------------

/**
 * Candado de aviso por proyecto y mes. Lo toman el cierre (`POST /snapshots/close`) y toda escritura
 * de horas (guardar, borrar, cronómetro, enviar, aprobar, devolver): así una escritura concurrente o
 * el cierre ocurre primero y el otro lo ve, en vez de cruzarse. Orden de adquisición: semana, mes, día.
 */
export async function lockProjectMonth(db: Db, projectId: string, year: number, month: number): Promise<void> {
  const key = `month:${projectId}:${year}-${month}`;
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

/** Toma el candado del mes de `workDate` y dice si ese proyecto ya está cerrado ese mes. */
export async function closedMonthLocked(db: Db, projectId: string, workDate: Date) {
  const year = workDate.getUTCFullYear();
  const month = workDate.getUTCMonth() + 1;
  await lockProjectMonth(db, projectId, year, month);
  const snapshot = await db.monthlySnapshot.findUnique({
    where: { projectId_year_month: { projectId, year, month } },
    select: { id: true },
  });
  return snapshot ? { year, month } : null;
}

/** Como `closedMonthLocked` para varios (proyecto, fecha), en orden estable. Devuelve el primer cierre. */
export async function lockAndCheckMonths(db: Db, targets: { projectId: string; workDate: Date }[]) {
  const unique = new Map<string, { projectId: string; workDate: Date }>();
  for (const t of targets) {
    unique.set(`${t.projectId}|${t.workDate.getUTCFullYear()}-${t.workDate.getUTCMonth()}`, t);
  }
  let closed: { year: number; month: number } | null = null;
  for (const key of [...unique.keys()].sort()) {
    const t = unique.get(key)!;
    const c = await closedMonthLocked(db, t.projectId, t.workDate);
    if (c && !closed) closed = c;
  }
  return closed;
}

export function monthClosedMessage(closed: { year: number; month: number }) {
  return `No se pueden modificar horas de un mes cerrado para este proyecto (${closed.year}-${String(closed.month).padStart(2, "0")}).`;
}

/** Forma de error de `saveDayGroup` para un mes cerrado (400 `MONTH_CLOSED`). */
export function monthClosedDayResult(closed: { year: number; month: number }) {
  const message = monthClosedMessage(closed);
  return {
    ok: false as const,
    error: {
      status: 400 as const,
      code: "MONTH_CLOSED",
      message,
      index: null,
      errors: [{ index: null, code: "MONTH_CLOSED", message }],
    },
  };
}

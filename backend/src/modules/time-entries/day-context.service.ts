/**
 * Contexto de un día de un consultor para las reglas del timesheet (R14).
 *
 * Reúne en un solo lugar lo que `utils/timesheetRules.ts` necesita y que sale de la base:
 * jornada vigente ese día (`resolverJornada` sobre `CapacityConfig`, con vigencia por fecha),
 * si es fin de semana o festivo (`Holiday` de su país + ciudad), `allowWeekendWork`, todos los
 * `TimeEntry` del día en todos los proyectos y el saldo de horas extra aprobadas por proyecto.
 *
 * Acepta un cliente de transacción para poder leer el estado DENTRO de la misma transacción que
 * después escribe (PUT /day, cronómetro).
 */

import { ExtraHourStatus } from "@prisma/client";
import type { DbClient } from "../../infra/prisma.js";
import { resolverJornada, type OrigenJornada } from "../../utils/capacity.js";
import { normalizeCountry, resolveCountryTimezone } from "../../utils/country.js";
import { eachDayIso, fromIsoDate, toIsoDate, type IsoDate } from "../../utils/isoDate.js";
import {
  roundHours,
  summarizeDay,
  type DayEntryInput,
  type DaySummary,
  type TimeEntryCategory,
  type TimeEntryStatus,
  type ValidateDayInput,
} from "../../utils/timesheetRules.js";

/** Cliente de Prisma o de una transacción interactiva. */
export type Db = Parameters<Parameters<DbClient["$transaction"]>[0]>[0];

export interface DayEntryRow {
  id: string;
  projectId: string;
  consultantId: string;
  workDate: Date;
  hours: number;
  status: TimeEntryStatus;
  startedAt: Date | null;
  endedAt: Date | null;
  isExcess: boolean;
  typeId: string;
  category: TimeEntryCategory;
  isAbsenceProject: boolean;
  extraHourEntryId: string | null;
  createdAt: Date;
}

export interface ApprovedRequest {
  id: string;
  projectId: string;
  totalHours: number;
  /** Franja tal como se guardó ("HH:MM" o "HH:MM:SS", hora local). */
  startTime: string;
  endTime: string;
  createdAt: Date;
}

export interface DayContext {
  date: IsoDate;
  consultantId: string;
  hoursPerDay: number;
  jornadaOrigen: OrigenJornada;
  isWeekend: boolean;
  isHoliday: boolean;
  holidayName: string | null;
  isNonWorkingDay: boolean;
  allowWeekendWork: boolean;
  /** Zona horaria IANA del país del consultor (para atar la franja a `workDate`). */
  timeZone: string;
  entries: DayEntryRow[];
  approvedRequests: ApprovedRequest[];
  /** Σ totalHours de solicitudes APROBADAS ese día, por proyecto. */
  approvedExtraBalance: Record<string, number>;
}

/** Máximo de días que se cargan en una sola consulta. */
export const MAX_DAYS_RANGE = 62;

function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

export function utcDayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Estado del día como lo espera `validateDay`/`summarizeDay` (todas las filas no editables). */
export function toDayEntryInputs(entries: DayEntryRow[], editable = false): DayEntryInput[] {
  return entries.map((e) => ({
    id: e.id,
    projectId: e.projectId,
    category: e.category,
    hours: e.hours,
    status: e.status,
    startedAt: e.startedAt,
    endedAt: e.endedAt,
    isExcess: e.isExcess,
    isAbsenceProject: e.isAbsenceProject,
    editable,
  }));
}

export function toValidateInput(ctx: DayContext, entries: DayEntryInput[]): ValidateDayInput {
  return {
    hoursPerDay: ctx.hoursPerDay,
    isNonWorkingDay: ctx.isNonWorkingDay,
    allowWeekendWork: ctx.allowWeekendWork,
    workDate: ctx.date,
    timeZone: ctx.timeZone,
    entries,
    approvedExtraBalance: ctx.approvedExtraBalance,
  };
}

export function summaryOfContext(ctx: DayContext): DaySummary {
  return summarizeDay(toValidateInput(ctx, toDayEntryInputs(ctx.entries)));
}

/**
 * Carga el contexto de cada día de `[from, to]` (ambos inclusive) de un consultor.
 * Una sola ronda de consultas para todo el rango.
 */
export async function loadDaysContext(
  db: Db,
  consultantId: string,
  from: IsoDate,
  to: IsoDate,
): Promise<Map<IsoDate, DayContext>> {
  const days = eachDayIso(from, to);
  if (days.length > MAX_DAYS_RANGE) {
    throw new Error(`Rango demasiado largo: máximo ${MAX_DAYS_RANGE} días`);
  }
  const start = fromIsoDate(from);
  const endExclusive = new Date(fromIsoDate(to).getTime() + 24 * 3_600_000);

  const consultant = await db.consultant.findUnique({
    where: { id: consultantId },
    select: { id: true, country: true, city: true, allowWeekendWork: true },
  });
  if (!consultant) throw new Error("CONSULTANT_NOT_FOUND");

  let normalizedCountry: string | null = null;
  try {
    normalizedCountry = consultant.country ? normalizeCountry(consultant.country) : null;
  } catch {
    normalizedCountry = null;
  }
  const countryNames = [consultant.country, normalizedCountry].filter((c): c is string => !!c);

  const [configs, holidays, rawEntries, requests] = await Promise.all([
    db.capacityConfig.findMany({
      where: {
        validFrom: { lt: endExclusive },
        OR: [{ consultantId }, { consultantId: null, country: { not: null } }],
      },
      orderBy: { validFrom: "desc" },
    }),
    countryNames.length
      ? db.holiday.findMany({
          where: { date: { gte: start, lt: endExclusive }, country: { in: countryNames, mode: "insensitive" } },
        })
      : Promise.resolve([]),
    db.timeEntry.findMany({
      where: { consultantId, workDate: { gte: start, lt: endExclusive } },
      include: {
        type: { select: { category: true } },
        project: { select: { isAbsenceProject: true } },
      },
      orderBy: [{ startedAt: "asc" }, { createdAt: "asc" }],
    }),
    db.extraHourEntry.findMany({
      where: {
        consultantId,
        status: ExtraHourStatus.APPROVED,
        projectId: { not: null },
        date: { gte: start, lt: endExclusive },
      },
      select: { id: true, projectId: true, date: true, totalHours: true, startTime: true, endTime: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const result = new Map<IsoDate, DayContext>();
  for (const iso of days) {
    const date = fromIsoDate(iso);

    // Jornada vigente ese día: la fila de mayor `validFrom` <= día, por consultor y por país.
    const own = configs.find((c) => c.consultantId === consultantId && c.validFrom.getTime() <= date.getTime()) ?? null;
    const seenCountries = new Set<string>();
    const perCountry = configs.filter((c) => {
      if (c.consultantId !== null || !c.country || c.validFrom.getTime() > date.getTime()) return false;
      if (seenCountries.has(c.country)) return false;
      seenCountries.add(c.country);
      return true;
    });
    const jornada = resolverJornada(own, consultant.country, perCountry);

    const dow = date.getUTCDay();
    const isWeekend = dow === 0 || dow === 6;
    const holiday = holidays.find(
      (h) => toIsoDate(h.date) === iso && (h.city === "" || sameText(h.city, consultant.city)),
    );

    const entries: DayEntryRow[] = rawEntries
      .filter((e) => toIsoDate(e.workDate) === iso)
      .map((e) => ({
        id: e.id,
        projectId: e.projectId,
        consultantId: e.consultantId,
        workDate: e.workDate,
        hours: Number(e.hours),
        status: e.status as TimeEntryStatus,
        startedAt: e.startedAt,
        endedAt: e.endedAt,
        isExcess: e.isExcess,
        typeId: e.typeId,
        category: e.type.category as TimeEntryCategory,
        isAbsenceProject: e.project.isAbsenceProject,
        extraHourEntryId: e.extraHourEntryId,
        createdAt: e.createdAt,
      }));

    const approvedRequests: ApprovedRequest[] = requests
      .filter((r) => toIsoDate(r.date) === iso)
      .map((r) => ({
        id: r.id,
        projectId: r.projectId!,
        totalHours: Number(r.totalHours),
        startTime: r.startTime,
        endTime: r.endTime,
        createdAt: r.createdAt,
      }));
    const approvedExtraBalance: Record<string, number> = {};
    for (const r of approvedRequests) {
      approvedExtraBalance[r.projectId] = roundHours((approvedExtraBalance[r.projectId] ?? 0) + r.totalHours);
    }

    result.set(iso, {
      date: iso,
      consultantId,
      hoursPerDay: jornada.hoursPerDay,
      jornadaOrigen: jornada.origen,
      isWeekend,
      isHoliday: !!holiday,
      holidayName: holiday?.name ?? null,
      isNonWorkingDay: isWeekend || !!holiday,
      allowWeekendWork: consultant.allowWeekendWork,
      timeZone: resolveCountryTimezone(consultant.country).timeZone,
      entries,
      approvedRequests,
      approvedExtraBalance,
    });
  }
  return result;
}

/** Contexto de un solo día (acepta una transacción). */
export async function loadDayContext(db: Db, consultantId: string, workDate: Date): Promise<DayContext> {
  const iso = toIsoDate(workDate);
  const map = await loadDaysContext(db, consultantId, iso, iso);
  return map.get(iso)!;
}

/**
 * Bloqueo de aviso (advisory lock) por consultor y día, liberado al terminar la transacción.
 * Serializa las escrituras concurrentes del mismo día: sin él, dos peticiones leen el mismo estado
 * (Read Committed), cada una pasa el tope por separado y juntas lo superan.
 */
export async function lockDay(db: Db, consultantId: string, workDate: Date): Promise<void> {
  const key = `${consultantId}:${toIsoDate(workDate)}`;
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

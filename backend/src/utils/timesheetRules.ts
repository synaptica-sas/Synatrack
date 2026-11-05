/**
 * Reglas puras del timesheet (R14, `documentacion/cambios/R14-timesheet-tipos-y-tope.md` §2).
 *
 * Sin Prisma, sin reloj del sistema, sin entorno: el llamador (rutas de time-entries, timer y
 * extra-hours, fase 3) trae la jornada (`resolverJornada`), los feriados, el saldo de horas extra
 * aprobadas y los registros del día; aquí solo se decide.
 *
 * Precisión: las horas viajan como `number` con 4 decimales, igual que la columna
 * `TimeEntry.hours` (Decimal(8,4)), `msToHours` de `modules/timer/timer.routes.ts` y
 * `roundHours` del frontend (`features/timesheet/timesheetUtils.ts`).
 *
 * Tolerancia contra el tope (`HOURS_TOLERANCE` = 0.0001 h = 0.36 s): una suma de valores de 4
 * decimales arrastra ruido de coma flotante (p. ej. 2.8 + 2.8 + 2.8 = 8.399999999999999) y cada
 * fila derivada de un cronómetro trae hasta ±0.00005 h de redondeo. La diferencia `suma - tope`
 * se redondea a 4 decimales y solo es exceso si queda POR ENCIMA de 0.0001 h. Como un segundo son
 * 0.000278 h (0.0003 tras redondear), cualquier exceso de un segundo o más se detecta siempre.
 */

import { resolveCountryTimezone } from "./country.js";

// ---------------------------------------------------------------------------
// Tipos y utilidades comunes
// ---------------------------------------------------------------------------

/** Espejo del enum `TimeEntryCategory` de Prisma (tipo propio para no depender del cliente). */
export type TimeEntryCategory = "REGULAR" | "EXTRA" | "ABSENCE";
/**
 * Espejo del enum `TimeEntryStatus` de Prisma. `SUBMITTED` (R15 §2.1): semana entregada al PM; aquí
 * se comporta como cualquier fila no PENDING (no editable, cuenta contra el tope, `fixed` en
 * `splitExcess`).
 */
export type TimeEntryStatus = "PENDING" | "SUBMITTED" | "APPROVED" | "REJECTED";

export const HOURS_TOLERANCE = 1e-4;
const MS_PER_HOUR = 3_600_000;

/** Redondeo a 4 decimales (mismo criterio que `msToHours` y `roundHours` del frontend). */
export function roundHours(hours: number): number {
  return Math.round(hours * 10_000) / 10_000;
}

/** `true` si `total` supera `cap` en más de la tolerancia (ver cabecera). */
export function exceedsCap(total: number, cap: number): boolean {
  return roundHours(total - cap) > HOURS_TOLERANCE;
}

/** Duración de una franja en horas, 4 decimales. */
export function spanHours(startedAt: Date, endedAt: Date): number {
  return roundHours((endedAt.getTime() - startedAt.getTime()) / MS_PER_HOUR);
}

/** 8.4 -> "8:24" (para mensajes). Redondea al minuto. */
export function formatHoursClock(hours: number): string {
  const totalMinutes = Math.round(hours * 60);
  const sign = totalMinutes < 0 ? "-" : "";
  const abs = Math.abs(totalMinutes);
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}`;
}

function describeHours(hours: number): string {
  return `${roundHours(hours)} h (${formatHoursClock(hours)})`;
}

// ---------------------------------------------------------------------------
// 1. validateDay
// ---------------------------------------------------------------------------

export interface DayEntryInput {
  id?: string;
  projectId: string;
  category: TimeEntryCategory;
  hours: number;
  status: TimeEntryStatus;
  startedAt?: Date | null;
  endedAt?: Date | null;
  isExcess?: boolean;
  /** El proyecto de la fila es el proyecto interno de Ausencias. */
  isAbsenceProject: boolean;
  /**
   * Fila que el usuario está proponiendo en este guardado. Por defecto `status === "PENDING"`.
   * Las filas no editables (aprobadas) solo cuentan para el tope: no se revalidan, para que un
   * registro histórico no bloquee guardar el resto del día.
   */
  editable?: boolean;
}

export interface ValidateDayInput {
  /** Jornada vigente ese día (`resolverJornada`). */
  hoursPerDay: number;
  /** Fin de semana o festivo (`Holiday` del país + ciudad del consultor). */
  isNonWorkingDay: boolean;
  /** `Consultant.allowWeekendWork`. */
  allowWeekendWork: boolean;
  /** Estado final propuesto del día en TODOS los proyectos del consultor. */
  entries: DayEntryInput[];
  /**
   * Día de calendario ("YYYY-MM-DD") y zona horaria IANA del país del consultor. Si vienen los
   * dos, el `startedAt` de toda fila editable debe caer en ese día LOCAL (solo `endedAt` puede
   * cruzar la medianoche): la nómina valora la franja real y una franja de otro día (p. ej. un
   * domingo bajo un `workDate` de martes) cambiaría el recargo.
   */
  workDate?: string;
  timeZone?: string;
  /** Σ `totalHours` de solicitudes de horas extra APROBADAS ese día, por `projectId`. */
  approvedExtraBalance: Record<string, number>;
}

export type DayErrorCode =
  | "INVALID_SCHEDULE"
  | "HOURS_NOT_POSITIVE"
  | "HOURS_OVER_24"
  | "DAILY_CAP_EXCEEDED"
  | "REGULAR_ON_NON_WORKING_DAY"
  | "ABSENCE_ON_NON_WORKING_DAY"
  | "EXTRA_WITHOUT_APPROVAL"
  | "EXTRA_REQUIRES_SPAN"
  | "EXTRA_INVALID_SPAN"
  | "SPAN_OUTSIDE_WORKDATE"
  | "EXTRA_HOURS_SPAN_MISMATCH"
  | "ABSENCE_OUTSIDE_ABSENCE_PROJECT"
  | "NON_ABSENCE_IN_ABSENCE_PROJECT";

export interface DayValidationError {
  /** Índice de la fila en `entries`; `null` si el error es del día (p. ej. jornada inválida). */
  index: number | null;
  id?: string;
  code: DayErrorCode;
  message: string;
}

function isEditable(e: DayEntryInput): boolean {
  return e.editable ?? e.status === "PENDING";
}

function countsAgainstCap(e: DayEntryInput): boolean {
  return e.status !== "REJECTED" && (e.category === "REGULAR" || e.category === "ABSENCE");
}

/**
 * Valida el estado final propuesto de UN día de un consultor (R14 §2.2, §2.3, §2.4).
 *
 * - Toda fila: horas > 0 y ≤ 24.
 * - Tope: Σ REGULAR + ABSENCE no REJECTED de todos los proyectos ≤ `hoursPerDay` (con
 *   `HOURS_TOLERANCE`). Se suman primero las filas no editables y luego las editables en el orden
 *   recibido; el error se pone en la primera fila editable que cruza el tope. Si ninguna fila
 *   editable aporta al tope, no se reporta (lo ya aprobado no bloquea editar extras).
 * - Día no laborable: REGULAR solo con `allowWeekendWork`. ABSENCE sigue la misma regla
 *   (decisión de esta fase: el doc dice "si no, solo EXTRA"; una ausencia en un día que no se
 *   trabaja no descuenta nada).
 * - EXTRA: requiere saldo aprobado > 0 en ese proyecto, `startedAt` < `endedAt`, y que `hours`
 *   coincida con la franja (±0.0001 h): la nómina paga la franja y el saldo cuenta `hours`, si
 *   difieren se pagaría algo distinto de lo que se descuenta. El exceso sobre el saldo NO es error
 *   aquí: lo resuelve `splitExcess`.
 * - ABSENCE solo en el proyecto de Ausencias y ese proyecto solo acepta ABSENCE.
 * - Las filas REJECTED no se validan ni cuentan.
 */
export function validateDay(input: ValidateDayInput): DayValidationError[] {
  const errors: DayValidationError[] = [];
  const { hoursPerDay, isNonWorkingDay, allowWeekendWork, entries, approvedExtraBalance } = input;

  if (!Number.isFinite(hoursPerDay) || hoursPerDay < 0) {
    errors.push({
      index: null,
      code: "INVALID_SCHEDULE",
      message: "No hay una jornada válida para este día; no se puede validar el tope de horas.",
    });
  }

  entries.forEach((e, index) => {
    if (e.status === "REJECTED" || !isEditable(e)) return;
    const push = (code: DayErrorCode, message: string) => errors.push({ index, id: e.id, code, message });

    if (!Number.isFinite(e.hours) || roundHours(e.hours) <= 0) {
      push("HOURS_NOT_POSITIVE", "Las horas deben ser mayores que cero.");
      return;
    }
    if (exceedsCap(e.hours, 24)) {
      push("HOURS_OVER_24", "Un registro no puede superar 24 horas.");
      return;
    }

    if (input.workDate && input.timeZone && e.startedAt) {
      const w = wallParts(e.startedAt, input.timeZone);
      if (isoOf(w) !== input.workDate) {
        push(
          "SPAN_OUTSIDE_WORKDATE",
          `La hora de inicio cae el ${isoOf(w)} (hora local) y el registro es del ${input.workDate}: la franja debe empezar el mismo día.`,
        );
      }
    }

    if (e.isAbsenceProject && e.category !== "ABSENCE") {
      push("NON_ABSENCE_IN_ABSENCE_PROJECT", "El proyecto de Ausencias solo acepta tipos de ausencia (Permiso, Vacaciones).");
    }
    if (!e.isAbsenceProject && e.category === "ABSENCE") {
      push("ABSENCE_OUTSIDE_ABSENCE_PROJECT", "Los tipos de ausencia solo se registran en el proyecto de Ausencias.");
    }

    if (isNonWorkingDay && !allowWeekendWork) {
      if (e.category === "REGULAR") {
        push(
          "REGULAR_ON_NON_WORKING_DAY",
          "Este día es fin de semana o festivo: sin autorización para trabajar esos días solo se admiten horas extra aprobadas.",
        );
      } else if (e.category === "ABSENCE") {
        push("ABSENCE_ON_NON_WORKING_DAY", "Este día es fin de semana o festivo: no se registran ausencias.");
      }
    }

    if (e.category === "EXTRA") {
      const balance = approvedExtraBalance[e.projectId] ?? 0;
      if (!(balance > 0)) {
        push(
          "EXTRA_WITHOUT_APPROVAL",
          "No hay una solicitud de horas extra aprobada para este proyecto y día.",
        );
      }
      if (!e.startedAt || !e.endedAt) {
        push("EXTRA_REQUIRES_SPAN", "Las horas extra requieren hora de inicio y de fin.");
      } else if (e.endedAt.getTime() <= e.startedAt.getTime()) {
        push("EXTRA_INVALID_SPAN", "La hora de fin debe ser posterior a la de inicio.");
      } else {
        const span = spanHours(e.startedAt, e.endedAt);
        if (Math.abs(roundHours(e.hours - span)) > HOURS_TOLERANCE) {
          push(
            "EXTRA_HOURS_SPAN_MISMATCH",
            `Las horas (${describeHours(e.hours)}) no coinciden con la franja de inicio a fin (${describeHours(span)}).`,
          );
        }
      }
    }
  });

  // Tope diario: no editables primero, luego editables en orden.
  if (Number.isFinite(hoursPerDay) && hoursPerDay >= 0) {
    let used = 0;
    entries.forEach((e) => {
      if (countsAgainstCap(e) && !isEditable(e) && Number.isFinite(e.hours)) used += e.hours;
    });
    let reported = false;
    entries.forEach((e, index) => {
      if (reported || !countsAgainstCap(e) || !isEditable(e) || !Number.isFinite(e.hours) || e.hours <= 0) return;
      used += e.hours;
      if (exceedsCap(used, hoursPerDay)) {
        reported = true;
        const total = sumCapped(entries);
        errors.push({
          index,
          id: e.id,
          code: "DAILY_CAP_EXCEEDED",
          message: `El día suma ${describeHours(total)} de horas regulares y ausencias en todos los proyectos y la jornada es de ${describeHours(hoursPerDay)}.`,
        });
      }
    });
  }

  return errors;
}

function sumCapped(entries: DayEntryInput[]): number {
  return roundHours(
    entries.reduce((acc, e) => (countsAgainstCap(e) && Number.isFinite(e.hours) && e.hours > 0 ? acc + e.hours : acc), 0),
  );
}

// ---------------------------------------------------------------------------
// 2. splitExcess
// ---------------------------------------------------------------------------

export interface ExtraRowInput {
  id?: string;
  hours: number;
  startedAt: Date | null;
  endedAt: Date | null;
  status: TimeEntryStatus;
  isExcess: boolean;
}

export interface ExtraRowPart {
  /** Posición de la fila original en la entrada. */
  sourceIndex: number;
  /** Id de la fila original. Solo lo lleva la parte que conserva el registro ("whole" o "first"). */
  id?: string;
  /** "whole": la fila no se parte; "first"/"second": mitades de una fila partida en el límite. */
  part: "whole" | "first" | "second";
  hours: number;
  startedAt: Date | null;
  endedAt: Date | null;
  isExcess: boolean;
  /** Fila no PENDING: se devuelve tal cual, no se reclasifica. */
  fixed: boolean;
}

export interface SplitExcessResult {
  /** En orden cronológico (startedAt; las filas sin franja al final). */
  rows: ExtraRowPart[];
  normalHours: number;
  excessHours: number;
  /** Saldo aprobado que queda sin usar. */
  remainingBalance: number;
  /** Horas EXTRA no excedentes ya aprobadas por encima del saldo (p. ej. si se redujo una solicitud). */
  fixedOverBalance: number;
}

function chronological<T extends { startedAt: Date | null }>(a: { row: T; i: number }, b: { row: T; i: number }) {
  const ta = a.row.startedAt?.getTime();
  const tb = b.row.startedAt?.getTime();
  if (ta === undefined && tb === undefined) return a.i - b.i;
  if (ta === undefined) return 1;
  if (tb === undefined) return -1;
  return ta - tb || a.i - b.i;
}

/**
 * Partición en el límite del saldo (R14 §2.3.4) para los registros EXTRA de UN día y UN proyecto.
 *
 * - Las filas REJECTED se ignoran (no salen).
 * - Las filas no PENDING se respetan tal cual (`fixed`). Las no excedentes consumen saldo primero,
 *   porque ya están aprobadas y no se pueden reclasificar; las excedentes aprobadas no consumen.
 * - Las PENDING se reevalúan en orden cronológico (su `isExcess` previo se ignora: si el saldo
 *   creció por una nueva aprobación, lo que era excedente pasa a normal). Consumen el saldo
 *   restante; la que lo cruza se parte: la primera parte (normal) termina en
 *   `startedAt + horas restantes del saldo` y la segunda (`isExcess`) va de ahí a `endedAt`.
 *   Las horas de la segunda son `hours - primera`, para que la suma se conserve exacta.
 * - Si la fila excede el saldo en ≤ `HOURS_TOLERANCE`, no se parte (evita retazos de 0.0001 h).
 */
export function splitExcess(extraRows: ExtraRowInput[], approvedBalance: number): SplitExcessResult {
  const balance = Number.isFinite(approvedBalance) && approvedBalance > 0 ? approvedBalance : 0;
  const live = extraRows.map((row, i) => ({ row, i })).filter(({ row }) => row.status !== "REJECTED");
  const fixed = live.filter(({ row }) => row.status !== "PENDING");
  const pending = live.filter(({ row }) => row.status === "PENDING").sort(chronological);

  const fixedNormal = fixed.reduce((acc, { row }) => (row.isExcess ? acc : acc + row.hours), 0);
  let remaining = roundHours(balance - fixedNormal);
  const fixedOverBalance = remaining < 0 ? roundHours(-remaining) : 0;
  if (remaining < 0) remaining = 0;

  const out: { part: ExtraRowPart; sortKey: { row: { startedAt: Date | null }; i: number } }[] = [];

  for (const { row, i } of fixed) {
    out.push({
      part: { sourceIndex: i, id: row.id, part: "whole", hours: row.hours, startedAt: row.startedAt, endedAt: row.endedAt, isExcess: row.isExcess, fixed: true },
      sortKey: { row, i },
    });
  }

  for (const { row, i } of pending) {
    const base = { sourceIndex: i, startedAt: row.startedAt, endedAt: row.endedAt, fixed: false };
    if (remaining <= HOURS_TOLERANCE) {
      out.push({ part: { ...base, id: row.id, part: "whole", hours: row.hours, isExcess: true }, sortKey: { row, i } });
      continue;
    }
    if (!exceedsCap(row.hours, remaining)) {
      remaining = roundHours(Math.max(0, remaining - row.hours));
      out.push({ part: { ...base, id: row.id, part: "whole", hours: row.hours, isExcess: false }, sortKey: { row, i } });
      continue;
    }
    // Cruza el límite: partir.
    const firstHours = roundHours(remaining);
    const secondHours = roundHours(row.hours - firstHours);
    const cut = row.startedAt ? new Date(row.startedAt.getTime() + Math.round(firstHours * MS_PER_HOUR)) : null;
    out.push({
      part: { ...base, id: row.id, part: "first", hours: firstHours, endedAt: cut ?? row.endedAt, isExcess: false },
      sortKey: { row, i },
    });
    out.push({
      part: { ...base, part: "second", hours: secondHours, startedAt: cut ?? row.startedAt, isExcess: true },
      sortKey: { row: { startedAt: cut ?? row.startedAt }, i },
    });
    remaining = 0;
  }

  out.sort((a, b) => chronological(a.sortKey, b.sortKey) || (a.part.part === "second" ? 1 : b.part.part === "second" ? -1 : 0));
  const rows = out.map((o) => o.part);
  return {
    rows,
    normalHours: roundHours(rows.filter((r) => !r.isExcess).reduce((a, r) => a + r.hours, 0)),
    excessHours: roundHours(rows.filter((r) => r.isExcess).reduce((a, r) => a + r.hours, 0)),
    remainingBalance: roundHours(remaining),
    fixedOverBalance,
  };
}

// ---------------------------------------------------------------------------
// 3. splitTimerSpan
// ---------------------------------------------------------------------------

export interface TimerSpanInput {
  start: Date;
  end: Date;
  /** Jornada vigente del día al que se imputa el cronómetro. */
  hoursPerDay: number;
  /** REGULAR + ABSENCE no REJECTED ya registradas ese día en todos los proyectos. */
  alreadyUsedRegular: number;
  /** `false` en fin de semana/festivo sin `allowWeekendWork`: no hay tramo REGULAR. */
  regularAllowed: boolean;
}

export interface TimerSegment {
  /** El cronómetro solo registra horas regulares (decisión 2026-11-05). */
  category: "REGULAR";
  isExcess: false;
  startedAt: Date;
  endedAt: Date;
  hours: number;
}

export interface TimerSplitResult {
  /** A lo sumo un tramo REGULAR; solo lo que se guarda. */
  segments: TimerSegment[];
  /** Horas que no se guardan (pasan del tope de la jornada o el día no admite regulares). */
  discardedHours: number;
  /** Desde qué instante se descartó (null si no se descartó nada). */
  discardedFrom: Date | null;
  /** Hasta qué instante llega lo descartado: el fin de la franja (null si no se descartó nada). */
  discardedTo: Date | null;
  totalHours: number;
}

/** Cupo en ms truncado al segundo: nunca deja un tramo por encima de su cupo. */
function capToMs(capHours: number): number {
  if (!(capHours > 0)) return 0;
  return Math.floor(capHours * 3600 + 1e-6) * 1000;
}

/**
 * Corte del cronómetro al detenerse (R14 §2.5, simplificado el 2026-11-05): solo se registra
 * REGULAR hasta completar la jornada (descontando lo ya registrado ese día). TODO lo que sobre se
 * descarta, haya o no solicitud de horas extra aprobada: el cronómetro no crea EXTRA ni excedentes;
 * si eran horas extra, el consultor las registra a mano en el timesheet.
 *
 * El corte se trunca al segundo entero (el tramo nunca supera su cupo). Un tramo que redondea a
 * 0 h (< 0.18 s) no se guarda. El día de imputación lo decide el llamador; esta función no parte
 * por día.
 */
export function splitTimerSpan(input: TimerSpanInput): TimerSplitResult {
  const startMs = input.start.getTime();
  const endMs = input.end.getTime();
  const totalMs = Math.max(0, endMs - startMs);

  const regularCap = input.regularAllowed ? Math.max(0, input.hoursPerDay - input.alreadyUsedRegular) : 0;
  const regularMs = Math.min(totalMs, capToMs(regularCap));
  const discardedMs = totalMs - regularMs;

  const segments: TimerSegment[] = [];
  const hours = roundHours(regularMs / MS_PER_HOUR);
  if (regularMs > 0 && hours > 0) {
    segments.push({
      category: "REGULAR",
      isExcess: false,
      startedAt: new Date(startMs),
      endedAt: new Date(startMs + regularMs),
      hours,
    });
  }

  return {
    segments,
    discardedHours: roundHours(discardedMs / MS_PER_HOUR),
    discardedFrom: discardedMs > 0 ? new Date(startMs + regularMs) : null,
    discardedTo: discardedMs > 0 ? new Date(endMs) : null,
    totalHours: roundHours(totalMs / MS_PER_HOUR),
  };
}

// ---------------------------------------------------------------------------
// 4. summarizeDay
// ---------------------------------------------------------------------------

export interface ProjectExtraSummary {
  projectId: string;
  /** Saldo aprobado (Σ solicitudes aprobadas). */
  extraApproved: number;
  /** EXTRA no excedentes no REJECTED. */
  extraUsed: number;
  /** EXTRA excedentes no REJECTED (pendientes o aprobados por el PM). */
  extraExcess: number;
  /** max(0, aprobado - usado). */
  extraRemaining: number;
}

export interface DaySummary {
  hoursPerDay: number;
  isNonWorkingDay: boolean;
  /** Se admiten horas REGULAR/ABSENCE este día. */
  regularAllowed: boolean;
  usedRegular: number;
  usedAbsence: number;
  /** usedRegular + usedAbsence: lo que cuenta contra la jornada. */
  usedAgainstCap: number;
  /** max(0, jornada - usado); 0 si el día no admite regulares. */
  remaining: number;
  /** Cuánto se pasa del tope (0 si no). Solo puede ser > 0 con datos históricos. */
  overBy: number;
  projects: ProjectExtraSummary[];
}

/**
 * Resumen del día para el pie de la tabla del modal y la celda del grid (R14 §3 day-summary, §4).
 * Mismas reglas de conteo que `validateDay` (REJECTED no cuenta). Incluye todo proyecto con saldo
 * aprobado o con registros EXTRA, ordenados por `projectId`.
 */
export function summarizeDay(input: ValidateDayInput): DaySummary {
  let usedRegular = 0;
  let usedAbsence = 0;
  const perProject = new Map<string, { used: number; excess: number }>();
  for (const e of input.entries) {
    if (e.status === "REJECTED" || !Number.isFinite(e.hours) || e.hours <= 0) continue;
    if (e.category === "REGULAR") usedRegular += e.hours;
    else if (e.category === "ABSENCE") usedAbsence += e.hours;
    else {
      const p = perProject.get(e.projectId) ?? { used: 0, excess: 0 };
      if (e.isExcess) p.excess += e.hours;
      else p.used += e.hours;
      perProject.set(e.projectId, p);
    }
  }
  for (const [projectId, balance] of Object.entries(input.approvedExtraBalance)) {
    if (balance > 0 && !perProject.has(projectId)) perProject.set(projectId, { used: 0, excess: 0 });
  }

  const regularAllowed = !input.isNonWorkingDay || input.allowWeekendWork;
  const hoursPerDay = Number.isFinite(input.hoursPerDay) ? input.hoursPerDay : 0;
  const usedAgainstCap = roundHours(usedRegular + usedAbsence);
  const projects = [...perProject.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([projectId, p]) => {
      const approved = roundHours(Math.max(0, input.approvedExtraBalance[projectId] ?? 0));
      const used = roundHours(p.used);
      return {
        projectId,
        extraApproved: approved,
        extraUsed: used,
        extraExcess: roundHours(p.excess),
        extraRemaining: roundHours(Math.max(0, approved - used)),
      };
    });

  return {
    hoursPerDay,
    isNonWorkingDay: input.isNonWorkingDay,
    regularAllowed,
    usedRegular: roundHours(usedRegular),
    usedAbsence: roundHours(usedAbsence),
    usedAgainstCap,
    remaining: regularAllowed ? roundHours(Math.max(0, hoursPerDay - usedAgainstCap)) : 0,
    overBy: exceedsCap(usedAgainstCap, hoursPerDay) ? roundHours(usedAgainstCap - hoursPerDay) : 0,
    projects,
  };
}

// ---------------------------------------------------------------------------
// 5. Franja real UTC -> hora local del país (entrada de calculateExtraHours)
// ---------------------------------------------------------------------------

export interface LocalShiftSegment {
  /** Medianoche UTC del día LOCAL (es lo que `calculateExtraHours` espera en `date`). */
  date: Date;
  isoDate: string;
  /** "HH:MM:SS" hora local de inicio. */
  startTime: string;
  /** "HH:MM:SS" hora local de fin; "00:00:00" si termina a medianoche local. */
  endTime: string;
  /** Duración real (reloj absoluto). */
  realHours: number;
  /** Duración de reloj de pared, que es lo que `calculateExtraHours` paga. */
  wallClockHours: number;
}

export interface LocalShiftResult {
  country: string;
  timeZone: string;
  segments: LocalShiftSegment[];
  warnings: string[];
}

interface WallParts { y: number; m: number; d: number; hh: number; mi: number; ss: number }

const formatterCache = new Map<string, Intl.DateTimeFormat>();
function wallParts(instant: Date, timeZone: string): WallParts {
  let fmt = formatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatterCache.set(timeZone, fmt);
  }
  const p: Record<string, number> = {};
  for (const part of fmt.formatToParts(instant)) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  return { y: p.year, m: p.month, d: p.day, hh: p.hour === 24 ? 0 : p.hour, mi: p.minute, ss: p.second };
}

/** Reloj de pared expresado como si fuera UTC (ms). */
function wallAsUtcMs(w: WallParts): number {
  return Date.UTC(w.y, w.m - 1, w.d, w.hh, w.mi, w.ss);
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const clock = (w: WallParts) => `${pad2(w.hh)}:${pad2(w.mi)}:${pad2(w.ss)}`;
const isoOf = (w: WallParts) => `${w.y}-${pad2(w.m)}-${pad2(w.d)}`;

/** Primer instante UTC cuyo día local es el siguiente a `w` (medianoche local o, en un hueco DST, lo primero que exista). */
function nextLocalMidnight(instant: Date, timeZone: string): Date {
  const w = wallParts(instant, timeZone);
  const targetWall = Date.UTC(w.y, w.m - 1, w.d + 1, 0, 0, 0);
  let guess = targetWall - (wallAsUtcMs(w) - instant.getTime());
  for (let k = 0; k < 3; k++) {
    const g = wallParts(new Date(guess), timeZone);
    const diff = targetWall - wallAsUtcMs(g);
    if (diff === 0) break;
    guess += diff;
  }
  // En un hueco DST (la medianoche no existe) el ajuste puede quedar en el día anterior: avanzar.
  while (wallAsUtcMs(wallParts(new Date(guess), timeZone)) < targetWall) guess += 60_000;
  return new Date(guess);
}

function makeSegment(from: Date, to: Date, timeZone: string, endsAtMidnight: boolean): LocalShiftSegment {
  const ws = wallParts(from, timeZone);
  const we = wallParts(to, timeZone);
  const wallMs = endsAtMidnight
    ? Date.UTC(ws.y, ws.m - 1, ws.d + 1) - wallAsUtcMs(ws)
    : wallAsUtcMs(we) - wallAsUtcMs(ws);
  return {
    date: new Date(Date.UTC(ws.y, ws.m - 1, ws.d)),
    isoDate: isoOf(ws),
    startTime: clock(ws),
    endTime: endsAtMidnight ? "00:00:00" : clock(we),
    realHours: roundHours((to.getTime() - from.getTime()) / MS_PER_HOUR),
    wallClockHours: roundHours(wallMs / MS_PER_HOUR),
  };
}

/**
 * Convierte la franja real (`startedAt`/`endedAt`, instantes UTC) de un `TimeEntry` EXTRA a la
 * fecha local + "HH:MM:SS" del país del consultor, que es como `calculateExtraHours` recibe la
 * franja (trabaja sobre la hora de pared escrita como UTC). Zona horaria: `COUNTRY_TIMEZONES` de
 * `country.ts`, la misma tabla de `extra-hours.routes.ts`; país vacío o no soportado -> Default
 * (Bogotá) con advertencia.
 *
 * Medianoche local:
 * - Por defecto NO se parte: un solo tramo con `date` = día local de inicio y `endTime` < `startTime`.
 *   `calculateExtraHours` ya interpreta eso como "termina al día siguiente" y evalúa festivo y
 *   franja diurna/nocturna minuto a minuto, así que el recargo del día siguiente se aplica igual.
 *   Es exactamente como se presupuesta la solicitud, por lo que "aprobado vs. real" es comparable.
 * - `splitAtLocalMidnight: true` parte en un tramo por día local. OJO: cambia montos en Perú (los
 *   primeros 120 min a 1.25x se cuentan por llamada) y México (el acumulado semanal se lee de BD y
 *   no ve el tramo anterior aún no guardado). Solo usarlo si negocio lo decide.
 * - Una franja de 24 h o más no cabe en un par inicio/fin: se parte siempre y se advierte.
 *
 * Cambios de horario (DST, p. ej. Chile): si la duración de reloj difiere de la real se advierte,
 * porque `calculateExtraHours` paga horas de reloj.
 */
export function toLocalExtraShift(params: {
  startedAt: Date;
  endedAt: Date;
  country: string | null | undefined;
  splitAtLocalMidnight?: boolean;
}): LocalShiftResult {
  const { startedAt, endedAt } = params;
  const { country, timeZone, warning } = resolveCountryTimezone(params.country);
  const warnings: string[] = warning ? [warning] : [];

  if (!(endedAt.getTime() > startedAt.getTime())) {
    warnings.push("La franja no es válida (el fin no es posterior al inicio): no se puede calcular el recargo.");
    return { country, timeZone, segments: [], warnings };
  }

  const realMs = endedAt.getTime() - startedAt.getTime();
  let split = params.splitAtLocalMidnight === true;
  if (realMs >= 24 * MS_PER_HOUR && !split) {
    split = true;
    warnings.push("La franja dura 24 horas o más: se partió por día local para poder calcular el recargo.");
  }

  const segments: LocalShiftSegment[] = [];
  if (!split) {
    segments.push(makeSegment(startedAt, endedAt, timeZone, false));
  } else {
    let from = startedAt;
    while (from.getTime() < endedAt.getTime()) {
      const midnight = nextLocalMidnight(from, timeZone);
      if (midnight.getTime() >= endedAt.getTime()) {
        segments.push(makeSegment(from, endedAt, timeZone, false));
        break;
      }
      segments.push(makeSegment(from, midnight, timeZone, true));
      from = midnight;
    }
  }

  // Fin exactamente a medianoche local sin partir: makeSegment ya da "00:00:00" (reloj de pared).
  const wallTotal = roundHours(segments.reduce((a, s) => a + s.wallClockHours, 0));
  const realTotal = roundHours(realMs / MS_PER_HOUR);
  if (Math.abs(roundHours(wallTotal - realTotal)) > HOURS_TOLERANCE) {
    warnings.push(
      `La franja cruza un cambio de horario en ${timeZone}: duran ${describeHours(realTotal)} reales y ${describeHours(wallTotal)} de reloj; el recargo se calcula sobre las de reloj.`,
    );
  }

  return { country, timeZone, segments, warnings };
}

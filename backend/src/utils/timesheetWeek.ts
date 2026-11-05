/**
 * Reglas puras de la aprobación semanal del timesheet (R15,
 * `documentacion/cambios/R15-aprobacion-semanal-timesheet.md` §2 y §3).
 *
 * Sin Prisma, sin reloj del sistema, sin entorno: el llamador (rutas de envío/revisión, fase 3)
 * trae la jornada por día (`crearJornadaPorDia`), los festivos del consultor (`Holiday` país +
 * ciudad), las fechas de ingreso/retiro, los registros, las revisiones y las delegaciones, y la
 * fecha de HOY en el calendario local del consultor. Aquí solo se decide.
 *
 * Fechas: todas son fechas de calendario `IsoDate` ("YYYY-MM-DD"), sin hora ni zona
 * (`utils/isoDate.ts`). Las que llegan como `Date` se leen en UTC (`toIsoDate`), que es como Prisma
 * entrega `@db.Date` y como `z.coerce.date()` guarda "YYYY-MM-DD".
 *
 * Horas: mismas reglas de precisión y tolerancia que R14 (`roundHours`, `exceedsCap`,
 * `HOURS_TOLERANCE` = 0.0001 h de `timesheetRules.ts`).
 */

import {
  addDaysIso,
  isoToDayNumber,
  isValidIsoDate,
  fromIsoDate,
  toIsoDate,
  weekdayOfDayNumber,
  type IsoDate,
} from "./isoDate.js";
import {
  exceedsCap,
  formatHoursClock,
  roundHours,
  type TimeEntryCategory,
  type TimeEntryStatus,
} from "./timesheetRules.js";

// ---------------------------------------------------------------------------
// Tipos comunes
// ---------------------------------------------------------------------------

/** Espejo del enum `TimesheetReviewStatus` de Prisma (fase 1 de R15). */
export type WeekReviewStatus = "SUBMITTED" | "APPROVED" | "RETURNED";

/**
 * Jornada por día. Lo natural es pasar la función de `crearJornadaPorDia` (recibe la medianoche
 * UTC del día); también vale un mapa `IsoDate -> horas`. Un día laborable sin jornada en el mapa,
 * o con un valor no finito o negativo, NO se completa con un valor por defecto: es un error
 * `NO_SCHEDULE` (si no se puede calcular, se dice).
 */
export type WeekJornada = ((dia: Date) => { hoursPerDay: number }) | Readonly<Record<IsoDate, number>>;

/** Fecha de calendario como texto o como `Date` (se lee en UTC). */
export type CalendarDateInput = IsoDate | Date;

function toIso(value: CalendarDateInput): IsoDate {
  if (value instanceof Date) return toIsoDate(value);
  if (!isValidIsoDate(value)) throw new Error(`Fecha inválida: "${value}" (se espera YYYY-MM-DD)`);
  return value;
}

/** Horas de la jornada de un día, o `null` si no hay una jornada válida. */
function jornadaOf(jornada: WeekJornada, day: IsoDate): number | null {
  const value = typeof jornada === "function" ? jornada(fromIsoDate(day))?.hoursPerDay : jornada[day];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function normEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

function liveHours(hours: number): number {
  return Number.isFinite(hours) && hours > 0 ? hours : 0;
}

// ---------------------------------------------------------------------------
// 1. Semana
// ---------------------------------------------------------------------------

/**
 * Lunes de la semana (lunes a domingo, R15 §2.2) a la que pertenece una fecha de calendario.
 * Aritmética de número de día UTC: no depende de la zona del servidor.
 */
export function weekStartOf(date: CalendarDateInput): IsoDate {
  const iso = toIso(date);
  const dayNumber = isoToDayNumber(iso);
  const offset = (weekdayOfDayNumber(dayNumber) + 6) % 7; // lunes = 0 … domingo = 6
  return addDaysIso(iso, -offset);
}

/** Las 7 fechas (lunes … domingo) de la semana que empieza en `weekStart`. Lanza si no es lunes. */
export function weekDays(weekStart: CalendarDateInput): IsoDate[] {
  const start = toIso(weekStart);
  if (weekStartOf(start) !== start) throw new Error(`La semana debe empezar en lunes: "${start}" no lo es.`);
  return Array.from({ length: 7 }, (_, i) => addDaysIso(start, i));
}

const DAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MONTH_NAMES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** "2026-11-02" -> "lunes 2 de noviembre de 2026". */
export function formatDateLong(date: CalendarDateInput): string {
  const iso = toIso(date);
  const dow = weekdayOfDayNumber(isoToDayNumber(iso));
  return `${DAY_NAMES[dow]} ${Number(iso.slice(8, 10))} de ${MONTH_NAMES[Number(iso.slice(5, 7)) - 1]} de ${iso.slice(0, 4)}`;
}

/**
 * Horas faltantes en "H:MM", redondeando al minuto pero nunca a "0:00": lo que falta supera la
 * tolerancia (0.36 s) y decir "faltan 0:00" sería contradictorio; se muestra como "0:01".
 */
function formatMissing(hours: number): string {
  const minutes = Math.max(1, Math.round(hours * 60));
  return formatHoursClock(minutes / 60);
}

// ---------------------------------------------------------------------------
// 2. validateWeekSubmission (R15 §2.3)
// ---------------------------------------------------------------------------

export interface WeekEntryInput {
  id?: string;
  projectId: string;
  workDate: CalendarDateInput;
  category: TimeEntryCategory;
  hours: number;
  status: TimeEntryStatus;
}

export interface ProjectReviewState {
  projectId: string;
  status: WeekReviewStatus;
}

export interface ValidateWeekSubmissionInput {
  weekStart: CalendarDateInput;
  /** HOY en el calendario local del consultor (zona de su país), no del servidor. */
  today: CalendarDateInput;
  jornada: WeekJornada;
  /** Festivos del consultor (`Holiday` de su país + ciudad), como "YYYY-MM-DD". */
  holidays: ReadonlySet<IsoDate>;
  hireDate?: CalendarDateInput | null;
  exitDate?: CalendarDateInput | null;
  /** Registros del consultor en la semana, todos los proyectos (incluido Ausencias). */
  entries: readonly WeekEntryInput[];
  /** `TimesheetWeekReview` existentes del consultor en esa semana. Proyecto sin fila = sin revisión. */
  reviews: readonly ProjectReviewState[];
}

export type WeekSubmissionErrorCode =
  | "INCOMPLETE_DAY"
  | "WEEK_IN_PROGRESS"
  | "NO_SCHEDULE"
  | "NOTHING_TO_SUBMIT"
  | "INCONSISTENT_REVIEW_STATE";

export interface WeekSubmissionError {
  code: WeekSubmissionErrorCode;
  message: string;
  date?: IsoDate;
  missingHours?: number;
  projectId?: string;
}

export type NonWorkingReason = "WEEKEND" | "HOLIDAY" | "BEFORE_HIRE" | "AFTER_EXIT";

export interface WeekDayCheck {
  date: IsoDate;
  isWorkday: boolean;
  /** Por qué no es laborable (solo si `isWorkday` es `false`). */
  nonWorkingReason?: NonWorkingReason;
  /** Jornada exigida; 0 en días no laborables, `null` si es laborable y no hay jornada. */
  required: number | null;
  /** REGULAR + ABSENCE no REJECTED de todos los proyectos. */
  covered: number;
  /** max(0, required - covered); 0 si no se pudo calcular. */
  missing: number;
  complete: boolean;
}

export interface WeekSubmissionResult {
  ok: boolean;
  errors: WeekSubmissionError[];
  /** Proyectos cuyo registros pasan a SUBMITTED: con PENDING y revisión ausente o RETURNED. */
  projectsToSubmit: string[];
  /**
   * Proyectos con revisión RETURNED que ya no tienen registros PENDING (el consultor borró todo lo
   * devuelto). No hay registros que enviar, pero la revisión devuelta debe cerrarse al enviar (la
   * fase 3 decide cómo: borrarla). Cuentan como "algo que enviar" para NOTHING_TO_SUBMIT.
   */
  returnedWithoutEntries: string[];
  days: WeekDayCheck[];
}

function countsForDay(e: { category: TimeEntryCategory; status: TimeEntryStatus }): boolean {
  return e.status !== "REJECTED" && (e.category === "REGULAR" || e.category === "ABSENCE");
}

/**
 * Validación bloqueante del envío de una semana (R15 §2.3). Aplica igual si envía ADMIN en nombre
 * del consultor.
 *
 * - Día laborable = lunes a viernes, no festivo, dentro de `[hireDate, exitDate]` (ambos
 *   incluidos). Se usa lunes a viernes aunque la jornada diga `workDaysPerWeek ≥ 6`: es lo que fija
 *   el contrato; el sábado nunca se exige.
 * - Cada día laborable: Σ REGULAR + ABSENCE no REJECTED (en cualquier estado y proyecto) ≥ jornada
 *   del día, con la tolerancia de R14 (`exceedsCap(jornada, cubierto)`). Las horas EXTRA no
 *   completan la jornada. Cada día incompleto es un error `INCOMPLETE_DAY` con lo que falta.
 * - Semana en curso: si `today` < último día laborable y algún laborable ≥ `today` está incompleto,
 *   se añade `WEEK_IN_PROGRESS` (además de los `INCOMPLETE_DAY`). El último día laborable mismo ya
 *   se puede enviar si está completo.
 * - Proyectos a enviar: los que tienen registros PENDING y su revisión es ausente o RETURNED.
 *   Un proyecto con revisión SUBMITTED/APPROVED nunca debería tener PENDING, ni uno sin revisión
 *   SUBMITTED tener registros SUBMITTED: cualquiera de los dos es `INCONSISTENT_REVIEW_STATE`.
 *   Los APPROVED sin revisión (aprobados antes de R15) son válidos y no se reenvían.
 * - Si no queda nada que enviar: `NOTHING_TO_SUBMIT`.
 * - Registros con `workDate` fuera de la semana se ignoran (el llamador filtra por semana).
 */
export function validateWeekSubmission(input: ValidateWeekSubmissionInput): WeekSubmissionResult {
  const days7 = weekDays(input.weekStart);
  const today = toIso(input.today);
  const hire = input.hireDate ? toIso(input.hireDate) : null;
  const exit = input.exitDate ? toIso(input.exitDate) : null;
  const inWeek = new Set(days7);
  const entries = input.entries
    .map((e) => ({ ...e, date: toIso(e.workDate) }))
    .filter((e) => inWeek.has(e.date));

  const errors: WeekSubmissionError[] = [];
  const dayErrors: WeekSubmissionError[] = [];

  const days: WeekDayCheck[] = days7.map((date) => {
    let reason: NonWorkingReason | undefined;
    const dow = weekdayOfDayNumber(isoToDayNumber(date));
    if (dow === 0 || dow === 6) reason = "WEEKEND";
    else if (input.holidays.has(date)) reason = "HOLIDAY";
    else if (hire && date < hire) reason = "BEFORE_HIRE";
    else if (exit && date > exit) reason = "AFTER_EXIT";

    const covered = roundHours(
      entries.reduce((acc, e) => (e.date === date && countsForDay(e) ? acc + liveHours(e.hours) : acc), 0),
    );
    if (reason) return { date, isWorkday: false, nonWorkingReason: reason, required: 0, covered, missing: 0, complete: true };

    const required = jornadaOf(input.jornada, date);
    if (required === null) {
      dayErrors.push({
        code: "NO_SCHEDULE",
        date,
        message: `No hay una jornada válida configurada para el ${formatDateLong(date)}: no se puede validar la semana.`,
      });
      return { date, isWorkday: true, required: null, covered, missing: 0, complete: false };
    }
    const complete = !exceedsCap(required, covered);
    const missing = complete ? 0 : roundHours(required - covered);
    if (!complete) {
      dayErrors.push({
        code: "INCOMPLETE_DAY",
        date,
        missingHours: missing,
        message: `El ${formatDateLong(date)} suma ${formatHoursClock(covered)} de ${formatHoursClock(required)}: faltan ${formatMissing(missing)}.`,
      });
    }
    return { date, isWorkday: true, required, covered, missing, complete };
  });

  const workdays = days.filter((d) => d.isWorkday);
  const lastWorkday = workdays.length ? workdays[workdays.length - 1].date : null;
  if (lastWorkday && today < lastWorkday) {
    const pendingFuture = workdays.filter((d) => d.date >= today && !d.complete);
    if (pendingFuture.length) {
      errors.push({
        code: "WEEK_IN_PROGRESS",
        date: pendingFuture[0].date,
        message: `La semana está en curso: no se puede enviar hasta que transcurra el ${formatDateLong(lastWorkday)} o estén completos todos los días (${pendingFuture.map((d) => formatDateLong(d.date)).join(", ")}).`,
      });
    }
  }
  errors.push(...dayErrors);

  // Proyectos
  const reviewByProject = new Map(input.reviews.map((r) => [r.projectId, r.status]));
  const projectIds = [...new Set(entries.map((e) => e.projectId))].sort();
  const projectsToSubmit: string[] = [];
  for (const projectId of projectIds) {
    const own = entries.filter((e) => e.projectId === projectId);
    const review = reviewByProject.get(projectId);
    const hasPending = own.some((e) => e.status === "PENDING");
    const hasSubmitted = own.some((e) => e.status === "SUBMITTED");
    if (hasPending && (review === "SUBMITTED" || review === "APPROVED")) {
      errors.push({
        code: "INCONSISTENT_REVIEW_STATE",
        projectId,
        message: `El proyecto ${projectId} tiene registros pendientes aunque su semana figura como ${review === "SUBMITTED" ? "enviada" : "aprobada"}. Hay que revisar los datos antes de enviar.`,
      });
      continue;
    }
    if (hasSubmitted && review !== "SUBMITTED") {
      errors.push({
        code: "INCONSISTENT_REVIEW_STATE",
        projectId,
        message: `El proyecto ${projectId} tiene registros enviados sin una revisión enviada para la semana. Hay que revisar los datos antes de enviar.`,
      });
      continue;
    }
    if (hasPending) projectsToSubmit.push(projectId);
  }
  const withEntries = new Set(entries.filter((e) => e.status === "PENDING").map((e) => e.projectId));
  const returnedWithoutEntries = input.reviews
    .filter((r) => r.status === "RETURNED" && !withEntries.has(r.projectId))
    .map((r) => r.projectId)
    .sort();

  if (projectsToSubmit.length === 0 && returnedWithoutEntries.length === 0) {
    errors.push({
      code: "NOTHING_TO_SUBMIT",
      message: "No hay nada que enviar en esta semana: todos los proyectos ya están enviados o aprobados, o no hay registros pendientes.",
    });
  }

  return { ok: errors.length === 0, errors, projectsToSubmit, returnedWithoutEntries, days };
}

// ---------------------------------------------------------------------------
// 3. resolveReviewer (R15 §2.4)
// ---------------------------------------------------------------------------

export interface DelegationInput {
  fromUserEmail: string;
  toUserEmail: string;
  startDate: CalendarDateInput;
  endDate: CalendarDateInput;
}

export interface ResolveReviewerInput {
  projectManagerEmail?: string | null;
  /** Email del consultor dueño de las horas (`Consultant.email`). */
  consultantEmail: string | null | undefined;
  /** Delegaciones del proyecto (todas o solo las vigentes: aquí se filtra por fecha). */
  delegations: readonly DelegationInput[];
  weekStart: CalendarDateInput;
  actor: { email: string; roles: readonly string[] };
  /**
   * Identidad resuelta por el llamador (por id, no por correo): el actor ES el consultor dueño de las
   * horas (misma ficha, `Consultant.userId` o `authUser.consultantId`). El correo de la ficha puede
   * estar vacío o desactualizado, así que esta señal tiene prioridad; la comparación de correos queda
   * como respaldo (se aplica además, nunca en lugar de).
   */
  actorIsConsultant?: boolean;
  /** El PM del proyecto ES el consultor dueño (por el usuario enlazado a su ficha). Respaldo: correos. */
  projectManagerIsConsultant?: boolean;
}

export type ReviewerReason =
  | "PROJECT_MANAGER"
  | "DELEGATE"
  | "ADMIN_FALLBACK"
  | "SELF_REVIEW"
  | "NOT_REVIEWER";

export interface ResolveReviewerResult {
  canReview: boolean;
  reason: ReviewerReason;
  /** Quién revisa esta unidad: el PM (o su delegado) o ADMIN (sin PM o PM = consultor). */
  reviewerKind: "PROJECT_MANAGER" | "ADMIN";
  message: string;
}

/**
 * ¿Puede `actor` aprobar/devolver la semana de este consultor en este proyecto? (R15 §2.4)
 *
 * 1. Nunca el propio consultor (emails comparados sin mayúsculas ni espacios), sea cual sea su rol.
 * 2. Si el proyecto tiene PM y no es el consultor: revisa el PM o un delegado suyo
 *    (`fromUserEmail` = PM, `toUserEmail` = actor) cuya vigencia se solape con la semana. ADMIN
 *    NO revisa en ese caso (no es un comodín).
 * 3. Si no hay PM o el PM es el propio consultor: revisa solo ADMIN. Las delegaciones no aplican
 *    (el contrato fija ADMIN; un delegado del PM-consultor sería revisión por encargo propio).
 *
 * "Semana dentro del rango de la delegación": basta con que ALGÚN día de la semana (lunes a
 * domingo) caiga en `[startDate, endDate]`, ambos incluidos. La revisión es por semana entera; una
 * delegación que cubre solo el jueves y viernes habilita al delegado para toda esa semana. Las
 * fechas `Date` se leen en UTC (`ApprovalDelegation` guarda medianoche UTC). Una delegación con
 * `endDate < startDate` no cubre nada.
 */
export function resolveReviewer(input: ResolveReviewerInput): ResolveReviewerResult {
  const actor = normEmail(input.actor.email);
  const consultant = normEmail(input.consultantEmail);
  const pm = normEmail(input.projectManagerEmail);
  const isAdmin = input.actor.roles.some((r) => r.trim().toUpperCase() === "ADMIN");
  const adminReviews = !pm || input.projectManagerIsConsultant === true || (!!consultant && pm === consultant);
  const reviewerKind = adminReviews ? "ADMIN" : "PROJECT_MANAGER";

  if (input.actorIsConsultant === true || (actor && consultant && actor === consultant)) {
    return { canReview: false, reason: "SELF_REVIEW", reviewerKind, message: "Nadie puede revisar sus propias horas." };
  }

  if (adminReviews) {
    if (isAdmin) {
      return {
        canReview: true,
        reason: "ADMIN_FALLBACK",
        reviewerKind,
        message: pm ? "El PM del proyecto es el propio consultor: revisa un administrador." : "El proyecto no tiene PM: revisa un administrador.",
      };
    }
    return {
      canReview: false,
      reason: "NOT_REVIEWER",
      reviewerKind,
      message: pm ? "El PM del proyecto es el propio consultor: solo un administrador puede revisar estas horas." : "El proyecto no tiene PM: solo un administrador puede revisar estas horas.",
    };
  }

  if (actor && actor === pm) {
    return { canReview: true, reason: "PROJECT_MANAGER", reviewerKind, message: "Eres el PM del proyecto." };
  }

  const weekFrom = weekStartOf(input.weekStart);
  const weekTo = addDaysIso(weekFrom, 6);
  const delegated = input.delegations.some((d) => {
    if (normEmail(d.fromUserEmail) !== pm || normEmail(d.toUserEmail) !== actor || !actor) return false;
    const from = toIso(d.startDate);
    const to = toIso(d.endDate);
    return from <= to && from <= weekTo && to >= weekFrom;
  });
  if (delegated) {
    return { canReview: true, reason: "DELEGATE", reviewerKind, message: "Tienes una delegación vigente del PM del proyecto para esta semana." };
  }
  return {
    canReview: false,
    reason: "NOT_REVIEWER",
    reviewerKind,
    message: "Solo el PM del proyecto o su delegado vigente pueden revisar estas horas.",
  };
}

// ---------------------------------------------------------------------------
// 4. buildReviewRows (R15 §3)
// ---------------------------------------------------------------------------

/** Novedades por celda/fila. El orden de este arreglo es el de salida. */
export const REVIEW_FLAGS = ["EXTRA", "EXCESS", "ABSENCE", "NON_WORKING_DAY", "OVER_JORNADA"] as const;
export type ReviewFlag = (typeof REVIEW_FLAGS)[number];

export interface ReviewEntryInput {
  id?: string;
  consultantId: string;
  projectId: string;
  workDate: CalendarDateInput;
  category: TimeEntryCategory;
  hours: number;
  status: TimeEntryStatus;
  isExcess?: boolean;
}

export interface ConsultantReviewContext {
  jornada: WeekJornada;
  holidays: ReadonlySet<IsoDate>;
  /**
   * Σ horas del consultor por día en TODOS sus proyectos (todas las categorías, sin REJECTED),
   * incluidos los que el revisor no ve. Se usa para `OVER_JORNADA`; si falta un día o es menor que
   * lo que suman los registros recibidos, se usa esa suma (nunca se subestima lo visible).
   */
  dailyTotals: Readonly<Record<IsoDate, number>>;
}

export interface ReviewRowsInput<T extends ReviewEntryInput> {
  entries: readonly T[];
  /** `TimesheetWeekReview` de las filas. Una revisión sin registros también genera fila (vacía). */
  reviews?: readonly { consultantId: string; projectId: string; weekStart: CalendarDateInput; status: WeekReviewStatus }[];
  consultants: Readonly<Record<string, ConsultantReviewContext>>;
}

export interface ReviewDay {
  date: IsoDate;
  /** Horas no REJECTED de esta fila (consultor + proyecto) ese día. */
  hours: number;
  flags: ReviewFlag[];
  /** Σ del consultor ese día en todos los proyectos (ver `dailyTotals`). */
  consultantTotal: number;
  /** Jornada del día; `null` si no se pudo resolver. */
  jornada: number | null;
}

/**
 * Estado de la fila: el de su revisión si existe; si no, `PENDING` (sin enviar) cuando hay algún
 * registro PENDING, `APPROVED` cuando todo lo vivo está aprobado (aprobado antes de R15) y
 * `REJECTED` cuando solo hay rechazos históricos.
 */
export type ReviewRowStatus = WeekReviewStatus | "PENDING" | "REJECTED";

export interface ReviewRow<T> {
  consultantId: string;
  projectId: string;
  weekStart: IsoDate;
  days: ReviewDay[];
  total: number;
  status: ReviewRowStatus;
  /** Estado de `TimesheetWeekReview` (o `null` si no hay). */
  reviewStatus: WeekReviewStatus | null;
  /** Unión de las novedades de los días, en el orden de `REVIEW_FLAGS`. */
  flags: ReviewFlag[];
  /** Registros de la fila tal como llegaron (incluidos REJECTED), en orden de `workDate`. */
  entries: T[];
}

export interface ReviewRowsResult<T> {
  rows: ReviewRow<T>[];
  /** Lo que no se pudo evaluar (consultor sin contexto, día sin jornada). */
  warnings: string[];
}

function orderFlags(set: Set<ReviewFlag>): ReviewFlag[] {
  return REVIEW_FLAGS.filter((f) => set.has(f));
}

/**
 * Agrega registros en filas consultor × proyecto × semana para la pantalla "Aprobación de horas"
 * (R15 §3), con novedades por día y su unión por fila. Solo cuentan las filas no REJECTED.
 *
 * - `EXTRA`: hay horas EXTRA (excedentes incluidos). `EXCESS`: hay EXTRA excedente (R14 §2.3).
 * - `ABSENCE`: hay ausencias.
 * - `NON_WORKING_DAY`: hay horas en sábado, domingo o festivo del consultor.
 * - `OVER_JORNADA`: la suma del consultor ese día en todos los proyectos supera la jornada
 *   (`exceedsCap`). Se marca solo en las celdas donde la fila tiene horas: al PM de un proyecto no
 *   le corresponde una jornada pasada por otro proyecto en el que no imputó nada.
 *
 * Sin contexto del consultor: fin de semana se detecta igual, festivos y `OVER_JORNADA` no, y se
 * advierte. Filas ordenadas por semana, consultor y proyecto.
 */
export function buildReviewRows<T extends ReviewEntryInput>(input: ReviewRowsInput<T>): ReviewRowsResult<T> {
  const warnings: string[] = [];
  const groups = new Map<string, { consultantId: string; projectId: string; weekStart: IsoDate; entries: { e: T; date: IsoDate }[] }>();
  const keyOf = (c: string, p: string, w: IsoDate) => `${w}|${c}|${p}`;

  // Suma visible por consultor y día (todas las filas recibidas, no REJECTED).
  const visibleTotals = new Map<string, number>();
  for (const e of input.entries) {
    const date = toIso(e.workDate);
    const weekStart = weekStartOf(date);
    const k = keyOf(e.consultantId, e.projectId, weekStart);
    let g = groups.get(k);
    if (!g) {
      g = { consultantId: e.consultantId, projectId: e.projectId, weekStart, entries: [] };
      groups.set(k, g);
    }
    g.entries.push({ e, date });
    if (e.status !== "REJECTED") {
      const tk = `${e.consultantId}|${date}`;
      visibleTotals.set(tk, (visibleTotals.get(tk) ?? 0) + liveHours(e.hours));
    }
  }

  const reviewByKey = new Map<string, WeekReviewStatus>();
  for (const r of input.reviews ?? []) {
    const weekStart = weekStartOf(r.weekStart);
    const k = keyOf(r.consultantId, r.projectId, weekStart);
    reviewByKey.set(k, r.status);
    if (!groups.has(k)) groups.set(k, { consultantId: r.consultantId, projectId: r.projectId, weekStart, entries: [] });
  }

  const warnedConsultants = new Set<string>();
  const rows: ReviewRow<T>[] = [];
  for (const [k, g] of groups) {
    const ctx = input.consultants[g.consultantId];
    if (!ctx && g.entries.length && !warnedConsultants.has(g.consultantId)) {
      warnedConsultants.add(g.consultantId);
      warnings.push(`Consultor ${g.consultantId} sin jornada ni festivos: no se marcan festivos ni días por encima de la jornada.`);
    }
    const rowFlags = new Set<ReviewFlag>();
    const days: ReviewDay[] = weekDays(g.weekStart).map((date) => {
      const flags = new Set<ReviewFlag>();
      let hours = 0;
      for (const { e, date: d } of g.entries) {
        if (d !== date || e.status === "REJECTED") continue;
        const h = liveHours(e.hours);
        hours += h;
        if (h <= 0) continue;
        if (e.category === "EXTRA") {
          flags.add("EXTRA");
          if (e.isExcess) flags.add("EXCESS");
        } else if (e.category === "ABSENCE") {
          flags.add("ABSENCE");
        }
      }
      hours = roundHours(hours);
      const visible = roundHours(visibleTotals.get(`${g.consultantId}|${date}`) ?? 0);
      const consultantTotal = roundHours(Math.max(visible, ctx?.dailyTotals[date] ?? 0));
      const jornada = ctx ? jornadaOf(ctx.jornada, date) : null;
      if (hours > 0) {
        const dow = weekdayOfDayNumber(isoToDayNumber(date));
        if (dow === 0 || dow === 6 || ctx?.holidays.has(date)) flags.add("NON_WORKING_DAY");
        if (ctx && jornada === null) {
          warnings.push(`Sin jornada para el consultor ${g.consultantId} el ${date}: no se evalúa si supera la jornada.`);
        } else if (jornada !== null && exceedsCap(consultantTotal, jornada)) {
          flags.add("OVER_JORNADA");
        }
      }
      flags.forEach((f) => rowFlags.add(f));
      return { date, hours, flags: orderFlags(flags), consultantTotal, jornada };
    });

    const reviewStatus = reviewByKey.get(k) ?? null;
    const live = g.entries.filter(({ e }) => e.status !== "REJECTED").map(({ e }) => e.status);
    let status: ReviewRowStatus;
    if (reviewStatus) status = reviewStatus;
    else if (live.includes("PENDING")) status = "PENDING";
    else if (live.includes("SUBMITTED")) status = "SUBMITTED";
    else if (live.length) status = "APPROVED";
    else status = "REJECTED";

    rows.push({
      consultantId: g.consultantId,
      projectId: g.projectId,
      weekStart: g.weekStart,
      days,
      total: roundHours(days.reduce((a, d) => a + d.hours, 0)),
      status,
      reviewStatus,
      flags: orderFlags(rowFlags),
      entries: [...g.entries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).map(({ e }) => e),
    });
  }

  // Orden por código de carácter (no `localeCompare`): determinista en cualquier servidor.
  const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
  rows.sort((a, b) => cmp(a.weekStart, b.weekStart) || cmp(a.consultantId, b.consultantId) || cmp(a.projectId, b.projectId));
  return { rows, warnings };
}

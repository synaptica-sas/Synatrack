import type { Assignment, ConsultantBlock, AssignmentStatus } from "@prisma/client";
import type { Decimal } from "@prisma/client/runtime/library";
import { isPublicHoliday } from "./holidays.js";

export type AvailabilityStatus = "FREE" | "PARTIAL" | "FULL" | "OVERLOADED";

export type ConsultantAvailability = {
  consultantId: string;
  capacityHours: number;
  committedHours: number;
  availableHours: number;
  utilizationPct: number;
  availabilityStatus: AvailabilityStatus;
  nextAvailableDate: Date | null;
};

const ACTIVE_STATUSES: AssignmentStatus[] = ["ACTIVE", "PARTIAL", "PLANNED"];

// ─── Jornada laboral (decisión de negocio D-5) ────────────────────────────────

/** Horas al día y días a la semana que se usan para calcular capacidad. */
export type Jornada = {
  hoursPerDay: number;
  workDaysPerWeek: number;
};

/** De dónde salió la jornada que se aplicó. Se devuelve para poder explicarla en pantalla. */
export type OrigenJornada = "consultor" | "pais" | "general";

export type JornadaEfectiva = Jornada & {
  origen: OrigenJornada;
  /** País cuya fila se aplicó, o `null` si la jornada no vino de un país. */
  paisAplicado: string | null;
};

/**
 * País de la fila que hace de valor general. Misma convención que
 * `ExtraHoursConfig`: la fila `Default` es "el resto del mundo".
 */
export const PAIS_GENERAL = "Default";

/**
 * Último escalón de la precedencia: lo que se aplica cuando no hay fila del
 * consultor, ni de su país, ni siquiera la fila general `Default`.
 *
 * Existe como constante con nombre a propósito. Antes este 8 estaba escondido
 * dentro de `calculateCapacityHours` (`config ? ... : 8`), que es justo lo que
 * hacía que toda la capacidad del sistema se calculara con 8 h sin que nadie lo
 * viera (DEP-41). Si este valor se usa, es porque la base está sin sembrar.
 */
export const JORNADA_GENERAL: Jornada = { hoursPerDay: 8, workDaysPerWeek: 5 };

type FilaJornada = {
  hoursPerDay: Decimal | number | string;
  workDaysPerWeek: number;
};

type FilaJornadaPais = FilaJornada & { country: string | null };

function aJornada(fila: FilaJornada): Jornada {
  return {
    hoursPerDay: Number(fila.hoursPerDay),
    workDaysPerWeek: fila.workDaysPerWeek,
  };
}

function mismoPais(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Resuelve la jornada que se le aplica a un consultor, con la precedencia que
 * decidió dirección (D-5): **lo del consultor manda sobre lo de su país, y lo
 * del país sobre el valor general**.
 *
 * 1. Fila de `CapacityConfig` con su `consultantId` → `origen: "consultor"`.
 * 2. Fila del país del consultor → `origen: "pais"`.
 * 3. Fila general (`country = "Default"`) → `origen: "general"`.
 * 4. Nada en la base → `JORNADA_GENERAL` (8 h × 5 días), `origen: "general"`.
 *
 * Un país sin configurar **no** es un error ni un 8 implícito: hereda la fila
 * general de forma explícita, y el `origen` que se devuelve lo dice.
 *
 * Función pura: el llamador trae las filas, aquí no se consulta nada.
 */
export function resolverJornada(
  configConsultor: FilaJornada | null | undefined,
  pais: string | null | undefined,
  configsPorPais: readonly FilaJornadaPais[],
): JornadaEfectiva {
  if (configConsultor) {
    return { ...aJornada(configConsultor), origen: "consultor", paisAplicado: null };
  }

  const delPais = configsPorPais.find((fila) => mismoPais(fila.country, pais));
  if (delPais) {
    return { ...aJornada(delPais), origen: "pais", paisAplicado: delPais.country };
  }

  const general = configsPorPais.find((fila) => mismoPais(fila.country, PAIS_GENERAL));
  if (general) {
    return { ...aJornada(general), origen: "general", paisAplicado: PAIS_GENERAL };
  }

  return { ...JORNADA_GENERAL, origen: "general", paisAplicado: null };
}

/** Días hábiles entre dos fechas (lunes a viernes, sin feriados) */
export function countWorkdays(from: Date, to: Date, workDaysPerWeek = 5, country?: string | null, customHolidays?: Set<string>): number {
  if (to < from) return 0;
  
  let workdays = 0;
  const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));

  const current = new Date(start);
  while (current <= end) {
    const day = current.getUTCDay(); // 0=Sun, 6=Sat
    const isWorkday = workDaysPerWeek >= 6 ? day !== 0 : day !== 0 && day !== 6;
    
    if (isWorkday) {
      const y = current.getUTCFullYear();
      const m = String(current.getUTCMonth() + 1).padStart(2, "0");
      const d = String(current.getUTCDate()).padStart(2, "0");
      const dateStr = `${y}-${m}-${d}`;
      
      const isHoliday = (country ? isPublicHoliday(current, country) : false) || (customHolidays ? customHolidays.has(dateStr) : false);
      if (!isHoliday) {
        workdays++;
      }
    }
    
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return workdays;
}

/** Solapamiento en días entre un assignment/block y un período */
export function overlapDays(
  itemStart: Date,
  itemEnd: Date,
  periodStart: Date,
  periodEnd: Date,
  workDaysPerWeek = 5,
  country?: string | null,
  customHolidays?: Set<string>,
): number {
  const start = itemStart > periodStart ? itemStart : periodStart;
  const end = itemEnd < periodEnd ? itemEnd : periodEnd;
  if (end < start) return 0;
  return countWorkdays(start, end, workDaysPerWeek, country, customHolidays);
}

/** Horas de capacidad de un consultor en un período */
export function calculateCapacityHours(
  period: { from: Date; to: Date },
  jornada: Jornada,
  blocks: Pick<ConsultantBlock, "startDate" | "endDate">[],
  country?: string | null,
  customHolidays?: Set<string>,
): number {
  const { hoursPerDay, workDaysPerWeek } = jornada;

  const totalWorkdays = countWorkdays(period.from, period.to, workDaysPerWeek, country, customHolidays);

  const blockedDays = blocks.reduce((sum, block) => {
    return sum + overlapDays(block.startDate, block.endDate, period.from, period.to, workDaysPerWeek, country, customHolidays);
  }, 0);

  return Math.max(totalWorkdays - blockedDays, 0) * hoursPerDay;
}

/** Horas comprometidas de un consultor dadas sus asignaciones en un período */
export function calculateCommittedHours(
  assignments: Pick<Assignment, "startDate" | "endDate" | "allocationMode" | "allocationPct" | "hoursPerPeriod" | "periodUnit" | "status">[],
  period: { from: Date; to: Date },
  jornada: Jornada,
  country?: string | null,
  customHolidays?: Set<string>,
): number {
  const { hoursPerDay, workDaysPerWeek } = jornada;

  return assignments
    .filter((a) => ACTIVE_STATUSES.includes(a.status) && a.endDate >= period.from && a.startDate <= period.to)
    .reduce((sum, assignment) => {
      const overlapWorkdays = overlapDays(
        assignment.startDate,
        assignment.endDate,
        period.from,
        period.to,
        workDaysPerWeek,
        country,
        customHolidays,
      );

      if (assignment.allocationMode === "PERCENTAGE") {
        const pct = Number(assignment.allocationPct ?? 0) / 100;
        return sum + overlapWorkdays * hoursPerDay * pct;
      }

      // HOURS mode: normalize hoursPerPeriod to hours in the overlapping window
      const hoursPerPeriod = Number(assignment.hoursPerPeriod ?? 0);
      const unit = assignment.periodUnit ?? "week";

      // Full period length in workdays
      const fullWorkdays = countWorkdays(assignment.startDate, assignment.endDate, workDaysPerWeek, country, customHolidays);
      if (fullWorkdays === 0) return sum;

      // Proportional allocation for the overlapping portion
      const proportion = overlapWorkdays / fullWorkdays;

      if (unit === "week") {
        const totalWeeks = fullWorkdays / workDaysPerWeek;
        return sum + proportion * totalWeeks * hoursPerPeriod;
      }

      // month: approximate
      const totalMonths = fullWorkdays / (workDaysPerWeek * 4.33);
      return sum + proportion * totalMonths * hoursPerPeriod;
    }, 0);
}

export function getAvailabilityStatus(utilizationPct: number): AvailabilityStatus {
  if (utilizationPct === 0) return "FREE";
  if (utilizationPct < 100) return "PARTIAL";
  if (utilizationPct === 100) return "FULL";
  return "OVERLOADED";
}

/** Primera fecha en que el consultor queda libre */
export function getNextAvailableDate(
  assignments: Pick<Assignment, "startDate" | "endDate" | "status">[],
  blocks: Pick<ConsultantBlock, "startDate" | "endDate">[],
  asOf: Date,
): Date | null {
  const active = [
    ...assignments
      .filter((a) => ACTIVE_STATUSES.includes(a.status) && a.endDate >= asOf)
      .map((a) => ({ start: a.startDate, end: a.endDate })),
    ...blocks
      .filter((b) => b.endDate >= asOf)
      .map((b) => ({ start: b.startDate, end: b.endDate })),
  ].sort((a, b) => a.start.getTime() - b.start.getTime());

  if (active.length === 0) return null; // ya está libre

  let latestEnd = active[0].end;
  for (const item of active) {
    if (item.start <= addDays(latestEnd, 1)) {
      if (item.end > latestEnd) latestEnd = item.end;
    }
  }

  return addDays(latestEnd, 1);
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function computeAvailability(
  consultantId: string,
  assignments: Pick<Assignment, "startDate" | "endDate" | "allocationMode" | "allocationPct" | "hoursPerPeriod" | "periodUnit" | "status">[],
  blocks: Pick<ConsultantBlock, "startDate" | "endDate">[],
  jornada: Jornada,
  period: { from: Date; to: Date },
  country?: string | null,
  customHolidays?: Set<string>,
): ConsultantAvailability {
  const capacityHours = calculateCapacityHours(period, jornada, blocks, country, customHolidays);
  const committedHours = calculateCommittedHours(assignments, period, jornada, country, customHolidays);
  const availableHours = Math.max(capacityHours - committedHours, 0);
  const utilizationPct = capacityHours > 0 ? Math.round((committedHours / capacityHours) * 100 * 10) / 10 : 0;
  const availabilityStatus = getAvailabilityStatus(utilizationPct);
  const nextAvailableDate = availabilityStatus !== "FREE"
    ? getNextAvailableDate(assignments, blocks, period.from)
    : null;

  return {
    consultantId,
    capacityHours: Math.round(capacityHours * 10) / 10,
    committedHours: Math.round(committedHours * 10) / 10,
    availableHours: Math.round(availableHours * 10) / 10,
    utilizationPct,
    availabilityStatus,
    nextAvailableDate,
  };
}

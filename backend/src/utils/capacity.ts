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

// ─── Jornada con vigencia, día a día (CONTRATO capacity §2 y §3.5, PLAN D1) ──

/**
 * Jornada que reciben las funciones de capacidad: una fija (la de antes, para el
 * periodo completo) o una función que da la jornada vigente en cada día UTC.
 */
export type JornadaPorDia = (dia: Date) => Jornada;
export type JornadaParam = Jornada | JornadaPorDia;

type FilaJornadaVigencia = FilaJornada & { validFrom: Date | string };
type FilaJornadaPaisVigencia = FilaJornadaVigencia & { country: string | null };

function isoDeFila(validFrom: Date | string): string {
  return typeof validFrom === "string" ? validFrom.slice(0, 10) : validFrom.toISOString().slice(0, 10);
}

/** Clave UTC "YYYY-MM-DD" de un día (nunca hora local). */
function claveDia(dia: Date): string {
  return dia.toISOString().slice(0, 10);
}

/**
 * Construye la jornada vigente **en cada día** para un consultor.
 *
 * Regla (CONTRATO capacity §2, `jornada(c,d)`): entre las filas con `validFrom ≤ d` se toma la de
 * mayor `validFrom`, con la precedencia de `resolverJornada`: consultor > país > `Default` > 8 h.
 * Ejemplo: Colombia 8 h desde 2000-01-01 y 8,4 h desde 2026-07-15 → el 14-jul aplica 8 y el
 * 15-jul aplica 8,4, sin importar qué día se consulte.
 *
 * Reemplaza a "jornada vigente hoy" (`jornadaVigenteDe()`), que aplicaba la jornada de la fecha de
 * consulta a todo el periodo: un mes anterior a un cambio de ley se recalculaba con la ley nueva.
 *
 * Función pura: el llamador trae todas las filas (con su `validFrom`). Memoiza por día.
 */
export function crearJornadaPorDia(
  filasConsultor: readonly FilaJornadaVigencia[],
  pais: string | null | undefined,
  filasPais: readonly FilaJornadaPaisVigencia[],
): (dia: Date) => JornadaEfectiva {
  const consultor = [...filasConsultor]
    .map((f) => ({ fila: f, desde: isoDeFila(f.validFrom) }))
    .sort((a, b) => (a.desde < b.desde ? 1 : a.desde > b.desde ? -1 : 0));
  const paises = [...filasPais]
    .map((f) => ({ fila: f, desde: isoDeFila(f.validFrom) }))
    .sort((a, b) => (a.desde < b.desde ? 1 : a.desde > b.desde ? -1 : 0));
  const cache = new Map<string, JornadaEfectiva>();

  return (dia: Date) => {
    const clave = claveDia(dia);
    const hit = cache.get(clave);
    if (hit) return hit;

    const propia = consultor.find((f) => f.desde <= clave)?.fila ?? null;
    // Una fila por país: la de mayor validFrom ≤ día (la lista ya viene ordenada desc).
    const vistos = new Set<string>();
    const vigentesPais: FilaJornadaPaisVigencia[] = [];
    for (const { fila, desde } of paises) {
      if (desde > clave || !fila.country) continue;
      const k = fila.country.trim().toLowerCase();
      if (vistos.has(k)) continue;
      vistos.add(k);
      vigentesPais.push(fila);
    }
    const efectiva = resolverJornada(propia, pais, vigentesPais);
    cache.set(clave, efectiva);
    return efectiva;
  };
}

function jornadaDe(param: JornadaParam): JornadaPorDia {
  return typeof param === "function" ? param : () => param;
}

function esFeriado(dia: Date, country?: string | null, customHolidays?: Set<string>): boolean {
  return (country ? isPublicHoliday(dia, country) : false) || (customHolidays ? customHolidays.has(claveDia(dia)) : false);
}

/**
 * Días laborables del rango (a medianoche UTC): lunes a viernes (o lunes a sábado si la jornada de
 * ese día tiene `workDaysPerWeek ≥ 6`), sin feriados del país ni `CustomHoliday`.
 */
function diasLaborables(
  from: Date,
  to: Date,
  jornada: JornadaPorDia,
  country?: string | null,
  customHolidays?: Set<string>,
): Date[] {
  const dias: Date[] = [];
  if (to < from) return dias;
  const current = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  while (current <= end) {
    const day = current.getUTCDay(); // 0=Sun, 6=Sat
    const { workDaysPerWeek } = jornada(current);
    const isWorkday = workDaysPerWeek >= 6 ? day !== 0 : day !== 0 && day !== 6;
    if (isWorkday && !esFeriado(current, country, customHolidays)) dias.push(new Date(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dias;
}

/**
 * Σ hoursPerDay de los días dados, agrupando por jornada distinta (días × horas) para no acumular
 * error de coma flotante sumando 8,4 una y otra vez.
 */
function sumarJornadas(dias: readonly Date[], jornada: JornadaPorDia): number {
  const porHoras = new Map<number, number>();
  for (const dia of dias) {
    const h = jornada(dia).hoursPerDay;
    porHoras.set(h, (porHoras.get(h) ?? 0) + 1);
  }
  let total = 0;
  for (const [h, n] of porHoras) total += n * h;
  return total;
}

/** Días hábiles entre dos fechas (lunes a viernes, sin feriados) */
export function countWorkdays(from: Date, to: Date, workDaysPerWeek = 5, country?: string | null, customHolidays?: Set<string>): number {
  return diasLaborables(from, to, () => ({ hoursPerDay: 0, workDaysPerWeek }), country, customHolidays).length;
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

/**
 * Horas de capacidad de un consultor en un período ("disponibilidad real": sí descuenta ausencias).
 *
 *   capacidad = Σ jornada(d).hoursPerDay  sobre los días d laborables del periodo
 *               (L-V, sin feriado) que NO están cubiertos por ningún bloqueo
 *
 * - Cada día bloqueado resta la jornada vigente en ESE día (con `JornadaPorDia`).
 * - Un fin de semana o feriado bloqueado no resta nada: ese día ya no sumaba.
 * - Los bloqueos se unen por día: si dos se solapan (p. ej. vacaciones cargadas a mano y la
 *   ausencia aprobada de R14 sobre el mismo día), el día se descuenta una sola vez.
 * - Las fechas del bloqueo se truncan al día UTC.
 */
export function calculateCapacityHours(
  period: { from: Date; to: Date },
  jornada: JornadaParam,
  blocks: Pick<ConsultantBlock, "startDate" | "endDate">[],
  country?: string | null,
  customHolidays?: Set<string>,
): number {
  const porDia = jornadaDe(jornada);
  const laborables = diasLaborables(period.from, period.to, porDia, country, customHolidays);
  if (laborables.length === 0) return 0;

  const bloqueados = new Set<string>();
  for (const block of blocks) {
    const desde = claveDia(block.startDate);
    const hasta = claveDia(block.endDate);
    for (const dia of laborables) {
      const k = claveDia(dia);
      if (k >= desde && k <= hasta) bloqueados.add(k);
    }
  }

  return sumarJornadas(laborables.filter((dia) => !bloqueados.has(claveDia(dia))), porDia);
}

/**
 * Insumo de `calculateCommittedHours`. `allocationPct`/`hoursPerPeriod` aceptan
 * `number` además de `Decimal`: la función solo los pasa por `Number(...)`, así
 * que sirve igual para una fila real de `Assignment` (R-013: para construir el
 * `Forecast` de una asignación que todavía no existe en la base).
 */
type CommittedHoursInput = Pick<Assignment, "startDate" | "endDate" | "allocationMode" | "periodUnit" | "status"> & {
  allocationPct: Decimal | number | null;
  hoursPerPeriod: Decimal | number | null;
};

/**
 * Horas comprometidas de un consultor dadas sus asignaciones en un período.
 *
 * - PERCENTAGE: Σ jornada(d).hoursPerDay × pct sobre los días laborables del solape (con la jornada
 *   vigente de cada día, igual que la capacidad, para que un 100 % siga siendo exactamente 100 %).
 * - HOURS: horas por semana (o mes ≈ 4,33 semanas) prorrateadas por días laborables del solape;
 *   las semanas se miden con el `workDaysPerWeek` vigente al inicio del solape.
 * - No descuenta bloqueos (la ausencia reduce capacidad, no compromiso).
 */
export function calculateCommittedHours(
  assignments: CommittedHoursInput[],
  period: { from: Date; to: Date },
  jornada: JornadaParam,
  country?: string | null,
  customHolidays?: Set<string>,
): number {
  const porDia = jornadaDe(jornada);

  return assignments
    .filter((a) => ACTIVE_STATUSES.includes(a.status) && a.endDate >= period.from && a.startDate <= period.to)
    .reduce((sum, assignment) => {
      const start = assignment.startDate > period.from ? assignment.startDate : period.from;
      const end = assignment.endDate < period.to ? assignment.endDate : period.to;
      const dias = diasLaborables(start, end, porDia, country, customHolidays);

      if (assignment.allocationMode === "PERCENTAGE") {
        const pct = Number(assignment.allocationPct ?? 0) / 100;
        return sum + sumarJornadas(dias, porDia) * pct;
      }

      // HOURS mode: normalize hoursPerPeriod to hours in the overlapping window
      const hoursPerPeriod = Number(assignment.hoursPerPeriod ?? 0);
      const unit = assignment.periodUnit ?? "week";
      const { workDaysPerWeek } = porDia(start);

      // Full period length in workdays
      const fullWorkdays = diasLaborables(assignment.startDate, assignment.endDate, porDia, country, customHolidays).length;
      if (fullWorkdays === 0) return sum;

      // Proportional allocation for the overlapping portion
      const proportion = dias.length / fullWorkdays;

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

/**
 * Suma días calendario en UTC (NEG-08). Antes usaba `setDate` (hora local): en una zona con cambio
 * de hora el resultado se corría una hora y, truncado a fecha, caía en el día equivocado
 * (p. ej. en Europe/Madrid, 2026-03-29 + 1 daba 2026-03-29T23:00Z). En un servidor en UTC, o en
 * zonas sin horario de verano (Quito, Bogotá), el resultado es idéntico al de antes.
 */
export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function computeAvailability(
  consultantId: string,
  assignments: Pick<Assignment, "startDate" | "endDate" | "allocationMode" | "allocationPct" | "hoursPerPeriod" | "periodUnit" | "status">[],
  blocks: Pick<ConsultantBlock, "startDate" | "endDate">[],
  jornada: JornadaParam,
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

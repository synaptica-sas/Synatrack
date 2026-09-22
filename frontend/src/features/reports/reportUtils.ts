import type { TimeEntry } from "../../services/api";
import { numberish, roundHours, weekDays } from "../timesheet/timesheetUtils";

/** Jornada estándar. Por encima de esto, las horas cuentan como exceso. */
export const DAILY_LIMIT = 8;

/**
 * Una barra del informe, partida en dos tramos: lo que cabe dentro de la
 * jornada y lo que se pasa.
 *
 * El exceso se calcula SIEMPRE día a día y luego se suma, nunca sobre el total
 * del periodo. Alguien que trabaje 10 h el lunes y 2 h el martes tiene 2 h de
 * exceso, aunque el total de la semana (12 h) esté muy por debajo de 40. Hacerlo
 * al revés escondería justo lo que el informe debe destacar.
 */
export type ReportBar = {
  key: string;
  label: string;
  /** Horas dentro de la jornada de 8 h. */
  regular: number;
  /** Horas que exceden las 8 h de algún día. */
  excess: number;
  /** regular + excess. */
  total: number;
};

/** Reparte las horas de un día entre jornada y exceso. */
function splitDay(hours: number) {
  return {
    regular: Math.min(hours, DAILY_LIMIT),
    excess: Math.max(hours - DAILY_LIMIT, 0),
  };
}

/** Suma las horas de cada entrada por día ISO. */
function hoursByDay(entries: TimeEntry[]): Map<string, number> {
  const byDay = new Map<string, number>();
  for (const entry of entries) {
    const day = entry.workDate.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + numberish(entry.hours));
  }
  return byDay;
}

/**
 * Horas de cada día, desglosadas por consultor.
 *
 * El desglose importa porque la jornada es de cada persona, no del equipo: un
 * día en que tres consultores trabajan 8 h suma 24 h sin que nadie se haya
 * excedido. Sin separar por consultor, el informe de "todos" marcaría en rojo
 * cualquier día con más de 8 h en total, que es justo lo contrario de lo que
 * debe señalar.
 */
function hoursByDayAndConsultant(entries: TimeEntry[]): Map<string, Map<string, number>> {
  const byDay = new Map<string, Map<string, number>>();
  for (const entry of entries) {
    const day = entry.workDate.slice(0, 10);
    let porConsultor = byDay.get(day);
    if (!porConsultor) {
      porConsultor = new Map();
      byDay.set(day, porConsultor);
    }
    const id = entry.consultantId;
    porConsultor.set(id, (porConsultor.get(id) ?? 0) + numberish(entry.hours));
  }
  return byDay;
}

/**
 * Una barra por consultor, con el total de la semana. El exceso se acumula
 * desde cada día por separado.
 */
export function barsByConsultant(entries: TimeEntry[]): ReportBar[] {
  const porConsultor = new Map<string, { label: string; entries: TimeEntry[] }>();

  for (const entry of entries) {
    const id = entry.consultantId;
    const actual = porConsultor.get(id);
    if (actual) {
      actual.entries.push(entry);
    } else {
      porConsultor.set(id, { label: entry.consultant?.fullName ?? "Sin nombre", entries: [entry] });
    }
  }

  const bars: ReportBar[] = [];
  for (const [id, { label, entries: suyas }] of porConsultor) {
    let regular = 0;
    let excess = 0;
    for (const hours of hoursByDay(suyas).values()) {
      const parte = splitDay(hours);
      regular += parte.regular;
      excess += parte.excess;
    }
    bars.push({
      key: id,
      label,
      regular: roundHours(regular),
      excess: roundHours(excess),
      total: roundHours(regular + excess),
    });
  }

  // De más a menos horas: el informe se lee de arriba abajo.
  return bars.sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

const DIAS = ["lun.", "mar.", "mié.", "jue.", "vie.", "sáb.", "dom."];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** Los cinco días laborables de la semana: de lunes a viernes. */
export function workWeekDays(weekStart: string): string[] {
  return weekDays(weekStart).slice(0, 5);
}

/** ¿Cae en sábado o domingo? Los días ISO de la semana van de lunes a domingo. */
export function isWeekendDay(isoDay: string, weekStart: string): boolean {
  return !workWeekDays(weekStart).includes(isoDay);
}

/**
 * Horas registradas en sábado o domingo. El informe no las dibuja, pero
 * tampoco las tira: se muestran aparte para que un fin de semana trabajado no
 * desaparezca sin dejar rastro.
 */
export function weekendHours(entries: TimeEntry[], weekStart: string): number {
  const laborables = new Set(workWeekDays(weekStart));
  let total = 0;
  for (const entry of entries) {
    if (!laborables.has(entry.workDate.slice(0, 10))) total += numberish(entry.hours);
  }
  return roundHours(total);
}

/** Deja fuera las entradas de sábado y domingo. */
export function onlyWeekdays(entries: TimeEntry[], weekStart: string): TimeEntry[] {
  const laborables = new Set(workWeekDays(weekStart));
  return entries.filter((entry) => laborables.has(entry.workDate.slice(0, 10)));
}

/**
 * Una barra por día laborable, de lunes a viernes. Se devuelven los cinco
 * aunque estén a cero, para que los huecos se vean como lo que son.
 *
 * El exceso se calcula por consultor dentro de cada día y luego se suma, de
 * modo que la barra de un día con varias personas solo se pone roja en la
 * parte que alguien trabajó de más.
 */
export function barsByDay(entries: TimeEntry[], weekStart: string): ReportBar[] {
  const byDay = hoursByDayAndConsultant(entries);

  return workWeekDays(weekStart).map((day, index) => {
    const porConsultor = byDay.get(day);
    let regular = 0;
    let excess = 0;

    if (porConsultor) {
      for (const hours of porConsultor.values()) {
        const parte = splitDay(hours);
        regular += parte.regular;
        excess += parte.excess;
      }
    }

    return {
      key: day,
      label: `${DIAS[index]}, ${MESES[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}`,
      regular: roundHours(regular),
      excess: roundHours(excess),
      total: roundHours(regular + excess),
    };
  });
}

/**
 * Horas decimales a "HH:MM:SS", el formato del reloj que usa el informe.
 * 8.5 → "08:30:00".
 */
export function formatHms(hours: number): string {
  const totalSeconds = Math.round(Math.max(0, hours) * 3600);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

/** Totales del pie del informe. */
export function totals(bars: ReportBar[]) {
  return bars.reduce(
    (acc, bar) => ({
      regular: roundHours(acc.regular + bar.regular),
      excess: roundHours(acc.excess + bar.excess),
      total: roundHours(acc.total + bar.total),
    }),
    { regular: 0, excess: 0, total: 0 },
  );
}

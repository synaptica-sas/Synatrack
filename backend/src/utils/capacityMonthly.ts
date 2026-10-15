/**
 * Capacity mensual (CONTRATO §2, documentacion/capacity/CONTRATO.md). Cálculo puro: el llamador
 * trae consultores, jornadas, feriados, años confirmados y asignaciones; aquí no se consulta nada
 * ni se mira la fecha del sistema. Todo en UTC con fechas "YYYY-MM-DD".
 *
 * Reglas (día d, consultor c, mes m), copiadas de la hoja Capacity del Excel del cliente:
 * - hábil(c,d): lunes a viernes, dentro de [hireDate, exitDate] y sin feriado del país de c con
 *   ciudad "" (nacional) ni con la ciudad de c.
 * - jornada(c,d): fila vigente (mayor validFrom ≤ d) del consultor; si no hay, la de su país; si no,
 *   la "Default"; si no, 8 h.
 * - capacidad(c,m) = Σ jornada(c,d) sobre los días hábiles de m.
 * - horas(a,m) = díasHábiles(c, a ∩ m) × hoursPerWeek / 5.
 * - pct = asignadas / capacidad × 100 (null si capacidad 0). Periodo y equipo: ponderados.
 * No redondea: se redondea al presentar.
 */
import { JORNADA_GENERAL } from "./capacity.js";
import {
  addMonthsKey,
  isoToDayNumber,
  isValidMonthKey,
  monthEnd,
  monthStart,
  weekdayOfDayNumber,
  type IsoDate,
  type MonthKey,
} from "./isoDate.js";

export type { IsoDate, MonthKey } from "./isoDate.js";
export type CapacityStatus = "OVER" | "OK" | "UNDER";

export interface MonthlyCapacityInput {
  months: MonthKey[]; // consecutivos, ya validados (máx. 24)
  includeProbables: boolean;
  thresholds: { underPct: number; overPct: number }; // 70, 100 (en %)
  consultants: {
    id: string;
    country: string | null;
    city: string | null;
    hireDate: IsoDate | null;
    exitDate: IsoDate | null;
  }[];
  jornadas: { consultantId: string | null; country: string | null; hoursPerDay: number; validFrom: IsoDate }[]; // country "Default" = general
  holidays: { country: string; city: string; date: IsoDate }[]; // city "" = nacional
  confirmedYears: { country: string; year: number }[];
  assignments: {
    id: string;
    consultantId: string;
    startDate: IsoDate;
    endDate: IsoDate;
    hoursPerWeek: number;
    certainty: "CONFIRMED" | "PROBABLE";
    isInternal: boolean;
  }[];
}

export interface MonthCell {
  month: MonthKey;
  workdays: number;
  capacityHours: number;
  assignedHours: number;
  billableHours: number;
  internalHours: number;
  probableHours: number;
  availableHours: number; // capacidad − asignadas (puede ser < 0)
  pct: number | null;
  billablePct: number | null;
  status: CapacityStatus | null;
  billableStatus: CapacityStatus | null;
}

export interface AssignmentBreakdown {
  assignmentId: string;
  included: boolean;
  totalHours: number;
  months: { month: MonthKey; hours: number }[]; // horas reales calculadas aunque no se incluya
}

export interface ConsultantResult {
  consultantId: string;
  months: MonthCell[];
  period: Omit<MonthCell, "month">;
  assignments: AssignmentBreakdown[];
}

export interface TeamCell extends MonthCell {
  overCount: number;
  underCount: number;
} // workdays = 0 en equipo

export type MonthlyCapacityWarning =
  | { code: "CONSULTANT_WITHOUT_COUNTRY"; consultantId: string }
  | { code: "HOLIDAYS_NOT_CONFIRMED"; country: string; year: number };

export interface MonthlyCapacityResult {
  months: MonthKey[];
  consultants: ConsultantResult[];
  team: { months: TeamCell[]; period: Omit<TeamCell, "month"> };
  kpis: {
    utilizationPct: number | null;
    billablePct: number | null;
    overCount: number;
    underCount: number;
    availableHours: number;
    capacityHours: number;
    assignedHours: number;
    consultantCount: number;
  };
  warnings: MonthlyCapacityWarning[];
}

/** Máximo de meses de un rango (CONTRATO §3.1). */
export const MAX_MONTHS = 24;

/** Clave de comparación de país/ciudad: minúsculas, sin tildes, sin espacios sobrantes. */
export function normalizeKey(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

const DEFAULT_COUNTRY_KEY = "default";

/**
 * Meses consecutivos de `from` a `to`, ambos incluidos.
 * Lanza si algún mes es inválido, si `from > to` o si el rango pasa de 24 meses.
 */
export function monthRange(from: MonthKey, to: MonthKey): MonthKey[] {
  if (!isValidMonthKey(from)) throw new Error(`Mes inicial inválido: "${from}" (se espera YYYY-MM)`);
  if (!isValidMonthKey(to)) throw new Error(`Mes final inválido: "${to}" (se espera YYYY-MM)`);
  if (from > to) throw new Error(`Rango inválido: el mes inicial (${from}) es posterior al final (${to})`);
  const out: MonthKey[] = [];
  for (let m = from; m <= to; m = addMonthsKey(m, 1)) {
    out.push(m);
    if (out.length > MAX_MONTHS) {
      throw new Error(`Rango demasiado largo: máximo ${MAX_MONTHS} meses (${from} a ${to})`);
    }
  }
  return out;
}

/**
 * Normaliza una asignación a horas por semana (CONTRATO §2, PLAN §4):
 * - HOURS + "week" (o sin unidad, como en `capacity.ts`) -> hoursPerPeriod.
 * - HOURS + "month" -> hoursPerPeriod × 12 / 52 (12 meses = 52 semanas).
 * - PERCENTAGE -> allocationPct / 100 × baseHoursPerDay × 5.
 * Un valor nulo cuenta como 0. Una unidad desconocida es un error de datos: se lanza.
 */
export function toHoursPerWeek(
  a: { allocationMode: "PERCENTAGE" | "HOURS"; allocationPct: number | null; hoursPerPeriod: number | null; periodUnit: string | null },
  baseHoursPerDay: number,
): number {
  if (a.allocationMode === "PERCENTAGE") {
    return ((a.allocationPct ?? 0) / 100) * baseHoursPerDay * 5;
  }
  const hours = a.hoursPerPeriod ?? 0;
  const unit = a.periodUnit ?? "week";
  if (unit === "week") return hours;
  if (unit === "month") return (hours * 12) / 52;
  throw new Error(`Unidad de periodo no soportada: "${unit}" (se espera "week" o "month")`);
}

/**
 * Estado según umbrales estrictos del Excel: OVER si pct > over; OK si pct ≥ under; UNDER si no.
 * Se compara con el pct redondeado a 6 decimales para que el ruido de coma flotante
 * (p. ej. 8,4 h sumadas 21 veces frente a 42 h/sem × 21 / 5) no convierta un 100 % exacto en OVER.
 * El pct que se devuelve no se toca.
 */
function statusOf(pct: number | null, t: { underPct: number; overPct: number }): CapacityStatus | null {
  if (pct === null) return null;
  const p = Math.round(pct * 1e6) / 1e6;
  if (p > t.overPct) return "OVER";
  if (p >= t.underPct) return "OK";
  return "UNDER";
}

type Sums = {
  workdays: number;
  capacityHours: number;
  assignedHours: number;
  internalHours: number;
  probableHours: number;
};

const emptySums = (): Sums => ({ workdays: 0, capacityHours: 0, assignedHours: 0, internalHours: 0, probableHours: 0 });

function addSums(target: Sums, s: Sums): void {
  target.workdays += s.workdays;
  target.capacityHours += s.capacityHours;
  target.assignedHours += s.assignedHours;
  target.internalHours += s.internalHours;
  target.probableHours += s.probableHours;
}

function toCell(s: Sums, t: { underPct: number; overPct: number }): Omit<MonthCell, "month"> {
  const billableHours = s.assignedHours - s.internalHours;
  const pct = s.capacityHours > 0 ? (s.assignedHours / s.capacityHours) * 100 : null;
  const billablePct = s.capacityHours > 0 ? (billableHours / s.capacityHours) * 100 : null;
  return {
    workdays: s.workdays,
    capacityHours: s.capacityHours,
    assignedHours: s.assignedHours,
    billableHours,
    internalHours: s.internalHours,
    probableHours: s.probableHours,
    availableHours: s.capacityHours - s.assignedHours,
    pct,
    billablePct,
    status: statusOf(pct, t),
    billableStatus: statusOf(billablePct, t),
  };
}

type JornadaRow = { from: number; hours: number };

/** Puntero que avanza día a día sobre filas ordenadas por validFrom: O(días + filas). */
class JornadaCursor {
  private idx = -1;
  constructor(private readonly rows: JornadaRow[]) {}
  at(day: number): number | null {
    while (this.idx + 1 < this.rows.length && this.rows[this.idx + 1].from <= day) this.idx++;
    return this.idx >= 0 ? this.rows[this.idx].hours : null;
  }
}

function pushRow(map: Map<string, JornadaRow[]>, key: string, row: JornadaRow): void {
  const list = map.get(key);
  if (list) list.push(row);
  else map.set(key, [row]);
}

export function computeMonthlyCapacity(input: MonthlyCapacityInput): MonthlyCapacityResult {
  const { months, thresholds, includeProbables } = input;

  for (let i = 1; i < months.length; i++) {
    if (months[i] !== addMonthsKey(months[i - 1], 1)) {
      throw new Error(`Los meses deben ser consecutivos: ${months[i - 1]} seguido de ${months[i]}`);
    }
  }
  if (months.length > MAX_MONTHS) throw new Error(`Rango demasiado largo: máximo ${MAX_MONTHS} meses`);

  const bounds = months.map((m) => ({ month: m, start: isoToDayNumber(monthStart(m)), end: isoToDayNumber(monthEnd(m)) }));
  const rangeStart = bounds.length ? bounds[0].start : 0;
  const rangeEnd = bounds.length ? bounds[bounds.length - 1].end : -1;
  const rangeLen = Math.max(rangeEnd - rangeStart + 1, 0);

  // Feriados: país -> ciudad -> días. Solo los que caen en el rango.
  const holidayIndex = new Map<string, Map<string, Set<number>>>();
  for (const h of input.holidays) {
    const day = isoToDayNumber(h.date);
    if (day < rangeStart || day > rangeEnd) continue;
    const countryKey = normalizeKey(h.country);
    let byCity = holidayIndex.get(countryKey);
    if (!byCity) holidayIndex.set(countryKey, (byCity = new Map()));
    const cityKey = normalizeKey(h.city);
    let set = byCity.get(cityKey);
    if (!set) byCity.set(cityKey, (set = new Set()));
    set.add(day);
  }

  // Jornadas por nivel, ordenadas por validFrom.
  const byConsultant = new Map<string, JornadaRow[]>();
  const byCountry = new Map<string, JornadaRow[]>();
  for (const j of input.jornadas) {
    const row = { from: isoToDayNumber(j.validFrom), hours: j.hoursPerDay };
    if (j.consultantId) pushRow(byConsultant, j.consultantId, row);
    else if (j.country) pushRow(byCountry, normalizeKey(j.country), row);
  }
  for (const list of [...byConsultant.values(), ...byCountry.values()]) list.sort((a, b) => a.from - b.from);

  // Asignaciones por consultor.
  const assignmentsByConsultant = new Map<string, MonthlyCapacityInput["assignments"]>();
  for (const a of input.assignments) {
    if (!Number.isFinite(a.hoursPerWeek) || a.hoursPerWeek < 0) {
      throw new Error(`Asignación ${a.id}: hoursPerWeek inválido (${a.hoursPerWeek})`);
    }
    const list = assignmentsByConsultant.get(a.consultantId);
    if (list) list.push(a);
    else assignmentsByConsultant.set(a.consultantId, [a]);
  }

  const warnings: MonthlyCapacityWarning[] = [];
  const countriesInTeam = new Map<string, string>(); // clave normalizada -> nombre tal como llegó
  const teamMonthSums = bounds.map(() => emptySums());
  const teamMonthOver = bounds.map(() => 0);
  const teamMonthUnder = bounds.map(() => 0);
  const teamPeriodSums = emptySums();
  let teamPeriodOver = 0;
  let teamPeriodUnder = 0;
  let teamCount = 0;

  const consultants: ConsultantResult[] = [];
  const habilPrefix = new Int32Array(rangeLen + 1);

  for (const c of input.consultants) {
    const countryKey = normalizeKey(c.country);
    const hasCountry = countryKey !== "";
    if (!hasCountry) warnings.push({ code: "CONSULTANT_WITHOUT_COUNTRY", consultantId: c.id });
    else if (!countriesInTeam.has(countryKey)) countriesInTeam.set(countryKey, c.country!.trim());

    const hire = c.hireDate ? isoToDayNumber(c.hireDate) : -Infinity;
    const exit = c.exitDate ? isoToDayNumber(c.exitDate) : Infinity;
    const byCity = hasCountry ? holidayIndex.get(countryKey) : undefined;
    const national = byCity?.get("");
    const cityKey = normalizeKey(c.city);
    const local = cityKey ? byCity?.get(cityKey) : undefined;

    const consultantCursor = new JornadaCursor(byConsultant.get(c.id) ?? []);
    const countryCursor = new JornadaCursor(hasCountry ? byCountry.get(countryKey) ?? [] : []);
    const defaultCursor = new JornadaCursor(byCountry.get(DEFAULT_COUNTRY_KEY) ?? []);

    // Una pasada por los días del rango: prefijo de días hábiles y capacidad por mes.
    // La capacidad se acumula como (días × jornada) por cada jornada distinta, para no sumar 8,4
    // veinte veces y arrastrar error de coma flotante.
    const monthSums = bounds.map(() => emptySums());
    let mi = 0;
    let hoursCount = new Map<number, number>();
    const flushCapacity = (idx: number) => {
      let cap = 0;
      for (const [h, n] of hoursCount) cap += h * n;
      monthSums[idx].capacityHours = hasCountry ? cap : 0;
      hoursCount = new Map();
    };
    for (let i = 0; i < rangeLen; i++) {
      const day = rangeStart + i;
      if (day > bounds[mi].end) {
        flushCapacity(mi);
        mi++;
      }
      const dow = weekdayOfDayNumber(day);
      const habil =
        dow >= 1 && dow <= 5 && day >= hire && day <= exit && !national?.has(day) && !local?.has(day);
      // Los cursores avanzan todos los días para mantener el orden.
      const hc = consultantCursor.at(day);
      const hp = countryCursor.at(day);
      const hd = defaultCursor.at(day);
      habilPrefix[i + 1] = habilPrefix[i] + (habil ? 1 : 0);
      if (habil) {
        monthSums[mi].workdays++;
        const hours = hc ?? hp ?? hd ?? JORNADA_GENERAL.hoursPerDay;
        hoursCount.set(hours, (hoursCount.get(hours) ?? 0) + 1);
      }
    }
    if (bounds.length) flushCapacity(mi);

    const habilBetween = (from: number, to: number) =>
      to < from ? 0 : habilPrefix[to - rangeStart + 1] - habilPrefix[from - rangeStart];

    const breakdowns: AssignmentBreakdown[] = [];
    for (const a of assignmentsByConsultant.get(c.id) ?? []) {
      const s = Math.max(isoToDayNumber(a.startDate), rangeStart);
      const e = Math.min(isoToDayNumber(a.endDate), rangeEnd);
      const included = a.certainty === "CONFIRMED" || includeProbables;
      const perMonth: { month: MonthKey; hours: number }[] = [];
      let total = 0;
      for (let k = 0; k < bounds.length; k++) {
        const days = habilBetween(Math.max(s, bounds[k].start), Math.min(e, bounds[k].end));
        const hours = (days * a.hoursPerWeek) / 5;
        perMonth.push({ month: bounds[k].month, hours });
        total += hours;
        if (a.certainty === "PROBABLE") monthSums[k].probableHours += hours;
        if (included) {
          monthSums[k].assignedHours += hours;
          if (a.isInternal) monthSums[k].internalHours += hours;
        }
      }
      breakdowns.push({ assignmentId: a.id, included, totalHours: total, months: perMonth });
    }

    const periodSums = emptySums();
    const cells: MonthCell[] = bounds.map((b, k) => {
      addSums(periodSums, monthSums[k]);
      return { month: b.month, ...toCell(monthSums[k], thresholds) };
    });
    const period = toCell(periodSums, thresholds);

    if (hasCountry) {
      teamCount++;
      cells.forEach((cell, k) => {
        addSums(teamMonthSums[k], monthSums[k]);
        if (cell.status === "OVER") teamMonthOver[k]++;
        if (cell.billableStatus === "UNDER") teamMonthUnder[k]++;
      });
      addSums(teamPeriodSums, periodSums);
      if (period.status === "OVER") teamPeriodOver++;
      if (period.billableStatus === "UNDER") teamPeriodUnder++;
    }

    consultants.push({ consultantId: c.id, months: cells, period, assignments: breakdowns });
  }

  // Avisos de calendario sin confirmar, por país de los consultores incluidos y año del rango.
  const confirmed = new Set(input.confirmedYears.map((y) => `${normalizeKey(y.country)}|${y.year}`));
  const years: number[] = [];
  if (months.length) {
    for (let y = Number(months[0].slice(0, 4)); y <= Number(months[months.length - 1].slice(0, 4)); y++) years.push(y);
  }
  const pending: { country: string; year: number }[] = [];
  for (const [key, name] of countriesInTeam) {
    for (const year of years) if (!confirmed.has(`${key}|${year}`)) pending.push({ country: name, year });
  }
  pending.sort((a, b) => a.country.localeCompare(b.country) || a.year - b.year);
  for (const p of pending) warnings.push({ code: "HOLIDAYS_NOT_CONFIRMED", ...p });

  // El equipo no tiene días hábiles propios: workdays = 0 (CONTRATO §2).
  const teamCell = (s: Sums) => ({ ...toCell({ ...s, workdays: 0 }, thresholds) });
  const teamMonths: TeamCell[] = bounds.map((b, k) => ({
    month: b.month,
    ...teamCell(teamMonthSums[k]),
    overCount: teamMonthOver[k],
    underCount: teamMonthUnder[k],
  }));
  const teamPeriod = { ...teamCell(teamPeriodSums), overCount: teamPeriodOver, underCount: teamPeriodUnder };

  return {
    months: [...months],
    consultants,
    team: { months: teamMonths, period: teamPeriod },
    kpis: {
      utilizationPct: teamPeriod.pct,
      billablePct: teamPeriod.billablePct,
      overCount: teamPeriod.overCount,
      underCount: teamPeriod.underCount,
      availableHours: teamPeriod.availableHours,
      capacityHours: teamPeriod.capacityHours,
      assignedHours: teamPeriod.assignedHours,
      consultantCount: teamCount,
    },
    warnings,
  };
}

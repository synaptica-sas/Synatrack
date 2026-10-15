import type { Prisma } from "@prisma/client";
import { prisma } from "../../infra/prisma.js";
import { JORNADA_GENERAL } from "../../utils/capacity.js";
import {
  computeMonthlyCapacity,
  normalizeKey,
  toHoursPerWeek,
  type IsoDate,
  monthRange,
  type MonthKey,
  type MonthlyCapacityInput,
  type MonthlyCapacityResult,
} from "../../utils/capacityMonthly.js";
import { fromIsoDate, monthEnd, monthStart, toIsoDate } from "../../utils/isoDate.js";

/**
 * Carga de datos + cálculo de capacity mensual (CONTRATO §3.1/§3.2). Lo usan el informe
 * (`monthly.routes.ts`) y el aviso OVERALLOCATED de las asignaciones. El cálculo en sí es puro
 * (`utils/capacityMonthly.ts`); aquí solo se traen y se convierten los datos. No escribe nada.
 */

/** Valores de fábrica de los umbrales cuando aún no hay fila (un GET no escribe en la base). */
export const UMBRALES_POR_DEFECTO = { underThresholdPct: 70, overThresholdPct: 100, includeProbablesDefault: false };

export async function cargarSettings() {
  const fila = await prisma.capacitySettings.findUnique({ where: { scope: "GENERAL" } });
  if (!fila) return { ...UMBRALES_POR_DEFECTO };
  return {
    underThresholdPct: Number(fila.underThresholdPct),
    overThresholdPct: Number(fila.overThresholdPct),
    includeProbablesDefault: fila.includeProbablesDefault,
  };
}

type FilaJornada = MonthlyCapacityInput["jornadas"][number];

/** Jornada vigente de un consultor en una fecha: consultor > país > Default > 8 (misma precedencia que el cálculo). */
export function jornadaBase(
  consultant: { id: string; country: string | null },
  date: IsoDate,
  jornadas: readonly FilaJornada[],
): number {
  const vigente = (filas: FilaJornada[]) =>
    filas.filter((j) => j.validFrom <= date).sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1))[0]?.hoursPerDay;
  const propias = vigente(jornadas.filter((j) => j.consultantId === consultant.id));
  if (propias !== undefined) return propias;
  const paisKey = normalizeKey(consultant.country);
  if (paisKey) {
    const delPais = vigente(jornadas.filter((j) => !j.consultantId && normalizeKey(j.country) === paisKey));
    if (delPais !== undefined) return delPais;
  }
  const general = vigente(jornadas.filter((j) => !j.consultantId && normalizeKey(j.country) === "default"));
  return general ?? JORNADA_GENERAL.hoursPerDay;
}

export type ConsultorCargado = {
  id: string;
  fullName: string;
  role: string;
  country: string | null;
  city: string | null;
  company: string | null;
  isInternal: boolean;
  hireDate: IsoDate | null;
  exitDate: IsoDate | null;
};

export type AsignacionCargada = {
  id: string;
  consultantId: string;
  projectId: string;
  projectName: string;
  client: string;
  projectStatus: string;
  isInternal: boolean;
  certainty: "CONFIRMED" | "PROBABLE";
  status: string;
  startDate: IsoDate;
  endDate: IsoDate;
  hoursPerWeek: number;
};

export type CalculoMensual = {
  consultants: ConsultorCargado[];
  assignments: AsignacionCargada[];
  result: MonthlyCapacityResult;
};

export type OpcionesCalculo = {
  months: MonthKey[];
  includeProbables: boolean;
  /** `exclude` quita las asignaciones de proyectos internos. */
  internal: "include" | "exclude";
  thresholds: { underPct: number; overPct: number };
  /** Filtro de consultores en base de datos (id, etc.). Se combina con "activos o salida dentro del rango". */
  consultantWhere?: Prisma.ConsultantWhereInput;
  /** Filtros en memoria (sin distinguir mayúsculas ni tildes). */
  filtros?: { country?: string; city?: string; company?: string };
  /** Si es true, no exige que el consultor esté activo (detalle de un consultor concreto). */
  sinFiltroDeActivo?: boolean;
};

const coincide = (valor: string | null, filtro: string | undefined) =>
  !filtro || normalizeKey(valor) === normalizeKey(filtro);

export async function cargarYCalcular(opts: OpcionesCalculo): Promise<CalculoMensual> {
  const { months } = opts;
  const inicio = monthStart(months[0]);
  const fin = monthEnd(months[months.length - 1]);
  const inicioDate = fromIsoDate(inicio);
  const finDate = fromIsoDate(fin);
  const anios: number[] = [];
  for (let y = Number(inicio.slice(0, 4)); y <= Number(fin.slice(0, 4)); y++) anios.push(y);

  const filasConsultor = await prisma.consultant.findMany({
    where: {
      AND: [
        opts.consultantWhere ?? {},
        opts.sinFiltroDeActivo ? {} : { OR: [{ active: true }, { exitDate: { gte: inicioDate } }] },
      ],
    },
    orderBy: { fullName: "asc" },
  });
  const f = opts.filtros ?? {};
  const consultants: ConsultorCargado[] = filasConsultor
    .filter((c) => coincide(c.country, f.country) && coincide(c.city, f.city) && coincide(c.company, f.company))
    .map((c) => ({
      id: c.id,
      fullName: c.fullName,
      role: c.role,
      // El alta de consultores guarda "Default" cuando no se elige país (y también
      // para USA). "Default" es la fila de respaldo de la jornada, no un país con
      // calendario: para capacity cuenta como "sin país" y dispara su aviso.
      country: c.country && c.country !== "Default" ? c.country : null,
      city: c.city,
      company: c.company,
      isInternal: c.isInternal,
      hireDate: c.hireDate ? toIsoDate(c.hireDate) : null,
      exitDate: c.exitDate ? toIsoDate(c.exitDate) : null,
    }));
  const ids = consultants.map((c) => c.id);

  const [configs, feriados, aniosConfirmados, filasAsignacion] = await Promise.all([
    prisma.capacityConfig.findMany({ where: { OR: [{ consultantId: { in: ids } }, { country: { not: null } }] } }),
    // Se traen los feriados del rango de todos los países: el cálculo ignora los que no aplican.
    prisma.holiday.findMany({ where: { date: { gte: inicioDate, lte: finDate } } }),
    prisma.holidayCalendarYear.findMany({ where: { year: { in: anios } } }),
    prisma.assignment.findMany({
      where: {
        consultantId: { in: ids },
        status: { not: "CANCELLED" },
        startDate: { lte: finDate },
        endDate: { gte: inicioDate },
      },
      include: { project: { select: { id: true, name: true, company: true, status: true, isInternal: true } } },
      orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  const jornadas: MonthlyCapacityInput["jornadas"] = configs.map((c) => ({
    consultantId: c.consultantId,
    country: c.consultantId ? null : c.country,
    hoursPerDay: Number(c.hoursPerDay),
    validFrom: toIsoDate(c.validFrom),
  }));

  const porId = new Map(consultants.map((c) => [c.id, c]));
  const assignments: AsignacionCargada[] = [];
  for (const a of filasAsignacion) {
    if (opts.internal === "exclude" && a.project.isInternal) continue;
    const consultor = porId.get(a.consultantId)!;
    const startDate = toIsoDate(a.startDate);
    let hoursPerWeek = 0;
    try {
      hoursPerWeek = toHoursPerWeek(
        {
          allocationMode: a.allocationMode,
          allocationPct: a.allocationPct == null ? null : Number(a.allocationPct),
          hoursPerPeriod: a.hoursPerPeriod == null ? null : Number(a.hoursPerPeriod),
          periodUnit: a.periodUnit,
        },
        jornadaBase(consultor, startDate, jornadas),
      );
    } catch {
      // Unidad de periodo desconocida (dato inconsistente): aporta 0 en vez de romper el informe.
      hoursPerWeek = 0;
    }
    assignments.push({
      id: a.id,
      consultantId: a.consultantId,
      projectId: a.projectId,
      projectName: a.project.name,
      client: a.project.company,
      projectStatus: a.project.status,
      isInternal: a.project.isInternal,
      certainty: a.certainty,
      status: a.status,
      startDate,
      endDate: toIsoDate(a.endDate),
      hoursPerWeek,
    });
  }

  const result = computeMonthlyCapacity({
    months,
    includeProbables: opts.includeProbables,
    thresholds: opts.thresholds,
    consultants: consultants.map((c) => ({
      id: c.id,
      country: c.country,
      city: c.city,
      hireDate: c.hireDate,
      exitDate: c.exitDate,
    })),
    jornadas,
    holidays: feriados.map((h) => ({ country: h.country, city: h.city, date: toIsoDate(h.date) })),
    confirmedYears: aniosConfirmados.map((y) => ({ country: y.country, year: y.year })),
    assignments: assignments.map((a) => ({
      id: a.id,
      consultantId: a.consultantId,
      startDate: a.startDate,
      endDate: a.endDate,
      hoursPerWeek: a.hoursPerWeek,
      certainty: a.certainty,
      isInternal: a.isInternal,
    })),
  });

  return { consultants, assignments, result };
}

/** Redondeo de presentación a 1 decimal (horas y %). */
export const redondear1 = (n: number): number => Math.round(n * 10) / 10;

/** Redondea a 1 decimal los campos de horas y porcentajes de una celda (workdays y contadores quedan enteros). */
const CAMPOS_REDONDEO = [
  "capacityHours",
  "assignedHours",
  "billableHours",
  "internalHours",
  "probableHours",
  "availableHours",
  "pct",
  "billablePct",
  "utilizationPct",
] as const;

export function redondearCelda<T extends object>(celda: T): T {
  const out = { ...celda } as Record<string, unknown>;
  for (const campo of CAMPOS_REDONDEO) {
    const v = out[campo];
    if (typeof v === "number") out[campo] = redondear1(v);
  }
  return out as T;
}

/** Rango pedido (por defecto, el año en curso en UTC); un rango inválido lanza Error (la ruta responde 400). */
export function resolverRango(from?: string, to?: string): { months: MonthKey[]; from: MonthKey; to: MonthKey } {
  const anio = new Date().getUTCFullYear();
  const desde = from ?? `${anio}-01`;
  const hasta = to ?? `${anio}-12`;
  return { months: monthRange(desde, hasta), from: desde, to: hasta };
}

/** Detalle por asignación de un consultor (CONTRATO §3.2). Sin tarifas ni costos. */
export function detalleAsignaciones(
  asignaciones: readonly AsignacionCargada[],
  desglose: ReadonlyMap<string, MonthlyCapacityResult["consultants"][number]["assignments"][number]>,
) {
  return asignaciones.map((a) => {
    const b = desglose.get(a.id)!;
    return {
      assignmentId: a.id,
      projectId: a.projectId,
      projectName: a.projectName,
      client: a.client,
      projectStatus: a.projectStatus,
      isInternal: a.isInternal,
      certainty: a.certainty,
      status: a.status,
      startDate: a.startDate,
      endDate: a.endDate,
      hoursPerWeek: Math.round(a.hoursPerWeek * 100) / 100,
      included: b.included,
      totalHours: redondear1(b.totalHours),
      months: b.months.map((m) => ({ month: m.month, hours: redondear1(m.hours) })),
    };
  });
}

export type OpcionesInforme = {
  /** Si no se indica, se usa el valor por defecto de los parámetros. */
  includeProbables?: boolean;
  internal: "include" | "exclude";
  from?: string;
  to?: string;
  country?: string;
  city?: string;
  company?: string;
  consultantId?: string;
  includeAssignments?: boolean;
};

/**
 * Informe completo de `GET /api/capacity/monthly` (CONTRATO §3.1). Lo usan la ruta y la
 * publicación del reporte oficial, para que el payload congelado sea idéntico al del informe.
 * Lanza Error si el rango es inválido.
 */
export async function construirInformeMensual(opts: OpcionesInforme) {
  const rango = resolverRango(opts.from, opts.to);
  const settings = await cargarSettings();
  const includeProbables = opts.includeProbables ?? settings.includeProbablesDefault;

  const { consultants, assignments, result } = await cargarYCalcular({
    months: rango.months,
    includeProbables,
    internal: opts.internal,
    thresholds: { underPct: settings.underThresholdPct, overPct: settings.overThresholdPct },
    consultantWhere: opts.consultantId ? { id: opts.consultantId } : undefined,
    filtros: { country: opts.country, city: opts.city, company: opts.company },
  });

  const porId = new Map(consultants.map((c) => [c.id, c]));
  const asignacionesDe = new Map<string, AsignacionCargada[]>();
  for (const a of assignments) {
    const lista = asignacionesDe.get(a.consultantId) ?? [];
    lista.push(a);
    asignacionesDe.set(a.consultantId, lista);
  }

  return {
    from: rango.from,
    to: rango.to,
    includeProbables,
    internal: opts.internal,
    settings: { underThresholdPct: settings.underThresholdPct, overThresholdPct: settings.overThresholdPct },
    months: result.months,
    consultants: result.consultants.map((r) => {
      const c = porId.get(r.consultantId)!;
      const base = {
        id: c.id,
        fullName: c.fullName,
        country: c.country,
        city: c.city,
        company: c.company,
        isInternal: c.isInternal,
        role: c.role,
        hireDate: c.hireDate,
        exitDate: c.exitDate,
        months: r.months.map(redondearCelda),
        period: redondearCelda(r.period),
      };
      if (!opts.includeAssignments) return base;
      const desglose = new Map(r.assignments.map((b) => [b.assignmentId, b]));
      return { ...base, assignments: detalleAsignaciones(asignacionesDe.get(c.id) ?? [], desglose) };
    }),
    team: {
      months: result.team.months.map(redondearCelda),
      period: redondearCelda(result.team.period),
    },
    kpis: redondearCelda(result.kpis),
    warnings: result.warnings.map((w) =>
      w.code === "CONSULTANT_WITHOUT_COUNTRY" ? { ...w, fullName: porId.get(w.consultantId)?.fullName ?? null } : w,
    ),
  };
}

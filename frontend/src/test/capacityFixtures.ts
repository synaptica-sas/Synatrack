import type {
  CapacityReport,
  MonthlyCapacity,
  MonthlyCapacityCell,
  MonthlyCapacityTeamCell,
} from "../services/api";

export function cell(month: string, over: Partial<MonthlyCapacityCell> = {}): MonthlyCapacityCell {
  return {
    month, workdays: 20, capacityHours: 160, assignedHours: 120, billableHours: 120, internalHours: 0,
    probableHours: 0, availableHours: 40, pct: 75, billablePct: 75, status: "OK", billableStatus: "OK", ...over,
  };
}

export function teamCell(month: string, over: Partial<MonthlyCapacityTeamCell> = {}): MonthlyCapacityTeamCell {
  return { ...cell(month), overCount: 0, underCount: 0, ...over };
}

/**
 * Dos meses y dos consultores:
 *  - Ana Pérez (Ecuador, Quito): ene 120 % SOBRE, feb 75 % OK; una asignación confirmada y otra probable no incluida.
 *  - Beto Ruiz (Colombia): ene sin capacidad (pct null), feb 50 % SUB.
 */
export function sampleData(): MonthlyCapacity {
  const anaMonths = [
    cell("2026-01", { pct: 120, assignedHours: 192, availableHours: -32, status: "OVER" }),
    cell("2026-02", { pct: 75, assignedHours: 120, status: "OK" }),
  ];
  const betoMonths = [
    cell("2026-01", { pct: null, status: null, capacityHours: 0, assignedHours: 0, availableHours: 0, workdays: 0, billablePct: null, billableStatus: null }),
    cell("2026-02", { pct: 50, assignedHours: 80, availableHours: 80, status: "UNDER", billablePct: 50, billableStatus: "UNDER" }),
  ];
  const { month: _a, ...anaPeriod } = cell("2026-01", { pct: 97.5, assignedHours: 312, capacityHours: 320, availableHours: 8, status: "OK" });
  const { month: _b, ...betoPeriod } = cell("2026-01", { pct: 50, assignedHours: 80, capacityHours: 160, availableHours: 80, status: "UNDER" });
  const { month: _t, ...teamPeriod } = cell("2026-01", { pct: 81.7, assignedHours: 392, capacityHours: 480, availableHours: 88, status: "OK" });
  void _a; void _b; void _t;
  return {
    from: "2026-01", to: "2026-02", includeProbables: false, internal: "include",
    settings: { underThresholdPct: 70, overThresholdPct: 100 },
    months: ["2026-01", "2026-02"],
    consultants: [
      {
        id: "c2", fullName: "Beto Ruiz", country: "Colombia", city: null, company: null, isInternal: false,
        role: null, hireDate: null, exitDate: null, months: betoMonths, period: betoPeriod, assignments: [],
      },
      {
        id: "c1", fullName: "Ana Pérez", country: "Ecuador", city: "Quito", company: "Synaptica", isInternal: true,
        role: "Consultora", hireDate: null, exitDate: null, months: anaMonths, period: anaPeriod,
        assignments: [
          {
            assignmentId: "a1", projectId: "p1", projectName: "Proyecto Alfa", client: "Cliente SA",
            projectStatus: "ACTIVE", isInternal: false, certainty: "CONFIRMED", status: "ACTIVE",
            startDate: "2026-01-01", endDate: "2026-02-28", hoursPerWeek: 40, included: true, totalHours: 312,
            months: [{ month: "2026-01", hours: 192 }, { month: "2026-02", hours: 120 }],
          },
          {
            assignmentId: "a2", projectId: "p2", projectName: "Proyecto Beta", client: null,
            projectStatus: "PROSPECT", isInternal: true, certainty: "PROBABLE", status: "PLANNED",
            startDate: "2026-02-01", endDate: "2026-02-28", hoursPerWeek: 10, included: false, totalHours: 40.5,
            months: [{ month: "2026-02", hours: 40.5 }],
          },
        ],
      },
    ],
    team: {
      months: [
        teamCell("2026-01", { pct: 120, status: "OVER", overCount: 1, underCount: 0 }),
        teamCell("2026-02", { pct: 62.5, status: "UNDER", overCount: 0, underCount: 1 }),
      ],
      period: { ...teamPeriod, overCount: 1, underCount: 1 },
    },
    kpis: { utilizationPct: 81.7, billablePct: 60, overCount: 1, underCount: 1, availableHours: 88, capacityHours: 480, assignedHours: 392, consultantCount: 2 },
    warnings: [{ code: "HOLIDAYS_NOT_CONFIRMED", country: "Ecuador", year: 2026 }],
  };
}

export function sampleReport(over: Partial<CapacityReport> = {}): CapacityReport {
  return {
    id: "rep1",
    title: "Capacity ene 2026 a feb 2026",
    note: "Cierre del trimestre",
    fromMonth: "2026-01",
    toMonth: "2026-02",
    includeProbables: false,
    internal: "include",
    filters: { country: "Ecuador" },
    settings: { underThresholdPct: 70, overThresholdPct: 100 },
    publishedBy: "admin@synaptica.com",
    publishedAt: "2026-10-15T13:00:00.000Z",
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
    payload: sampleData(),
    ...over,
  };
}

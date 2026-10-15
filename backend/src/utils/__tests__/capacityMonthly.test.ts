import { describe, it, expect } from "vitest";
import {
  computeMonthlyCapacity,
  monthRange,
  toHoursPerWeek,
  normalizeKey,
  type MonthlyCapacityInput,
  type MonthCell,
} from "../capacityMonthly.js";

// ─── Datos de la hoja Feriados del Excel (fixture: todos nacionales, city "") ─────────────

const EC_EXCEL = [
  "2026-10-09", "2026-11-02", "2026-11-03", "2026-11-20", "2026-12-07", "2026-12-25",
  "2027-01-01", "2027-02-08", "2027-02-09", "2027-03-26",
];
const CO_EXCEL = [
  "2026-10-12", "2026-11-02", "2026-11-16", "2026-12-08", "2026-12-25",
  "2027-01-01", "2027-01-11", "2027-03-22", "2027-03-25", "2027-03-26",
];

const holidaysOf = (country: string, dates: string[], city = "") => dates.map((date) => ({ country, city, date }));

const EXCEL_HOLIDAYS = [...holidaysOf("Ecuador", EC_EXCEL), ...holidaysOf("Colombia", CO_EXCEL)];
const THRESHOLDS = { underPct: 70, overPct: 100 };
const EXCEL_MONTHS = ["2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03"];

type Consultant = MonthlyCapacityInput["consultants"][number];
type Assignment = MonthlyCapacityInput["assignments"][number];

const consultant = (id: string, country: string | null, extra: Partial<Consultant> = {}): Consultant => ({
  id,
  country,
  city: null,
  hireDate: null,
  exitDate: null,
  ...extra,
});

let seq = 0;
const assignment = (
  consultantId: string,
  startDate: string,
  endDate: string,
  hoursPerWeek: number,
  extra: Partial<Assignment> = {},
): Assignment => ({
  id: `a${++seq}`,
  consultantId,
  startDate,
  endDate,
  hoursPerWeek,
  certainty: "CONFIRMED",
  isInternal: false,
  ...extra,
});

/** Entrada mínima con jornada explícita y todos los años confirmados (para no meter avisos). */
function input(partial: Partial<MonthlyCapacityInput>): MonthlyCapacityInput {
  return {
    months: ["2026-10"],
    includeProbables: false,
    thresholds: THRESHOLDS,
    consultants: [],
    jornadas: [],
    holidays: EXCEL_HOLIDAYS,
    confirmedYears: [2026, 2027].flatMap((year) => [
      { country: "Ecuador", year },
      { country: "Colombia", year },
    ]),
    assignments: [],
    ...partial,
  };
}

const cell = (cells: MonthCell[], month: string) => {
  const found = cells.find((c) => c.month === month);
  if (!found) throw new Error(`sin mes ${month}`);
  return found;
};

// ─── Fixture completo del Excel ─────────────────────────────────────────────────────────

function excelFixture(includeProbables: boolean): MonthlyCapacityInput {
  return input({
    months: EXCEL_MONTHS,
    includeProbables,
    consultants: [consultant("C1", "Ecuador"), consultant("C2", "Colombia"), consultant("C3", "Ecuador")],
    // Jornadas como overrides de consultor, igual que la columna "Jornada" del Excel.
    jornadas: [
      { consultantId: "C1", country: null, hoursPerDay: 8, validFrom: "2000-01-01" },
      { consultantId: "C2", country: null, hoursPerDay: 8, validFrom: "2000-01-01" },
      { consultantId: "C3", country: null, hoursPerDay: 4, validFrom: "2000-01-01" },
    ],
    assignments: [
      assignment("C1", "2026-09-01", "2027-02-26", 32),
      assignment("C1", "2026-10-01", "2026-12-18", 16),
      assignment("C2", "2026-10-15", "2027-03-31", 40),
      assignment("C3", "2026-11-04", "2027-01-29", 20, { certainty: "PROBABLE" }),
    ],
  });
}

const EXPECTED = {
  C1: { assigned: [201.6, 172.8, 176, 128, 115.2, 0], capacity: [168, 144, 168, 160, 144, 176], pct: [120, 120, 104.76, 80, 80, 0], period: 82.67 },
  C2: { assigned: [96, 152, 168, 152, 160, 160], capacity: [168, 152, 168, 152, 160, 160], pct: [57.14, 100, 100, 100, 100, 100], period: 92.5 },
  C3: { assigned: [0, 0, 0, 0, 0, 0], capacity: [84, 72, 84, 80, 72, 88], pct: [0, 0, 0, 0, 0, 0], period: 0 },
};

describe("computeMonthlyCapacity — fixture completo del Excel", () => {
  const result = computeMonthlyCapacity(excelFixture(false));
  const byId = (id: string) => result.consultants.find((c) => c.consultantId === id)!;

  for (const id of ["C1", "C2", "C3"] as const) {
    it(`${id}: capacidad, asignadas y % por mes y del periodo (sin probables)`, () => {
      const r = byId(id);
      const exp = EXPECTED[id];
      r.months.forEach((m, k) => {
        expect(m.month).toBe(EXCEL_MONTHS[k]);
        expect(m.capacityHours).toBeCloseTo(exp.capacity[k], 9);
        expect(m.assignedHours).toBeCloseTo(exp.assigned[k], 9);
        expect(m.pct!).toBeCloseTo(exp.pct[k], 2);
      });
      expect(r.period.pct!).toBeCloseTo(exp.period, 1);
    });
  }

  it("equipo: % ponderado por mes (sin probables)", () => {
    const expected = [70.9, 88.3, 81.9, 71.4, 73.2, 37.7];
    result.team.months.forEach((m, k) => {
      expect(m.pct!).toBeCloseTo(expected[k], 1);
      expect(m.workdays).toBe(0);
    });
  });

  it("equipo: overCount / underCount por mes con umbrales 70/100 (100 % exacto es OK, 0 % es UNDER)", () => {
    // oct: C1 120 OVER, C2 57 UNDER, C3 0 UNDER; nov y dic: C1 OVER, C2 100 OK, C3 UNDER;
    // ene y feb: C1 80 OK, C2 OK, C3 UNDER; mar: C1 0 UNDER, C2 OK, C3 UNDER.
    expect(result.team.months.map((m) => m.overCount)).toEqual([1, 1, 1, 0, 0, 0]);
    expect(result.team.months.map((m) => m.underCount)).toEqual([2, 1, 1, 1, 1, 2]);
    expect(cell(byId("C2").months, "2026-11").status).toBe("OK");
    expect(cell(byId("C3").months, "2026-10").status).toBe("UNDER");
  });

  it("kpis = periodo del equipo + consultantCount", () => {
    expect(result.kpis.consultantCount).toBe(3);
    expect(result.kpis.capacityHours).toBeCloseTo(960 + 960 + 480, 9);
    expect(result.kpis.assignedHours).toBeCloseTo(793.6 + 888, 9);
    expect(result.kpis.utilizationPct!).toBeCloseTo(((793.6 + 888) / 2400) * 100, 9);
    expect(result.kpis.availableHours).toBeCloseTo(2400 - 1681.6, 9);
    // periodo: C1 82,7 OK, C2 92,5 OK, C3 0 UNDER
    expect(result.kpis.overCount).toBe(0);
    expect(result.kpis.underCount).toBe(1);
    expect(result.warnings).toEqual([]);
  });

  it("con probables solo cambia C3 (nov, dic y ene al 100 %) y el equipo", () => {
    const withP = computeMonthlyCapacity(excelFixture(true));
    const c3 = withP.consultants.find((c) => c.consultantId === "C3")!;
    expect(c3.months.map((m) => m.assignedHours)).toEqual([0, 72, 84, 80, 0, 0]);
    expect(c3.months.map((m) => m.pct)).toEqual([0, 100, 100, 100, 0, 0]);
    expect(c3.period.pct!).toBeCloseTo(49.2, 1);
    for (const id of ["C1", "C2"]) {
      const a = withP.consultants.find((c) => c.consultantId === id)!;
      const b = result.consultants.find((c) => c.consultantId === id)!;
      expect(a.months).toEqual(b.months);
    }
    const expected = [70.9, 107.8, 101.9, 91.8, 73.2, 37.7];
    withP.team.months.forEach((m, k) => expect(m.pct!).toBeCloseTo(expected[k], 1));
  });

  it("C1: la asignación que cruza meses prorratea en cada mes, incluido el corte del 18-dic", () => {
    const [a32, a16] = byId("C1").assignments;
    expect(a32.months.map((m) => m.hours)).toEqual([134.4, 115.2, 134.4, 128, 115.2, 0].map((h) => expect.closeTo(h, 9)));
    // dic: 1..18 son 14 días L-V menos el 7-dic = 13 días × 16/5
    expect(a16.months.map((m) => m.hours)).toEqual([67.2, 57.6, 41.6, 0, 0, 0].map((h) => expect.closeTo(h, 9)));
    expect(a16.totalHours).toBeCloseTo(166.4, 9);
  });
});

// ─── Casos obligatorios ─────────────────────────────────────────────────────────────────

describe("computeMonthlyCapacity — casos obligatorios del plan", () => {
  it("EC oct-2026: capacidad 168 y 32 + 16 h/sem = 201,6 h -> 120 %", () => {
    const r = computeMonthlyCapacity(
      input({
        consultants: [consultant("ec", "Ecuador")],
        jornadas: [{ consultantId: null, country: "Ecuador", hoursPerDay: 8, validFrom: "2000-01-01" }],
        assignments: [assignment("ec", "2026-10-01", "2026-10-31", 32), assignment("ec", "2026-10-01", "2026-10-31", 16)],
      }),
    );
    const m = r.consultants[0].months[0];
    expect(m.workdays).toBe(21);
    expect(m.capacityHours).toBe(168);
    expect(m.assignedHours).toBeCloseTo(201.6, 9);
    expect(m.pct!).toBeCloseTo(120, 9);
    expect(m.status).toBe("OVER");
    expect(m.availableHours).toBeCloseTo(-33.6, 9);
  });

  it("CO 40 h/sem desde el 15-oct-2026 con jornada 8: 96 / 168 = 57,14 %", () => {
    const r = computeMonthlyCapacity(
      input({
        consultants: [consultant("co", "Colombia")],
        jornadas: [{ consultantId: null, country: "Colombia", hoursPerDay: 8, validFrom: "2000-01-01" }],
        assignments: [assignment("co", "2026-10-15", "2027-03-31", 40)],
      }),
    );
    const m = r.consultants[0].months[0];
    expect(m.capacityHours).toBe(168);
    expect(m.assignedHours).toBe(96);
    expect(m.pct!).toBeCloseTo(57.142857, 5);
    expect(m.status).toBe("UNDER");
  });

  it("EC medio tiempo (4 h): capacidad oct-2026 = 84 h", () => {
    const r = computeMonthlyCapacity(
      input({
        consultants: [consultant("ec", "Ecuador")],
        jornadas: [
          { consultantId: null, country: "Ecuador", hoursPerDay: 8, validFrom: "2000-01-01" },
          { consultantId: "ec", country: null, hoursPerDay: 4, validFrom: "2000-01-01" },
        ],
      }),
    );
    expect(r.consultants[0].months[0].capacityHours).toBe(84);
  });

  it("Probable: no suma a asignadas con el filtro apagado, pero sí a probableHours; encendido suma", () => {
    const base = {
      consultants: [consultant("ec", "Ecuador")],
      jornadas: [{ consultantId: null, country: "Ecuador", hoursPerDay: 8, validFrom: "2000-01-01" }],
      assignments: [assignment("ec", "2026-10-01", "2026-10-31", 20, { certainty: "PROBABLE" as const })],
    };
    const off = computeMonthlyCapacity(input({ ...base, includeProbables: false }));
    const on = computeMonthlyCapacity(input({ ...base, includeProbables: true }));
    expect(off.consultants[0].months[0].assignedHours).toBe(0);
    expect(off.consultants[0].months[0].probableHours).toBe(84);
    expect(off.consultants[0].assignments[0]).toMatchObject({ included: false, totalHours: 84 });
    expect(on.consultants[0].months[0].assignedHours).toBe(84);
    expect(on.consultants[0].months[0].probableHours).toBe(84);
    expect(on.consultants[0].assignments[0].included).toBe(true);
  });
});

// ─── Bordes ─────────────────────────────────────────────────────────────────────────────

describe("computeMonthlyCapacity — bordes", () => {
  const coJornada8 = [{ consultantId: null, country: "Colombia", hoursPerDay: 8, validFrom: "2000-01-01" }];

  it("feriado en fin de semana no cambia los días hábiles (CO 1-may-2027, sábado)", () => {
    const base = { months: ["2027-05"], consultants: [consultant("co", "Colombia")], jornadas: coJornada8 };
    const sin = computeMonthlyCapacity(input({ ...base, holidays: [] }));
    const con = computeMonthlyCapacity(input({ ...base, holidays: holidaysOf("Colombia", ["2027-05-01"]) }));
    expect(con.consultants[0].months[0].workdays).toBe(sin.consultants[0].months[0].workdays);
    expect(con.consultants[0].months[0].workdays).toBe(21);
  });

  it("consultor sin asignaciones: 0 %, UNDER y cuenta en underCount", () => {
    const r = computeMonthlyCapacity(input({ consultants: [consultant("co", "Colombia")], jornadas: coJornada8 }));
    const m = r.consultants[0].months[0];
    expect(m.pct).toBe(0);
    expect(m.status).toBe("UNDER");
    expect(m.billableStatus).toBe("UNDER");
    expect(r.team.months[0].underCount).toBe(1);
    expect(r.kpis.underCount).toBe(1);
  });

  it("fin < inicio aporta 0 horas", () => {
    const r = computeMonthlyCapacity(
      input({
        consultants: [consultant("co", "Colombia")],
        jornadas: coJornada8,
        assignments: [assignment("co", "2026-10-20", "2026-10-10", 40)],
      }),
    );
    expect(r.consultants[0].months[0].assignedHours).toBe(0);
    expect(r.consultants[0].assignments[0].totalHours).toBe(0);
  });

  it("país sin año confirmado: aviso HOLIDAYS_NOT_CONFIRMED por país-año y el cálculo sigue", () => {
    const r = computeMonthlyCapacity(
      input({
        months: ["2026-12", "2027-01"],
        consultants: [consultant("ec", "Ecuador"), consultant("ec2", "ecuador "), consultant("co", "Colombia")],
        jornadas: coJornada8,
        confirmedYears: [
          { country: "Ecuador", year: 2026 },
          { country: "Colombia", year: 2026 },
          { country: "Colombia", year: 2027 },
        ],
      }),
    );
    expect(r.warnings).toEqual([{ code: "HOLIDAYS_NOT_CONFIRMED", country: "Ecuador", year: 2027 }]);
    // se calcula con los feriados que hay: ene-2027 EC = 21 L-V − 1-ene = 20 días
    expect(r.consultants[0].months[1].workdays).toBe(20);
  });

  it("país sin ningún año confirmado: un aviso por cada año del rango", () => {
    const r = computeMonthlyCapacity(
      input({ months: ["2026-12", "2027-01"], consultants: [consultant("pe", "Perú")], confirmedYears: [] }),
    );
    expect(r.warnings).toEqual([
      { code: "HOLIDAYS_NOT_CONFIRMED", country: "Perú", year: 2026 },
      { code: "HOLIDAYS_NOT_CONFIRMED", country: "Perú", year: 2027 },
    ]);
  });

  it("consultor sin país: aviso, capacidad 0 y excluido del equipo", () => {
    const r = computeMonthlyCapacity(
      input({
        consultants: [consultant("co", "Colombia"), consultant("x", null), consultant("y", "  ")],
        jornadas: coJornada8,
        assignments: [assignment("x", "2026-10-01", "2026-10-31", 40)],
      }),
    );
    expect(r.warnings).toEqual([
      { code: "CONSULTANT_WITHOUT_COUNTRY", consultantId: "x" },
      { code: "CONSULTANT_WITHOUT_COUNTRY", consultantId: "y" },
    ]);
    const x = r.consultants.find((c) => c.consultantId === "x")!.months[0];
    expect(x.capacityHours).toBe(0);
    expect(x.pct).toBeNull();
    expect(x.status).toBeNull();
    expect(r.kpis.consultantCount).toBe(1);
    expect(r.team.months[0].capacityHours).toBe(168);
    expect(r.team.months[0].assignedHours).toBe(0);
  });

  it("feriado local: Quito 7-dic-2026 lo descuenta el de Quito, no el de Guayaquil ni el sin ciudad", () => {
    const r = computeMonthlyCapacity(
      input({
        months: ["2026-12"],
        consultants: [
          consultant("uio", "Ecuador", { city: "Quito" }),
          consultant("uio2", "ECUADOR", { city: "  quito " }),
          consultant("gye", "Ecuador", { city: "Guayaquil" }),
          consultant("none", "Ecuador"),
        ],
        jornadas: [{ consultantId: null, country: "Ecuador", hoursPerDay: 8, validFrom: "2000-01-01" }],
        holidays: [
          ...holidaysOf("Ecuador", ["2026-12-25"]),
          { country: "Ecuador", city: "Quito", date: "2026-12-07" },
        ],
      }),
    );
    const days = Object.fromEntries(r.consultants.map((c) => [c.consultantId, c.months[0].workdays]));
    // dic-2026: 23 L-V − 25-dic = 22; Quito además − 7-dic = 21
    expect(days).toEqual({ uio: 21, uio2: 21, gye: 22, none: 22 });
  });

  it("país y ciudad se comparan sin mayúsculas ni tildes", () => {
    expect(normalizeKey("  Perú ")).toBe("peru");
    expect(normalizeKey("San  José")).toBe("san jose");
    const r = computeMonthlyCapacity(
      input({
        months: ["2026-10"],
        consultants: [consultant("pe", "PERU")],
        jornadas: [{ consultantId: null, country: "Perú", hoursPerDay: 6, validFrom: "2000-01-01" }],
        holidays: [{ country: "perú", city: "", date: "2026-10-08" }],
        confirmedYears: [{ country: "Peru", year: 2026 }],
      }),
    );
    expect(r.consultants[0].months[0].workdays).toBe(21);
    expect(r.consultants[0].months[0].capacityHours).toBe(126);
    expect(r.warnings).toEqual([]);
  });

  it("cambio de jornada a mitad de mes (CO 8 h y 8,4 h desde el 15-jul-2026): suma día a día", () => {
    const r = computeMonthlyCapacity(
      input({
        months: ["2026-07"],
        consultants: [consultant("co", "Colombia")],
        jornadas: [
          { consultantId: null, country: "Colombia", hoursPerDay: 8, validFrom: "2000-01-01" },
          { consultantId: null, country: "Colombia", hoursPerDay: 8.4, validFrom: "2026-07-15" },
        ],
        holidays: holidaysOf("Colombia", ["2026-07-20"]),
        assignments: [assignment("co", "2026-07-01", "2026-07-31", 42)],
      }),
    );
    // 1..14-jul: 10 días × 8 = 80; 15..31-jul: 13 días − 20-jul = 12 × 8,4 = 100,8
    const m = r.consultants[0].months[0];
    expect(m.workdays).toBe(22);
    expect(m.capacityHours).toBeCloseTo(180.8, 9);
    // 42 h/sem × 22 / 5 = 184,8
    expect(m.assignedHours).toBeCloseTo(184.8, 9);
  });

  it("precedencia consultor > país > Default, cada nivel con su validFrom", () => {
    const r = computeMonthlyCapacity(
      input({
        months: ["2026-10"],
        holidays: [],
        consultants: [consultant("own", "Colombia"), consultant("ctry", "Colombia"), consultant("def", "Chile")],
        jornadas: [
          { consultantId: null, country: "Default", hoursPerDay: 7, validFrom: "2000-01-01" },
          { consultantId: null, country: "Default", hoursPerDay: 6, validFrom: "2026-10-16" },
          { consultantId: null, country: "Colombia", hoursPerDay: 8, validFrom: "2000-01-01" },
          // fila del consultor que solo rige desde el 16-oct: antes manda su país
          { consultantId: "own", country: null, hoursPerDay: 4, validFrom: "2026-10-16" },
        ],
        confirmedYears: [],
      }),
    );
    const cap = Object.fromEntries(r.consultants.map((c) => [c.consultantId, c.months[0].capacityHours]));
    // oct-2026 sin feriados: 22 L-V; 1..15-oct = 11 días, 16..31-oct = 11 días
    expect(cap).toEqual({ own: 11 * 8 + 11 * 4, ctry: 22 * 8, def: 11 * 7 + 11 * 6 });
  });

  it("sin ninguna jornada configurada se usa 8 h", () => {
    const r = computeMonthlyCapacity(input({ holidays: [], consultants: [consultant("co", "Colombia")], jornadas: [] }));
    expect(r.consultants[0].months[0].capacityHours).toBe(22 * 8);
  });

  it("hireDate y exitDate a mitad de mes; meses fuera de rango con capacidad 0, pct y status null", () => {
    const r = computeMonthlyCapacity(
      input({
        months: ["2026-09", "2026-10", "2026-11", "2026-12"],
        holidays: [],
        consultants: [consultant("co", "Colombia", { hireDate: "2026-10-15", exitDate: "2026-11-13" })],
        jornadas: coJornada8,
        assignments: [assignment("co", "2026-09-01", "2026-12-31", 40)],
      }),
    );
    const [sep, oct, nov, dic] = r.consultants[0].months;
    expect(sep).toMatchObject({ workdays: 0, capacityHours: 0, assignedHours: 0, pct: null, status: null, billableStatus: null });
    expect(dic).toMatchObject({ workdays: 0, capacityHours: 0, assignedHours: 0, pct: null, status: null });
    // oct 15..31: 12 L-V; nov 1..13: 10 L-V
    expect(oct).toMatchObject({ workdays: 12, capacityHours: 96, assignedHours: 96, pct: 100, status: "OK" });
    expect(nov).toMatchObject({ workdays: 10, capacityHours: 80, assignedHours: 80, pct: 100 });
    expect(r.consultants[0].assignments[0].totalHours).toBe(176);
    // capacidad 0 en sep y dic no cuenta como subutilizado
    expect(r.team.months.map((m) => m.underCount)).toEqual([0, 0, 0, 0]);
    expect(r.team.months[0].pct).toBeNull();
  });

  it("capacidad 0 -> pct y billablePct null, sin división por cero", () => {
    const r = computeMonthlyCapacity(
      input({
        consultants: [consultant("co", "Colombia")],
        jornadas: [{ consultantId: "co", country: null, hoursPerDay: 0, validFrom: "2000-01-01" }],
        assignments: [assignment("co", "2026-10-01", "2026-10-31", 40)],
      }),
    );
    const m = r.consultants[0].months[0];
    expect(m.capacityHours).toBe(0);
    expect(m.assignedHours).toBe(168);
    expect(m.pct).toBeNull();
    expect(m.billablePct).toBeNull();
    expect(m.status).toBeNull();
    expect(r.kpis.utilizationPct).toBeNull();
  });

  it("asignación interna: suma a asignadas, va en internalHours y underCount usa billableStatus", () => {
    const r = computeMonthlyCapacity(
      input({
        consultants: [consultant("co", "Colombia")],
        jornadas: coJornada8,
        assignments: [
          assignment("co", "2026-10-01", "2026-10-31", 30, { isInternal: true }),
          assignment("co", "2026-10-01", "2026-10-31", 10),
        ],
      }),
    );
    const m = r.consultants[0].months[0];
    // 21 días: 30 h/sem -> 126 internas; 10 h/sem -> 42 facturables; total 168 = 100 %
    expect(m.assignedHours).toBeCloseTo(168, 9);
    expect(m.internalHours).toBeCloseTo(126, 9);
    expect(m.billableHours).toBeCloseTo(42, 9);
    expect(m.pct!).toBeCloseTo(100, 9);
    expect(m.billablePct!).toBeCloseTo(25, 9);
    expect(m.status).toBe("OK");
    expect(m.billableStatus).toBe("UNDER");
    expect(r.team.months[0].underCount).toBe(1);
    expect(r.team.months[0].overCount).toBe(0);
  });

  it("asignación interna probable con el filtro apagado no entra en internalHours", () => {
    const r = computeMonthlyCapacity(
      input({
        consultants: [consultant("co", "Colombia")],
        jornadas: coJornada8,
        assignments: [assignment("co", "2026-10-01", "2026-10-31", 40, { isInternal: true, certainty: "PROBABLE" })],
      }),
    );
    expect(r.consultants[0].months[0]).toMatchObject({ assignedHours: 0, internalHours: 0, probableHours: 168 });
  });

  it("100 % con jornada 8,4 no se vuelve OVER por error de coma flotante", () => {
    const r = computeMonthlyCapacity(
      input({
        months: ["2026-10", "2026-11", "2026-12"],
        consultants: [consultant("co", "Colombia")],
        jornadas: [{ consultantId: null, country: "Colombia", hoursPerDay: 8.4, validFrom: "2000-01-01" }],
        assignments: [assignment("co", "2026-10-01", "2026-12-31", 42)],
      }),
    );
    for (const m of r.consultants[0].months) expect(m.status).toBe("OK");
    expect(r.consultants[0].period.status).toBe("OK");
  });

  it("70 % exacto es OK (umbral estricto como en el Excel)", () => {
    const r = computeMonthlyCapacity(
      input({
        holidays: [],
        consultants: [consultant("co", "Colombia")],
        jornadas: coJornada8,
        assignments: [assignment("co", "2026-10-01", "2026-10-31", 28)],
      }),
    );
    expect(r.consultants[0].months[0].pct!).toBeCloseTo(70, 9);
    expect(r.consultants[0].months[0].status).toBe("OK");
  });

  it("el % del periodo es ponderado y difiere del promedio simple de los meses", () => {
    const r = computeMonthlyCapacity(excelFixture(false));
    const c1 = r.consultants.find((c) => c.consultantId === "C1")!;
    const simple = c1.months.reduce((s, m) => s + m.pct!, 0) / c1.months.length;
    expect(simple).toBeCloseTo(84.13, 2);
    expect(c1.period.pct!).toBeCloseTo(82.67, 2);
    expect(c1.period.pct!).not.toBeCloseTo(simple, 1);
    // el periodo suma los meses
    expect(c1.period.capacityHours).toBeCloseTo(960, 9);
    expect(c1.period.workdays).toBe(21 + 18 + 21 + 20 + 18 + 22);
  });

  it("asignación de un consultor que no está en la lista se ignora", () => {
    const r = computeMonthlyCapacity(
      input({
        consultants: [consultant("co", "Colombia")],
        jornadas: coJornada8,
        assignments: [assignment("otro", "2026-10-01", "2026-10-31", 40)],
      }),
    );
    expect(r.team.months[0].assignedHours).toBe(0);
  });

  it("rechaza meses no consecutivos y hoursPerWeek inválido", () => {
    expect(() => computeMonthlyCapacity(input({ months: ["2026-10", "2026-12"] }))).toThrow(/consecutivos/);
    expect(() =>
      computeMonthlyCapacity(
        input({ consultants: [consultant("co", "Colombia")], assignments: [assignment("co", "2026-10-01", "2026-10-31", Number.NaN)] }),
      ),
    ).toThrow(/hoursPerWeek/);
  });

  it("sin meses devuelve una estructura vacía", () => {
    const r = computeMonthlyCapacity(input({ months: [], consultants: [consultant("co", "Colombia")] }));
    expect(r.months).toEqual([]);
    expect(r.consultants[0].months).toEqual([]);
    expect(r.kpis.utilizationPct).toBeNull();
  });

  it("rendimiento: 60 consultores × 24 meses en menos de 50 ms", () => {
    const months = monthRange("2026-01", "2027-12");
    const consultants = Array.from({ length: 60 }, (_, i) =>
      consultant(`c${i}`, i % 2 ? "Ecuador" : "Colombia", { city: i % 3 ? "Quito" : null }),
    );
    const assignments = consultants.flatMap((c, i) => [
      assignment(c.id, "2025-11-01", "2026-09-30", 20 + (i % 5)),
      assignment(c.id, "2026-06-15", "2027-12-31", 16, { certainty: i % 4 ? "CONFIRMED" : "PROBABLE" }),
      assignment(c.id, "2027-02-01", "2027-03-15", 8, { isInternal: true }),
    ]);
    const big = input({
      months,
      consultants,
      assignments,
      jornadas: [
        { consultantId: null, country: "Default", hoursPerDay: 8, validFrom: "2000-01-01" },
        { consultantId: null, country: "Colombia", hoursPerDay: 8, validFrom: "2000-01-01" },
        { consultantId: null, country: "Colombia", hoursPerDay: 8.4, validFrom: "2026-07-15" },
      ],
      holidays: [...EXCEL_HOLIDAYS, { country: "Ecuador", city: "Quito", date: "2026-12-07" }],
    });
    computeMonthlyCapacity(big); // calentamiento del JIT
    const t0 = performance.now();
    const r = computeMonthlyCapacity(big);
    const elapsed = performance.now() - t0;
    expect(r.consultants).toHaveLength(60);
    expect(elapsed).toBeLessThan(50);
  });
});

// ─── monthRange y toHoursPerWeek ────────────────────────────────────────────────────────

describe("monthRange", () => {
  it("devuelve los meses consecutivos, cruzando el año", () => {
    expect(monthRange("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(monthRange("2026-10", "2026-10")).toEqual(["2026-10"]);
  });

  it("acepta exactamente 24 meses y rechaza 25", () => {
    expect(monthRange("2026-01", "2027-12")).toHaveLength(24);
    expect(() => monthRange("2026-01", "2028-01")).toThrow(/24/);
  });

  it("rechaza orden inválido y formatos inválidos", () => {
    expect(() => monthRange("2027-01", "2026-12")).toThrow(/posterior/);
    expect(() => monthRange("2026-13", "2027-01")).toThrow(/inválido/);
    expect(() => monthRange("2026-1", "2027-01")).toThrow(/inválido/);
  });
});

describe("toHoursPerWeek", () => {
  const base = { allocationPct: null, hoursPerPeriod: null, periodUnit: null };
  it("HOURS + week devuelve las horas tal cual (también sin unidad)", () => {
    expect(toHoursPerWeek({ ...base, allocationMode: "HOURS", hoursPerPeriod: 32, periodUnit: "week" }, 8)).toBe(32);
    expect(toHoursPerWeek({ ...base, allocationMode: "HOURS", hoursPerPeriod: 32 }, 8)).toBe(32);
  });
  it("HOURS + month: horas × 12 / 52", () => {
    expect(toHoursPerWeek({ ...base, allocationMode: "HOURS", hoursPerPeriod: 160, periodUnit: "month" }, 8)).toBeCloseTo(36.923077, 5);
  });
  it("PERCENTAGE: pct / 100 × jornada base × 5", () => {
    expect(toHoursPerWeek({ ...base, allocationMode: "PERCENTAGE", allocationPct: 50 }, 8)).toBe(20);
    expect(toHoursPerWeek({ ...base, allocationMode: "PERCENTAGE", allocationPct: 100 }, 8.4)).toBeCloseTo(42, 9);
  });
  it("valores nulos cuentan como 0 y una unidad desconocida lanza", () => {
    expect(toHoursPerWeek({ ...base, allocationMode: "PERCENTAGE" }, 8)).toBe(0);
    expect(toHoursPerWeek({ ...base, allocationMode: "HOURS", periodUnit: "week" }, 8)).toBe(0);
    expect(() => toHoursPerWeek({ ...base, allocationMode: "HOURS", hoursPerPeriod: 8, periodUnit: "day" }, 8)).toThrow(/day/);
  });
});

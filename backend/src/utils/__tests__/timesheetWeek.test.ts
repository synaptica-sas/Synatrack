import { describe, it, expect } from "vitest";
import {
  weekStartOf,
  weekDays,
  formatDateLong,
  validateWeekSubmission,
  resolveReviewer,
  buildReviewRows,
  type ValidateWeekSubmissionInput,
  type WeekEntryInput,
  type ReviewEntryInput,
  type ConsultantReviewContext,
} from "../timesheetWeek.js";
import { crearJornadaPorDia } from "../capacity.js";
import { getHolidaysForYear } from "../holidays.js";
import { toIsoDate } from "../isoDate.js";

const ONE_MINUTE = 0.0167; // 1 min a 4 decimales

// Semana del lunes 2 al domingo 8 de noviembre de 2026. En Colombia el lunes 2 es festivo
// (Todos los Santos, trasladado a lunes).
const WEEK = "2026-11-02";
const COLOMBIA_2026 = new Set(getHolidaysForYear(2026, "Colombia").map((h) => toIsoDate(h.date)));

// Semana sin festivos: lunes 9 a domingo 15 de noviembre de 2026.
const PLAIN_WEEK = "2026-11-09";
const PLAIN_DAYS = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"];

function reg(workDate: string, hours: number, over: Partial<WeekEntryInput> = {}): WeekEntryInput {
  return { projectId: "p1", workDate, category: "REGULAR", hours, status: "PENDING", ...over };
}

function fullWeek(days: string[], hours = 8, over: Partial<WeekEntryInput> = {}): WeekEntryInput[] {
  return days.map((d) => reg(d, hours, over));
}

function input(over: Partial<ValidateWeekSubmissionInput> = {}): ValidateWeekSubmissionInput {
  return {
    weekStart: PLAIN_WEEK,
    today: "2026-11-16",
    jornada: () => ({ hoursPerDay: 8 }),
    holidays: new Set(),
    entries: fullWeek(PLAIN_DAYS),
    reviews: [],
    ...over,
  };
}

const codes = (i: ValidateWeekSubmissionInput) => validateWeekSubmission(i).errors.map((e) => e.code);

describe("weekStartOf / weekDays", () => {
  it("lunes de la semana para cada día, domingo incluido", () => {
    expect(weekStartOf("2026-11-02")).toBe("2026-11-02");
    expect(weekStartOf("2026-11-05")).toBe("2026-11-02");
    expect(weekStartOf("2026-11-08")).toBe("2026-11-02"); // domingo -> lunes anterior
    expect(weekStartOf("2026-11-09")).toBe("2026-11-09");
  });

  it("cruza mes y año", () => {
    expect(weekStartOf("2027-01-01")).toBe("2026-12-28");
    expect(weekDays("2026-12-28")).toEqual([
      "2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03",
    ]);
  });

  it("acepta Date leído en UTC (medianoche UTC de @db.Date)", () => {
    expect(weekStartOf(new Date(Date.UTC(2026, 10, 8)))).toBe("2026-11-02");
    // 23:30 UTC del domingo sigue siendo domingo en calendario UTC
    expect(weekStartOf(new Date("2026-11-08T23:30:00Z"))).toBe("2026-11-02");
  });

  it("weekDays exige lunes y la fecha válida", () => {
    expect(() => weekDays("2026-11-03")).toThrow(/lunes/);
    expect(() => weekStartOf("2026-02-30")).toThrow(/inválida/);
  });

  it("formatDateLong en español", () => {
    expect(formatDateLong("2026-11-02")).toBe("lunes 2 de noviembre de 2026");
    expect(formatDateLong("2026-11-11")).toBe("miércoles 11 de noviembre de 2026");
  });
});

describe("validateWeekSubmission", () => {
  it("semana completa sin revisiones: ok y envía el proyecto", () => {
    const r = validateWeekSubmission(input());
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.projectsToSubmit).toEqual(["p1"]);
    expect(r.days.filter((d) => d.isWorkday)).toHaveLength(5);
  });

  it("festivo en Colombia (lunes 2-nov-2026) no se exige; los demás sí", () => {
    expect(COLOMBIA_2026.has("2026-11-02")).toBe(true);
    const r = validateWeekSubmission(
      input({
        weekStart: WEEK,
        today: "2026-11-09",
        holidays: COLOMBIA_2026,
        entries: fullWeek(["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"]),
      }),
    );
    expect(r.ok).toBe(true);
    const monday = r.days[0];
    expect(monday).toMatchObject({ isWorkday: false, nonWorkingReason: "HOLIDAY", required: 0 });
  });

  it("jornada vigente por día con crearJornadaPorDia (cambio de 8 a 8.4 a mitad de semana)", () => {
    const jornada = crearJornadaPorDia([], "Colombia", [
      { country: "Colombia", hoursPerDay: 8, workDaysPerWeek: 5, validFrom: "2000-01-01" },
      { country: "Colombia", hoursPerDay: 8.4, workDaysPerWeek: 5, validFrom: "2026-11-12" },
    ]);
    const entries = [
      ...fullWeek(["2026-11-09", "2026-11-10", "2026-11-11"], 8),
      ...fullWeek(["2026-11-12", "2026-11-13"], 8), // a partir del jueves faltan 0.4 h
    ];
    const r = validateWeekSubmission(input({ jornada, entries }));
    expect(r.errors.map((e) => [e.code, e.date, e.missingHours])).toEqual([
      ["INCOMPLETE_DAY", "2026-11-12", 0.4],
      ["INCOMPLETE_DAY", "2026-11-13", 0.4],
    ]);
    expect(r.errors[0].message).toBe("El jueves 12 de noviembre de 2026 suma 8:00 de 8:24: faltan 0:24.");
  });

  it("día corto por 1 minuto bloquea y dice 0:01", () => {
    const entries = fullWeek(PLAIN_DAYS);
    entries[2] = reg("2026-11-11", 8 - ONE_MINUTE);
    const r = validateWeekSubmission(input({ entries }));
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ code: "INCOMPLETE_DAY", date: "2026-11-11", missingHours: ONE_MINUTE });
    expect(r.errors[0].message).toContain("faltan 0:01");
  });

  it("faltan unos segundos (sobre la tolerancia): bloquea y nunca dice 0:00", () => {
    const entries = fullWeek(PLAIN_DAYS);
    entries[0] = reg("2026-11-09", 7.9972); // falta 0.0028 h ≈ 10 s
    const r = validateWeekSubmission(input({ entries }));
    expect(r.errors[0].message).toContain("faltan 0:01");
  });

  it("ruido de coma flotante dentro de la tolerancia no bloquea", () => {
    const entries = PLAIN_DAYS.flatMap((d) => [reg(d, 2.8), reg(d, 2.8), reg(d, 2.8)]);
    const r = validateWeekSubmission(input({ jornada: () => ({ hoursPerDay: 8.4 }), entries }));
    expect(r.ok).toBe(true);
  });

  it("ausencia completa el día; EXTRA no; REJECTED no cuenta", () => {
    const entries: WeekEntryInput[] = [
      ...fullWeek(["2026-11-09", "2026-11-10"]),
      reg("2026-11-11", 4),
      reg("2026-11-11", 4, { projectId: "aus", category: "ABSENCE" }),
      reg("2026-11-12", 6),
      reg("2026-11-12", 2, { category: "EXTRA" }),
      reg("2026-11-13", 8, { status: "REJECTED" }),
      reg("2026-11-13", 8),
    ];
    const r = validateWeekSubmission(input({ entries }));
    expect(r.errors.map((e) => [e.code, e.date])).toEqual([["INCOMPLETE_DAY", "2026-11-12"]]);
    expect(r.days[2]).toMatchObject({ covered: 8, complete: true });
  });

  it("los registros ya APROBADOS o ENVIADOS cubren el día", () => {
    const entries: WeekEntryInput[] = [
      ...fullWeek(PLAIN_DAYS, 8, { projectId: "p1", status: "APPROVED" }),
      reg("2026-11-10", 1, { projectId: "p2", category: "EXTRA" }),
    ];
    const r = validateWeekSubmission(input({ entries }));
    expect(r.ok).toBe(true);
    expect(r.projectsToSubmit).toEqual(["p2"]);
  });

  it("consultor que ingresa el miércoles: lunes y martes no se exigen", () => {
    const r = validateWeekSubmission(
      input({ hireDate: "2026-11-11", entries: fullWeek(["2026-11-11", "2026-11-12", "2026-11-13"]) }),
    );
    expect(r.ok).toBe(true);
    expect(r.days.slice(0, 2).map((d) => d.nonWorkingReason)).toEqual(["BEFORE_HIRE", "BEFORE_HIRE"]);
  });

  it("consultor que sale el martes (exitDate incluido)", () => {
    const r = validateWeekSubmission(
      input({ exitDate: new Date(Date.UTC(2026, 10, 10)), entries: fullWeek(["2026-11-09", "2026-11-10"]) }),
    );
    expect(r.ok).toBe(true);
    expect(r.days[2].nonWorkingReason).toBe("AFTER_EXIT");
  });

  it("semana en curso: hoy miércoles, jueves y viernes vacíos -> WEEK_IN_PROGRESS + días", () => {
    const r = validateWeekSubmission(
      input({ today: "2026-11-11", entries: fullWeek(["2026-11-09", "2026-11-10", "2026-11-11"]) }),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => [e.code, e.date])).toEqual([
      ["WEEK_IN_PROGRESS", "2026-11-12"],
      ["INCOMPLETE_DAY", "2026-11-12"],
      ["INCOMPLETE_DAY", "2026-11-13"],
    ]);
    expect(r.errors[0].message).toContain("viernes 13 de noviembre de 2026");
  });

  it("semana en curso pero todos los días ya completos (vacaciones cargadas): se puede enviar", () => {
    const entries = fullWeek(PLAIN_DAYS, 8, { projectId: "aus", category: "ABSENCE" });
    const r = validateWeekSubmission(input({ today: "2026-11-10", entries }));
    expect(r.ok).toBe(true);
    expect(r.projectsToSubmit).toEqual(["aus"]);
  });

  it("hoy es el último laborable: completo se envía; incompleto solo INCOMPLETE_DAY", () => {
    expect(validateWeekSubmission(input({ today: "2026-11-13" })).ok).toBe(true);
    const r = validateWeekSubmission(input({ today: "2026-11-13", entries: fullWeek(PLAIN_DAYS.slice(0, 4)) }));
    expect(r.errors.map((e) => e.code)).toEqual(["INCOMPLETE_DAY"]);
  });

  it("día laborable sin jornada en el mapa -> NO_SCHEDULE (no asume 8)", () => {
    const jornada = { "2026-11-09": 8, "2026-11-10": 8, "2026-11-11": 8, "2026-11-12": 8 };
    const r = validateWeekSubmission(input({ jornada }));
    expect(r.errors.map((e) => [e.code, e.date])).toEqual([["NO_SCHEDULE", "2026-11-13"]]);
  });

  it("registros fuera de la semana se ignoran", () => {
    const r = validateWeekSubmission(input({ entries: [...fullWeek(PLAIN_DAYS), reg("2026-11-16", 8, { projectId: "otra" })] }));
    expect(r.projectsToSubmit).toEqual(["p1"]);
  });

  describe("proyectos a enviar", () => {
    it("reenvío: solo viajan los proyectos RETURNED", () => {
      const entries: WeekEntryInput[] = [
        ...PLAIN_DAYS.map((d) => reg(d, 4, { projectId: "a", status: "SUBMITTED" })),
        ...PLAIN_DAYS.map((d) => reg(d, 2, { projectId: "b", status: "APPROVED" })),
        ...PLAIN_DAYS.map((d) => reg(d, 2, { projectId: "c" })), // devuelto, corregido
      ];
      const r = validateWeekSubmission(
        input({
          entries,
          reviews: [
            { projectId: "a", status: "SUBMITTED" },
            { projectId: "b", status: "APPROVED" },
            { projectId: "c", status: "RETURNED" },
          ],
        }),
      );
      expect(r.ok).toBe(true);
      expect(r.projectsToSubmit).toEqual(["c"]);
    });

    it("todo enviado o aprobado -> NOTHING_TO_SUBMIT", () => {
      const entries = fullWeek(PLAIN_DAYS, 8, { status: "SUBMITTED" });
      const r = validateWeekSubmission(input({ entries, reviews: [{ projectId: "p1", status: "SUBMITTED" }] }));
      expect(r.errors.map((e) => e.code)).toEqual(["NOTHING_TO_SUBMIT"]);
      expect(r.projectsToSubmit).toEqual([]);
    });

    it("solo aprobados antes de R15 (sin revisión) -> NOTHING_TO_SUBMIT", () => {
      expect(codes(input({ entries: fullWeek(PLAIN_DAYS, 8, { status: "APPROVED" }) }))).toEqual(["NOTHING_TO_SUBMIT"]);
    });

    it("PENDING en proyecto con revisión SUBMITTED o APPROVED -> INCONSISTENT_REVIEW_STATE", () => {
      const entries: WeekEntryInput[] = [...fullWeek(PLAIN_DAYS, 4, { projectId: "a" }), ...fullWeek(PLAIN_DAYS, 4, { projectId: "b" })];
      const r = validateWeekSubmission(
        input({ entries, reviews: [{ projectId: "a", status: "APPROVED" }, { projectId: "b", status: "SUBMITTED" }] }),
      );
      expect(r.errors.map((e) => [e.code, e.projectId])).toEqual([
        ["INCONSISTENT_REVIEW_STATE", "a"],
        ["INCONSISTENT_REVIEW_STATE", "b"],
        ["NOTHING_TO_SUBMIT", undefined],
      ]);
      expect(r.errors[0].message).toContain("aprobada");
    });

    it("registros SUBMITTED sin revisión SUBMITTED -> INCONSISTENT_REVIEW_STATE", () => {
      const r = validateWeekSubmission(input({ entries: fullWeek(PLAIN_DAYS, 8, { status: "SUBMITTED" }) }));
      expect(r.errors[0]).toMatchObject({ code: "INCONSISTENT_REVIEW_STATE", projectId: "p1" });
    });

    it("proyecto devuelto al que el consultor le borró todo: se informa y cuenta como algo que enviar", () => {
      const r = validateWeekSubmission(
        input({
          entries: fullWeek(PLAIN_DAYS, 8, { projectId: "a", status: "SUBMITTED" }),
          reviews: [{ projectId: "a", status: "SUBMITTED" }, { projectId: "x", status: "RETURNED" }],
        }),
      );
      expect(r.ok).toBe(true);
      expect(r.projectsToSubmit).toEqual([]);
      expect(r.returnedWithoutEntries).toEqual(["x"]);
    });
  });
});

describe("resolveReviewer", () => {
  const base = {
    projectManagerEmail: "pm@synaptica.co",
    consultantEmail: "ana@synaptica.co",
    delegations: [] as { fromUserEmail: string; toUserEmail: string; startDate: string | Date; endDate: string | Date }[],
    weekStart: PLAIN_WEEK,
  };

  it("PM del proyecto, sin distinguir mayúsculas ni espacios", () => {
    const r = resolveReviewer({ ...base, actor: { email: " PM@Synaptica.CO ", roles: ["PM"] } });
    expect(r).toMatchObject({ canReview: true, reason: "PROJECT_MANAGER", reviewerKind: "PROJECT_MANAGER" });
  });

  it("ADMIN no revisa si el proyecto tiene otro PM", () => {
    const r = resolveReviewer({ ...base, actor: { email: "admin@synaptica.co", roles: ["ADMIN"] } });
    expect(r).toMatchObject({ canReview: false, reason: "NOT_REVIEWER" });
  });

  it("nadie revisa sus propias horas, aunque sea ADMIN o PM", () => {
    expect(resolveReviewer({ ...base, actor: { email: "ana@synaptica.co", roles: ["ADMIN"] } }).reason).toBe("SELF_REVIEW");
    const pmSelf = resolveReviewer({ ...base, projectManagerEmail: "Ana@synaptica.co", actor: { email: "ana@synaptica.co", roles: ["ADMIN", "PM"] } });
    expect(pmSelf).toMatchObject({ canReview: false, reason: "SELF_REVIEW", reviewerKind: "ADMIN" });
  });

  it("PM = propio consultor -> revisa ADMIN; un no ADMIN no", () => {
    const i = { ...base, projectManagerEmail: "ana@synaptica.co" };
    expect(resolveReviewer({ ...i, actor: { email: "admin@synaptica.co", roles: ["ADMIN"] } })).toMatchObject({
      canReview: true,
      reason: "ADMIN_FALLBACK",
    });
    expect(resolveReviewer({ ...i, actor: { email: "otro@synaptica.co", roles: ["PM"] } }).canReview).toBe(false);
  });

  it("Ausencias sin PM -> revisa ADMIN", () => {
    const i = { ...base, projectManagerEmail: null };
    expect(resolveReviewer({ ...i, actor: { email: "admin@synaptica.co", roles: ["admin"] } })).toMatchObject({
      canReview: true,
      reason: "ADMIN_FALLBACK",
      reviewerKind: "ADMIN",
    });
    expect(resolveReviewer({ ...i, projectManagerEmail: "  ", actor: { email: "pm@synaptica.co", roles: ["PM"] } }).canReview).toBe(false);
  });

  it("delegación que cubre solo jueves-viernes habilita al delegado para toda la semana", () => {
    const delegations = [{ fromUserEmail: "PM@synaptica.co", toUserEmail: "luis@synaptica.co", startDate: "2026-11-12", endDate: "2026-11-20" }];
    expect(resolveReviewer({ ...base, delegations, actor: { email: "luis@synaptica.co", roles: ["CONSULTANT"] } })).toMatchObject({
      canReview: true,
      reason: "DELEGATE",
    });
  });

  it("delegación que termina el domingo anterior o empieza el lunes siguiente no cubre", () => {
    const actor = { email: "luis@synaptica.co", roles: ["PM"] };
    const before = [{ fromUserEmail: "pm@synaptica.co", toUserEmail: "luis@synaptica.co", startDate: "2026-11-01", endDate: "2026-11-08" }];
    const after = [{ fromUserEmail: "pm@synaptica.co", toUserEmail: "luis@synaptica.co", startDate: "2026-11-16", endDate: "2026-11-30" }];
    expect(resolveReviewer({ ...base, delegations: before, actor }).canReview).toBe(false);
    expect(resolveReviewer({ ...base, delegations: after, actor }).canReview).toBe(false);
    // el domingo de la semana sí cuenta (Date a medianoche UTC)
    const sunday = [{ fromUserEmail: "pm@synaptica.co", toUserEmail: "luis@synaptica.co", startDate: new Date(Date.UTC(2026, 10, 15)), endDate: new Date(Date.UTC(2026, 10, 20)) }];
    expect(resolveReviewer({ ...base, delegations: sunday, actor }).canReview).toBe(true);
  });

  it("delegación de otra persona (no del PM) o a otro delegado no habilita", () => {
    const actor = { email: "luis@synaptica.co", roles: ["PM"] };
    const otherFrom = [{ fromUserEmail: "x@synaptica.co", toUserEmail: "luis@synaptica.co", startDate: "2026-11-01", endDate: "2026-11-30" }];
    const otherTo = [{ fromUserEmail: "pm@synaptica.co", toUserEmail: "eva@synaptica.co", startDate: "2026-11-01", endDate: "2026-11-30" }];
    expect(resolveReviewer({ ...base, delegations: otherFrom, actor }).canReview).toBe(false);
    expect(resolveReviewer({ ...base, delegations: otherTo, actor }).canReview).toBe(false);
  });

  it("el delegado nunca revisa sus propias horas", () => {
    const delegations = [{ fromUserEmail: "pm@synaptica.co", toUserEmail: "ana@synaptica.co", startDate: "2026-11-01", endDate: "2026-11-30" }];
    expect(resolveReviewer({ ...base, delegations, actor: { email: "ana@synaptica.co", roles: ["PM"] } }).reason).toBe("SELF_REVIEW");
  });

  it("con PM = consultor, la delegación no aplica (solo ADMIN)", () => {
    const delegations = [{ fromUserEmail: "ana@synaptica.co", toUserEmail: "luis@synaptica.co", startDate: "2026-11-01", endDate: "2026-11-30" }];
    const r = resolveReviewer({ ...base, projectManagerEmail: "ana@synaptica.co", delegations, actor: { email: "luis@synaptica.co", roles: ["PM"] } });
    expect(r.canReview).toBe(false);
  });

  it("delegación con fin anterior al inicio no cubre nada", () => {
    const delegations = [{ fromUserEmail: "pm@synaptica.co", toUserEmail: "luis@synaptica.co", startDate: "2026-11-13", endDate: "2026-11-10" }];
    expect(resolveReviewer({ ...base, delegations, actor: { email: "luis@synaptica.co", roles: ["PM"] } }).canReview).toBe(false);
  });
});

describe("buildReviewRows", () => {
  type E = ReviewEntryInput & { id: string };
  let seq = 0;
  const e = (over: Partial<E> & { workDate: string }): E => ({
    id: `e${++seq}`,
    consultantId: "ana",
    projectId: "p1",
    category: "REGULAR",
    hours: 8,
    status: "SUBMITTED",
    ...over,
  });
  const ctx = (over: Partial<ConsultantReviewContext> = {}): ConsultantReviewContext => ({
    jornada: () => ({ hoursPerDay: 8 }),
    holidays: COLOMBIA_2026,
    dailyTotals: {},
    ...over,
  });

  it("agrega por consultor × proyecto × semana, con total y días L-D", () => {
    const { rows, warnings } = buildReviewRows({
      entries: [
        e({ workDate: "2026-11-10", hours: 4 }),
        e({ workDate: "2026-11-10", hours: 4 }),
        e({ workDate: "2026-11-11", projectId: "p2" }),
        e({ workDate: "2026-11-16", hours: 3 }), // otra semana
        e({ workDate: "2026-11-11", consultantId: "beto" }),
      ],
      reviews: [{ consultantId: "ana", projectId: "p1", weekStart: PLAIN_WEEK, status: "SUBMITTED" }],
      consultants: { ana: ctx(), beto: ctx() },
    });
    expect(warnings).toEqual([]);
    expect(rows.map((r) => [r.weekStart, r.consultantId, r.projectId, r.total, r.status])).toEqual([
      ["2026-11-09", "ana", "p1", 8, "SUBMITTED"],
      ["2026-11-09", "ana", "p2", 8, "SUBMITTED"], // sin revisión: derivado de los registros
      ["2026-11-09", "beto", "p1", 8, "SUBMITTED"],
      ["2026-11-16", "ana", "p1", 3, "SUBMITTED"],
    ]);
    expect(rows[0].days.map((d) => d.hours)).toEqual([0, 8, 0, 0, 0, 0, 0]);
    expect(rows[0].entries).toHaveLength(2);
    expect(rows[0].flags).toEqual([]);
  });

  it("flags combinados: extra + excedente + fin de semana + por encima de la jornada", () => {
    const { rows } = buildReviewRows({
      entries: [
        e({ workDate: "2026-11-10", hours: 8 }),
        e({ workDate: "2026-11-10", category: "EXTRA", hours: 2 }),
        e({ workDate: "2026-11-10", category: "EXTRA", hours: 1, isExcess: true }),
        e({ workDate: "2026-11-14", category: "EXTRA", hours: 3 }), // sábado
      ],
      consultants: { ana: ctx() },
    });
    const [row] = rows;
    expect(row.days[1].flags).toEqual(["EXTRA", "EXCESS", "OVER_JORNADA"]);
    expect(row.days[1]).toMatchObject({ hours: 11, consultantTotal: 11, jornada: 8 });
    expect(row.days[5].flags).toEqual(["EXTRA", "NON_WORKING_DAY"]);
    expect(row.flags).toEqual(["EXTRA", "EXCESS", "NON_WORKING_DAY", "OVER_JORNADA"]);
    expect(row.total).toBe(14);
  });

  it("festivo de Colombia marca NON_WORKING_DAY; ausencia marca ABSENCE", () => {
    const { rows } = buildReviewRows({
      entries: [
        e({ workDate: "2026-11-02", category: "EXTRA", hours: 2 }), // lunes festivo
        e({ workDate: "2026-11-03", projectId: "aus", category: "ABSENCE", hours: 8 }),
      ],
      consultants: { ana: ctx() },
    });
    const p1 = rows.find((r) => r.projectId === "p1")!;
    const aus = rows.find((r) => r.projectId === "aus")!;
    expect(p1.days[0].flags).toEqual(["EXTRA", "NON_WORKING_DAY"]);
    expect(aus.days[1].flags).toEqual(["ABSENCE"]);
    expect(aus.flags).toEqual(["ABSENCE"]);
  });

  it("OVER_JORNADA usa el total del consultor en TODOS los proyectos (dailyTotals) y solo marca celdas con horas", () => {
    const { rows } = buildReviewRows({
      entries: [e({ workDate: "2026-11-10", hours: 6 })],
      consultants: { ana: ctx({ dailyTotals: { "2026-11-10": 9, "2026-11-11": 12 } }) },
    });
    expect(rows[0].days[1]).toMatchObject({ hours: 6, consultantTotal: 9, flags: ["OVER_JORNADA"] });
    expect(rows[0].days[2]).toMatchObject({ hours: 0, consultantTotal: 12, flags: [] });
  });

  it("dailyTotals menor que lo visible no subestima; justo en la jornada no marca", () => {
    const { rows } = buildReviewRows({
      entries: [e({ workDate: "2026-11-10", hours: 5 }), e({ workDate: "2026-11-10", projectId: "p2", hours: 3 })],
      consultants: { ana: ctx({ dailyTotals: { "2026-11-10": 2 } }) },
    });
    expect(rows[0].days[1]).toMatchObject({ consultantTotal: 8, flags: [] });
  });

  it("REJECTED no suma ni marca, pero se lista; fila solo con rechazos queda REJECTED", () => {
    const { rows } = buildReviewRows({
      entries: [e({ workDate: "2026-11-10", category: "EXTRA", hours: 5, status: "REJECTED" })],
      consultants: { ana: ctx() },
    });
    expect(rows[0]).toMatchObject({ total: 0, flags: [], status: "REJECTED" });
    expect(rows[0].entries).toHaveLength(1);
  });

  it("estado derivado sin revisión: PENDING si hay pendientes, APPROVED si todo aprobado", () => {
    const { rows } = buildReviewRows({
      entries: [
        e({ workDate: "2026-11-10", status: "APPROVED" }),
        e({ workDate: "2026-11-11", status: "PENDING" }),
        e({ workDate: "2026-11-10", projectId: "p2", status: "APPROVED" }),
      ],
      consultants: { ana: ctx() },
    });
    expect(rows.map((r) => [r.projectId, r.status, r.reviewStatus])).toEqual([
      ["p1", "PENDING", null],
      ["p2", "APPROVED", null],
    ]);
  });

  it("revisión RETURNED sin registros genera fila vacía", () => {
    const { rows } = buildReviewRows({
      entries: [],
      reviews: [{ consultantId: "ana", projectId: "p9", weekStart: new Date(Date.UTC(2026, 10, 9)), status: "RETURNED" }],
      consultants: {},
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ projectId: "p9", weekStart: "2026-11-09", total: 0, status: "RETURNED", flags: [] });
  });

  it("consultor sin contexto: marca fin de semana, advierte y no evalúa jornada", () => {
    const { rows, warnings } = buildReviewRows({
      entries: [e({ workDate: "2026-11-15", hours: 12 }), e({ workDate: "2026-11-02", hours: 12 })],
      consultants: {},
    });
    expect(warnings).toHaveLength(1);
    const nov15 = rows.find((r) => r.weekStart === "2026-11-09")!;
    expect(nov15.days[6].flags).toEqual(["NON_WORKING_DAY"]);
    const nov2 = rows.find((r) => r.weekStart === "2026-11-02")!;
    expect(nov2.days[0].flags).toEqual([]); // festivo no detectable sin contexto
  });

  it("día sin jornada en el mapa: advierte y no marca OVER_JORNADA", () => {
    const { rows, warnings } = buildReviewRows({
      entries: [e({ workDate: "2026-11-10", hours: 12 })],
      consultants: { ana: ctx({ jornada: {} }) },
    });
    expect(rows[0].days[1].flags).toEqual([]);
    expect(warnings[0]).toContain("2026-11-10");
  });
});

describe("resolveReviewer: identidad resuelta por el llamador (R15, H1)", () => {
  const base = {
    projectManagerEmail: "pm@x.com",
    consultantEmail: null,
    delegations: [],
    weekStart: "2026-09-07",
  };

  it("actorIsConsultant bloquea aunque el correo de la ficha esté vacío", () => {
    const r = resolveReviewer({ ...base, actor: { email: "pm@x.com", roles: ["PM"] }, actorIsConsultant: true });
    expect(r).toMatchObject({ canReview: false, reason: "SELF_REVIEW" });
  });

  it("projectManagerIsConsultant manda la revisión a ADMIN aunque los correos no coincidan", () => {
    const pm = resolveReviewer({ ...base, actor: { email: "pm@x.com", roles: ["PM"] }, projectManagerIsConsultant: true });
    expect(pm).toMatchObject({ canReview: false, reviewerKind: "ADMIN" });
    const admin = resolveReviewer({ ...base, actor: { email: "adm@x.com", roles: ["ADMIN"] }, projectManagerIsConsultant: true });
    expect(admin).toMatchObject({ canReview: true, reason: "ADMIN_FALLBACK" });
  });

  it("sin las señales conserva el comportamiento anterior", () => {
    expect(resolveReviewer({ ...base, actor: { email: "pm@x.com", roles: ["PM"] } }).canReview).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import {
  validateDay,
  splitExcess,
  splitTimerSpan,
  summarizeDay,
  toLocalExtraShift,
  exceedsCap,
  roundHours,
  type DayEntryInput,
  type ValidateDayInput,
  type ExtraRowInput,
} from "../timesheetRules.js";
import { resolveCountryTimezone } from "../country.js";

const ONE_SECOND = 1 / 3600;
const t = (iso: string) => new Date(iso);

function entry(over: Partial<DayEntryInput> = {}): DayEntryInput {
  return { projectId: "p1", category: "REGULAR", hours: 1, status: "PENDING", isAbsenceProject: false, ...over };
}

function day(over: Partial<ValidateDayInput> = {}): ValidateDayInput {
  return { hoursPerDay: 8.4, isNonWorkingDay: false, allowWeekendWork: false, entries: [], approvedExtraBalance: {}, ...over };
}

const codes = (input: ValidateDayInput) => validateDay(input).map((e) => e.code);

describe("exceedsCap / tolerancia", () => {
  it("8.4 exacto no excede; ruido de coma flotante tampoco", () => {
    expect(exceedsCap(8.4, 8.4)).toBe(false);
    expect(exceedsCap(2.8 + 2.8 + 2.8, 8.4)).toBe(false);
    expect(exceedsCap(8.4001, 8.4)).toBe(false); // un paso de redondeo (0.36 s) se tolera
  });
  it("un segundo por encima sí excede", () => {
    expect(exceedsCap(8.4 + ONE_SECOND, 8.4)).toBe(true);
    expect(exceedsCap(roundHours(8.4 + ONE_SECOND), 8.4)).toBe(true);
  });
});

describe("validateDay — tope diario", () => {
  it("Colombia 8.4 (8:24) exacto en el tope es válido", () => {
    expect(validateDay(day({ entries: [entry({ hours: 8.4 })] }))).toEqual([]);
  });

  it("un segundo por encima del tope falla y marca la fila", () => {
    const errs = validateDay(day({ entries: [entry({ id: "a", hours: roundHours(8.4 + ONE_SECOND) })] }));
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatchObject({ index: 0, id: "a", code: "DAILY_CAP_EXCEEDED" });
    expect(errs[0].message).toContain("8:24");
  });

  it("suma todos los proyectos y culpa la primera fila editable que cruza", () => {
    const errs = validateDay(
      day({
        entries: [
          entry({ projectId: "p1", hours: 4, status: "APPROVED" }),
          entry({ projectId: "p2", hours: 3 }),
          entry({ projectId: "p3", hours: 2 }),
          entry({ projectId: "p4", hours: 1 }),
        ],
      }),
    );
    expect(errs.map((e) => [e.index, e.code])).toEqual([[2, "DAILY_CAP_EXCEEDED"]]);
  });

  it("varios proyectos sumando exactamente 8.4 es válido", () => {
    const entries = [entry({ projectId: "p1", hours: 2.8 }), entry({ projectId: "p2", hours: 2.8 }), entry({ projectId: "p3", hours: 2.8 })];
    expect(validateDay(day({ entries }))).toEqual([]);
  });

  it("las ausencias cuentan contra la jornada", () => {
    const entries = [
      entry({ projectId: "aus", category: "ABSENCE", hours: 4, isAbsenceProject: true }),
      entry({ projectId: "p1", hours: 4.5 }),
    ];
    expect(codes(day({ entries }))).toEqual(["DAILY_CAP_EXCEEDED"]);
  });

  it("los rechazados se ignoran (ni cuentan ni se validan)", () => {
    const entries = [entry({ hours: 8.4, status: "REJECTED" }), entry({ hours: -3, status: "REJECTED" }), entry({ hours: 8.4 })];
    expect(validateDay(day({ entries }))).toEqual([]);
  });

  it("EXTRA no cuenta contra la jornada", () => {
    const entries = [
      entry({ hours: 8.4 }),
      entry({ category: "EXTRA", hours: 2, startedAt: t("2026-11-04T23:00:00Z"), endedAt: t("2026-11-05T01:00:00Z") }),
    ];
    expect(validateDay(day({ entries, approvedExtraBalance: { p1: 2 } }))).toEqual([]);
  });

  it("si solo lo aprobado excede el tope, no se bloquea guardar extras", () => {
    const entries = [
      entry({ hours: 9, status: "APPROVED" }),
      entry({ category: "EXTRA", hours: 1, startedAt: t("2026-11-04T23:00:00Z"), endedAt: t("2026-11-05T00:00:00Z") }),
    ];
    expect(validateDay(day({ entries, approvedExtraBalance: { p1: 1 } }))).toEqual([]);
  });

  it("jornada inválida es un error del día (index null)", () => {
    expect(validateDay(day({ hoursPerDay: Number.NaN }))[0]).toMatchObject({ index: null, code: "INVALID_SCHEDULE" });
  });
});

describe("validateDay — reglas por fila", () => {
  it("horas deben ser > 0 y ≤ 24", () => {
    expect(codes(day({ entries: [entry({ hours: 0 })] }))).toEqual(["HOURS_NOT_POSITIVE"]);
    expect(codes(day({ entries: [entry({ hours: -1 })] }))).toEqual(["HOURS_NOT_POSITIVE"]);
    expect(codes(day({ hoursPerDay: 30, entries: [entry({ hours: 25 })] }))).toEqual(["HOURS_OVER_24"]);
  });

  it("fin de semana sin allowWeekendWork: REGULAR rechazado", () => {
    expect(codes(day({ isNonWorkingDay: true, entries: [entry({ hours: 2 })] }))).toEqual(["REGULAR_ON_NON_WORKING_DAY"]);
  });

  it("fin de semana con allowWeekendWork: REGULAR permitido y con tope", () => {
    expect(validateDay(day({ isNonWorkingDay: true, allowWeekendWork: true, entries: [entry({ hours: 8.4 })] }))).toEqual([]);
    expect(codes(day({ isNonWorkingDay: true, allowWeekendWork: true, entries: [entry({ hours: 9 })] }))).toEqual(["DAILY_CAP_EXCEEDED"]);
  });

  it("festivo sin allowWeekendWork: ausencia rechazada, EXTRA aprobada sí", () => {
    const entries = [
      entry({ projectId: "aus", category: "ABSENCE", hours: 8, isAbsenceProject: true }),
      entry({ category: "EXTRA", hours: 3, startedAt: t("2026-11-07T14:00:00Z"), endedAt: t("2026-11-07T17:00:00Z") }),
    ];
    expect(codes(day({ isNonWorkingDay: true, entries, approvedExtraBalance: { p1: 3 } }))).toEqual(["ABSENCE_ON_NON_WORKING_DAY"]);
  });

  it("EXTRA sin saldo aprobado en ESE proyecto falla", () => {
    const e = entry({ projectId: "p2", category: "EXTRA", hours: 1, startedAt: t("2026-11-04T23:00:00Z"), endedAt: t("2026-11-05T00:00:00Z") });
    expect(codes(day({ entries: [e], approvedExtraBalance: { p1: 4 } }))).toEqual(["EXTRA_WITHOUT_APPROVAL"]);
    expect(codes(day({ entries: [e], approvedExtraBalance: { p2: 0 } }))).toEqual(["EXTRA_WITHOUT_APPROVAL"]);
  });

  it("EXTRA sin franja o con franja invertida falla", () => {
    const bal = { p1: 2 };
    expect(codes(day({ entries: [entry({ category: "EXTRA", hours: 1 })], approvedExtraBalance: bal }))).toEqual(["EXTRA_REQUIRES_SPAN"]);
    expect(
      codes(day({ entries: [entry({ category: "EXTRA", hours: 1, startedAt: t("2026-11-04T23:00:00Z") })], approvedExtraBalance: bal })),
    ).toEqual(["EXTRA_REQUIRES_SPAN"]);
    expect(
      codes(
        day({
          entries: [entry({ category: "EXTRA", hours: 1, startedAt: t("2026-11-04T23:00:00Z"), endedAt: t("2026-11-04T22:00:00Z") })],
          approvedExtraBalance: bal,
        }),
      ),
    ).toEqual(["EXTRA_INVALID_SPAN"]);
  });

  it("EXTRA con horas distintas de la franja falla (la nómina paga la franja)", () => {
    const e = entry({ category: "EXTRA", hours: 2, startedAt: t("2026-11-04T23:00:00Z"), endedAt: t("2026-11-05T00:00:00Z") });
    expect(codes(day({ entries: [e], approvedExtraBalance: { p1: 2 } }))).toEqual(["EXTRA_HOURS_SPAN_MISMATCH"]);
  });

  it("ABSENCE fuera del proyecto de Ausencias y no-ABSENCE dentro fallan", () => {
    expect(codes(day({ entries: [entry({ category: "ABSENCE", hours: 2 })] }))).toEqual(["ABSENCE_OUTSIDE_ABSENCE_PROJECT"]);
    expect(codes(day({ entries: [entry({ projectId: "aus", hours: 2, isAbsenceProject: true })] }))).toEqual([
      "NON_ABSENCE_IN_ABSENCE_PROJECT",
    ]);
  });

  it("las filas aprobadas no se revalidan", () => {
    expect(validateDay(day({ isNonWorkingDay: true, entries: [entry({ hours: 2, status: "APPROVED" })] }))).toEqual([]);
  });
});

describe("splitExcess", () => {
  const row = (over: Partial<ExtraRowInput>): ExtraRowInput => ({
    hours: 1,
    startedAt: null,
    endedAt: null,
    status: "PENDING",
    isExcess: false,
    ...over,
  });

  it("todo dentro del saldo queda normal", () => {
    const r = splitExcess([row({ id: "a", hours: 2, startedAt: t("2026-11-04T23:00:00Z"), endedAt: t("2026-11-05T01:00:00Z") })], 2);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ id: "a", part: "whole", isExcess: false, hours: 2 });
    expect(r).toMatchObject({ normalHours: 2, excessHours: 0, remainingBalance: 0 });
  });

  it("corta a mitad de fila: primera normal, segunda excedente desde startedAt + saldo", () => {
    const r = splitExcess(
      [
        row({ id: "b", hours: 2, startedAt: t("2026-11-05T01:00:00Z"), endedAt: t("2026-11-05T03:00:00Z") }),
        row({ id: "a", hours: 1, startedAt: t("2026-11-04T23:00:00Z"), endedAt: t("2026-11-05T00:00:00Z") }),
      ],
      2.5,
    );
    expect(r.rows.map((x) => [x.id, x.part, x.hours, x.isExcess])).toEqual([
      ["a", "whole", 1, false],
      ["b", "first", 1.5, false],
      [undefined, "second", 0.5, true],
    ]);
    expect(r.rows[1].endedAt).toEqual(t("2026-11-05T02:30:00Z"));
    expect(r.rows[2].startedAt).toEqual(t("2026-11-05T02:30:00Z"));
    expect(r.rows[2].endedAt).toEqual(t("2026-11-05T03:00:00Z"));
    expect(r.rows[2].sourceIndex).toBe(0);
    expect(r).toMatchObject({ normalHours: 2.5, excessHours: 0.5, remainingBalance: 0 });
  });

  it("saldo agotado: las filas siguientes quedan enteras como excedente", () => {
    const r = splitExcess(
      [
        row({ hours: 2, startedAt: t("2026-11-04T23:00:00Z"), endedAt: t("2026-11-05T01:00:00Z") }),
        row({ hours: 1, startedAt: t("2026-11-05T01:00:00Z"), endedAt: t("2026-11-05T02:00:00Z") }),
      ],
      2,
    );
    expect(r.rows.map((x) => [x.part, x.isExcess])).toEqual([
      ["whole", false],
      ["whole", true],
    ]);
  });

  it("respeta lo aprobado: el excedente aprobado no consume saldo; el normal aprobado sí", () => {
    const r = splitExcess(
      [
        row({ id: "ok", hours: 1, status: "APPROVED", startedAt: t("2026-11-04T22:00:00Z"), endedAt: t("2026-11-04T23:00:00Z") }),
        row({ id: "x", hours: 1, status: "APPROVED", isExcess: true, startedAt: t("2026-11-04T23:00:00Z"), endedAt: t("2026-11-05T00:00:00Z") }),
        row({ id: "new", hours: 1, isExcess: true, startedAt: t("2026-11-05T00:00:00Z"), endedAt: t("2026-11-05T01:00:00Z") }),
        row({ id: "rej", hours: 5, status: "REJECTED" }),
      ],
      2,
    );
    // "new" venía como excedente pendiente; con saldo 2 - 1 (aprobado normal) = 1 pasa a normal.
    expect(r.rows.map((x) => [x.id, x.isExcess, x.fixed])).toEqual([
      ["ok", false, true],
      ["x", true, true],
      ["new", false, false],
    ]);
    expect(r.remainingBalance).toBe(0);
  });

  it("informa si lo aprobado ya supera el saldo", () => {
    const r = splitExcess([row({ hours: 3, status: "APPROVED" }), row({ hours: 1 })], 2);
    expect(r.fixedOverBalance).toBe(1);
    expect(r.rows[1]).toMatchObject({ isExcess: true, part: "whole" });
  });

  it("no parte por un exceso dentro de la tolerancia", () => {
    const r = splitExcess([row({ hours: 2.0001, startedAt: t("2026-11-04T23:00:00Z"), endedAt: t("2026-11-05T01:00:00Z") })], 2);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].isExcess).toBe(false);
  });
});

describe("splitTimerSpan", () => {
  const base = { hoursPerDay: 8.4, alreadyUsedRegular: 0, regularAllowed: true };

  it("franja dentro de la jornada: un solo tramo REGULAR y nada descartado", () => {
    const r = splitTimerSpan({ ...base, start: t("2026-11-04T13:00:00Z"), end: t("2026-11-04T15:30:00Z") });
    expect(r.segments).toEqual([
      { category: "REGULAR", isExcess: false, startedAt: t("2026-11-04T13:00:00Z"), endedAt: t("2026-11-04T15:30:00Z"), hours: 2.5 },
    ]);
    expect(r.discardedHours).toBe(0);
    expect(r.discardedFrom).toBeNull();
    expect(r.discardedTo).toBeNull();
  });

  it("lo que pasa de la jornada se descarta, nunca se convierte en EXTRA", () => {
    // Ya hay 6 h; quedan 2.4 (2:24). Franja de 5 h: 2.4 REGULAR y 2.6 descartadas.
    const r = splitTimerSpan({ ...base, alreadyUsedRegular: 6, start: t("2026-11-04T20:00:00Z"), end: t("2026-11-05T01:00:00Z") });
    expect(r.segments.map((s) => [s.category, s.isExcess, s.startedAt.toISOString(), s.endedAt.toISOString(), s.hours])).toEqual([
      ["REGULAR", false, "2026-11-04T20:00:00.000Z", "2026-11-04T22:24:00.000Z", 2.4],
    ]);
    expect(r.discardedHours).toBe(2.6);
    expect(r.discardedFrom).toEqual(t("2026-11-04T22:24:00Z"));
    expect(r.discardedTo).toEqual(t("2026-11-05T01:00:00Z"));
    expect(r.totalHours).toBe(5);
  });

  it("guarda hasta el tope y descarta el resto", () => {
    const r = splitTimerSpan({ ...base, alreadyUsedRegular: 7.4, start: t("2026-11-04T20:00:00Z"), end: t("2026-11-04T23:00:00Z") });
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0]).toMatchObject({ category: "REGULAR", hours: 1 });
    expect(r.discardedHours).toBe(2);
    expect(r.discardedFrom).toEqual(t("2026-11-04T21:00:00Z"));
    expect(r.discardedTo).toEqual(t("2026-11-04T23:00:00Z"));
  });

  it("jornada ya llena: no se guarda nada, todo se descarta", () => {
    const r = splitTimerSpan({ ...base, alreadyUsedRegular: 8.4, start: t("2026-11-04T23:00:00Z"), end: t("2026-11-05T00:30:00Z") });
    expect(r.segments).toEqual([]);
    expect(r.discardedHours).toBe(1.5);
  });

  it("jornada ya excedida (dato histórico) se trata como llena", () => {
    const r = splitTimerSpan({ ...base, alreadyUsedRegular: 9, start: t("2026-11-04T23:00:00Z"), end: t("2026-11-05T00:00:00Z") });
    expect(r.segments).toEqual([]);
    expect(r.discardedHours).toBe(1);
  });

  it("día no laborable sin permiso: nada se guarda, todo se descarta", () => {
    const r = splitTimerSpan({ ...base, regularAllowed: false, start: t("2026-11-07T14:00:00Z"), end: t("2026-11-07T16:00:00Z") });
    expect(r.segments).toEqual([]);
    expect(r.discardedHours).toBe(2);
    expect(r.discardedFrom).toEqual(t("2026-11-07T14:00:00Z"));
  });

  it("el tramo REGULAR nunca supera la jornada (corte truncado al segundo)", () => {
    // Restan 8.4 - 0.0001 h = 30239.64 s -> corte en 30239 s.
    const r = splitTimerSpan({ ...base, alreadyUsedRegular: 0.0001, start: t("2026-11-04T08:00:00Z"), end: t("2026-11-04T18:00:00Z") });
    const reg = r.segments[0];
    expect(reg.endedAt.getTime() - reg.startedAt.getTime()).toBe(30239_000);
    expect(exceedsCap(0.0001 + reg.hours, 8.4)).toBe(false);
  });

  it("franja vacía o invertida no produce tramos", () => {
    const r = splitTimerSpan({ ...base, start: t("2026-11-04T10:00:00Z"), end: t("2026-11-04T09:00:00Z") });
    expect(r).toMatchObject({ segments: [], discardedHours: 0, totalHours: 0 });
  });
});

describe("summarizeDay", () => {
  it("resume regular, ausencias, restante y extra por proyecto", () => {
    const s = summarizeDay(
      day({
        entries: [
          entry({ projectId: "p1", hours: 3 }),
          entry({ projectId: "aus", category: "ABSENCE", hours: 2, isAbsenceProject: true }),
          entry({ projectId: "p1", hours: 5, status: "REJECTED" }),
          entry({ projectId: "p1", category: "EXTRA", hours: 1.5 }),
          entry({ projectId: "p1", category: "EXTRA", hours: 0.5, isExcess: true }),
          entry({ projectId: "p1", category: "EXTRA", hours: 4, status: "REJECTED" }),
        ],
        approvedExtraBalance: { p1: 2, p9: 1, p0: 0 },
      }),
    );
    expect(s).toEqual({
      hoursPerDay: 8.4,
      isNonWorkingDay: false,
      regularAllowed: true,
      usedRegular: 3,
      usedAbsence: 2,
      usedAgainstCap: 5,
      remaining: 3.4,
      overBy: 0,
      projects: [
        { projectId: "p1", extraApproved: 2, extraUsed: 1.5, extraExcess: 0.5, extraRemaining: 0.5 },
        { projectId: "p9", extraApproved: 1, extraUsed: 0, extraExcess: 0, extraRemaining: 1 },
      ],
    });
  });

  it("día no laborable sin permiso: restante 0", () => {
    const s = summarizeDay(day({ isNonWorkingDay: true }));
    expect(s).toMatchObject({ regularAllowed: false, remaining: 0 });
  });

  it("informa el exceso histórico", () => {
    expect(summarizeDay(day({ entries: [entry({ hours: 9, status: "APPROVED" })] })).overBy).toBe(0.6);
  });
});

describe("toLocalExtraShift", () => {
  it("Colombia (UTC-5): convierte a fecha y hora local", () => {
    const r = toLocalExtraShift({ startedAt: t("2026-11-04T23:00:00Z"), endedAt: t("2026-11-05T01:30:00Z"), country: "Colombia" });
    expect(r.timeZone).toBe("America/Bogota");
    expect(r.warnings).toEqual([]);
    expect(r.segments).toEqual([
      { date: t("2026-11-04T00:00:00Z"), isoDate: "2026-11-04", startTime: "18:00:00", endTime: "20:30:00", realHours: 2.5, wallClockHours: 2.5 },
    ]);
  });

  it("el día local puede ser distinto del día UTC", () => {
    // 02:00 UTC del 5 = 21:00 del 4 en Bogotá.
    const r = toLocalExtraShift({ startedAt: t("2026-11-05T02:00:00Z"), endedAt: t("2026-11-05T03:00:00Z"), country: "colombia" });
    expect(r.segments[0]).toMatchObject({ isoDate: "2026-11-04", startTime: "21:00:00", endTime: "22:00:00" });
  });

  it("cruce de medianoche local sin partir: un tramo con fin < inicio (calculateExtraHours lo pasa al día siguiente)", () => {
    const r = toLocalExtraShift({ startedAt: t("2026-11-05T03:00:00Z"), endedAt: t("2026-11-05T07:00:00Z"), country: "Colombia" });
    expect(r.segments).toEqual([
      { date: t("2026-11-04T00:00:00Z"), isoDate: "2026-11-04", startTime: "22:00:00", endTime: "02:00:00", realHours: 4, wallClockHours: 4 },
    ]);
  });

  it("cruce de medianoche con splitAtLocalMidnight: un tramo por día local", () => {
    const r = toLocalExtraShift({ startedAt: t("2026-11-05T03:00:00Z"), endedAt: t("2026-11-05T07:00:00Z"), country: "Colombia", splitAtLocalMidnight: true });
    expect(r.segments.map((s) => [s.isoDate, s.startTime, s.endTime, s.realHours])).toEqual([
      ["2026-11-04", "22:00:00", "00:00:00", 2],
      ["2026-11-05", "00:00:00", "02:00:00", 2],
    ]);
  });

  it("fin exactamente a medianoche local", () => {
    const r = toLocalExtraShift({ startedAt: t("2026-11-05T03:00:00Z"), endedAt: t("2026-11-05T05:00:00Z"), country: "Colombia" });
    expect(r.segments[0]).toMatchObject({ isoDate: "2026-11-04", startTime: "22:00:00", endTime: "00:00:00", wallClockHours: 2 });
  });

  it("país desconocido o vacío: zona por defecto con advertencia", () => {
    const r = toLocalExtraShift({ startedAt: t("2026-11-04T23:00:00Z"), endedAt: t("2026-11-05T00:00:00Z"), country: "Narnia" });
    expect(r.country).toBe("Default");
    expect(r.timeZone).toBe("America/Bogota");
    expect(r.warnings[0]).toContain("Narnia");
    expect(toLocalExtraShift({ startedAt: t("2026-11-04T23:00:00Z"), endedAt: t("2026-11-05T00:00:00Z"), country: null }).warnings).toHaveLength(1);
  });

  it("franja de 24 h o más se parte siempre y advierte", () => {
    const r = toLocalExtraShift({ startedAt: t("2026-11-04T17:00:00Z"), endedAt: t("2026-11-05T19:00:00Z"), country: "Colombia" });
    expect(r.segments.map((s) => [s.isoDate, s.startTime, s.endTime])).toEqual([
      ["2026-11-04", "12:00:00", "00:00:00"],
      ["2026-11-05", "00:00:00", "14:00:00"],
    ]);
    expect(r.warnings.some((w) => w.includes("24 horas"))).toBe(true);
  });

  it("franja inválida: sin tramos y con advertencia", () => {
    const r = toLocalExtraShift({ startedAt: t("2026-11-05T00:00:00Z"), endedAt: t("2026-11-05T00:00:00Z"), country: "Colombia" });
    expect(r.segments).toEqual([]);
    expect(r.warnings).toHaveLength(1);
  });

  it("Chile: advierte cuando la franja cruza un cambio de horario", () => {
    // 2026-09-06 00:00 (UTC-4) los relojes de Santiago saltan a 01:00 (UTC-3).
    const r = toLocalExtraShift({ startedAt: t("2026-09-06T02:00:00Z"), endedAt: t("2026-09-06T06:00:00Z"), country: "Chile" });
    expect(r.segments[0].realHours).toBe(4);
    expect(r.segments[0].wallClockHours).toBe(5);
    expect(r.warnings.some((w) => w.includes("cambio de horario"))).toBe(true);
  });

  it("resolveCountryTimezone usa la misma tabla que la ruta de horas extra", () => {
    expect(resolveCountryTimezone("Ecuador")).toEqual({ country: "Ecuador", timeZone: "America/Guayaquil", warning: null });
    expect(resolveCountryTimezone("Perú").timeZone).toBe("America/Lima");
  });
});

describe("validateDay — franja atada a workDate (SPAN_OUTSIDE_WORKDATE)", () => {
  const bogota = { workDate: "2026-08-11", timeZone: "America/Bogota" };

  it("el inicio debe caer en el día local de workDate", () => {
    // 2026-08-09 22:00 Bogotá (domingo) bajo un workDate de martes.
    const errs = validateDay(
      day({ ...bogota, entries: [entry({ id: "a", hours: 1, startedAt: t("2026-08-10T03:00:00Z"), endedAt: t("2026-08-10T04:00:00Z") })] }),
    );
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatchObject({ index: 0, id: "a", code: "SPAN_OUTSIDE_WORKDATE" });
  });

  it("usa la hora local, no la UTC: 22:00 locales son del día aunque en UTC sea el siguiente", () => {
    const ok = day({ ...bogota, entries: [entry({ hours: 1, startedAt: t("2026-08-12T03:00:00Z"), endedAt: t("2026-08-12T04:00:00Z") })] });
    expect(validateDay(ok)).toEqual([]);
  });

  it("solo el fin puede cruzar la medianoche", () => {
    const cruza = day({ ...bogota, entries: [entry({ hours: 3, startedAt: t("2026-08-12T03:00:00Z"), endedAt: t("2026-08-12T06:00:00Z") })] });
    expect(validateDay(cruza)).toEqual([]);
  });

  it("sin workDate/timeZone no se comprueba", () => {
    expect(validateDay(day({ entries: [entry({ hours: 1, startedAt: t("2026-08-10T03:00:00Z"), endedAt: t("2026-08-10T04:00:00Z") })] }))).toEqual([]);
  });
});

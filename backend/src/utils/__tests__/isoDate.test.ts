import { describe, it, expect, afterAll } from "vitest";
import {
  toIsoDate,
  fromIsoDate,
  addDaysIso,
  isWeekdayIso,
  monthStart,
  monthEnd,
  eachDayIso,
  maxIso,
  minIso,
  monthKeyOf,
  addMonthsKey,
  isValidIsoDate,
  isValidMonthKey,
  isoToDayNumber,
  dayNumberToIso,
  weekdayOfDayNumber,
} from "../isoDate.js";

describe("isoDate — conversiones", () => {
  it("toIsoDate usa la fecha UTC del instante", () => {
    expect(toIsoDate(new Date("2026-10-31T00:00:00.000Z"))).toBe("2026-10-31");
    // 23:30 en Quito (UTC-5) ya es 1-nov en UTC: manda UTC
    expect(toIsoDate(new Date("2026-10-31T23:30:00-05:00"))).toBe("2026-11-01");
    expect(() => toIsoDate(new Date("no-es-fecha"))).toThrow();
  });

  it("fromIsoDate devuelve la medianoche UTC y valida el calendario", () => {
    expect(fromIsoDate("2026-02-28").toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(() => fromIsoDate("2026-02-29")).toThrow(); // 2026 no es bisiesto
    expect(fromIsoDate("2028-02-29").toISOString()).toBe("2028-02-29T00:00:00.000Z");
    expect(() => fromIsoDate("2026-13-01")).toThrow();
    expect(() => fromIsoDate("2026-1-01")).toThrow();
    expect(() => fromIsoDate("2026-10-01T00:00:00Z")).toThrow();
  });

  it("número de día ida y vuelta, y día de la semana", () => {
    expect(isoToDayNumber("1970-01-01")).toBe(0);
    expect(weekdayOfDayNumber(0)).toBe(4); // jueves
    expect(weekdayOfDayNumber(-1)).toBe(3); // 1969-12-31 miércoles
    expect(dayNumberToIso(isoToDayNumber("2027-05-01"))).toBe("2027-05-01");
    expect(weekdayOfDayNumber(isoToDayNumber("2027-05-01"))).toBe(6); // sábado
  });

  it("validadores", () => {
    expect(isValidIsoDate("2026-04-31")).toBe(false);
    expect(isValidIsoDate("2026-04-30")).toBe(true);
    expect(isValidMonthKey("2026-00")).toBe(false);
    expect(isValidMonthKey("2026-12")).toBe(true);
    expect(isValidMonthKey("2026-1")).toBe(false);
  });
});

describe("isoDate — aritmética y meses", () => {
  it("addDaysIso cruza meses, años y bisiestos", () => {
    expect(addDaysIso("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysIso("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDaysIso("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDaysIso("2026-10-15", 0)).toBe("2026-10-15");
  });

  it("isWeekdayIso: lunes a viernes", () => {
    expect(isWeekdayIso("2026-10-16")).toBe(true); // viernes
    expect(isWeekdayIso("2026-10-17")).toBe(false); // sábado
    expect(isWeekdayIso("2026-10-18")).toBe(false); // domingo
    expect(isWeekdayIso("2026-10-19")).toBe(true); // lunes
  });

  it("monthStart / monthEnd / monthKeyOf / addMonthsKey", () => {
    expect(monthStart("2026-02")).toBe("2026-02-01");
    expect(monthEnd("2026-02")).toBe("2026-02-28");
    expect(monthEnd("2028-02")).toBe("2028-02-29");
    expect(monthEnd("2026-04")).toBe("2026-04-30");
    expect(monthEnd("2026-12")).toBe("2026-12-31");
    expect(monthKeyOf("2026-10-15")).toBe("2026-10");
    expect(addMonthsKey("2026-11", 2)).toBe("2027-01");
    expect(addMonthsKey("2027-01", -1)).toBe("2026-12");
    expect(() => monthEnd("2026-13")).toThrow();
  });

  it("eachDayIso incluye ambos extremos y es vacío si fin < inicio", () => {
    expect(eachDayIso("2026-12-30", "2027-01-02")).toEqual(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
    expect(eachDayIso("2026-10-15", "2026-10-15")).toEqual(["2026-10-15"]);
    expect(eachDayIso("2026-10-16", "2026-10-15")).toEqual([]);
  });

  it("maxIso / minIso", () => {
    expect(maxIso("2026-09-30", "2026-10-01")).toBe("2026-10-01");
    expect(minIso("2026-09-30", "2026-10-01")).toBe("2026-09-30");
    expect(() => maxIso("2026-9-30", "2026-10-01")).toThrow();
  });
});

// Node relee process.env.TZ al asignarlo, así que se puede cambiar de zona en caliente dentro del
// proceso de pruebas. Se comprueba que el cambio surtió efecto (si no, la prueba no probaría nada).
describe("isoDate — no depende de la zona horaria del proceso", () => {
  const originalTz = process.env.TZ;
  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  const zones = ["UTC", "America/Guayaquil", "America/Bogota", "Europe/Madrid", "Pacific/Kiritimati", "Pacific/Pago_Pago"];

  function snapshot() {
    return {
      // límites de mes y de año, y el cambio de hora europeo (29-mar-2026, 25-oct-2026)
      a: addDaysIso("2026-03-28", 1),
      b: addDaysIso("2026-03-29", 1),
      c: addDaysIso("2026-10-25", 1),
      d: addDaysIso("2026-10-31", 1),
      e: addDaysIso("2026-12-31", 1),
      f: toIsoDate(fromIsoDate("2026-11-01")),
      g: toIsoDate(new Date(Date.UTC(2026, 9, 31, 23, 59))),
      h: monthEnd("2026-10"),
      i: eachDayIso("2026-10-30", "2026-11-02"),
      j: isWeekdayIso("2026-11-01"),
      k: fromIsoDate("2027-01-01").getTime(),
    };
  }

  it("da exactamente el mismo resultado en zonas de UTC-11 a UTC+14", () => {
    const results = zones.map((tz) => {
      process.env.TZ = tz;
      return { tz, offsetMarch: new Date(Date.UTC(2026, 2, 30)).getTimezoneOffset(), value: snapshot() };
    });
    // el cambio de zona surtió efecto
    expect(new Set(results.map((r) => r.offsetMarch)).size).toBeGreaterThan(1);
    const expected = {
      a: "2026-03-29",
      b: "2026-03-30",
      c: "2026-10-26",
      d: "2026-11-01",
      e: "2027-01-01",
      f: "2026-11-01",
      g: "2026-10-31",
      h: "2026-10-31",
      i: ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"],
      j: false,
      k: Date.UTC(2027, 0, 1),
    };
    for (const r of results) expect({ tz: r.tz, ...r.value }).toEqual({ tz: r.tz, ...expected });
  });
});

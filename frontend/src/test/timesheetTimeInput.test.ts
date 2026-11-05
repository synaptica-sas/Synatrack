import { describe, it, expect } from "vitest";
import {
  blankRow,
  formatApprovedRanges,
  linkRow,
  normalizeField,
  normalizeRowTimes,
  outsideApprovedWarning,
  parseDurationInput,
  parseTimeInput,
  prefillExtraRow,
  MSG_FIN_ANTES_DE_INICIO,
  MSG_HORA_INVALIDA,
  type DayRow,
} from "../features/timesheet/timesheetDay";
import type { TimeEntryType } from "../services/api";

const TYPES: TimeEntryType[] = [
  { id: "reg", code: "REG", name: "Regulares", category: "REGULAR", blockType: null, active: true, sortOrder: 1 },
  { id: "ext", code: "EXT", name: "Extras", category: "EXTRA", blockType: null, active: true, sortOrder: 2 },
];

const row = (changes: Partial<DayRow> = {}): DayRow => ({ ...blankRow("ext"), ...changes });

describe("parseTimeInput", () => {
  it.each([
    ["6", "06:00"],
    ["06", "06:00"],
    ["630", "06:30"],
    ["0630", "06:30"],
    ["6:3", "06:30"],
    ["6:30", "06:30"],
    ["18", "18:00"],
    ["1830", "18:30"],
    ["6p", "18:00"],
    ["6pm", "18:00"],
    ["6 pm", "18:00"],
    ["6:30pm", "18:30"],
    ["6:30 PM", "18:30"],
    ["6a", "06:00"],
    ["6am", "06:00"],
    ["12am", "00:00"],
    ["12pm", "12:00"],
    ["12:15am", "00:15"],
    ["0", "00:00"],
    ["23:59", "23:59"],
  ])("%s -> %s", (input, expected) => {
    expect(parseTimeInput(input)).toBe(expected);
  });

  it.each(["", "  ", "25", "24", "7:75", "abc", "13pm", "0pm", "1860", "6:300", "6::30", "6x"])(
    "rechaza %j",
    (input) => {
      expect(parseTimeInput(input)).toBeNull();
    },
  );
});

describe("parseDurationInput", () => {
  it.each([
    ["2", 2],
    ["2.5", 2.5],
    ["2,5", 2.5],
    ["2:30", 2.5],
    ["230", 2.5],
    ["0230", 2.5],
    ["0:45", 0.75],
    ["45m", 0.75],
    ["02:30:00", 2.5],
  ])("%s -> %s h", (input, expected) => {
    expect(parseDurationInput(input)).toBeCloseTo(expected, 6);
  });

  it.each(["", "abc", "275", "2:75"])("rechaza %j", (input) => {
    expect(parseDurationInput(input)).toBeNull();
  });
});

describe("linkRow (cálculo en vivo)", () => {
  it("inicio + fin -> duración", () => {
    expect(linkRow(row({ start: "6pm", end: "20" }), "end").changes).toEqual({ duration: "02:00:00" });
  });

  it("inicio + duración -> fin", () => {
    expect(linkRow(row({ start: "18", duration: "2" }), "duration").changes).toEqual({ end: "20:00" });
  });

  it("al mover el inicio con duración conserva la duración y mueve el fin", () => {
    const r = row({ start: "19", end: "20:00", duration: "02:00:00" });
    expect(linkRow(r, "start").changes).toEqual({ end: "21:00" });
  });

  it("inicio con fin y sin duración calcula la duración", () => {
    expect(linkRow(row({ start: "18", end: "2030" }), "start").changes).toEqual({ duration: "02:30:00" });
  });

  it("fin <= inicio es un error de fila", () => {
    const r = linkRow(row({ start: "18", end: "08" }), "end");
    expect(r.error?.message).toBe(MSG_FIN_ANTES_DE_INICIO);
    expect(r.changes).toEqual({});
    expect(linkRow(row({ start: "18", end: "18" }), "end").error?.message).toBe(MSG_FIN_ANTES_DE_INICIO);
  });

  it("no calcula con valores ilegibles", () => {
    expect(linkRow(row({ start: "abc", end: "20" }), "end")).toEqual({ changes: {} });
    expect(linkRow(row({ start: "18", duration: "x" }), "duration")).toEqual({ changes: {} });
  });

  it("una duración que cruza la medianoche es error", () => {
    expect(linkRow(row({ start: "23", duration: "2" }), "duration").error).toBeDefined();
  });
});

describe("normalizeField / normalizeRowTimes", () => {
  it("el caso real: 06 y 08 se leen como 06:00 y 08:00", () => {
    const r = row({ start: "06", end: "08" });
    const a = normalizeField(r, "start");
    expect(a.changes.start).toBe("06:00");
    const b = normalizeField({ ...r, ...a.changes }, "end");
    expect(b.changes).toEqual({ end: "08:00", duration: "02:00:00" });
  });

  it("hora inválida marca el campo con el mensaje", () => {
    const res = normalizeField(row({ start: "25" }), "start");
    expect(res.error).toEqual({ message: MSG_HORA_INVALIDA, fields: ["start"] });
    expect(res.changes).toEqual({});
  });

  it("vacío no es error", () => {
    expect(normalizeField(row(), "start")).toEqual({ changes: {} });
  });

  it("la duración se normaliza a HH:MM:SS", () => {
    expect(normalizeField(row({ duration: "230" }), "duration").changes.duration).toBe("02:30:00");
    expect(normalizeField(row({ duration: "45m" }), "duration").changes.duration).toBe("00:45:00");
  });

  it("normalizeRowTimes deja el renglón listo para guardar", () => {
    const res = normalizeRowTimes(row({ start: "6p", end: "8p" }));
    expect(res.error).toBeUndefined();
    expect(res.row).toMatchObject({ start: "18:00", end: "20:00", duration: "02:00:00" });
  });

  it("normalizeRowTimes devuelve el primer error", () => {
    expect(normalizeRowTimes(row({ start: "7:75", end: "8" })).error?.fields).toEqual(["start"]);
  });
});

describe("prefillExtraRow", () => {
  const ranges = [
    { id: "a", startTime: "18:00", endTime: "20:00", totalHours: 2 },
    { id: "b", startTime: "21:00", endTime: "22:30", totalHours: "1.5" },
  ];

  it("rellena con la primera franja aprobada", () => {
    expect(prefillExtraRow(row(), [], ranges, TYPES)).toEqual({
      start: "18:00",
      end: "20:00",
      duration: "02:00:00",
    });
  });

  it("salta las franjas ya cubiertas por otras filas extra", () => {
    const otra = row({ start: "18:00", end: "20:00" });
    expect(prefillExtraRow(row(), [otra], ranges, TYPES)).toEqual({
      start: "21:00",
      end: "22:30",
      duration: "01:30:00",
    });
  });

  it("las filas que no son extra no cubren nada", () => {
    const regular = row({ typeId: "reg", start: "18:00", end: "20:00" });
    expect(prefillExtraRow(row(), [regular], ranges, TYPES)?.start).toBe("18:00");
  });

  it("no hace nada si ya hay inicio o fin, si no hay franjas o si todas están cubiertas", () => {
    expect(prefillExtraRow(row({ start: "9" }), [], ranges, TYPES)).toBeNull();
    expect(prefillExtraRow(row(), [], [], TYPES)).toBeNull();
    const cubiertas = [row({ start: "18:00", end: "20:00" }), row({ start: "21:00", end: "22:30" })];
    expect(prefillExtraRow(row(), cubiertas, ranges, TYPES)).toBeNull();
  });

  it("outsideApprovedWarning avisa si la franja no cabe en ninguna aprobada", () => {
    const una = [ranges[0]];
    expect(outsideApprovedWarning(row({ start: "06:00", end: "08:00" }), una, TYPES)).toBe(
      "06:00–08:00 está fuera de la franja aprobada 18:00–20:00",
    );
    expect(outsideApprovedWarning(row({ start: "19:00", end: "21:00" }), una, TYPES)).toContain("fuera de");
    expect(outsideApprovedWarning(row({ start: "06:00", end: "08:00" }), ranges, TYPES)).toBe(
      "06:00–08:00 está fuera de las franjas aprobadas 18:00–20:00, 21:00–22:30",
    );
  });

  it("outsideApprovedWarning calla si está contenida, sin franjas, sin horas válidas o no es Extra", () => {
    expect(outsideApprovedWarning(row({ start: "18:00", end: "20:00" }), ranges, TYPES)).toBeNull();
    expect(outsideApprovedWarning(row({ start: "21:15", end: "22:00" }), ranges, TYPES)).toBeNull();
    expect(outsideApprovedWarning(row({ start: "06:00", end: "08:00" }), [], TYPES)).toBeNull();
    expect(outsideApprovedWarning(row({ start: "06:00" }), ranges, TYPES)).toBeNull();
    expect(outsideApprovedWarning(row({ typeId: "reg", start: "06:00", end: "08:00" }), ranges, TYPES)).toBeNull();
  });

  it("formatApprovedRanges lista todas las franjas", () => {
    expect(formatApprovedRanges(ranges)).toBe("18:00–20:00, 21:00–22:30");
  });
});

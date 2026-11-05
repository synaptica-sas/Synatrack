import { describe, it, expect } from "vitest";
import type { DaySummary, TimeEntry, TimeEntryType } from "../services/api";
import {
  blankRow,
  buildDayPayload,
  cellDefaultTypeId,
  computeLiveFooter,
  defaultTypeId,
  focusAfterDelete,
  focusAfterEnter,
  formatDayUsage,
  isBlank,
  isCellTypable,
  mapServerErrors,
  offeredTypes,
  rowFromEntry,
  withTrailingBlank,
  type DayRow,
} from "../features/timesheet/timesheetDay";
import { avisosAlDetener } from "../features/tracker/trackerAvisos";

/**
 * Lógica pura de la tabla "Editar tiempo" (R14). El servidor valida de verdad;
 * aquí se comprueba lo que el cliente anticipa: tipos ofrecidos, pie en vivo,
 * payload de PUT /day y navegación.
 */

const T = (
  id: string,
  category: TimeEntryType["category"],
  extra: Partial<TimeEntryType> = {},
): TimeEntryType => ({
  id,
  code: null,
  name: id,
  category,
  blockType: category === "ABSENCE" ? "OTHER" : null,
  active: true,
  sortOrder: 10,
  ...extra,
});

const REGULAR = T("t-reg", "REGULAR", { code: "REGULAR", name: "Horas Regulares", sortOrder: 1 });
const EXTRA = T("t-ext", "EXTRA", { code: "EXTRA", name: "Horas Extras", sortOrder: 2 });
const PERMISO = T("t-per", "ABSENCE", { code: "PERMISO", name: "Permiso", sortOrder: 3 });
const VACACIONES = T("t-vac", "ABSENCE", { code: "VACACIONES", name: "Vacaciones", sortOrder: 4, blockType: "VACATION" });
const TYPES = [VACACIONES, EXTRA, PERMISO, REGULAR];

const SUMMARY: DaySummary = {
  date: "2026-11-03",
  isWeekend: false,
  isHoliday: false,
  holidayName: null,
  allowWeekendWork: false,
  hoursPerDay: 8,
  isNonWorkingDay: false,
  regularAllowed: true,
  usedRegular: 6,
  usedAbsence: 0,
  usedAgainstCap: 6,
  remaining: 2,
  overBy: 0,
  projects: [{ projectId: "p1", extraApproved: 2, extraUsed: 0, extraExcess: 0, extraRemaining: 2 }],
};

function entry(over: Partial<TimeEntry> & { hours: string }): TimeEntry {
  return {
    id: "e1",
    projectId: "p1",
    consultantId: "c1",
    workDate: "2026-11-03T00:00:00.000Z",
    note: null,
    description: null,
    activityId: null,
    source: "TIMESHEET",
    startedAt: null,
    endedAt: null,
    status: "PENDING",
    approvedBy: null,
    approvedAt: null,
    rejectionNote: null,
    createdAt: "",
    updatedAt: "",
    project: {} as TimeEntry["project"],
    consultant: {} as TimeEntry["consultant"],
    ...over,
  };
}

const regRef = { id: "t-reg", code: "REGULAR", name: "Horas Regulares", category: "REGULAR" as const };
const extRef = { id: "t-ext", code: "EXTRA", name: "Horas Extras", category: "EXTRA" as const };

describe("offeredTypes", () => {
  const ctx = { isAbsenceProject: false, regularAllowed: true, extraApproved: 0 };

  it("sin saldo de extra solo ofrece Regular", () => {
    expect(offeredTypes(TYPES, ctx).map((t) => t.id)).toEqual(["t-reg"]);
  });

  it("con saldo aprobado ofrece también Extra, ordenado por sortOrder", () => {
    expect(offeredTypes(TYPES, { ...ctx, extraApproved: 2 }).map((t) => t.id)).toEqual(["t-reg", "t-ext"]);
  });

  it("en el proyecto Ausencias solo ofrece los de ausencia", () => {
    const r = offeredTypes(TYPES, { isAbsenceProject: true, regularAllowed: true, extraApproved: 5 });
    expect(r.map((t) => t.id)).toEqual(["t-per", "t-vac"]);
  });

  it("un día no laborable sin permiso no ofrece Regular, pero sí Extra con saldo", () => {
    const r = offeredTypes(TYPES, { isAbsenceProject: false, regularAllowed: false, extraApproved: 1 });
    expect(r.map((t) => t.id)).toEqual(["t-ext"]);
  });

  it("no ofrece tipos desactivados, salvo el que ya usa un registro existente", () => {
    const inactivo = T("t-old", "REGULAR", { active: false });
    expect(offeredTypes([REGULAR, inactivo], ctx).map((t) => t.id)).toEqual(["t-reg"]);
    expect(offeredTypes([REGULAR, inactivo], ctx, ["t-old"]).map((t) => t.id).sort()).toEqual(["t-old", "t-reg"]);
  });
});

describe("defaultTypeId / cellDefaultTypeId", () => {
  it("Regular por defecto; Permiso en Ausencias", () => {
    expect(defaultTypeId([EXTRA, REGULAR], false)).toBe("t-reg");
    expect(defaultTypeId([VACACIONES, PERMISO], true)).toBe("t-per");
  });

  it("si el día no admite regulares, usa el primero ofrecido", () => {
    expect(defaultTypeId([EXTRA], false)).toBe("t-ext");
  });

  it("la celda tecleada: Permiso en Ausencias y nada (Regular del servidor) en el resto", () => {
    expect(cellDefaultTypeId(TYPES, true)).toBe("t-per");
    expect(cellDefaultTypeId(TYPES, false)).toBeUndefined();
  });
});

describe("filas y renglón vacío", () => {
  it("siempre deja exactamente un renglón vacío al final", () => {
    const una = rowFromEntry(entry({ hours: "2.0000", type: regRef, typeId: "t-reg" }));
    const rows = withTrailingBlank([una], "t-reg");
    expect(rows).toHaveLength(2);
    expect(isBlank(rows[1])).toBe(true);
    // idempotente
    expect(withTrailingBlank(rows, "t-reg")).toBe(rows);
    // varios vacíos se reducen a uno
    expect(withTrailingBlank([...rows, blankRow("t-reg")], "t-reg")).toHaveLength(2);
  });

  it("escribir en el vacío crea otro debajo", () => {
    const rows = withTrailingBlank([], "t-reg");
    const escrito = rows.map((r, i) => (i === 0 ? { ...r, duration: "1:00" } : r));
    expect(withTrailingBlank(escrito, "t-reg")).toHaveLength(2);
  });

  it("el tipo por defecto no hace que un renglón deje de estar vacío", () => {
    expect(isBlank(blankRow("t-ext"))).toBe(true);
  });

  it("marca como excedente y solo lectura según el registro", () => {
    const ex = rowFromEntry(entry({ hours: "1", type: extRef, typeId: "t-ext", isExcess: true }));
    expect(ex.isExcess).toBe(true);
    expect(ex.editable).toBe(true);
    const aprobada = rowFromEntry(entry({ hours: "1", status: "APPROVED" }));
    expect(aprobada.editable).toBe(false);
  });
});

describe("computeLiveFooter", () => {
  const regular = (hours: string, over: Partial<TimeEntry> = {}) =>
    entry({ hours, type: regRef, typeId: "t-reg", ...over });

  it("sin cambios coincide con el servidor", () => {
    const entries = [regular("2")];
    const rows = withTrailingBlank(entries.map((e) => rowFromEntry(e)), "t-reg");
    const f = computeLiveFooter({ summary: SUMMARY, projectId: "p1", entries, rows, types: TYPES });
    expect(f.used).toBe(6);
    expect(f.remaining).toBe(2);
    expect(f.overBy).toBe(0);
  });

  it("resta lo que este proyecto ya tenía pendiente y suma el borrador", () => {
    const entries = [regular("2")];
    const rows = withTrailingBlank(entries.map((e) => rowFromEntry(e)), "t-reg");
    rows[0] = { ...rows[0], duration: "3:00" };
    const f = computeLiveFooter({ summary: SUMMARY, projectId: "p1", entries, rows, types: TYPES });
    // 6 (servidor) - 2 (antes) + 3 (borrador)
    expect(f.used).toBe(7);
    expect(f.remaining).toBe(1);
  });

  it("detecta que el borrador se pasa de la jornada", () => {
    const rows: DayRow[] = [{ ...blankRow("t-reg"), duration: "4:00" }];
    const f = computeLiveFooter({ summary: SUMMARY, projectId: "p1", entries: [], rows, types: TYPES });
    expect(f.used).toBe(10);
    expect(f.overBy).toBe(2);
    expect(f.remaining).toBe(0);
  });

  it("no descuenta los registros ya aprobados de este proyecto", () => {
    const entries = [regular("2", { status: "APPROVED" })];
    const rows = entries.map((e) => rowFromEntry(e));
    const f = computeLiveFooter({ summary: SUMMARY, projectId: "p1", entries, rows, types: TYPES });
    expect(f.used).toBe(6);
  });

  it("las ausencias cuentan contra la jornada", () => {
    const rows: DayRow[] = [{ ...blankRow("t-per"), duration: "1:00" }];
    const f = computeLiveFooter({ summary: SUMMARY, projectId: "p1", entries: [], rows, types: TYPES });
    expect(f.used).toBe(7);
  });

  it("las horas extra no tocan la jornada y se comparan con el saldo aprobado", () => {
    const rows: DayRow[] = [{ ...blankRow("t-ext"), duration: "3:00" }];
    const f = computeLiveFooter({ summary: SUMMARY, projectId: "p1", entries: [], rows, types: TYPES });
    expect(f.used).toBe(6);
    expect(f.showExtra).toBe(true);
    expect(f.extraUsed).toBe(3);
    expect(f.extraApproved).toBe(2);
    expect(f.extraOver).toBe(1);
  });

  it("oculta la línea de extra si no hay saldo ni borrador extra", () => {
    const f = computeLiveFooter({
      summary: { ...SUMMARY, projects: [] },
      projectId: "p1",
      entries: [],
      rows: [blankRow("t-reg")],
      types: TYPES,
    });
    expect(f.showExtra).toBe(false);
  });

  it("el excedente pendiente se reevalúa junto con el resto del extra", () => {
    const summary = { ...SUMMARY, projects: [{ projectId: "p1", extraApproved: 2, extraUsed: 2, extraExcess: 1, extraRemaining: 0 }] };
    const entries = [
      entry({ id: "a", hours: "2", type: extRef, typeId: "t-ext" }),
      entry({ id: "b", hours: "1", type: extRef, typeId: "t-ext", isExcess: true }),
    ];
    const rows = entries.map((e) => rowFromEntry(e));
    const f = computeLiveFooter({ summary, projectId: "p1", entries, rows, types: TYPES });
    // el excedente del borrador se cuenta como extra normal: el servidor lo vuelve a partir
    expect(f.extraUsed).toBe(3);
    expect(f.extraOver).toBe(1);
  });
});

describe("buildDayPayload", () => {
  const DAY = "2026-11-03";

  it("omite renglones vacíos y de solo lectura", () => {
    const rows: DayRow[] = [
      rowFromEntry(entry({ id: "ok", hours: "1", status: "APPROVED", type: regRef, typeId: "t-reg" })),
      { ...blankRow("t-reg"), duration: "1:30" },
      blankRow("t-reg"),
    ];
    const r = buildDayPayload(DAY, rows, TYPES);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]).toMatchObject({ typeId: "t-reg", hours: 1.5, startedAt: null, endedAt: null, description: null });
    expect(r.rowIndexes).toEqual([1]);
    expect(r.entries[0].id).toBeUndefined();
  });

  it("reenvía el id y los instantes exactos de un registro sin tocar", () => {
    const e = entry({
      id: "e9",
      hours: "1.0003",
      type: regRef,
      typeId: "t-reg",
      startedAt: "2026-11-03T14:00:13.000Z",
      endedAt: "2026-11-03T15:00:14.000Z",
      description: "algo",
    });
    const r = buildDayPayload(DAY, [rowFromEntry(e)], TYPES);
    expect(r.ok && r.entries[0]).toMatchObject({
      id: "e9",
      hours: 1.0003,
      startedAt: "2026-11-03T14:00:13.000Z",
      endedAt: "2026-11-03T15:00:14.000Z",
      description: "algo",
    });
  });

  it("rechaza una duración inválida señalando el renglón", () => {
    const r = buildDayPayload(DAY, [{ ...blankRow("t-reg"), duration: "abc" }], TYPES);
    expect(r).toMatchObject({ ok: false, rowIndex: 0 });
  });

  it("las horas extra exigen inicio y fin", () => {
    const sin = buildDayPayload(DAY, [{ ...blankRow("t-ext"), duration: "1:00" }], TYPES);
    expect(sin).toMatchObject({ ok: false, rowIndex: 0 });
    expect(!sin.ok && sin.message).toMatch(/inicio y de fin/);

    const con = buildDayPayload(DAY, [{ ...blankRow("t-ext"), duration: "1:00", start: "18:00", end: "19:00" }], TYPES);
    expect(con.ok).toBe(true);
    if (con.ok) {
      expect(con.entries[0].startedAt).toBeTruthy();
      expect(con.entries[0].endedAt).toBeTruthy();
    }
  });

  it("rechaza fin sin inicio y fin anterior al inicio", () => {
    expect(buildDayPayload(DAY, [{ ...blankRow("t-reg"), duration: "1:00", end: "10:00" }], TYPES).ok).toBe(false);
    expect(
      buildDayPayload(DAY, [{ ...blankRow("t-reg"), duration: "1:00", start: "10:00", end: "09:00" }], TYPES).ok,
    ).toBe(false);
  });

  it("exige tipo", () => {
    expect(buildDayPayload(DAY, [{ ...blankRow(""), duration: "1:00" }], TYPES).ok).toBe(false);
  });

  it("sin renglones con contenido devuelve una lista vacía (borra los pendientes)", () => {
    const r = buildDayPayload(DAY, [blankRow("t-reg")], TYPES);
    expect(r).toMatchObject({ ok: true, entries: [], rowIndexes: [] });
  });
});

describe("mapServerErrors", () => {
  it("traduce el índice del payload al del renglón y deja el resto como generales", () => {
    const m = mapServerErrors(
      [
        { index: 1, message: "Supera la jornada" },
        { index: null, message: "Día cerrado" },
        { index: 7, message: "fuera de rango" },
      ],
      [0, 3],
    );
    expect(m.byRow).toEqual({ 3: "Supera la jornada" });
    expect(m.general).toEqual(["Día cerrado", "fuera de rango"]);
  });
});

describe("isCellTypable", () => {
  const reg = (over: Partial<TimeEntry> = {}) => entry({ hours: "1", type: regRef, typeId: "t-reg", ...over });

  it("vacía o con un solo registro Regular pendiente: se teclea", () => {
    expect(isCellTypable([], false)).toBe(true);
    expect(isCellTypable([reg()], false)).toBe(true);
    // un registro anterior al catálogo (sin tipo) cuenta como Regular
    expect(isCellTypable([entry({ hours: "1" })], false)).toBe(true);
  });

  it("varios registros, extra, excedente o ya revisado: se abre la ventana", () => {
    expect(isCellTypable([reg(), reg({ id: "e2" })], false)).toBe(false);
    expect(isCellTypable([entry({ hours: "1", type: extRef, typeId: "t-ext" })], false)).toBe(false);
    expect(isCellTypable([reg({ isExcess: true })], false)).toBe(false);
    expect(isCellTypable([reg({ status: "APPROVED" })], false)).toBe(false);
  });

  it("en Ausencias solo se teclea con un registro de ausencia", () => {
    const perRef = { id: "t-per", code: "PERMISO", name: "Permiso", category: "ABSENCE" as const };
    expect(isCellTypable([entry({ hours: "1", type: perRef, typeId: "t-per" })], true)).toBe(true);
    expect(isCellTypable([reg()], true)).toBe(false);
  });
});

describe("teclado", () => {
  it("Enter baja a la misma columna de la fila siguiente", () => {
    expect(focusAfterEnter({ row: 2, col: "duration" })).toEqual({ row: 3, col: "duration" });
  });

  it("tras borrar, el foco queda en la misma posición o en la última fila", () => {
    expect(focusAfterDelete(1, 4)).toBe(1);
    expect(focusAfterDelete(3, 3)).toBe(2);
    expect(focusAfterDelete(0, 1)).toBe(0);
  });
});

describe("formatDayUsage", () => {
  it("muestra usado/jornada con una cifra decimal", () => {
    expect(formatDayUsage(7.5, 8.4)).toBe("7,5/8,4 h");
    expect(formatDayUsage(8, 8)).toBe("8/8 h");
  });
});

describe("avisosAlDetener", () => {
  it("sin descartes no avisa nada", () => {
    expect(avisosAlDetener({ discardedHours: 0, discardedFrom: null })).toEqual([]);
  });

  it("avisa de las horas descartadas con la franja en hora local", () => {
    const desde = new Date(2026, 10, 5, 18, 0).toISOString();
    const a = avisosAlDetener({ discardedHours: 2.25, discardedFrom: desde });
    expect(a).toHaveLength(1);
    expect(a[0].type).toBe("warning");
    expect(a[0].message).toContain("2 h 15 min por encima de tu jornada (18:00 – 20:15)");
    expect(a[0].message).toMatch(/regístralas manualmente en el timesheet/);
  });

  it("usa discardedTo cuando el servidor lo manda", () => {
    const desde = new Date(2026, 10, 5, 17, 0).toISOString();
    const hasta = new Date(2026, 10, 5, 17, 45).toISOString();
    const a = avisosAlDetener({ discardedHours: 0.75, discardedFrom: desde, discardedTo: hasta });
    expect(a[0].message).toContain("45 min por encima de tu jornada (17:00 – 17:45)");
  });
});

describe("Horas extra de otro consultor (solo lectura)", () => {
  const ctx = { isAbsenceProject: false, regularAllowed: true, extraApproved: 2 };

  it("no ofrece EXTRA en filas nuevas si quien edita no es el dueño", () => {
    expect(offeredTypes(TYPES, ctx).map((t) => t.id)).toContain("t-ext");
    expect(offeredTypes(TYPES, { ...ctx, allowExtra: false }).map((t) => t.id)).not.toContain("t-ext");
  });

  it("la fila EXTRA existente queda bloqueada y se reenvía intacta", () => {
    const extra = entry({
      id: "x1",
      hours: "2",
      startedAt: "2026-11-03T23:00:00.000Z",
      endedAt: "2026-11-04T01:00:00.000Z",
      typeId: "t-ext",
      type: extRef,
    });
    const regular = entry({ id: "r1", hours: "1", typeId: "t-reg", type: regRef });
    const rows = [rowFromEntry(extra, { lockExtra: true }), rowFromEntry(regular, { lockExtra: true })];
    expect(rows[0].editable).toBe(false);
    expect(rows[0].locked).toBe(true);
    expect(rows[1].editable).toBe(true);

    const built = buildDayPayload("2026-11-03", rows, TYPES);
    expect(built.ok).toBe(true);
    if (built.ok) {
      const sent = built.entries.find((e) => e.id === "x1");
      expect(sent).toMatchObject({ typeId: "t-ext", hours: 2, startedAt: extra.startedAt, endedAt: extra.endedAt });
    }
  });

  it("para el consultor propio la fila EXTRA sigue editable", () => {
    const extra = entry({ id: "x1", hours: "2", typeId: "t-ext", type: extRef });
    expect(rowFromEntry(extra).editable).toBe(true);
  });
});

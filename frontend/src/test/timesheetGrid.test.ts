import { describe, expect, it } from "vitest";
import {
  buildProjectRows,
  cellActivities,
  cellHours,
  combineDayTime,
  endTimeFrom,
  hoursBetween,
  isValidTime,
  projectsToCopy,
  rangeFor,
  timeOfDay,
} from "../features/timesheet/timesheetGrid";
import type { TimeEntry } from "../services/api";

function entry(projectId: string, description: string | null, day: string, hours: number): TimeEntry {
  return {
    id: `${projectId}-${description}-${day}-${hours}`,
    projectId,
    consultantId: "c1",
    workDate: `${day}T00:00:00.000Z`,
    hours: String(hours),
    note: null,
    description,
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
    consultant: { fullName: "Ana" } as TimeEntry["consultant"],
    project: {} as TimeEntry["project"],
  };
}

const LUNES = "2026-09-28";
const MARTES = "2026-09-29";

describe("Una fila por proyecto", () => {
  it("las descripciones distintas del mismo proyecto caen en la misma fila y celda", () => {
    const rows = buildProjectRows([
      entry("p1", "Diseño", LUNES, 1),
      entry("p1", "Reunión", LUNES, 0.5),
      entry("p1", null, MARTES, 2),
    ]);

    expect(rows.size).toBe(1);
    const fila = rows.get("p1")!;
    expect(fila.cells[LUNES]).toHaveLength(2);
    expect(cellHours(fila.cells[LUNES])).toBe(1.5);
    expect(cellHours(fila.cells[MARTES])).toBe(2);
  });

  it("proyectos distintos son filas distintas", () => {
    const rows = buildProjectRows([entry("p1", "x", LUNES, 1), entry("p2", "x", LUNES, 1)]);

    expect([...rows.keys()].sort()).toEqual(["p1", "p2"]);
  });

  it("una celda vacía suma 0", () => {
    expect(cellHours(undefined)).toBe(0);
  });
});

describe("Letrero de actividades", () => {
  it("cada línea de la descripción es una actividad", () => {
    expect(cellActivities([entry("p1", "mucho\nbastante\r\ndemasiado", LUNES, 1)])).toEqual([
      "mucho",
      "bastante",
      "demasiado",
    ]);
  });

  it("junta las de varios registros, sin vacías ni repetidas", () => {
    const lineas = cellActivities([
      entry("p1", "Diseño\n\n  ", LUNES, 1),
      entry("p1", "diseño\nPruebas", LUNES, 1),
      entry("p1", null, LUNES, 1),
    ]);

    expect(lineas).toEqual(["Diseño", "Pruebas"]);
  });
});

describe("Copiar la semana anterior", () => {
  it("trae cada proyecto una sola vez, en orden de aparición", () => {
    const ids = projectsToCopy(
      [entry("p2", "a", LUNES, 1), entry("p1", "b", LUNES, 1), entry("p2", "c", MARTES, 1)],
      new Set(),
    );

    expect(ids).toEqual(["p2", "p1"]);
  });

  it("no duplica los que ya están en esta semana", () => {
    expect(projectsToCopy([entry("p1", "a", LUNES, 1)], new Set(["p1"]))).toEqual([]);
  });
});

describe("Franja horaria", () => {
  it("valida horas HH:MM", () => {
    expect(isValidTime("09:00")).toBe(true);
    expect(isValidTime("9:05")).toBe(true);
    expect(isValidTime("24:00")).toBe(false);
    expect(isValidTime("09:60")).toBe(false);
    expect(isValidTime("")).toBe(false);
  });

  it("el fin es el inicio más la duración", () => {
    expect(endTimeFrom("09:00", 4 / 60)).toBe("09:04");
    expect(endTimeFrom("23:30", 1)).toBe("00:30");
  });

  it("la duración es la diferencia entre inicio y fin", () => {
    expect(hoursBetween("09:00", "10:30")).toBe(1.5);
    expect(hoursBetween("10:00", "09:00")).toBeNull();
    expect(hoursBetween("10:00", "10:00")).toBeNull();
  });

  it("ida y vuelta entre hora local e instante ISO", () => {
    expect(timeOfDay(combineDayTime(LUNES, "09:04"))).toBe("09:04");
    expect(timeOfDay(null)).toBe("");
  });

  it("el fin guardado sale de la duración exacta, con sus segundos", () => {
    const { startedAt, endedAt } = rangeFor(LUNES, "09:00", 43 / 3600);

    expect(new Date(endedAt!).getTime() - new Date(startedAt!).getTime()).toBe(43_000);
  });

  it("sin hora de inicio no hay franja", () => {
    expect(rangeFor(LUNES, "", 1)).toEqual({ startedAt: null, endedAt: null });
  });
});

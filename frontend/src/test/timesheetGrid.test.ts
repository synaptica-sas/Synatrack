import { describe, expect, it } from "vitest";
import {
  buildRows,
  projectsWithHoursOn,
  rankByHours,
  rowKeyOf,
  rowsToCopy,
  sortByRank,
  type TimesheetRow,
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

describe("Agrupación en filas", () => {
  it("mayúsculas y espacios de más no abren una fila nueva", () => {
    const filas = buildRows([
      entry("p1", "Tarea", LUNES, 1),
      entry("p1", "tarea ", MARTES, 2),
    ]);
    expect(filas.size).toBe(1);
  });

  it("proyectos distintos son filas distintas aunque se llamen igual", () => {
    const filas = buildRows([entry("p1", "Tarea", LUNES, 1), entry("p2", "Tarea", LUNES, 1)]);
    expect(filas.size).toBe(2);
  });
});

describe("Qué proyectos se abren al llegar", () => {
  it("solo los que tienen horas ese día", () => {
    const filas = buildRows([
      entry("p1", "a", LUNES, 2),
      entry("p2", "b", MARTES, 3),
    ]).values();

    expect(projectsWithHoursOn(filas, MARTES)).toEqual(new Set(["p2"]));
  });
});

describe("Orden de las tareas", () => {
  it("de más a menos horas en la semana", () => {
    const filas = [...buildRows([
      entry("p1", "poco", LUNES, 1),
      entry("p1", "mucho", LUNES, 5),
      entry("p1", "medio", LUNES, 3),
    ]).values()];

    const orden = sortByRank(filas, rankByHours(filas)).map((r) => r.description);
    expect(orden).toEqual(["mucho", "medio", "poco"]);
  });

  it("es una foto: una tarea nueva va al final aunque tenga más horas", () => {
    const iniciales = [...buildRows([entry("p1", "vieja", LUNES, 2)]).values()];
    const rank = rankByHours(iniciales);

    const nueva: TimesheetRow = { ...iniciales[0], key: rowKeyOf("p1", null, "nueva"), description: "nueva" };
    const orden = sortByRank([nueva, ...iniciales], rank).map((r) => r.description);

    // No salta arriba mientras se edita: se reordena al volver a la semana.
    expect(orden).toEqual(["vieja", "nueva"]);
  });
});

describe("Copiar la semana anterior", () => {
  it("trae las tareas como filas vacías", () => {
    const copiadas = rowsToCopy([entry("p1", "Reunión", "2026-09-21", 4)], new Set());

    expect(copiadas).toHaveLength(1);
    expect(copiadas[0].description).toBe("Reunión");
    expect(copiadas[0].cells).toEqual({});
  });

  it("no duplica las que ya están en esta semana", () => {
    const existente = rowKeyOf("p1", null, "reunión");
    const copiadas = rowsToCopy(
      [entry("p1", "Reunión", "2026-09-21", 4), entry("p1", "Otra", "2026-09-22", 1)],
      new Set([existente]),
    );

    expect(copiadas.map((r) => r.description)).toEqual(["Otra"]);
  });

  it("una misma tarea repetida varios días se copia una sola vez", () => {
    const copiadas = rowsToCopy(
      [entry("p1", "Diaria", "2026-09-21", 1), entry("p1", "Diaria", "2026-09-22", 1)],
      new Set(),
    );
    expect(copiadas).toHaveLength(1);
  });
});

import { describe, expect, it } from "vitest";
import type { StopTimerResult, TimeEntry } from "../services/api";
import { avisoDescartado, avisosAlDetener } from "../features/tracker/trackerAvisos";
import {
  absenceHoursApproved,
  filterByScope,
  hoursByStatus,
} from "../features/reports/reportUtils";

describe("detener cronómetro con la jornada ya llena", () => {
  const desde = "2026-11-02T20:00:00.000Z";
  const resultado: StopTimerResult = {
    data: null,
    entries: [],
    discardedHours: 1.5,
    discardedFrom: desde,
    discardedTo: "2026-11-02T21:30:00.000Z",
    totalHours: 0,
  };

  it("solo emite el aviso de horas descartadas, sin éxito engañoso", () => {
    const avisos = avisosAlDetener(resultado);
    expect(avisos).toHaveLength(1);
    expect(avisos[0].type).toBe("warning");
    expect(avisoDescartado(resultado)).toContain("1 h 30 min");
  });

  it("no emite nada si no se descartó ni se guardó nada", () => {
    expect(avisosAlDetener({ ...resultado, discardedHours: 0, discardedFrom: null })).toEqual([]);
  });
});

describe("informes sin ausencias", () => {
  const e = (hours: string, category: "REGULAR" | "ABSENCE", status = "APPROVED") =>
    ({
      id: Math.random().toString(),
      hours,
      status,
      workDate: "2026-11-02",
      type: { id: "t", code: null, name: "x", category },
    }) as unknown as TimeEntry;

  const entries = [e("8", "REGULAR"), e("8", "ABSENCE"), e("2", "ABSENCE", "PENDING")];

  it("excluye ausencias de los totales por estado y del alcance de la gráfica", () => {
    expect(hoursByStatus(entries)).toEqual({ approved: 8, submitted: 0, pending: 0 });
    expect(filterByScope(entries, "all")).toHaveLength(1);
  });

  it("muestra aparte las ausencias aprobadas", () => {
    expect(absenceHoursApproved(entries)).toBe(8);
  });
});

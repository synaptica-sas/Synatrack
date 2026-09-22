import { describe, expect, it } from "vitest";
import {
  DAILY_LIMIT,
  barsByConsultant,
  barsByDay,
  formatHms,
  onlyWeekdays,
  totals,
  weekendHours,
} from "../features/reports/reportUtils";
import type { TimeEntry } from "../services/api";

/** Entrada mínima: el informe solo mira fecha, horas y consultor. */
function entry(consultantId: string, fullName: string, day: string, hours: number): TimeEntry {
  return {
    id: `${consultantId}-${day}-${hours}`,
    projectId: "p1",
    consultantId,
    workDate: `${day}T00:00:00.000Z`,
    hours: String(hours),
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
    consultant: { fullName } as TimeEntry["consultant"],
    project: {} as TimeEntry["project"],
  };
}

const LUNES = "2026-09-21";
const MARTES = "2026-09-22";
const SABADO = "2026-09-26";
const DOMINGO = "2026-09-27";

describe("El exceso se mide por día, nunca sobre el total de la semana", () => {
  it("10 h el lunes y 2 h el martes son 2 h de exceso, aunque la semana sume 12", () => {
    const [ana] = barsByConsultant([
      entry("a", "Ana", LUNES, 10),
      entry("a", "Ana", MARTES, 2),
    ]);

    expect(ana.total).toBe(12);
    expect(ana.excess).toBe(2);
    expect(ana.regular).toBe(10); // 8 del lunes + 2 del martes
  });

  it("8 h cada día no genera exceso, aunque la semana pase de 40", () => {
    const dias = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26"];
    const [ana] = barsByConsultant(dias.map((d) => entry("a", "Ana", d, 8)));

    expect(ana.total).toBe(48);
    expect(ana.excess).toBe(0);
  });

  it("justo 8 h no es exceso; 8.25 sí lo es", () => {
    const [justo] = barsByConsultant([entry("a", "Ana", LUNES, DAILY_LIMIT)]);
    expect(justo.excess).toBe(0);

    const [pasado] = barsByConsultant([entry("b", "Beto", LUNES, DAILY_LIMIT + 0.25)]);
    expect(pasado.excess).toBe(0.25);
    expect(pasado.regular).toBe(8);
  });

  it("varias entradas del mismo día se suman antes de aplicar el límite", () => {
    // Tres registros de 3 h el mismo día son 9 h: 1 h de exceso.
    const [ana] = barsByConsultant([
      entry("a", "Ana", LUNES, 3),
      entry("a", "Ana", LUNES, 3),
      entry("a", "Ana", LUNES, 3),
    ]);

    expect(ana.total).toBe(9);
    expect(ana.excess).toBe(1);
  });
});

describe("Barras por consultor", () => {
  it("agrupa por persona y ordena de más a menos horas", () => {
    const bars = barsByConsultant([
      entry("a", "Ana", LUNES, 4),
      entry("b", "Beto", LUNES, 9),
      entry("a", "Ana", MARTES, 3),
    ]);

    expect(bars.map((b) => b.label)).toEqual(["Beto", "Ana"]);
    expect(bars[0].total).toBe(9);
    expect(bars[0].excess).toBe(1);
    expect(bars[1].total).toBe(7);
    expect(bars[1].excess).toBe(0);
  });

  it("sin entradas no hay barras", () => {
    expect(barsByConsultant([])).toEqual([]);
  });
});

describe("Barras por día", () => {
  it("devuelve los cinco días laborables aunque estén vacíos", () => {
    const bars = barsByDay([entry("a", "Ana", LUNES, 5)], LUNES);

    expect(bars).toHaveLength(5);
    expect(bars[0].label).toBe("lun., sep 21");
    expect(bars[0].total).toBe(5);
    expect(bars[1].total).toBe(0);
    expect(bars[4].label).toBe("vie., sep 25");
  });

  it("no incluye sábado ni domingo", () => {
    const bars = barsByDay(
      [
        entry("a", "Ana", LUNES, 5),
        entry("a", "Ana", SABADO, 4),
        entry("a", "Ana", DOMINGO, 3),
      ],
      LUNES,
    );

    expect(bars).toHaveLength(5);
    expect(bars.map((b) => b.label)).not.toContain("sáb., sep 26");
    expect(bars.map((b) => b.label)).not.toContain("dom., sep 27");
  });

  it("la jornada es de cada persona: tres consultores a 8 h no generan exceso", () => {
    const bars = barsByDay(
      [
        entry("a", "Ana", LUNES, 8),
        entry("b", "Beto", LUNES, 8),
        entry("c", "Carla", LUNES, 8),
      ],
      LUNES,
    );

    // 24 h en el día, pero nadie se pasó de su jornada.
    expect(bars[0].total).toBe(24);
    expect(bars[0].excess).toBe(0);
  });

  it("solo se marca en rojo lo que excedió quien se pasó", () => {
    const bars = barsByDay(
      [
        entry("a", "Ana", LUNES, 10),  // 2 h de exceso
        entry("b", "Beto", LUNES, 6),  // sin exceso
      ],
      LUNES,
    );

    expect(bars[0].total).toBe(16);
    expect(bars[0].regular).toBe(14);
    expect(bars[0].excess).toBe(2);
  });

  it("parte el día en jornada y exceso", () => {
    const bars = barsByDay([entry("a", "Ana", LUNES, 11.5)], LUNES);

    expect(bars[0].regular).toBe(8);
    expect(bars[0].excess).toBe(3.5);
  });

  it("ignora entradas fuera de la semana pedida", () => {
    const bars = barsByDay([entry("a", "Ana", "2026-09-14", 6)], LUNES);
    expect(bars.every((b) => b.total === 0)).toBe(true);
  });
});

describe("El fin de semana se aparta, no se pierde", () => {
  it("onlyWeekdays deja fuera sábado y domingo", () => {
    const todas = [
      entry("a", "Ana", LUNES, 5),
      entry("a", "Ana", SABADO, 4),
      entry("a", "Ana", DOMINGO, 3),
    ];

    const laborables = onlyWeekdays(todas, LUNES);
    expect(laborables).toHaveLength(1);
    expect(laborables[0].workDate.slice(0, 10)).toBe(LUNES);
  });

  it("weekendHours suma lo que queda fuera, para poder avisarlo", () => {
    const todas = [
      entry("a", "Ana", LUNES, 5),
      entry("a", "Ana", SABADO, 4),
      entry("b", "Beto", DOMINGO, 3.5),
    ];

    expect(weekendHours(todas, LUNES)).toBe(7.5);
  });

  it("sin horas en fin de semana el aviso no aparece", () => {
    expect(weekendHours([entry("a", "Ana", LUNES, 5)], LUNES)).toBe(0);
  });

  it("el total de las barras cuadra con las horas laborables, sin el fin de semana", () => {
    const todas = [
      entry("a", "Ana", LUNES, 5),
      entry("a", "Ana", MARTES, 3),
      entry("a", "Ana", SABADO, 4),
    ];

    const bars = barsByDay(onlyWeekdays(todas, LUNES), LUNES);
    expect(totals(bars).total).toBe(8);
    expect(weekendHours(todas, LUNES)).toBe(4);
  });
});

describe("Formato de reloj", () => {
  it("convierte horas decimales a HH:MM:SS", () => {
    expect(formatHms(0)).toBe("00:00:00");
    expect(formatHms(8)).toBe("08:00:00");
    expect(formatHms(9.5)).toBe("09:30:00");
    expect(formatHms(0.25)).toBe("00:15:00");
    expect(formatHms(43.5)).toBe("43:30:00");
  });

  it("no produce horas negativas", () => {
    expect(formatHms(-3)).toBe("00:00:00");
  });
});

describe("Totales", () => {
  it("suman los tramos de todas las barras", () => {
    const bars = barsByConsultant([
      entry("a", "Ana", LUNES, 10),
      entry("b", "Beto", LUNES, 4),
    ]);

    expect(totals(bars)).toEqual({ regular: 12, excess: 2, total: 14 });
  });

  it("todo a cero cuando no hay nada", () => {
    expect(totals([])).toEqual({ regular: 0, excess: 0, total: 0 });
  });
});

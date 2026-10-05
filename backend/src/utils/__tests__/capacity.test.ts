import { describe, it, expect } from "vitest";
import type { AssignmentStatus } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library.js";
import {
  countWorkdays,
  overlapDays,
  calculateCapacityHours,
  calculateCommittedHours,
  getAvailabilityStatus,
  getNextAvailableDate,
  computeAvailability,
  addDays,
  resolverJornada,
  JORNADA_GENERAL,
  PAIS_GENERAL,
} from "../capacity.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function d(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/**
 * Jornada de referencia de estas pruebas: la general, 8 h × 5 días. Desde D-5
 * las funciones de capacidad reciben una jornada ya resuelta, no la fila cruda
 * de `CapacityConfig`.
 */
const defaultConfig = JORNADA_GENERAL;

/** Jornadas por país tal y como llegan de la base (`hoursPerDay` es Decimal). */
const JORNADAS_PAIS = [
  { country: "Default", hoursPerDay: new Decimal(8), workDaysPerWeek: 5 },
  { country: "Colombia", hoursPerDay: new Decimal(8.5), workDaysPerWeek: 5 },
  { country: "Ecuador", hoursPerDay: new Decimal(8), workDaysPerWeek: 5 },
];

function makeAssignment(
  start: string,
  end: string,
  mode: "PERCENTAGE" | "HOURS" = "PERCENTAGE",
  allocationPct = 100,
  hoursPerPeriod?: number,
  status: "ACTIVE" | "PARTIAL" | "PLANNED" | "COMPLETED" | "CANCELLED" = "ACTIVE",
) {
  return {
    startDate: d(start),
    endDate: d(end),
    allocationMode: mode,
    allocationPct: mode === "PERCENTAGE" ? new Decimal(allocationPct) : null,
    hoursPerPeriod: hoursPerPeriod != null ? new Decimal(hoursPerPeriod) : null,
    periodUnit: hoursPerPeriod != null ? "week" : null,
    status: status as AssignmentStatus,
  };
}

function makeBlock(start: string, end: string) {
  return { startDate: d(start), endDate: d(end) };
}

// ─── countWorkdays ────────────────────────────────────────────────────────────

describe("countWorkdays", () => {
  it("single day (Monday) = 1", () => {
    // 2026-05-04 is a Monday
    expect(countWorkdays(d("2026-05-04"), d("2026-05-04"))).toBe(1);
  });

  it("full week Mon-Fri = 5", () => {
    expect(countWorkdays(d("2026-05-04"), d("2026-05-08"))).toBe(5);
  });

  it("Mon to next Sun = 5 workdays (Sat+Sun excluded)", () => {
    expect(countWorkdays(d("2026-05-04"), d("2026-05-10"))).toBe(5);
  });

  it("two full weeks = 10", () => {
    expect(countWorkdays(d("2026-05-04"), d("2026-05-15"))).toBe(10);
  });

  it("end before start = 0", () => {
    expect(countWorkdays(d("2026-05-08"), d("2026-05-04"))).toBe(0);
  });

  it("respects workDaysPerWeek=6 (Sat counted)", () => {
    // Mon-Sat = 6
    expect(countWorkdays(d("2026-05-04"), d("2026-05-09"), 6)).toBe(6);
  });
});

// ─── overlapDays ──────────────────────────────────────────────────────────────

describe("overlapDays", () => {
  it("no overlap (assignment ends before period)", () => {
    expect(overlapDays(d("2026-04-01"), d("2026-04-30"), d("2026-05-01"), d("2026-05-31"))).toBe(0);
  });

  it("no overlap (assignment starts after period)", () => {
    expect(overlapDays(d("2026-06-01"), d("2026-06-30"), d("2026-05-01"), d("2026-05-31"))).toBe(0);
  });

  it("full overlap", () => {
    const days = overlapDays(d("2026-05-01"), d("2026-05-31"), d("2026-05-01"), d("2026-05-31"));
    expect(days).toBeGreaterThan(0);
  });

  it("partial overlap: assignment spans two months", () => {
    const overlap = overlapDays(d("2026-04-15"), d("2026-05-15"), d("2026-05-01"), d("2026-05-31"));
    const fullMonth = overlapDays(d("2026-05-01"), d("2026-05-31"), d("2026-05-01"), d("2026-05-31"));
    expect(overlap).toBeLessThan(fullMonth);
  });
});

// ─── calculateCapacityHours ───────────────────────────────────────────────────

describe("calculateCapacityHours", () => {
  it("22 workdays in May 2026 × 8h = 176h (no blocks)", () => {
    // May 2026: 21 workdays (check: May has 31 days, 4 weekends = 8 days, 31-8=23 - no, check manually)
    // May 2026: 1=Fri,2=Sat,3=Sun,4=Mon,...31=Sun → weekends: 2,3,9,10,16,17,23,24,30,31 = 10 days
    // workdays = 31 - 10 = 21
    const hours = calculateCapacityHours({ from: d("2026-05-01"), to: d("2026-05-31") }, defaultConfig, []);
    expect(hours).toBe(21 * 8); // 168
  });

  it("con la jornada general (8 h × 5 d) una semana son 40 h", () => {
    const hours = calculateCapacityHours({ from: d("2026-05-04"), to: d("2026-05-08") }, JORNADA_GENERAL, []);
    expect(hours).toBe(5 * 8); // 40
  });

  it("deducts vacation block", () => {
    const noBlock = calculateCapacityHours({ from: d("2026-05-04"), to: d("2026-05-08") }, defaultConfig, []);
    const withBlock = calculateCapacityHours(
      { from: d("2026-05-04"), to: d("2026-05-08") },
      defaultConfig,
      [makeBlock("2026-05-04", "2026-05-04")], // Monday blocked
    );
    expect(withBlock).toBe(noBlock - 8);
  });

  it("block outside period is ignored", () => {
    const noBlock = calculateCapacityHours({ from: d("2026-05-04"), to: d("2026-05-08") }, defaultConfig, []);
    const withBlock = calculateCapacityHours(
      { from: d("2026-05-04"), to: d("2026-05-08") },
      defaultConfig,
      [makeBlock("2026-06-01", "2026-06-05")],
    );
    expect(withBlock).toBe(noBlock);
  });

  it("capacity never goes below 0 even if blocks exceed workdays", () => {
    const hours = calculateCapacityHours(
      { from: d("2026-05-04"), to: d("2026-05-08") },
      defaultConfig,
      [makeBlock("2026-01-01", "2026-12-31")],
    );
    expect(hours).toBe(0);
  });
});

// ─── calculateCommittedHours ──────────────────────────────────────────────────

describe("calculateCommittedHours", () => {
  const period = { from: d("2026-05-04"), to: d("2026-05-08") }; // 5 workdays

  it("100% assignment for full period = capacity", () => {
    const a = makeAssignment("2026-05-04", "2026-05-08", "PERCENTAGE", 100);
    const hours = calculateCommittedHours([a], period, defaultConfig);
    expect(hours).toBeCloseTo(5 * 8, 0); // 40h
  });

  it("50% assignment for full period = 20h", () => {
    const a = makeAssignment("2026-05-04", "2026-05-08", "PERCENTAGE", 50);
    const hours = calculateCommittedHours([a], period, defaultConfig);
    expect(hours).toBeCloseTo(20, 0);
  });

  it("two assignments summing 150% = 60h", () => {
    const a1 = makeAssignment("2026-05-04", "2026-05-08", "PERCENTAGE", 100);
    const a2 = makeAssignment("2026-05-04", "2026-05-08", "PERCENTAGE", 50);
    const hours = calculateCommittedHours([a1, a2], period, defaultConfig);
    expect(hours).toBeCloseTo(60, 0);
  });

  it("COMPLETED assignment does not count", () => {
    const a = makeAssignment("2026-05-04", "2026-05-08", "PERCENTAGE", 100, undefined, "COMPLETED");
    const hours = calculateCommittedHours([a], period, defaultConfig);
    expect(hours).toBe(0);
  });

  it("CANCELLED assignment does not count", () => {
    const a = makeAssignment("2026-05-04", "2026-05-08", "PERCENTAGE", 100, undefined, "CANCELLED");
    const hours = calculateCommittedHours([a], period, defaultConfig);
    expect(hours).toBe(0);
  });

  it("assignment outside period = 0 committed hours", () => {
    const a = makeAssignment("2026-06-01", "2026-06-30", "PERCENTAGE", 100);
    const hours = calculateCommittedHours([a], period, defaultConfig);
    expect(hours).toBe(0);
  });

  it("HOURS mode: 40h/week for 1 week period", () => {
    const a = makeAssignment("2026-05-04", "2026-05-08", "HOURS", 0, 40);
    const hours = calculateCommittedHours([a], period, defaultConfig);
    expect(hours).toBeGreaterThan(0);
  });
});

// ─── getAvailabilityStatus ────────────────────────────────────────────────────

describe("getAvailabilityStatus", () => {
  it("0% → FREE", () => expect(getAvailabilityStatus(0)).toBe("FREE"));
  it("50% → PARTIAL", () => expect(getAvailabilityStatus(50)).toBe("PARTIAL"));
  it("99% → PARTIAL", () => expect(getAvailabilityStatus(99)).toBe("PARTIAL"));
  it("100% → FULL", () => expect(getAvailabilityStatus(100)).toBe("FULL"));
  it("110% → OVERLOADED", () => expect(getAvailabilityStatus(110)).toBe("OVERLOADED"));
  it("150% → OVERLOADED", () => expect(getAvailabilityStatus(150)).toBe("OVERLOADED"));
});

// ─── getNextAvailableDate ─────────────────────────────────────────────────────

describe("getNextAvailableDate", () => {
  const today = d("2026-05-10");

  it("no assignments → null (already free)", () => {
    expect(getNextAvailableDate([], [], today)).toBeNull();
  });

  it("single assignment ending in 10 days → available on day 11", () => {
    const a = makeAssignment("2026-05-01", "2026-05-20", "PERCENTAGE", 100);
    const next = getNextAvailableDate([a], [], today);
    expect(next?.toISOString().slice(0, 10)).toBe("2026-05-21");
  });

  it("chained assignments: next starts when previous ends → extends to last end", () => {
    const a1 = makeAssignment("2026-05-01", "2026-05-20");
    const a2 = makeAssignment("2026-05-20", "2026-06-10");
    const next = getNextAvailableDate([a1, a2], [], today);
    expect(next?.toISOString().slice(0, 10)).toBe("2026-06-11");
  });

  it("block after assignment extends release date", () => {
    const a = makeAssignment("2026-05-01", "2026-05-20");
    const block = makeBlock("2026-05-21", "2026-05-25");
    const next = getNextAvailableDate([a], [block], today);
    expect(next?.toISOString().slice(0, 10)).toBe("2026-05-26");
  });

  it("past assignments (endDate < today) are ignored", () => {
    const a = makeAssignment("2026-04-01", "2026-05-09", "PERCENTAGE", 100, undefined, "COMPLETED");
    const next = getNextAvailableDate([a], [], today);
    expect(next).toBeNull();
  });
});

// ─── computeAvailability (integration) ───────────────────────────────────────

describe("computeAvailability", () => {
  const period = { from: d("2026-05-04"), to: d("2026-05-08") }; // 5 workdays = 40h

  it("no assignments → FREE, 40h available, 0 committed", () => {
    const result = computeAvailability("c1", [], [], defaultConfig, period);
    expect(result.availabilityStatus).toBe("FREE");
    expect(result.capacityHours).toBe(40);
    expect(result.committedHours).toBe(0);
    expect(result.availableHours).toBe(40);
    expect(result.utilizationPct).toBe(0);
    expect(result.nextAvailableDate).toBeNull();
  });

  it("50% assignment → PARTIAL, 20h available", () => {
    const a = makeAssignment("2026-05-04", "2026-05-08", "PERCENTAGE", 50);
    const result = computeAvailability("c1", [a], [], defaultConfig, period);
    expect(result.availabilityStatus).toBe("PARTIAL");
    expect(result.availableHours).toBeCloseTo(20, 0);
    expect(result.committedHours).toBeCloseTo(20, 0);
  });

  it("100% assignment → FULL, 0 available", () => {
    const a = makeAssignment("2026-05-04", "2026-05-08", "PERCENTAGE", 100);
    const result = computeAvailability("c1", [a], [], defaultConfig, period);
    expect(result.availabilityStatus).toBe("FULL");
    expect(result.availableHours).toBe(0);
  });

  it("150% (2 assignments) → OVERLOADED", () => {
    const a1 = makeAssignment("2026-05-04", "2026-05-08", "PERCENTAGE", 100);
    const a2 = makeAssignment("2026-05-04", "2026-05-08", "PERCENTAGE", 50);
    const result = computeAvailability("c1", [a1, a2], [], defaultConfig, period);
    expect(result.availabilityStatus).toBe("OVERLOADED");
    expect(result.utilizationPct).toBeGreaterThan(100);
  });

  it("vacation block reduces capacity, not committedHours", () => {
    const block = makeBlock("2026-05-04", "2026-05-04"); // Monday off
    const a = makeAssignment("2026-05-04", "2026-05-08", "PERCENTAGE", 100);
    const result = computeAvailability("c1", [a], [block], defaultConfig, period);
    // capacity = 4 days × 8h = 32h; committed > 32h (100% of 40h) → OVERLOADED
    expect(result.capacityHours).toBe(32);
    expect(result.availabilityStatus).toBe("OVERLOADED");
  });

  it("nextAvailableDate is set when not FREE", () => {
    const a = makeAssignment("2026-05-04", "2026-05-31", "PERCENTAGE", 100);
    const result = computeAvailability("c1", [a], [], defaultConfig, period);
    expect(result.nextAvailableDate).not.toBeNull();
    expect(result.nextAvailableDate?.toISOString().slice(0, 10)).toBe("2026-06-01");
  });

  it("con la jornada general la capacidad semanal es 40 h", () => {
    const result = computeAvailability("c1", [], [], JORNADA_GENERAL, period);
    expect(result.capacityHours).toBe(40);
  });

  it("PLANNED assignment cuenta como comprometido", () => {
    const a = makeAssignment("2026-05-04", "2026-05-08", "PERCENTAGE", 80, undefined, "PLANNED");
    const result = computeAvailability("c1", [a], [], defaultConfig, period);
    expect(result.committedHours).toBeGreaterThan(0);
    expect(result.availabilityStatus).toBe("PARTIAL");
  });

  it("COMPLETED assignment no cuenta como comprometido", () => {
    const a = makeAssignment("2026-05-04", "2026-05-08", "PERCENTAGE", 100, undefined, "COMPLETED");
    const result = computeAvailability("c1", [a], [], defaultConfig, period);
    expect(result.committedHours).toBe(0);
    expect(result.availabilityStatus).toBe("FREE");
  });

  it("múltiples vacaciones que cubren todo el período → capacidad = 0", () => {
    const blocks = [
      makeBlock("2026-05-04", "2026-05-05"),
      makeBlock("2026-05-06", "2026-05-08"),
    ];
    const result = computeAvailability("c1", [], blocks, defaultConfig, period);
    expect(result.capacityHours).toBe(0);
    expect(result.availabilityStatus).toBe("FREE");
  });

  it("utilizationPct = 0 cuando no hay assignments", () => {
    const result = computeAvailability("c1", [], [], defaultConfig, period);
    expect(result.utilizationPct).toBe(0);
  });

  it("availableHours nunca es negativo aunque committedHours supere la capacidad", () => {
    const a1 = makeAssignment("2026-05-04", "2026-05-08", "PERCENTAGE", 100);
    const a2 = makeAssignment("2026-05-04", "2026-05-08", "PERCENTAGE", 100);
    const result = computeAvailability("c1", [a1, a2], [], defaultConfig, period);
    expect(result.availableHours).toBe(0); // nunca negativo
    expect(result.utilizationPct).toBe(200);
    expect(result.availabilityStatus).toBe("OVERLOADED");
  });

  it("assignment con overlap parcial de período: solo cuenta días solapados", () => {
    // Assignment que abarca solo los últimos 3 días hábiles del período (miér-vier)
    const a = makeAssignment("2026-05-06", "2026-05-08", "PERCENTAGE", 100);
    const result = computeAvailability("c1", [a], [], defaultConfig, period);
    // 3 días de overlap × 8h = 24h comprometidas de 40h de capacidad
    expect(result.committedHours).toBeCloseTo(24, 0);
    expect(result.availabilityStatus).toBe("PARTIAL");
  });
});

// ─── countWorkdays — edge cases adicionales ───────────────────────────────────

describe("countWorkdays — edge cases", () => {
  it("semana con feriado nacional (solo días hábiles reales)", () => {
    // El conteo básico no incluye feriados, solo excluye sábados/domingos
    // 2026-06-01 (lun) a 2026-06-05 (vie) = 5
    expect(countWorkdays(new Date("2026-06-01T00:00:00.000Z"), new Date("2026-06-05T00:00:00.000Z"))).toBe(5);
  });

  it("año bisiesto: feb 2028 tiene 29 días", () => {
    // 1 feb 2028 (miér) a 29 feb 2028 (miér)
    const days = countWorkdays(
      new Date("2028-02-01T00:00:00.000Z"),
      new Date("2028-02-29T00:00:00.000Z"),
    );
    // 29 días totales - 8 fines de semana (4 sáb + 4 dom + 1 sáb) = 21 laborables
    expect(days).toBe(21);
  });

  it("inicio en sábado: el sábado no cuenta", () => {
    // 2026-05-02 (sáb) a 2026-05-04 (lun)
    const days = countWorkdays(
      new Date("2026-05-02T00:00:00.000Z"),
      new Date("2026-05-04T00:00:00.000Z"),
    );
    expect(days).toBe(1); // solo el lunes
  });
});

// ─── addDays ──────────────────────────────────────────────────────────────────

describe("addDays", () => {
  it("suma 1 día a una fecha", () => {
    const result = addDays(new Date("2026-05-01T00:00:00.000Z"), 1);
    expect(result.toISOString().slice(0, 10)).toBe("2026-05-02");
  });

  it("suma 0 días: misma fecha", () => {
    const d = new Date("2026-05-01T00:00:00.000Z");
    expect(addDays(d, 0).toISOString().slice(0, 10)).toBe("2026-05-01");
  });

  it("cruza fin de mes", () => {
    const result = addDays(new Date("2026-01-31T00:00:00.000Z"), 1);
    expect(result.toISOString().slice(0, 10)).toBe("2026-02-01");
  });
});

// ─── Jornada laboral configurable (decisión de negocio D-5) ──────────────────

describe("resolverJornada — precedencia consultor → país → general", () => {
  it("sin fila propia, un colombiano hereda las 8,5 h de Colombia", () => {
    const jornada = resolverJornada(null, "Colombia", JORNADAS_PAIS);
    expect(jornada.hoursPerDay).toBe(8.5);
    expect(jornada.workDaysPerWeek).toBe(5);
    expect(jornada.origen).toBe("pais");
    expect(jornada.paisAplicado).toBe("Colombia");
  });

  it("sin fila propia, un ecuatoriano hereda las 8 h de Ecuador", () => {
    const jornada = resolverJornada(null, "Ecuador", JORNADAS_PAIS);
    expect(jornada.hoursPerDay).toBe(8);
    expect(jornada.origen).toBe("pais");
    expect(jornada.paisAplicado).toBe("Ecuador");
  });

  it("la fila del consultor manda sobre la de su país", () => {
    const propia = { hoursPerDay: new Decimal(6), workDaysPerWeek: 4 };
    const jornada = resolverJornada(propia, "Colombia", JORNADAS_PAIS);
    expect(jornada.hoursPerDay).toBe(6);
    expect(jornada.workDaysPerWeek).toBe(4);
    expect(jornada.origen).toBe("consultor");
    // La excepción no "pertenece" a un país: se aplica tal cual.
    expect(jornada.paisAplicado).toBeNull();
  });

  it("un país sin configurar cae en la fila general, no en un 8 escondido", () => {
    const jornada = resolverJornada(null, "Chile", JORNADAS_PAIS);
    expect(jornada.hoursPerDay).toBe(8);
    expect(jornada.origen).toBe("general");
    expect(jornada.paisAplicado).toBe(PAIS_GENERAL);
  });

  it("un consultor sin país cae también en la fila general", () => {
    expect(resolverJornada(null, null, JORNADAS_PAIS).origen).toBe("general");
    expect(resolverJornada(null, undefined, JORNADAS_PAIS).origen).toBe("general");
  });

  it("sin ninguna fila en la base se usa JORNADA_GENERAL (8 × 5)", () => {
    const jornada = resolverJornada(null, "Colombia", []);
    expect(jornada).toEqual({ ...JORNADA_GENERAL, origen: "general", paisAplicado: null });
  });

  it("el país se compara sin distinguir mayúsculas ni espacios", () => {
    expect(resolverJornada(null, "  colombia ", JORNADAS_PAIS).hoursPerDay).toBe(8.5);
    expect(resolverJornada(null, "COLOMBIA", JORNADAS_PAIS).hoursPerDay).toBe(8.5);
  });

  it("la fila general sigue valiendo aunque Colombia cambie de valor", () => {
    const otras = [
      { country: "Default", hoursPerDay: new Decimal(7), workDaysPerWeek: 5 },
      { country: "Colombia", hoursPerDay: new Decimal(9), workDaysPerWeek: 6 },
    ];
    expect(resolverJornada(null, "Colombia", otras).hoursPerDay).toBe(9);
    expect(resolverJornada(null, "Peru", otras).hoursPerDay).toBe(7);
  });
});

describe("capacidad con la jornada real de cada país (D-5)", () => {
  // Semana completa de lunes a viernes, sin feriados en ninguno de los dos países.
  const semana = { from: d("2026-05-04"), to: d("2026-05-08") };

  it("un consultor colombiano tiene 42,5 h de capacidad semanal, no 40", () => {
    const jornada = resolverJornada(null, "Colombia", JORNADAS_PAIS);
    expect(calculateCapacityHours(semana, jornada, [], "Colombia")).toBe(42.5);
  });

  it("un consultor ecuatoriano tiene 40 h de capacidad semanal", () => {
    const jornada = resolverJornada(null, "Ecuador", JORNADAS_PAIS);
    expect(calculateCapacityHours(semana, jornada, [], "Ecuador")).toBe(40);
  });

  it("la misma asignación al 100 % compromete más horas en Colombia que en Ecuador", () => {
    const asignacion = makeAssignment("2026-05-04", "2026-05-08", "PERCENTAGE", 100);
    const colombia = calculateCommittedHours(
      [asignacion], semana, resolverJornada(null, "Colombia", JORNADAS_PAIS), "Colombia",
    );
    const ecuador = calculateCommittedHours(
      [asignacion], semana, resolverJornada(null, "Ecuador", JORNADAS_PAIS), "Ecuador",
    );
    expect(colombia).toBeCloseTo(42.5, 5);
    expect(ecuador).toBeCloseTo(40, 5);
  });

  it("una asignación de 40 h/semana ocupa al colombiano al 94,1 %, no al 100 %", () => {
    // Es el efecto medible del arreglo: antes, con 8 h fijas, salía 100 %.
    const asignacion = makeAssignment("2026-05-04", "2026-05-08", "HOURS", 0, 40);
    const jornada = resolverJornada(null, "Colombia", JORNADAS_PAIS);
    const resultado = computeAvailability("c-col", [asignacion], [], jornada, semana, "Colombia");
    expect(resultado.capacityHours).toBe(42.5);
    expect(resultado.committedHours).toBeCloseTo(40, 1);
    expect(resultado.utilizationPct).toBeCloseTo(94.1, 1);
    expect(resultado.availabilityStatus).toBe("PARTIAL");
  });

  it("la excepción por consultor se impone sobre su país también en la capacidad", () => {
    const mediaJornada = { hoursPerDay: new Decimal(4), workDaysPerWeek: 5 };
    const jornada = resolverJornada(mediaJornada, "Colombia", JORNADAS_PAIS);
    expect(calculateCapacityHours(semana, jornada, [], "Colombia")).toBe(20);
  });
});

import { describe, it, expect } from "vitest";
import type { MonthlyCapacityConsultantRow } from "../services/api";
import {
  addMonths,
  countMonths,
  FILTERS_STORAGE_KEY,
  formatPct,
  loadStoredFilters,
  saveStoredFilters,
  presetRange,
  shiftRange,
  sortConsultants,
  statusTone,
  validateRange,
} from "../features/capacity/monthly/monthlyUtils";

describe("statusTone", () => {
  it("clasifica cada estado con su tono", () => {
    expect(statusTone("OVER")).toBe("over");
    expect(statusTone("OK")).toBe("ok");
    expect(statusTone("UNDER")).toBe("under");
  });
  it("trata null como sin dato", () => {
    expect(statusTone(null)).toBe("none");
  });
});

describe("shiftRange (flechas ◀ ▶)", () => {
  it("avanza el rango completo un mes", () => {
    expect(shiftRange("2026-01", "2026-12", 1)).toEqual({ from: "2026-02", to: "2027-01" });
  });
  it("retrocede cruzando el cambio de año", () => {
    expect(shiftRange("2026-01", "2026-06", -1)).toEqual({ from: "2025-12", to: "2026-05" });
  });
  it("conserva la duración del rango", () => {
    const { from, to } = shiftRange("2026-11", "2027-02", 3);
    expect(countMonths(from, to)).toBe(4);
    expect(from).toBe("2027-02");
  });
  it("addMonths maneja saltos de varios años", () => {
    expect(addMonths("2026-03", -15)).toBe("2024-12");
  });
});

describe("validateRange", () => {
  it("acepta exactamente 24 meses", () => {
    expect(validateRange("2026-01", "2027-12")).toBeNull();
  });
  it("rechaza 25 meses", () => {
    expect(validateRange("2026-01", "2028-01")).toMatch(/24 meses/);
  });
  it("rechaza un inicio posterior al fin", () => {
    expect(validateRange("2026-05", "2026-04")).toMatch(/posterior/);
  });
  it("acepta un solo mes", () => {
    expect(validateRange("2026-05", "2026-05")).toBeNull();
  });
});

describe("presetRange", () => {
  const today = new Date(2026, 9, 15); // octubre de 2026
  it("año actual: enero a diciembre", () => {
    expect(presetRange("currentYear", today)).toEqual({ from: "2026-01", to: "2026-12" });
  });
  it("próximos 6 meses incluye el mes en curso", () => {
    expect(presetRange("next6", today)).toEqual({ from: "2026-10", to: "2027-03" });
  });
  it("próximos 12 meses cruza de año", () => {
    expect(presetRange("next12", today)).toEqual({ from: "2026-10", to: "2027-09" });
  });
});

describe("formatPct", () => {
  it("redondea sin decimales", () => {
    expect(formatPct(87.6)).toBe("88%");
  });
  it("muestra raya cuando no hay dato", () => {
    expect(formatPct(null)).toBe("—");
  });
});

describe("sortConsultants", () => {
  const row = (fullName: string, country: string | null, pct: number | null) =>
    ({ fullName, country, period: { pct } }) as unknown as MonthlyCapacityConsultantRow;
  const rows = [row("Beto", "Colombia", 50), row("Ana", null, null), row("Carla", "Ecuador", 120)];

  it("ordena por nombre", () => {
    expect(sortConsultants(rows, "name", "asc").map((r) => r.fullName)).toEqual(["Ana", "Beto", "Carla"]);
  });
  it("ordena por % del periodo descendente con null al final", () => {
    expect(sortConsultants(rows, "period", "desc").map((r) => r.fullName)).toEqual(["Carla", "Beto", "Ana"]);
  });
  it("ordena por país", () => {
    expect(sortConsultants(rows, "country", "asc").map((r) => r.fullName)).toEqual(["Ana", "Beto", "Carla"]);
  });
});

describe("persistencia del periodo y filtros", () => {
  const filtros = {
    from: "2026-03", to: "2026-08", includeProbables: true, excludeInternal: true, country: "Ecuador", city: "Quito",
  };
  it("guarda y recupera los filtros", () => {
    sessionStorage.clear();
    saveStoredFilters(filtros);
    expect(loadStoredFilters()).toEqual(filtros);
  });
  it("ignora datos corruptos o con meses inválidos", () => {
    sessionStorage.setItem(FILTERS_STORAGE_KEY, "{no es json");
    expect(loadStoredFilters()).toBeNull();
    sessionStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify({ from: "2026-13", to: "2026-02" }));
    expect(loadStoredFilters()).toBeNull();
  });
  it("no revienta si el storage falla", () => {
    const roto = { getItem: () => { throw new Error("bloqueado"); }, setItem: () => { throw new Error("lleno"); } };
    expect(loadStoredFilters(roto)).toBeNull();
    expect(() => saveStoredFilters(filtros, roto)).not.toThrow();
  });
});

import { describe, it, expect } from "vitest";
import { computeHealthStatus, type HealthInput } from "../health.js";

const baseInput: HealthInput = {
  alertLevel: "ok",
  // Margen holgado a proposito: 25 ya no es un proyecto sano bajo D-2 (el
  // umbral de advertencia por defecto es 30).
  grossMarginActualPct: 50,
  marginWarningPct: 30,
  marginCriticalPct: 15,
  openHighRisks: 0,
  delayedMilestones: 0,
  spi: 1.0,
  cpi: 1.0,
  utilizationPct: 75,
};

describe("computeHealthStatus", () => {
  it("retorna GREEN para un proyecto saludable", () => {
    expect(computeHealthStatus(baseInput)).toBe("GREEN");
  });

  // ── RED triggers ──────────────────────────────────────────────────────────

  it("retorna RED si alertLevel es exceeded (presupuesto superado)", () => {
    expect(computeHealthStatus({ ...baseInput, alertLevel: "exceeded" })).toBe("RED");
  });

  it("retorna RED si hay riesgos de alto impacto abiertos", () => {
    expect(computeHealthStatus({ ...baseInput, openHighRisks: 1 })).toBe("RED");
    expect(computeHealthStatus({ ...baseInput, openHighRisks: 3 })).toBe("RED");
  });

  it("retorna RED si CPI < 0.75", () => {
    expect(computeHealthStatus({ ...baseInput, cpi: 0.74 })).toBe("RED");
    expect(computeHealthStatus({ ...baseInput, cpi: 0.5 })).toBe("RED");
  });

  it("retorna RED si SPI < 0.75", () => {
    expect(computeHealthStatus({ ...baseInput, spi: 0.74 })).toBe("RED");
  });

  it("retorna RED si el margen baja del umbral crítico (D-2)", () => {
    // crítico = 15 → cualquier margen por debajo de 15 es RED
    expect(computeHealthStatus({ ...baseInput, grossMarginActualPct: 14.99 })).toBe("RED");
    expect(computeHealthStatus({ ...baseInput, grossMarginActualPct: 7 })).toBe("RED");
    expect(computeHealthStatus({ ...baseInput, grossMarginActualPct: -5 })).toBe("RED");
  });

  // ── YELLOW triggers ───────────────────────────────────────────────────────

  it("retorna YELLOW si alertLevel es warning", () => {
    expect(computeHealthStatus({ ...baseInput, alertLevel: "warning" })).toBe("YELLOW");
  });

  it("retorna YELLOW si hay hitos retrasados", () => {
    expect(computeHealthStatus({ ...baseInput, delayedMilestones: 1 })).toBe("YELLOW");
  });

  it("retorna YELLOW si CPI está entre 0.75 y 0.90", () => {
    expect(computeHealthStatus({ ...baseInput, cpi: 0.76 })).toBe("YELLOW");
    expect(computeHealthStatus({ ...baseInput, cpi: 0.89 })).toBe("YELLOW");
  });

  it("retorna YELLOW si SPI está entre 0.75 y 0.90", () => {
    expect(computeHealthStatus({ ...baseInput, spi: 0.85 })).toBe("YELLOW");
  });

  it("retorna YELLOW si el margen está entre el crítico y el de advertencia (D-2)", () => {
    // crítico = 15, advertencia = 30 → la banda [15, 30) es YELLOW
    expect(computeHealthStatus({ ...baseInput, grossMarginActualPct: 29.99 })).toBe("YELLOW");
    expect(computeHealthStatus({ ...baseInput, grossMarginActualPct: 20 })).toBe("YELLOW");
    expect(computeHealthStatus({ ...baseInput, grossMarginActualPct: 15 })).toBe("YELLOW");
  });

  it("los bordes exactos pertenecen a la banda buena", () => {
    // 30,00 con advertencia 30 → GREEN; 15,00 con crítico 15 → YELLOW, no RED.
    expect(computeHealthStatus({ ...baseInput, grossMarginActualPct: 30 })).toBe("GREEN");
    expect(computeHealthStatus({ ...baseInput, grossMarginActualPct: 15 })).not.toBe("RED");
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  it("CPI exactamente en 0.75 no es RED", () => {
    expect(computeHealthStatus({ ...baseInput, cpi: 0.75 })).not.toBe("RED");
  });

  it("CPI exactamente en 0.90 no es YELLOW", () => {
    expect(computeHealthStatus({ ...baseInput, cpi: 0.90 })).not.toBe("YELLOW");
  });

  it("ignorar margen si los dos umbrales son null", () => {
    const lowMargin = { ...baseInput, grossMarginActualPct: 2, marginWarningPct: null, marginCriticalPct: null };
    expect(computeHealthStatus(lowMargin)).toBe("GREEN");
  });

  it("ignorar margen si grossMarginActualPct es null", () => {
    const noMargin = { ...baseInput, grossMarginActualPct: null };
    expect(computeHealthStatus(noMargin)).toBe("GREEN");
  });

  it("RED tiene prioridad sobre YELLOW (múltiples condiciones simultáneas)", () => {
    // alertLevel warning (→ YELLOW) AND openHighRisks > 0 (→ RED) → debe ser RED
    expect(computeHealthStatus({ ...baseInput, alertLevel: "warning", openHighRisks: 1 })).toBe("RED");
  });
});

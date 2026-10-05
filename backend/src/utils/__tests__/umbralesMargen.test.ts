/**
 * Dos umbrales de margen por proyecto (decisión de negocio D-2).
 *
 * Dirección confirmó que son DOS niveles, no uno:
 *   · advertencia — 30 % por defecto, "el margen baja, hay que vigilarlo"
 *   · crítico     — 15 % por defecto, "el suelo que no se debe cruzar"
 *
 * Este archivo fija los cortes exactos, los bordes y el comportamiento cuando
 * el proyecto no configura nada. Antes de D-2 solo existía un umbral y el
 * segundo nivel se improvisaba multiplicándolo por 0,5 dentro de `health.ts`.
 */

import { describe, expect, it } from "vitest";
import { buildRateBook } from "../currency.js";
import {
  DEFAULT_MARGIN_CRITICAL_PCT,
  DEFAULT_MARGIN_WARNING_PCT,
  classifyMargin,
  computeProjectFinancials,
  marginThresholdsAreCoherent,
  resolveMarginThresholds,
  type ProjectFinancialsInput,
} from "../financial.js";
import { computeHealthStatus, type HealthInput } from "../health.js";
import { UMBRALES_SALUD_POR_DEFECTO } from "../healthThresholds.js";

const DEFECTO = resolveMarginThresholds(null, null);

// ─── Clasificación del margen contra los dos umbrales ────────────────────────

describe("classifyMargin con los umbrales por defecto (30 / 15)", () => {
  it("por debajo de 30 el proyecto queda en advertencia", () => {
    expect(classifyMargin(29.99, DEFECTO)).toBe("warning");
    expect(classifyMargin(22, DEFECTO)).toBe("warning");
    expect(classifyMargin(15.01, DEFECTO)).toBe("warning");
  });

  it("por debajo de 15 el proyecto queda en crítico", () => {
    expect(classifyMargin(14.99, DEFECTO)).toBe("critical");
    expect(classifyMargin(0, DEFECTO)).toBe("critical");
    expect(classifyMargin(-40, DEFECTO)).toBe("critical");
  });

  it("los bordes exactos pertenecen a la banda buena: 30,00 es ok y 15,00 es advertencia", () => {
    expect(classifyMargin(30, DEFECTO)).toBe("ok");
    expect(classifyMargin(30.01, DEFECTO)).toBe("ok");
    expect(classifyMargin(15, DEFECTO)).toBe("warning");
  });

  it("un margen no medible (null) no produce veredicto", () => {
    // Sin ingresos reconocidos no hay nada que comparar: no se pinta rojo por
    // falta de datos.
    expect(classifyMargin(null, DEFECTO)).toBe("ok");
  });
});

describe("resolveMarginThresholds", () => {
  it("un proyecto sin umbrales propios usa los valores por defecto (30 / 15)", () => {
    expect(DEFECTO).toEqual({ warningPct: 30, criticalPct: 15 });
    expect(DEFAULT_MARGIN_WARNING_PCT).toBe(30);
    expect(DEFAULT_MARGIN_CRITICAL_PCT).toBe(15);
  });

  it("configurar solo uno deja el otro en el valor por defecto", () => {
    expect(resolveMarginThresholds(45, null)).toEqual({ warningPct: 45, criticalPct: 15 });
    expect(resolveMarginThresholds(null, 10)).toEqual({ warningPct: 30, criticalPct: 10 });
  });

  it("el cero es un valor válido y no cae al valor por defecto", () => {
    expect(resolveMarginThresholds(0, 0)).toEqual({ warningPct: 0, criticalPct: 0 });
  });
});

// ─── Coherencia: el crítico es un suelo, no puede estar por encima ───────────

describe("marginThresholdsAreCoherent", () => {
  it("acepta crítico por debajo o igual al de advertencia", () => {
    expect(marginThresholdsAreCoherent(30, 15)).toBe(true);
    expect(marginThresholdsAreCoherent(20, 20)).toBe(true);
  });

  it("rechaza un crítico mayor que el de advertencia", () => {
    expect(marginThresholdsAreCoherent(20, 25)).toBe(false);
  });

  it("rechaza también contra el valor por defecto cuando el otro campo va vacío", () => {
    // Crítico 40 con la advertencia en blanco se compara contra el 30 por
    // defecto: es incoherente aunque el formulario no haya escrito nada.
    expect(marginThresholdsAreCoherent(null, 40)).toBe(false);
    // Advertencia 10 con el crítico en blanco se compara contra el 15 por defecto.
    expect(marginThresholdsAreCoherent(10, null)).toBe(false);
  });
});

// ─── El semáforo RAG distingue los dos niveles ───────────────────────────────

const saludBase: HealthInput = {
  alertLevel: "ok",
  grossMarginActualPct: 50,
  marginWarningPct: 30,
  marginCriticalPct: 15,
  openHighRisks: 0,
  delayedMilestones: 0,
  spi: 1,
  cpi: 1,
  utilizationPct: 0,
  thresholds: UMBRALES_SALUD_POR_DEFECTO,
};

describe("computeHealthStatus con los dos umbrales (D-2)", () => {
  it("por debajo de 30 el semáforo es Advertencia (YELLOW)", () => {
    expect(computeHealthStatus({ ...saludBase, grossMarginActualPct: 29.99 })).toBe("YELLOW");
  });

  it("por debajo de 15 el semáforo es Crítico (RED)", () => {
    expect(computeHealthStatus({ ...saludBase, grossMarginActualPct: 14.99 })).toBe("RED");
  });

  it("los bordes exactos: 30,00 es Saludable y 15,00 es Advertencia", () => {
    expect(computeHealthStatus({ ...saludBase, grossMarginActualPct: 30 })).toBe("GREEN");
    expect(computeHealthStatus({ ...saludBase, grossMarginActualPct: 15 })).toBe("YELLOW");
  });

  it("con umbrales propios manda el proyecto, no el valor por defecto", () => {
    const propios = { ...saludBase, marginWarningPct: 60, marginCriticalPct: 45 };
    // 50 % estaría saludable con 30/15 y es advertencia con 60/45.
    expect(computeHealthStatus({ ...saludBase, grossMarginActualPct: 50 })).toBe("GREEN");
    expect(computeHealthStatus({ ...propios, grossMarginActualPct: 50 })).toBe("YELLOW");
    expect(computeHealthStatus({ ...propios, grossMarginActualPct: 44 })).toBe("RED");
  });
});

// ─── Extremo a extremo del cálculo: de las cifras al veredicto ───────────────

const rateBook = buildRateBook([{ baseCode: "USD", quoteCode: "COP", rate: 4000 }], []);
const FECHA = new Date("2026-01-15T00:00:00Z");


/**
 * Proyecto con un costo real fijo de 20 000 USD (400 h × 50 USD). El margen se
 * mueve cambiando los ingresos reconocidos:
 *   ingresos 100 000 → margen 80 %   (ok)
 *   ingresos  25 000 → margen 20 %   (advertencia)
 *   ingresos  22 000 → margen 9,09 % (crítico)
 */
function proyectoConIngresos(
  ingresos: number,
  umbrales: { marginWarningPct: number | null; marginCriticalPct: number | null },
): ProjectFinancialsInput {
  return {
    budget: 200_000,
    budgetCurrency: "USD",
    sellPrice: 200_000,
    sellCurrency: "USD",
    marginWarningPct: umbrales.marginWarningPct,
    marginCriticalPct: umbrales.marginCriticalPct,
    budgetAlertPct: null,
    healthThresholds: UMBRALES_SALUD_POR_DEFECTO,
    revenueEntries: [{ amount: ingresos, currency: "USD", entryDate: FECHA }],
    approvedTimeEntries: [
      {
        consultantId: "c1",
        hours: 400,
        workDate: new Date("2026-04-15T00:00:00Z"),
        hourlyRate: 50,
        rateCurrency: "USD",
      },
    ],
    expenses: [],
    forecasts: [],
    rateBook,
    valuationDate: FECHA,
    baseCurrency: "USD",
  };
}

const sinUmbralesPropios = { marginWarningPct: null, marginCriticalPct: null };

describe("computeProjectFinancials: veredicto de margen de punta a punta", () => {
  it("un proyecto sin umbrales propios se mide contra 30 / 15", () => {
    const f = computeProjectFinancials(proyectoConIngresos(25_000, sinUmbralesPropios));
    expect(f.grossMarginActualPct).toBe(20);
    expect(f.marginWarningPct).toBe(30);
    expect(f.marginCriticalPct).toBe(15);
    expect(f.marginLevel).toBe("warning");
  });

  it("por debajo del crítico el veredicto es crítico", () => {
    const f = computeProjectFinancials(proyectoConIngresos(22_000, sinUmbralesPropios));
    expect(f.grossMarginActualPct).toBe(9.09);
    expect(f.marginLevel).toBe("critical");
  });

  it("margen holgado: ningún veredicto", () => {
    const f = computeProjectFinancials(proyectoConIngresos(100_000, sinUmbralesPropios));
    expect(f.grossMarginActualPct).toBe(80);
    expect(f.marginLevel).toBe("ok");
  });

  it("borde exacto de 30,00 %: el proyecto NO entra en advertencia", () => {
    // Costo 20 000 e ingresos 28 571,43 → margen 30,00 %.
    const f = computeProjectFinancials(proyectoConIngresos(28_571.43, sinUmbralesPropios));
    expect(f.grossMarginActualPct).toBe(30);
    expect(f.marginLevel).toBe("ok");
  });

  it("un crítico heredado por encima de 30 no produce un semáforo imposible", () => {
    // Proyecto que traía un suelo del 40 % y ninguna advertencia: la banda de
    // aviso queda vacía y todo lo que baje del suelo es crítico.
    const f = computeProjectFinancials(
      proyectoConIngresos(25_000, { marginWarningPct: null, marginCriticalPct: 40 }),
    );
    expect(f.marginWarningPct).toBe(40);
    expect(f.marginCriticalPct).toBe(40);
    expect(f.marginLevel).toBe("critical");
  });
});

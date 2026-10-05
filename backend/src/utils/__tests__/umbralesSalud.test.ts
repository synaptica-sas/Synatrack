/**
 * Umbrales del semáforo de salud configurables (decisión de negocio D-7).
 *
 * El defecto que se corrige: había DOS criterios para lo mismo. El Portafolio
 * pintaba la celda de CPI con `< 0,85` rojo y `< 1,00` ámbar, mientras el
 * semáforo de la MISMA fila usaba `< 0,75` y `< 0,90`. Un CPI de 0,80 salía con
 * la celda en rojo y el semáforo en ámbar.
 *
 * La prueba central de este fichero es "la contradicción desapareció": el
 * veredicto de la celda y el del semáforo se calculan ahora con la misma
 * función y la misma configuración, así que no pueden diferir.
 */

import { describe, expect, it } from "vitest";
import {
  AMBITO_GENERAL,
  UMBRALES_SALUD_POR_DEFECTO,
  clasificarIndiceEvm,
  clasificarUsoPresupuesto,
  resolverUmbralesSalud,
  type UmbralesSalud,
} from "../healthThresholds.js";
import { computeHealthStatus, type HealthInput } from "../health.js";
import { DEFAULT_BUDGET_ALERT_PCT, resolveBudgetAlertPct } from "../financial.js";

const umbrales = UMBRALES_SALUD_POR_DEFECTO;

/** Proyecto sano en todo lo demás: lo único que se mueve es el CPI o el SPI. */
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
  thresholds: umbrales,
};

/**
 * Traduce el veredicto de la CELDA al estado que tendría el semáforo si ese
 * indicador fuese lo único que falla. Es la equivalencia que antes no existía:
 * crítico → RED, advertencia → YELLOW, ok / no medible → GREEN.
 */
function semaforoEsperadoSegunCelda(nivel: string): "GREEN" | "YELLOW" | "RED" {
  if (nivel === "critical") return "RED";
  if (nivel === "warning") return "YELLOW";
  return "GREEN";
}

// ─── Los valores que confirmó dirección ──────────────────────────────────────

describe("valores iniciales acordados (D-7)", () => {
  it("CPI y SPI arrancan en 0,75 crítico y 0,90 advertencia", () => {
    expect(umbrales.cpiCritical).toBe(0.75);
    expect(umbrales.cpiWarning).toBe(0.9);
    expect(umbrales.spiCritical).toBe(0.75);
    expect(umbrales.spiWarning).toBe(0.9);
  });

  it("el presupuesto arranca en 90 % de aviso y 100 % de excedido", () => {
    expect(umbrales.budgetWarningPct).toBe(90);
    expect(umbrales.budgetCriticalPct).toBe(100);
  });

  it("son exactamente los cortes que tenía el backend antes de D-7", () => {
    // Si alguien cambia los defaults del código sin pasar por dirección, esto
    // falla: los valores iniciales son una decisión de negocio, no una opinión.
    expect(umbrales).toEqual({
      cpiWarning: 0.9,
      cpiCritical: 0.75,
      spiWarning: 0.9,
      spiCritical: 0.75,
      budgetWarningPct: 90,
      budgetCriticalPct: 100,
    });
  });
});

// ─── EL DEFECTO QUE SE CORRIGE ───────────────────────────────────────────────

describe("la celda y el semáforo ya no se contradicen (D-7)", () => {
  it("un CPI de 0,80 da el MISMO veredicto en la celda y en el semáforo", () => {
    const cpi = 0.8;

    // Lo que pinta la celda del Portafolio (el API lo calcula y lo envía).
    const nivelCelda = clasificarIndiceEvm(cpi, umbrales.cpiWarning, umbrales.cpiCritical);
    // Lo que decide el semáforo de esa misma fila.
    const semaforo = computeHealthStatus({ ...saludBase, cpi });

    expect(nivelCelda).toBe("warning");
    expect(semaforo).toBe("YELLOW");
    expect(semaforoEsperadoSegunCelda(nivelCelda)).toBe(semaforo);

    // ANTES: la celda usaba `< 0,85` y habría dicho "danger" (rojo) mientras el
    // semáforo decía YELLOW. Esta es la línea que reproduce el bug histórico.
    const celdaVieja = cpi < 0.85 ? "critical" : cpi < 1 ? "warning" : "ok";
    expect(celdaVieja).toBe("critical");
    expect(semaforoEsperadoSegunCelda(celdaVieja)).not.toBe(semaforo);
  });

  it("un CPI de 0,95 da el MISMO veredicto en la celda y en el semáforo", () => {
    const cpi = 0.95;
    const nivelCelda = clasificarIndiceEvm(cpi, umbrales.cpiWarning, umbrales.cpiCritical);

    expect(nivelCelda).toBe("ok");
    expect(computeHealthStatus({ ...saludBase, cpi })).toBe("GREEN");

    // ANTES la celda iba ámbar (< 1,00) con la fila en verde.
    expect(cpi < 1).toBe(true);
  });

  it("coinciden en TODO el rango, no solo en los dos casos del acta", () => {
    for (let cpi = 0.5; cpi <= 1.5; cpi = Number((cpi + 0.01).toFixed(2))) {
      const nivelCelda = clasificarIndiceEvm(cpi, umbrales.cpiWarning, umbrales.cpiCritical);
      const semaforo = computeHealthStatus({ ...saludBase, cpi });
      expect(semaforoEsperadoSegunCelda(nivelCelda), `CPI ${cpi}`).toBe(semaforo);
    }
  });

  it("lo mismo para el SPI", () => {
    for (let spi = 0.5; spi <= 1.5; spi = Number((spi + 0.01).toFixed(2))) {
      const nivelCelda = clasificarIndiceEvm(spi, umbrales.spiWarning, umbrales.spiCritical);
      const semaforo = computeHealthStatus({ ...saludBase, spi });
      expect(semaforoEsperadoSegunCelda(nivelCelda), `SPI ${spi}`).toBe(semaforo);
    }
  });
});

// ─── Bordes exactos ──────────────────────────────────────────────────────────

describe("clasificarIndiceEvm: bordes exactos", () => {
  const clasificar = (v: number | null) => clasificarIndiceEvm(v, 0.9, 0.75);

  it("el umbral pertenece a la banda buena", () => {
    expect(clasificar(0.75)).toBe("warning"); // 0,75 exacto NO es crítico
    expect(clasificar(0.7499)).toBe("critical");
    expect(clasificar(0.9)).toBe("ok"); // 0,90 exacto NO es advertencia
    expect(clasificar(0.8999)).toBe("warning");
  });

  it("un índice que no se puede calcular no inventa veredicto", () => {
    expect(clasificar(null)).toBe("no-medible");
    expect(clasificarIndiceEvm(undefined, 0.9, 0.75)).toBe("no-medible");
    expect(clasificarIndiceEvm(Number.NaN, 0.9, 0.75)).toBe("no-medible");
    // Y el semáforo no se pone en rojo por falta de datos.
    expect(computeHealthStatus({ ...saludBase, cpi: null, spi: null })).toBe("GREEN");
  });

  it("un índice por encima de 1 es saludable", () => {
    expect(clasificar(1)).toBe("ok");
    expect(clasificar(1.4)).toBe("ok");
  });
});

describe("clasificarUsoPresupuesto: bordes exactos", () => {
  const u = { budgetWarningPct: 90, budgetCriticalPct: 100 };

  it("alcanzar el aviso ya avisa; alcanzar el 100 % todavía no es excederlo", () => {
    expect(clasificarUsoPresupuesto(89.99, u)).toBe("ok");
    expect(clasificarUsoPresupuesto(90, u)).toBe("warning");
    expect(clasificarUsoPresupuesto(100, u)).toBe("warning");
    expect(clasificarUsoPresupuesto(100.01, u)).toBe("critical");
  });

  it("reproduce exactamente el `alertLevel` que había antes de D-7", () => {
    for (const pct of [0, 50, 89.99, 90, 95, 100, 100.01, 130]) {
      const antes = pct > 100 ? "exceeded" : pct >= 90 ? "warning" : "ok";
      const ahora = clasificarUsoPresupuesto(pct, u);
      const ahoraTraducido = ahora === "critical" ? "exceeded" : ahora;
      expect(ahoraTraducido, `pct ${pct}`).toBe(antes);
    }
  });
});

// ─── Cambiar la configuración cambia el veredicto ────────────────────────────

describe("mover un umbral mueve el veredicto", () => {
  it("con el criterio exigente que pedía la pantalla vieja, un CPI 0,80 es crítico", () => {
    const exigentes: UmbralesSalud = { ...umbrales, cpiCritical: 0.85, cpiWarning: 1 };

    expect(clasificarIndiceEvm(0.8, exigentes.cpiWarning, exigentes.cpiCritical)).toBe("critical");
    expect(computeHealthStatus({ ...saludBase, cpi: 0.8, thresholds: exigentes })).toBe("RED");

    // Y la celda y el semáforo siguen coincidiendo: la configuración los mueve
    // a los dos a la vez, que es justo lo que antes no pasaba.
    const nivel = clasificarIndiceEvm(0.8, exigentes.cpiWarning, exigentes.cpiCritical);
    expect(semaforoEsperadoSegunCelda(nivel)).toBe(
      computeHealthStatus({ ...saludBase, cpi: 0.8, thresholds: exigentes }),
    );
  });

  it("aflojar el umbral devuelve a verde un proyecto que estaba en ámbar", () => {
    expect(computeHealthStatus({ ...saludBase, cpi: 0.8 })).toBe("YELLOW");
    const flojos: UmbralesSalud = { ...umbrales, cpiWarning: 0.7, cpiCritical: 0.5 };
    expect(computeHealthStatus({ ...saludBase, cpi: 0.8, thresholds: flojos })).toBe("GREEN");
  });
});

// ─── Base sin sembrar ────────────────────────────────────────────────────────

describe("comportamiento sin configuración sembrada", () => {
  it("sin fila en la base se aplican los valores por defecto, no un cero ni un error", () => {
    expect(resolverUmbralesSalud(null)).toEqual(UMBRALES_SALUD_POR_DEFECTO);
    expect(resolverUmbralesSalud(undefined)).toEqual(UMBRALES_SALUD_POR_DEFECTO);
  });

  it("devuelve una copia: tocar el resultado no corrompe la constante", () => {
    const resuelto = resolverUmbralesSalud(null);
    resuelto.cpiCritical = 0.1;
    expect(UMBRALES_SALUD_POR_DEFECTO.cpiCritical).toBe(0.75);
  });

  it("un campo suelto corrupto cae a SU default y no arrastra a los demás", () => {
    const resuelto = resolverUmbralesSalud({
      cpiWarning: "0.95",
      cpiCritical: null,
      spiWarning: "0.80",
      spiCritical: "0.60",
      budgetWarningPct: "85",
      budgetCriticalPct: "110",
    });
    expect(resuelto.cpiCritical).toBe(0.75); // el nulo cayó a su default
    expect(resuelto.cpiWarning).toBe(0.95); // los demás conservan lo guardado
    expect(resuelto.spiWarning).toBe(0.8);
    expect(resuelto.budgetCriticalPct).toBe(110);
  });

  it("los Decimal de Prisma llegan como string y se convierten", () => {
    const resuelto = resolverUmbralesSalud({
      cpiWarning: "0.900",
      cpiCritical: "0.750",
      spiWarning: "0.900",
      spiCritical: "0.750",
      budgetWarningPct: "90.00",
      budgetCriticalPct: "100.00",
    });
    expect(resuelto).toEqual(UMBRALES_SALUD_POR_DEFECTO);
  });

  it("el ámbito de la única fila tiene nombre, no es una cadena suelta", () => {
    expect(AMBITO_GENERAL).toBe("GENERAL");
  });
});

// ─── Invariantes de una configuración incoherente ────────────────────────────

describe("una configuración incoherente colapsa la banda, no produce un imposible", () => {
  it("un crítico de CPI por encima de la advertencia sube la advertencia hasta él", () => {
    const r = resolverUmbralesSalud({
      cpiWarning: 0.8,
      cpiCritical: 0.95,
      spiWarning: 0.9,
      spiCritical: 0.75,
      budgetWarningPct: 90,
      budgetCriticalPct: 100,
    });
    expect(r.cpiCritical).toBe(0.95);
    expect(r.cpiWarning).toBe(0.95); // banda de aviso vacía, no invertida
    // Todo lo que baje de 0,95 es crítico; nada queda en "advertencia".
    expect(clasificarIndiceEvm(0.94, r.cpiWarning, r.cpiCritical)).toBe("critical");
    expect(clasificarIndiceEvm(0.95, r.cpiWarning, r.cpiCritical)).toBe("ok");
  });

  it("un aviso de presupuesto por encima del excedido se baja hasta él", () => {
    const r = resolverUmbralesSalud({
      cpiWarning: 0.9,
      cpiCritical: 0.75,
      spiWarning: 0.9,
      spiCritical: 0.75,
      budgetWarningPct: 120,
      budgetCriticalPct: 100,
    });
    expect(r.budgetCriticalPct).toBe(100);
    expect(r.budgetWarningPct).toBe(100);
  });
});

// ─── Convivencia del umbral general y el del proyecto ────────────────────────

describe("budgetAlertPct: lo del proyecto manda sobre lo general (D-7)", () => {
  it("si el proyecto define su umbral, se usa el suyo", () => {
    expect(resolveBudgetAlertPct(70, { budgetWarningPct: 85 })).toBe(70);
  });

  it("si el proyecto no define nada, hereda el general de la empresa", () => {
    expect(resolveBudgetAlertPct(null, { budgetWarningPct: 85 })).toBe(85);
    expect(resolveBudgetAlertPct(undefined, { budgetWarningPct: 85 })).toBe(85);
  });

  it("sin umbrales generales cae a la constante con nombre, no a un literal", () => {
    expect(resolveBudgetAlertPct(null)).toBe(DEFAULT_BUDGET_ALERT_PCT);
    expect(DEFAULT_BUDGET_ALERT_PCT).toBe(UMBRALES_SALUD_POR_DEFECTO.budgetWarningPct);
  });

  it("el cero del proyecto es un valor válido y NO cae al general", () => {
    expect(resolveBudgetAlertPct(0, { budgetWarningPct: 90 })).toBe(0);
  });
});

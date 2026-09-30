import { describe, expect, it } from "vitest";
import {
  type EjecucionRegistrada,
  type HistorialTrabajo,
  type TrabajoVigilado,
  evaluarFrescura,
  evaluarTrabajo,
} from "../job-freshness.js";

const HORA = 60 * 60 * 1000;
const AHORA = new Date("2026-09-29T12:00:00.000Z");

const VIGILADO: TrabajoVigilado = {
  nombre: "alert-engine",
  intervaloEsperadoMs: 1 * HORA,
  toleranciaMs: 3 * HORA,
};

/** Construye una ejecución terminada `horasAtras` antes de `AHORA`. */
function ejecucion(horasAtras: number, ok: boolean, error: string | null = null): EjecucionRegistrada {
  const startedAt = new Date(AHORA.getTime() - horasAtras * HORA);
  return {
    jobName: VIGILADO.nombre,
    origin: "http",
    startedAt,
    finishedAt: new Date(startedAt.getTime() + 1500),
    durationMs: 1500,
    ok,
    error,
  };
}

const SIN_HISTORIAL: HistorialTrabajo = { ultimoIntento: null, ultimoExito: null };

describe("evaluarTrabajo — los tres casos que hay que distinguir", () => {
  it("«nunca»: no hay ninguna ejecución registrada", () => {
    const resultado = evaluarTrabajo(VIGILADO, SIN_HISTORIAL, AHORA);

    expect(resultado.estado).toBe("nunca");
    expect(resultado.ultimoIntentoEn).toBeNull();
    expect(resultado.ultimoExitoEn).toBeNull();
    expect(resultado.antiguedadExitoSegundos).toBeNull();
    expect(resultado.ultimoError).toBeNull();
  });

  it("«fallido»: el último intento terminó con error, y el error se conserva", () => {
    const fallo = ejecucion(0.5, false, "ECONNREFUSED contra el proveedor");
    const resultado = evaluarTrabajo(
      VIGILADO,
      { ultimoIntento: fallo, ultimoExito: ejecucion(1.5, true) },
      AHORA,
    );

    expect(resultado.estado).toBe("fallido");
    expect(resultado.ultimoError).toBe("ECONNREFUSED contra el proveedor");
    // Aunque haya fallado, se sigue viendo cuándo fue la última vez que salió bien.
    expect(resultado.ultimoExitoEn).toBe(ejecucion(1.5, true).startedAt.toISOString());
  });

  it("«obsoleto»: corrió bien, pero hace más tiempo que la tolerancia", () => {
    const viejo = ejecucion(5, true);
    const resultado = evaluarTrabajo(
      VIGILADO,
      { ultimoIntento: viejo, ultimoExito: viejo },
      AHORA,
    );

    expect(resultado.estado).toBe("obsoleto");
    expect(resultado.antiguedadExitoSegundos).toBe(5 * 3600);
    expect(resultado.toleranciaSegundos).toBe(3 * 3600);
    expect(resultado.ultimoError).toBeNull();
  });

  it("«ok»: corrió bien y dentro del plazo", () => {
    const reciente = ejecucion(0.5, true);
    const resultado = evaluarTrabajo(
      VIGILADO,
      { ultimoIntento: reciente, ultimoExito: reciente },
      AHORA,
    );

    expect(resultado.estado).toBe("ok");
    expect(resultado.antiguedadExitoSegundos).toBe(1800);
    expect(resultado.ultimaDuracionMs).toBe(1500);
  });
});

describe("evaluarTrabajo — bordes de la tolerancia y precedencias", () => {
  it("justo en la tolerancia todavía es «ok»; un milisegundo después es «obsoleto»", () => {
    const enElBorde: EjecucionRegistrada = {
      ...ejecucion(0, true),
      startedAt: new Date(AHORA.getTime() - VIGILADO.toleranciaMs),
    };
    expect(
      evaluarTrabajo(VIGILADO, { ultimoIntento: enElBorde, ultimoExito: enElBorde }, AHORA).estado,
    ).toBe("ok");

    const pasado: EjecucionRegistrada = {
      ...enElBorde,
      startedAt: new Date(AHORA.getTime() - VIGILADO.toleranciaMs - 1),
    };
    expect(
      evaluarTrabajo(VIGILADO, { ultimoIntento: pasado, ultimoExito: pasado }, AHORA).estado,
    ).toBe("obsoleto");
  });

  it("«fallido» gana a «obsoleto» cuando se dan los dos a la vez", () => {
    const resultado = evaluarTrabajo(
      VIGILADO,
      { ultimoIntento: ejecucion(1, false, "boom"), ultimoExito: ejecucion(40, true) },
      AHORA,
    );

    expect(resultado.estado).toBe("fallido");
    expect(resultado.ultimoError).toBe("boom");
  });

  it("un trabajo que solo ha fallado y nunca tuvo éxito NO se reporta como «ok»", () => {
    const resultado = evaluarTrabajo(
      VIGILADO,
      { ultimoIntento: ejecucion(0.1, false, "boom"), ultimoExito: null },
      AHORA,
    );

    expect(resultado.estado).toBe("fallido");
    expect(resultado.ultimoExitoEn).toBeNull();
  });
});

describe("evaluarFrescura — agregado de todos los trabajos vigilados", () => {
  const catalogo: TrabajoVigilado[] = [
    VIGILADO,
    { nombre: "fx-sync", intervaloEsperadoMs: 24 * HORA, toleranciaMs: 72 * HORA },
  ];

  it("es «ok» solo cuando TODOS los trabajos están al día", () => {
    const reciente = ejecucion(0.2, true);
    const historiales = new Map<string, HistorialTrabajo>([
      ["alert-engine", { ultimoIntento: reciente, ultimoExito: reciente }],
      ["fx-sync", { ultimoIntento: reciente, ultimoExito: reciente }],
    ]);

    const resultado = evaluarFrescura(catalogo, historiales, AHORA);
    expect(resultado.estado).toBe("ok");
    expect(resultado.trabajos.map((t) => t.estado)).toEqual(["ok", "ok"]);
  });

  it("un trabajo esperado del que no hay NINGUNA fila sale como «nunca» y degrada el conjunto", () => {
    const reciente = ejecucion(0.2, true);
    const historiales = new Map<string, HistorialTrabajo>([
      ["alert-engine", { ultimoIntento: reciente, ultimoExito: reciente }],
    ]);

    const resultado = evaluarFrescura(catalogo, historiales, AHORA);
    expect(resultado.estado).toBe("degradado");
    expect(resultado.trabajos.find((t) => t.nombre === "fx-sync")?.estado).toBe("nunca");
  });

  it("ignora las ejecuciones de trabajos que ya no están en el catálogo", () => {
    const reciente = ejecucion(0.2, true);
    const historiales = new Map<string, HistorialTrabajo>([
      ["alert-engine", { ultimoIntento: reciente, ultimoExito: reciente }],
      ["fx-sync", { ultimoIntento: reciente, ultimoExito: reciente }],
      ["trabajo-retirado", { ultimoIntento: ejecucion(500, false, "x"), ultimoExito: null }],
    ]);

    const resultado = evaluarFrescura(catalogo, historiales, AHORA);
    expect(resultado.estado).toBe("ok");
    expect(resultado.trabajos).toHaveLength(2);
  });
});

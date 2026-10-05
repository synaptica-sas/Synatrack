import { describe, expect, it } from "vitest";
import {
  UMBRAL_ADVERTENCIA_POR_DEFECTO,
  UMBRAL_CRITICO_POR_DEFECTO,
  claseMargen,
  nivelMargen,
  presentacionMargen,
  textoCriteriosSalud,
} from "../utils/projectHealth";

/**
 * Dos umbrales de margen por proyecto (decisión de negocio D-2).
 *
 * El cliente NO calcula la salud —eso lo hace el servidor— pero sí pinta el
 * margen contra los umbrales que vienen en la respuesta, y esos cortes tienen
 * que ser exactamente los mismos que los del backend (`classifyMargin`).
 */
describe("nivelMargen con los umbrales por defecto (30 / 15)", () => {
  it("por debajo de 30 el proyecto queda en advertencia", () => {
    expect(nivelMargen(29.99, 30, 15)).toBe("warning");
    expect(nivelMargen(20, 30, 15)).toBe("warning");
  });

  it("por debajo de 15 el proyecto queda en crítico", () => {
    expect(nivelMargen(14.99, 30, 15)).toBe("critical");
    expect(nivelMargen(-10, 30, 15)).toBe("critical");
  });

  it("los bordes exactos pertenecen a la banda buena", () => {
    expect(nivelMargen(30, 30, 15)).toBe("ok");
    expect(nivelMargen(15, 30, 15)).toBe("warning");
  });

  it("un proyecto sin umbrales en la respuesta usa los valores por defecto", () => {
    expect(UMBRAL_ADVERTENCIA_POR_DEFECTO).toBe(30);
    expect(UMBRAL_CRITICO_POR_DEFECTO).toBe(15);
    expect(nivelMargen(25)).toBe("warning");
    expect(nivelMargen(10)).toBe("critical");
    expect(nivelMargen(31)).toBe("ok");
  });

  it("un margen no medible no inventa un veredicto", () => {
    expect(nivelMargen(null, 30, 15)).toBe("no-medible");
    expect(nivelMargen(undefined, 30, 15)).toBe("no-medible");
  });
});

describe("presentacionMargen: el color no es el único portador", () => {
  it("cada nivel trae su etiqueta en palabras, con el vocabulario acordado", () => {
    expect(presentacionMargen(50, 30, 15).etiqueta).toBe("Saludable");
    expect(presentacionMargen(20, 30, 15).etiqueta).toBe("Advertencia");
    expect(presentacionMargen(5, 30, 15).etiqueta).toBe("Crítico");
    expect(presentacionMargen(null, 30, 15).etiqueta).toBe("No medible");
  });

  it("el tono acompaña al nivel, no lo sustituye", () => {
    expect(presentacionMargen(50, 30, 15).tono).toBe("tone-success");
    expect(presentacionMargen(20, 30, 15).tono).toBe("tone-warning");
    expect(presentacionMargen(5, 30, 15).tono).toBe("tone-danger");
    expect(presentacionMargen(null, 30, 15).tono).toBe("tone-muted");
  });
});

describe("claseMargen", () => {
  it("distingue los tres estados contra los umbrales del proyecto", () => {
    // Con 60/45 propios, un 50 % que sería saludable con 30/15 es advertencia.
    expect(claseMargen(50, 30, 15)).toBe("tone-success");
    expect(claseMargen(50, 60, 45)).toBe("tone-warning");
    expect(claseMargen(44, 60, 45)).toBe("tone-danger");
  });
});

describe("textoCriteriosSalud", () => {
  it("enuncia los dos umbrales reales del proyecto", () => {
    const texto = textoCriteriosSalud(35, 20);
    expect(texto).toContain("advertencia: 35%");
    expect(texto).toContain("crítico: 20%");
  });

  it("dice explícitamente cuando el API no informó un umbral, en vez de suponerlo", () => {
    expect(textoCriteriosSalud(null, null)).toContain("no informado por el API");
  });
});

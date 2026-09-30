import { describe, it, expect } from "vitest";
import {
  formatearPar,
  formatearParesFaltantes,
  textoConversionIncompleta,
  tituloConversionIncompleta,
} from "../utils/conversionStatus";

describe("formatearPar", () => {
  it("traduce el par técnico a español", () => {
    expect(formatearPar("COP->USD")).toBe("de COP a USD");
  });

  it("tolera espacios alrededor de la flecha", () => {
    expect(formatearPar("COP -> USD")).toBe("de COP a USD");
  });

  it("deja tal cual un par con formato inesperado", () => {
    expect(formatearPar("COP")).toBe("COP");
    expect(formatearPar("A->B->C")).toBe("A->B->C");
    expect(formatearPar("->USD")).toBe("->USD");
  });
});

describe("formatearParesFaltantes", () => {
  it("devuelve cadena vacía sin pares", () => {
    expect(formatearParesFaltantes([])).toBe("");
    expect(formatearParesFaltantes(["", "  "])).toBe("");
  });

  it("un solo par no lleva conjunción", () => {
    expect(formatearParesFaltantes(["COP->USD"])).toBe("de COP a USD");
  });

  it("dos pares se unen con 'y'", () => {
    expect(formatearParesFaltantes(["COP->USD", "BRL->USD"])).toBe("de COP a USD y de BRL a USD");
  });

  it("tres pares usan coma y 'y' final", () => {
    expect(formatearParesFaltantes(["COP->USD", "BRL->USD", "CLP->USD"])).toBe(
      "de COP a USD, de BRL a USD y de CLP a USD",
    );
  });

  it("a partir de cinco resume el resto", () => {
    const pares = ["A->Z", "B->Z", "C->Z", "D->Z", "E->Z", "F->Z"];
    expect(formatearParesFaltantes(pares)).toBe("de A a Z, de B a Z, de C a Z, de D a Z y 2 pares más");
  });

  it("el resumen concuerda en singular", () => {
    const pares = ["A->Z", "B->Z", "C->Z", "D->Z", "E->Z"];
    expect(formatearParesFaltantes(pares)).toBe("de A a Z, de B a Z, de C a Z, de D a Z y 1 par más");
  });
});

describe("textos del aviso", () => {
  it("nombra los pares y la consecuencia", () => {
    const texto = textoConversionIncompleta(["COP->USD"]);
    expect(texto).toContain("de COP a USD");
    expect(texto).toContain("aproximados");
    // Nada de vocabulario de código en pantalla.
    expect(texto).not.toContain("->");
    expect(texto).not.toContain("missingPairs");
  });

  it("tiene una redacción válida aunque no lleguen los pares", () => {
    expect(textoConversionIncompleta([])).toContain("aproximados");
  });

  it("el título corto también nombra los pares", () => {
    expect(tituloConversionIncompleta(["BRL->USD"])).toContain("de BRL a USD");
    expect(tituloConversionIncompleta([])).toContain("aproximada");
  });
});

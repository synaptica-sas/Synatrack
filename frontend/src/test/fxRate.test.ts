import { describe, expect, it } from "vitest";
import { findFxRate, type FxRateSource } from "../utils/fxRate";

/**
 * `findFxRate` alimenta el conversor de divisas del cajón lateral. Es la misma
 * regla de triangulación que `backend/src/utils/currency.ts`, duplicada a
 * propósito (DEP-18); estas pruebas son las que la sostienen del lado del
 * frontend, donde antes no había ninguna.
 */
const tasas: FxRateSource[] = [
  { baseCode: "USD", quoteCode: "COP", rate: "4000" },
  { baseCode: "EUR", quoteCode: "USD", rate: "1.1" },
  { baseCode: "USD", quoteCode: "MXN", rate: "17" },
];

describe("findFxRate", () => {
  it("devuelve 1 cuando origen y destino son la misma moneda", () => {
    expect(findFxRate(tasas, "USD", "USD")).toBe(1);
    // Incluso sin ninguna tasa cargada.
    expect(findFxRate([], "CLP", "CLP")).toBe(1);
  });

  it("usa la tasa directa cuando existe el par tal cual", () => {
    expect(findFxRate(tasas, "USD", "COP")).toBe(4000);
  });

  it("usa la tasa inversa cuando solo existe el par contrario", () => {
    expect(findFxRate(tasas, "COP", "USD")).toBeCloseTo(1 / 4000, 12);
  });

  it("acepta la tasa como número además de como cadena", () => {
    expect(findFxRate([{ baseCode: "USD", quoteCode: "PEN", rate: 3.75 }], "USD", "PEN")).toBe(3.75);
  });

  it("triangula vía una moneda pivote: EUR→COP pasando por USD", () => {
    // 1 EUR = 1,1 USD y 1 USD = 4000 COP -> 1 EUR = 4400 COP
    expect(findFxRate(tasas, "EUR", "COP")).toBeCloseTo(4400, 9);
  });

  it("triangula usando el pivote invertido: MXN→COP con USD como puente", () => {
    // Rama del pivote invertido: se llega a COP dividiendo por la tasa COP->USD,
    // porque no existe ninguna tasa con COP como destino.
    const conMxnBase: FxRateSource[] = [
      { baseCode: "MXN", quoteCode: "USD", rate: "0.0588" },
      { baseCode: "COP", quoteCode: "USD", rate: "0.00025" },
    ];
    // 1 MXN = 0,0588 USD y 1 COP = 0,00025 USD -> 1 MXN = 235,2 COP
    expect(findFxRate(conMxnBase, "MXN", "COP")).toBeCloseTo(0.0588 / 0.00025, 6);
  });

  /**
   * LIMITACIÓN CONOCIDA, distinta del backend: la triangulación solo arranca
   * desde monedas que aparecen como `baseCode` en alguna tasa. Si la moneda de
   * origen solo existe como `quoteCode`, devuelve null aunque haya un camino.
   * `backend/src/utils/currency.ts` sí lo resuelve, porque construye un mapa
   * bidireccional antes de buscar el pivote. Se documenta tal cual porque este
   * cambio solo extrae la función; corregirlo es otro trabajo.
   */
  it("no triangula cuando la moneda de origen solo aparece como destino (diverge del backend)", () => {
    // Existen USD->COP y USD->MXN, así que COP->MXN es calculable vía USD,
    // pero esta implementación no lo encuentra.
    expect(findFxRate(tasas, "COP", "MXN")).toBeNull();
  });

  it("devuelve null cuando no hay ninguna ruta entre las dos monedas", () => {
    expect(findFxRate(tasas, "CLP", "COP")).toBeNull();
    expect(findFxRate([], "USD", "COP")).toBeNull();
  });

  it("la triangulación coincide con la tasa esperada en ambos sentidos cuando ambas son calculables", () => {
    const ambosSentidos: FxRateSource[] = [
      { baseCode: "EUR", quoteCode: "USD", rate: "1.1" },
      { baseCode: "USD", quoteCode: "COP", rate: "4000" },
      { baseCode: "COP", quoteCode: "USD", rate: String(1 / 4000) },
    ];
    const ida = findFxRate(ambosSentidos, "EUR", "COP");
    const vuelta = findFxRate(ambosSentidos, "COP", "EUR");
    expect(ida).toBeCloseTo(4400, 9);
    expect(vuelta).not.toBeNull();
    expect(ida! * vuelta!).toBeCloseTo(1, 9);
  });
});

import { describe, expect, it } from "vitest";
import {
  buildRateBook,
  conversionStatus,
  convertAmountDatedDetailed,
  convertAmountFallbackOnDate,
  convertAmountOnDate,
  createConversionLedger,
  rateMapForDate,
  recordDatedQuality,
  type FxHistoryRecord,
} from "../currency.js";
import { computeProjectFinancials } from "../financial.js";
import { UMBRALES_SALUD_POR_DEFECTO } from "../healthThresholds.js";

/**
 * R-008 / R-012 / R-026 / R-033 / R-034 — la conversión se hace con la tasa de
 * la fecha del movimiento, no con la de hoy.
 *
 * El escenario es siempre el mismo y está elegido para que los números canten:
 * el peso se devalúa de 4.000 a 5.000 por dólar a lo largo del año, así que el
 * MISMO importe en pesos vale distinto según cuándo ocurrió.
 */
const HISTORIA: FxHistoryRecord[] = [
  { baseCode: "USD", quoteCode: "COP", rate: 4000, effectiveDate: new Date("2026-01-01T00:00:00Z") },
  { baseCode: "USD", quoteCode: "COP", rate: 4500, effectiveDate: new Date("2026-06-01T00:00:00Z") },
  { baseCode: "USD", quoteCode: "COP", rate: 5000, effectiveDate: new Date("2026-10-01T00:00:00Z") },
];

/** La tasa "de hoy" que vive en FxConfig y que antes se usaba para TODO. */
const ACTUAL = [{ baseCode: "USD", quoteCode: "COP", rate: 5000 }];

const MARZO = new Date("2026-03-15T00:00:00Z");
const JULIO = new Date("2026-07-15T00:00:00Z");
const HOY = new Date("2026-10-05T00:00:00Z");

describe("rateMapForDate — la tasa vigente en una fecha", () => {
  const libro = buildRateBook(ACTUAL, HISTORIA);

  it("toma el tramo vigente en esa fecha, no el último", () => {
    expect(rateMapForDate(libro, MARZO).rates.get("USD->COP")).toBe(4000);
    expect(rateMapForDate(libro, JULIO).rates.get("USD->COP")).toBe(4500);
    expect(rateMapForDate(libro, HOY).rates.get("USD->COP")).toBe(5000);
  });

  it("el día exacto de entrada en vigor ya usa la tasa nueva", () => {
    expect(rateMapForDate(libro, new Date("2026-06-01T00:00:00Z")).rates.get("USD->COP")).toBe(4500);
    expect(rateMapForDate(libro, new Date("2026-05-31T23:59:59Z")).rates.get("USD->COP")).toBe(4000);
  });

  it("también resuelve el par inverso", () => {
    expect(rateMapForDate(libro, MARZO).rates.get("COP->USD")).toBeCloseTo(1 / 4000, 12);
  });

  it("marca como fechadas las tasas que salieron del histórico", () => {
    const resuelto = rateMapForDate(libro, MARZO);
    expect(resuelto.dated.has("USD->COP")).toBe(true);
    expect(resuelto.dated.has("COP->USD")).toBe(true);
  });

  it("memoiza por día UTC: dos horas del mismo día devuelven el MISMO objeto", () => {
    const a = rateMapForDate(libro, new Date("2026-03-15T01:00:00Z"));
    const b = rateMapForDate(libro, new Date("2026-03-15T23:00:00Z"));
    expect(a).toBe(b);
  });
});

describe("convertAmountFallbackOnDate — un gasto se valora a su fecha", () => {
  const libro = buildRateBook(ACTUAL, HISTORIA);

  it("un gasto de marzo usa la tasa de marzo, NO la de hoy", () => {
    // 4.000.000 COP en marzo (4.000/USD) = 1.000 USD.
    // Con la tasa de hoy (5.000/USD) saldrían 800 USD: ese era el bug.
    expect(convertAmountFallbackOnDate(4_000_000, "COP", "USD", MARZO, libro)).toBeCloseTo(1_000, 9);
    expect(convertAmountFallbackOnDate(4_000_000, "COP", "USD", HOY, libro)).toBeCloseTo(800, 9);
  });

  it("una fecha sin tramo propio cae en el tramo anterior más reciente", () => {
    // Julio no tiene fila; el tramo vigente es el de junio (4.500).
    expect(convertAmountFallbackOnDate(4_500_000, "COP", "USD", JULIO, libro)).toBeCloseTo(1_000, 9);
  });

  it("no ensucia el libro cuando la tasa sale del histórico", () => {
    const ledger = createConversionLedger();
    convertAmountFallbackOnDate(4_000_000, "COP", "USD", MARZO, libro, ledger);
    expect(conversionStatus(ledger)).toEqual({
      incomplete: false,
      missingPairs: [],
      approximateDates: false,
      undatedPairs: [],
    });
  });

  it("sin NINGUNA tasa histórica anterior cae a la actual Y LO ANOTA", () => {
    // Fecha anterior a la primera fila del histórico: no hay nada <= 2025-12-01.
    const ledger = createConversionLedger();
    const antes = new Date("2025-12-01T00:00:00Z");
    const resultado = convertAmountFallbackOnDate(5_000_000, "COP", "USD", antes, libro, ledger);

    // Convierte con la tasa actual (5.000): el importe es utilizable...
    expect(resultado).toBeCloseTo(1_000, 9);
    // ...pero queda constancia de que se valoró con la tasa de hoy.
    expect(conversionStatus(ledger)).toEqual({
      incomplete: false,
      missingPairs: [],
      approximateDates: true,
      undatedPairs: ["COP->USD"],
    });
  });

  it("sin histórico NI tasa actual devuelve el monto crudo y lo anota como faltante", () => {
    const ledger = createConversionLedger();
    expect(convertAmountFallbackOnDate(500, "JPY", "BRL", MARZO, libro, ledger)).toBe(500);
    expect(conversionStatus(ledger)).toEqual({
      incomplete: true,
      missingPairs: ["JPY->BRL"],
      approximateDates: false,
      undatedPairs: [],
    });
  });

  it("un libro sin histórico se comporta como el mapa de siempre, pero avisando", () => {
    const sinHistoria = buildRateBook(ACTUAL, []);
    const ledger = createConversionLedger();
    expect(convertAmountFallbackOnDate(5_000_000, "COP", "USD", MARZO, sinHistoria, ledger)).toBeCloseTo(1_000, 9);
    expect(conversionStatus(ledger).approximateDates).toBe(true);
  });

  it("misma moneda no convierte ni anota nada", () => {
    const ledger = createConversionLedger();
    const vieja = new Date("2020-01-01T00:00:00Z");
    expect(convertAmountFallbackOnDate(123, "USD", "USD", vieja, libro, ledger)).toBe(123);
    expect(conversionStatus(ledger).approximateDates).toBe(false);
  });

  it("un importe 0 no marca el total (misma regla que DEP-32)", () => {
    const ledger = createConversionLedger();
    convertAmountFallbackOnDate(0, "COP", "USD", new Date("2025-01-01T00:00:00Z"), libro, ledger);
    expect(conversionStatus(ledger).approximateDates).toBe(false);
  });

  it("convertAmountOnDate devuelve null cuando no hay camino", () => {
    expect(convertAmountOnDate(10, "JPY", "BRL", MARZO, libro)).toBeNull();
    expect(convertAmountOnDate(4_000_000, "COP", "USD", MARZO, libro)).toBeCloseTo(1_000, 9);
  });
});

describe("computeProjectFinancials — cada movimiento con la tasa de SU fecha", () => {
  const libro = buildRateBook(ACTUAL, HISTORIA);

  const base = {
    budget: 400_000_000,
    budgetCurrency: "COP",
    sellPrice: null,
    sellCurrency: "COP",
    marginWarningPct: null,
    marginCriticalPct: null,
    budgetAlertPct: null,
    healthThresholds: UMBRALES_SALUD_POR_DEFECTO,
    revenueEntries: [],
    approvedTimeEntries: [],
    expenses: [],
    forecasts: [],
    rateBook: libro,
    // Proyecto contratado en enero: su presupuesto se congela a 4.000/USD.
    valuationDate: new Date("2026-01-10T00:00:00Z"),
    baseCurrency: "USD",
  };

  it("el presupuesto se fija a la fecha de contratación (R-033), no a la de hoy", () => {
    // 400.000.000 COP a 4.000 = 100.000 USD. Con la tasa de hoy (5.000) serían
    // 80.000 USD: el presupuesto del contrato habría "encogido" 20.000 USD sin
    // que nadie tocara nada.
    expect(computeProjectFinancials(base).budget).toBeCloseTo(100_000, 6);
  });

  it("un total con gastos de fechas distintas usa la tasa de CADA uno", () => {
    const f = computeProjectFinancials({
      ...base,
      expenses: [
        { amount: 4_000_000, currency: "COP", entryDate: MARZO }, // /4000 = 1.000 USD
        { amount: 4_500_000, currency: "COP", entryDate: JULIO }, // /4500 = 1.000 USD
        { amount: 5_000_000, currency: "COP", entryDate: HOY },   // /5000 = 1.000 USD
      ],
    });
    // Tres importes distintos en pesos que valen lo mismo en dólares: 3.000.
    expect(f.expensesActual).toBeCloseTo(3_000, 6);
    // Con la tasa única de hoy habrían salido 800 + 900 + 1.000 = 2.700.
    expect(f.expensesActual).not.toBeCloseTo(2_700, 6);
    expect(f.conversion.approximateDates).toBe(false);
  });

  it("los ingresos se valoran a su fecha de reconocimiento (R-034)", () => {
    const f = computeProjectFinancials({
      ...base,
      revenueEntries: [
        { amount: 40_000_000, currency: "COP", entryDate: MARZO }, // 10.000 USD
        { amount: 45_000_000, currency: "COP", entryDate: JULIO }, // 10.000 USD
      ],
    });
    expect(f.revenueRecognized).toBeCloseTo(20_000, 6);
  });

  it("el costo de las horas usa la tasa del día trabajado", () => {
    const f = computeProjectFinancials({
      ...base,
      approvedTimeEntries: [
        // 10 h x 400.000 COP/h = 4.000.000 COP en marzo -> 1.000 USD
        { consultantId: "c1", hours: 10, workDate: MARZO, hourlyRate: 400_000, rateCurrency: "COP" },
        // 10 h x 400.000 COP/h = 4.000.000 COP hoy      ->   800 USD
        { consultantId: "c1", hours: 10, workDate: HOY, hourlyRate: 400_000, rateCurrency: "COP" },
      ],
    });
    expect(f.laborCostActual).toBeCloseTo(1_800, 6);
  });

  it("un gasto anterior al histórico marca el total como aproximado por fecha", () => {
    const f = computeProjectFinancials({
      ...base,
      expenses: [{ amount: 5_000_000, currency: "COP", entryDate: new Date("2025-11-01T00:00:00Z") }],
    });
    expect(f.expensesActual).toBeCloseTo(1_000, 6);
    expect(f.conversion.incomplete).toBe(false);
    expect(f.conversion.approximateDates).toBe(true);
    expect(f.conversion.undatedPairs).toEqual(["COP->USD"]);
  });

  it("un proyecto sin movimientos en moneda extranjera no marca nada", () => {
    const f = computeProjectFinancials({
      ...base,
      budget: 100_000,
      budgetCurrency: "USD",
      expenses: [{ amount: 500, currency: "USD", entryDate: HOY }],
    });
    expect(f.conversion.approximateDates).toBe(false);
    expect(f.conversion.incomplete).toBe(false);
  });
});

/**
 * R-026 — la conversión POR GASTO que consume la pantalla de Gastos.
 *
 * `convertAmountDatedDetailed` es ahora la única implementación de la aritmética
 * fechada (`convertAmountFallbackOnDate` delega en ella). Estas pruebas fijan
 * dos cosas: que clasifica bien de dónde salió la tasa, y que el total que se
 * obtiene sumando importe a importe es EXACTAMENTE el mismo que el que calcula
 * el backend para el Tablero. Si dejaran de coincidir, volveríamos al problema
 * que R-026 vino a cerrar: dos pantallas con números distintos del mismo dato.
 */
describe("convertAmountDatedDetailed — conversión por gasto (R-026)", () => {
  const libro = buildRateBook(ACTUAL, HISTORIA);

  it("usa la tasa de la fecha del gasto y la marca como fechada", () => {
    // 4.500.000 COP en marzo, cuando el dólar estaba a 4.000 → 1.125 USD.
    const marzo = convertAmountDatedDetailed(4_500_000, "COP", "USD", MARZO, libro);
    expect(marzo.amount).toBeCloseTo(1125, 6);
    expect(marzo.quality).toBe("dated");

    // El MISMO importe en julio, con el dólar a 4.500 → 1.000 USD.
    const julio = convertAmountDatedDetailed(4_500_000, "COP", "USD", JULIO, libro);
    expect(julio.amount).toBeCloseTo(1000, 6);
    expect(julio.quality).toBe("dated");

    // Y con la tasa de HOY (lo que hacía el cliente) habrían sido 900 USD: ni
    // uno ni otro. Esa es exactamente la diferencia que producía el desajuste.
    expect(4_500_000 / 5000).toBe(900);
  });

  it("marca `undated` cuando el gasto es anterior a todo el histórico", () => {
    const antiguo = convertAmountDatedDetailed(
      4_500_000, "COP", "USD", new Date("2025-03-15T00:00:00Z"), libro,
    );
    // Se convierte con la tasa de hoy (5.000), que es el único respaldo.
    expect(antiguo.amount).toBeCloseTo(900, 6);
    expect(antiguo.quality).toBe("undated");
  });

  it("marca `missing` y NO convierte cuando no hay tasa por ningún camino", () => {
    const sinTasa = convertAmountDatedDetailed(1234, "JPY", "USD", MARZO, libro);
    expect(sinTasa.amount).toBe(1234);
    expect(sinTasa.quality).toBe("missing");
  });

  it("la misma moneda no se toca y cuenta como fechada", () => {
    const igual = convertAmountDatedDetailed(999, "USD", "USD", MARZO, libro);
    expect(igual).toEqual({ amount: 999, quality: "dated" });
  });

  it("da el MISMO número, bit a bit, que convertAmountFallbackOnDate", () => {
    const casos: Array<[number, string, Date]> = [
      [4_500_000, "COP", MARZO],
      [4_500_000, "COP", JULIO],
      [800_000, "COP", new Date("2025-01-01T00:00:00Z")],
      [1234, "JPY", MARZO],
      [0, "COP", MARZO],
    ];
    for (const [monto, moneda, fecha] of casos) {
      expect(convertAmountDatedDetailed(monto, moneda, "USD", fecha, libro).amount).toBe(
        convertAmountFallbackOnDate(monto, moneda, "USD", fecha, libro),
      );
    }
  });

  it("el total sumado gasto a gasto coincide con el total del Tablero", () => {
    // Los mismos gastos que vería la pantalla, en fechas con tasas distintas.
    const gastos = [
      { amount: 4_650_000, currency: "COP", entryDate: MARZO },
      { amount: 3_600_000, currency: "COP", entryDate: JULIO },
      { amount: 1_500_000, currency: "COP", entryDate: HOY },
    ];

    // Lo que hace la pantalla de Gastos: suma los importes ya convertidos.
    const totalGastos = gastos.reduce(
      (s, g) => s + convertAmountDatedDetailed(g.amount, g.currency, "USD", g.entryDate, libro).amount,
      0,
    );

    // Lo que hace el backend para el Tablero (utils/financial.ts).
    const totalTablero = gastos.reduce(
      (s, g) => s + convertAmountFallbackOnDate(g.amount, g.currency, "USD", g.entryDate, libro),
      0,
    );

    expect(totalGastos).toBe(totalTablero);
    // Y no es el número que daba la conversión a la tasa de hoy.
    const totalTasaDeHoy = gastos.reduce((s, g) => s + g.amount / 5000, 0);
    expect(totalGastos).not.toBe(totalTasaDeHoy);
    expect(totalGastos).toBeCloseTo(1162.5 + 800 + 300, 6);
  });

  it("el libro de faltantes recoge las dos calidades por separado", () => {
    const ledger = createConversionLedger();
    const casos: Array<[number, string, Date]> = [
      [4_650_000, "COP", MARZO],                            // dated   → no anota
      [800_000, "COP", new Date("2025-01-01T00:00:00Z")],    // undated → anota
      [1234, "JPY", MARZO],                                  // missing → anota
    ];
    for (const [monto, moneda, fecha] of casos) {
      const { quality } = convertAmountDatedDetailed(monto, moneda, "USD", fecha, libro);
      recordDatedQuality(ledger, quality, moneda, "USD");
    }
    expect(conversionStatus(ledger)).toEqual({
      incomplete: true,
      missingPairs: ["JPY->USD"],
      approximateDates: true,
      undatedPairs: ["COP->USD"],
    });
  });
});

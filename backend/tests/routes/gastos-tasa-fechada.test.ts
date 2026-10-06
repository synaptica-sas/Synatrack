import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { prisma } from "../../src/infra/prisma.js";

/**
 * R-026 — la pantalla de Gastos valora cada gasto con la tasa de SU fecha, y el
 * total que muestra es el mismo que el del Tablero.
 *
 * Antes de R-026 `GET /api/expenses` devolvía solo el importe original y el
 * cliente lo convertía con `convertToBase`, que usa las tasas de HOY. El
 * Tablero, en cambio, ya valoraba cada movimiento a la tasa de su fecha
 * (R-008/R-012). Resultado: los mismos gastos sumaban distinto en dos pantallas
 * del mismo producto. Esta prueba fija la igualdad, que es el criterio real de
 * que el problema está cerrado.
 *
 * Se usa `XTS` —el código ISO 4217 reservado para pruebas— y `XXX` —el reservado
 * para "sin moneda"— para no tocar el histórico real de COP/USD de la base.
 */

const RUN = `gfx-${Date.now()}`;
const EMAIL = `${RUN}@test.local`;
const como = (roles: string) => ({ "x-dev-email": EMAIL, "x-dev-roles": roles });

/** El dólar vale 100 XTS en enero y 200 XTS en julio: el mismo importe en XTS
 *  vale la MITAD en julio. Números redondos para que el fallo cante. */
const TASA_ENERO = 100;
const TASA_JULIO = 200;

const GASTO_ENERO = 50_000; // XTS → 500 USD a la tasa de enero
const GASTO_JULIO = 50_000; // XTS → 250 USD a la tasa de julio
const GASTO_SIN_TASA = 777; // XXX → sin tasa por ningún camino

let app: FastifyInstance;
let projectId: string;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();

  const project = await prisma.project.create({
    data: {
      name: `${RUN} Proyecto`,
      company: "Test",
      country: "Colombia",
      currency: "USD",
      budget: 1_000_000,
      startDate: new Date("2026-01-01T00:00:00Z"),
      endDate: new Date("2026-12-31T00:00:00Z"),
    },
  });
  projectId = project.id;

  await prisma.fxRateHistory.createMany({
    data: [
      { baseCode: "USD", quoteCode: "XTS", rate: TASA_ENERO, effectiveDate: new Date("2026-01-01T00:00:00Z") },
      { baseCode: "USD", quoteCode: "XTS", rate: TASA_JULIO, effectiveDate: new Date("2026-07-01T00:00:00Z") },
    ],
  });

  await prisma.financialEntry.createMany({
    data: [
      { projectId, type: "EXPENSE", category: "Viajes", amount: GASTO_ENERO, currency: "XTS", entryDate: new Date("2026-03-15T00:00:00Z") },
      { projectId, type: "EXPENSE", category: "Viajes", amount: GASTO_JULIO, currency: "XTS", entryDate: new Date("2026-08-15T00:00:00Z") },
      { projectId, type: "EXPENSE", category: "Otros", amount: GASTO_SIN_TASA, currency: "XXX", entryDate: new Date("2026-08-20T00:00:00Z") },
    ],
  });
});

afterAll(async () => {
  await prisma.financialEntry.deleteMany({ where: { projectId } });
  await prisma.project.deleteMany({ where: { id: projectId } });
  await prisma.fxRateHistory.deleteMany({ where: { quoteCode: "XTS" } });
  await app.close();
});

/** Los gastos del proyecto de esta prueba, convertidos a `base`. */
async function listarGastos(base: string) {
  const res = await app.inject({
    method: "GET",
    url: `/api/expenses?base=${base}`,
    headers: como("ADMIN"),
  });
  expect(res.statusCode).toBe(200);
  const body = res.json() as {
    data: Array<{
      projectId: string;
      currency: string;
      amount: string;
      baseAmount: number;
      baseCurrency: string;
      conversionQuality: "dated" | "undated" | "missing";
      expenseDate: string;
    }>;
    conversion: { incomplete: boolean; missingPairs: string[]; approximateDates: boolean; undatedPairs: string[] };
    baseCurrency: string;
  };
  return { ...body, mios: body.data.filter((e) => e.projectId === projectId) };
}

describe("GET /api/expenses — conversión a la tasa de la fecha del gasto (R-026)", () => {
  it("convierte cada gasto con la tasa vigente en su fecha, no con la de hoy", async () => {
    const { mios, baseCurrency } = await listarGastos("USD");
    expect(baseCurrency).toBe("USD");

    const enMarzo = mios.find((e) => e.expenseDate.startsWith("2026-03-15"))!;
    const enAgosto = mios.find((e) => e.expenseDate.startsWith("2026-08-15"))!;

    // Mismo importe en XTS, fechas distintas → importes base distintos.
    expect(Number(enMarzo.amount)).toBe(Number(enAgosto.amount));
    expect(enMarzo.baseAmount).toBeCloseTo(GASTO_ENERO / TASA_ENERO, 6); // 500
    expect(enAgosto.baseAmount).toBeCloseTo(GASTO_JULIO / TASA_JULIO, 6); // 250
    expect(enMarzo.conversionQuality).toBe("dated");
    expect(enAgosto.conversionQuality).toBe("dated");

    // Lo que daba la conversión en el cliente (tasa de hoy = la última, 200)
    // para el gasto de marzo era 250: la mitad de lo que vale de verdad.
    expect(enMarzo.baseAmount).not.toBeCloseTo(GASTO_ENERO / TASA_JULIO, 6);
  });

  it("marca y publica el gasto cuyo par no tiene tasa", async () => {
    const { mios, conversion } = await listarGastos("USD");

    const sinTasa = mios.find((e) => e.currency === "XXX")!;
    expect(sinTasa.conversionQuality).toBe("missing");
    // No se convierte: el importe sale tal cual, igual que en el resto del backend.
    expect(sinTasa.baseAmount).toBe(GASTO_SIN_TASA);

    expect(conversion.incomplete).toBe(true);
    expect(conversion.missingPairs).toContain("XXX->USD");
  });

  it("el total de Gastos es EXACTAMENTE el que calcula el Tablero", async () => {
    const { mios } = await listarGastos("USD");
    const totalGastos = mios.reduce((s, e) => s + e.baseAmount, 0);

    const res = await app.inject({
      method: "GET",
      url: `/api/stats/overview?projectId=${projectId}&baseCurrency=USD&from=2026-01-01&to=2026-12-31`,
      headers: como("ADMIN"),
    });
    expect(res.statusCode).toBe(200);
    const totalTablero = (res.json() as { data: { totals: { expensesActual?: number } } }).data.totals
      .expensesActual;

    expect(totalTablero).toBeDefined();
    // El criterio de éxito de R-026: el MISMO número, no "parecido".
    expect(totalGastos).toBeCloseTo(totalTablero!, 6);
    // Y es el valor fechado (500 + 250 + 777 sin convertir), no el de hoy.
    expect(totalGastos).toBeCloseTo(500 + 250 + GASTO_SIN_TASA, 6);
  });

  it("respeta la moneda base pedida", async () => {
    const { mios, baseCurrency } = await listarGastos("XTS");
    expect(baseCurrency).toBe("XTS");
    const enMarzo = mios.find((e) => e.expenseDate.startsWith("2026-03-15"))!;
    // Ya está en XTS: no se toca.
    expect(enMarzo.baseAmount).toBe(GASTO_ENERO);
    expect(enMarzo.conversionQuality).toBe("dated");
  });

  it("rechaza una moneda base que no es un código ISO de 3 letras", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/expenses?base=DOLARES",
      headers: como("ADMIN"),
    });
    expect(res.statusCode).toBe(400);
  });
});

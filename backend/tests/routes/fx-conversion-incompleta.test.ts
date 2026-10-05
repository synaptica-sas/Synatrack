import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/infra/prisma.js";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";
import { crearEscenarioBasico, limpiarEscenario, type EscenarioBasico } from "../helpers/datos.js";

/**
 * DEP-32: una conversión incompleta deja de ser indistinguible de un total
 * correcto.
 *
 * `convertAmountFallback` devuelve el importe SIN convertir cuando no hay tasa
 * para el par, así que un gasto en otra moneda se sumaba al total en la moneda
 * base como si ya estuviera convertido, y la respuesta no traía ninguna marca.
 *
 * La moneda `XTS` es el código ISO 4217 reservado para pruebas: nunca va a
 * existir una fila `FxConfig` para ella, así que sirve de par garantizadamente
 * sin tasa sin depender del contenido real de la tabla.
 */
describe("DEP-32: las respuestas avisan cuando la conversión quedó incompleta", () => {
  let app: FastifyInstance;
  let escenario: EscenarioBasico;
  const snapshotIds: string[] = [];

  beforeAll(async () => {
    app = await crearAppDePrueba();
    escenario = await crearEscenarioBasico("dep32-fx");
  });

  afterAll(async () => {
    await prisma.monthlySnapshot.deleteMany({ where: { id: { in: snapshotIds } } });
    await prisma.financialEntry.deleteMany({ where: { projectId: escenario.projectId } });
    await limpiarEscenario(escenario);
    await app.close();
  });

  async function crearGasto(amount: number, currency: string) {
    return prisma.financialEntry.create({
      data: {
        projectId: escenario.projectId,
        type: "EXPENSE",
        entryDate: new Date(Date.UTC(2026, 4, 15)),
        amount,
        currency,
        description: "Gasto de prueba DEP-32",
      },
    });
  }

  it("el detalle del proyecto no marca nada cuando todo es convertible", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${escenario.projectId}/detail`,
      headers: comoRol(AppRole.ADMIN),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.conversion).toEqual({
      incomplete: false,
      missingPairs: [],
      // R-008/R-012: el proyecto de esta prueba es íntegramente en la moneda
      // base, así que no hay ninguna conversión que fechar.
      approximateDates: false,
      undatedPairs: [],
    });
  });

  it("el detalle del proyecto marca `conversion.incomplete` si falta una tasa", async () => {
    const gasto = await crearGasto(5_000, "XTS");

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${escenario.projectId}/detail`,
      headers: comoRol(AppRole.ADMIN),
    });

    expect(res.statusCode).toBe(200);
    const { conversion } = res.json().data;
    expect(conversion.incomplete).toBe(true);
    expect(conversion.missingPairs).toContain("XTS->USD");

    await prisma.financialEntry.delete({ where: { id: gasto.id } });
  });

  it("el cierre mensual se niega con 422 en vez de congelar un total aproximado", async () => {
    const gasto = await crearGasto(5_000, "XTS");

    const res = await app.inject({
      method: "POST",
      url: "/api/snapshots/close",
      headers: comoRol(AppRole.ADMIN),
      payload: { projectId: escenario.projectId, year: 2026, month: 5, baseCurrency: "USD" },
    });

    expect(res.statusCode).toBe(422);
    const cuerpo = res.json();
    expect(cuerpo.conversion.incomplete).toBe(true);
    expect(cuerpo.conversion.missingPairs).toContain("XTS->USD");
    expect(cuerpo.message).toContain("XTS->USD");

    // Lo importante: NO quedó ninguna fila con el total mal convertido.
    const congelado = await prisma.monthlySnapshot.findUnique({
      where: { projectId_year_month: { projectId: escenario.projectId, year: 2026, month: 5 } },
    });
    expect(congelado).toBeNull();

    await prisma.financialEntry.delete({ where: { id: gasto.id } });
  });

  it("sin la moneda problemática el mismo cierre se completa con normalidad", async () => {
    const gasto = await crearGasto(1_000, "USD");

    const res = await app.inject({
      method: "POST",
      url: "/api/snapshots/close",
      headers: comoRol(AppRole.ADMIN),
      payload: { projectId: escenario.projectId, year: 2026, month: 5, baseCurrency: "USD" },
    });

    expect(res.statusCode).toBe(201);
    const snapshot = res.json().data;
    snapshotIds.push(snapshot.id);
    expect(Number(snapshot.expensesActual)).toBe(1_000);

    await prisma.monthlySnapshot.delete({ where: { id: snapshot.id } });
    await prisma.financialEntry.delete({ where: { id: gasto.id } });
  });
});

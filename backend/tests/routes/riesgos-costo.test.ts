import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/infra/prisma.js";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";

/**
 * R-009: costo estimado de un riesgo, que afecta el costo PROYECTADO del
 * presupuesto (no el real: todavía no se ha incurrido). Mismo patrón que
 * `sellPrice`/`sellCurrency` en Proyectos: monto opcional, moneda siempre con
 * un valor por defecto.
 */
describe("Costo estimado de un riesgo (R-009)", () => {
  let app: FastifyInstance;
  let projectId: string;
  const riesgosCreados: string[] = [];

  beforeAll(async () => {
    app = await crearAppDePrueba();
    const proyecto = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: comoRol(AppRole.ADMIN),
      payload: {
        name: `Proyecto Riesgo Costo ${Date.now()}`,
        company: "Synaptica",
        country: "Colombia",
        currency: "USD",
        budget: 100000,
        startDate: "2026-01-01",
        endDate: "2026-12-31",
      },
    });
    projectId = proyecto.json().data.id as string;
  });

  afterAll(async () => {
    await prisma.risk.deleteMany({ where: { id: { in: riesgosCreados } } });
    await prisma.project.delete({ where: { id: projectId } });
    await app.close();
  });

  async function crearRiesgo(extra: Record<string, unknown>) {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/risks`,
      headers: comoRol(AppRole.PM),
      payload: { title: "Riesgo de prueba", probability: 2, impact: 2, ...extra },
    });
    if (res.statusCode === 201) riesgosCreados.push(res.json().data.id as string);
    return res;
  }

  it("un riesgo sin costo estimado sigue siendo válido, con moneda por defecto", async () => {
    const res = await crearRiesgo({});
    expect(res.statusCode).toBe(201);
    expect(res.json().data.estimatedCost).toBeNull();
    expect(res.json().data.costCurrency).toBe("USD");
  });

  it("se puede crear un riesgo con costo estimado y moneda", async () => {
    const res = await crearRiesgo({ estimatedCost: 5000, costCurrency: "eur" });
    expect(res.statusCode).toBe(201);
    expect(Number(res.json().data.estimatedCost)).toBe(5000);
    expect(res.json().data.costCurrency).toBe("EUR");
  });

  it("un costo negativo o cero se rechaza", async () => {
    const res = await crearRiesgo({ estimatedCost: 0 });
    expect(res.statusCode).toBe(400);
  });

  it("se puede actualizar el costo estimado con PUT", async () => {
    const creado = await crearRiesgo({ estimatedCost: 1000, costCurrency: "USD" });
    const id = creado.json().data.id as string;

    const actualizado = await app.inject({
      method: "PUT",
      url: `/api/projects/${projectId}/risks/${id}`,
      headers: comoRol(AppRole.PM),
      payload: { title: "Riesgo de prueba", probability: 2, impact: 2, estimatedCost: 2500, costCurrency: "USD" },
    });
    expect(actualizado.statusCode).toBe(200);
    expect(Number(actualizado.json().data.estimatedCost)).toBe(2500);
  });

  it("un riesgo OPEN con costo estimado afecta el total proyectado del presupuesto, no el real", async () => {
    await crearRiesgo({ estimatedCost: 20000, costCurrency: "USD" });

    const detalle = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/detail`,
      headers: comoRol(AppRole.ADMIN),
    });
    expect(detalle.statusCode).toBe(200);
    const fin = detalle.json().data.financials;
    // Sin horas ni gastos registrados, el único costo es la exposición del riesgo.
    expect(fin.spent).toBe(0);
    expect(fin.riskExposure).toBeGreaterThanOrEqual(20000);
    expect(fin.projectedTotal).toBeGreaterThanOrEqual(20000);
  });
});

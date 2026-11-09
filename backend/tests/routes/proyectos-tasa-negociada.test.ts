import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/infra/prisma.js";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";
import { idEmpresa } from "../helpers/datos.js";

/**
 * Tasa negociada por proyecto: "1 USD = X" en la moneda del proyecto. Se guarda
 * con su moneda (deducida por el servidor), se valida contra la moneda del
 * proyecto y, si está, valora presupuesto y precio de venta.
 */
describe("Proyectos: tasa de cambio negociada", () => {
  let app: FastifyInstance;
  let companyId: string;
  const creados: string[] = [];
  const admin = comoRol(AppRole.ADMIN);

  beforeAll(async () => {
    app = await crearAppDePrueba();
    companyId = await idEmpresa("Cliente pruebas tasa negociada");
  });

  afterAll(async () => {
    await prisma.project.deleteMany({ where: { id: { in: creados } } });
    await app.close();
  });

  const base = (extra: Record<string, unknown> = {}) => ({
    name: `Tasa negociada ${Math.random().toString(36).slice(2, 8)}`,
    companyId,
    country: "Colombia",
    currency: "COP",
    sellCurrency: "COP",
    budget: 35_000_000,
    sellPrice: 70_000_000,
    startDate: "2025-01-01",
    endDate: "2026-12-31",
    ...extra,
  });

  async function crear(payload: Record<string, unknown>) {
    const res = await app.inject({ method: "POST", url: "/api/projects", headers: admin, payload });
    if (res.statusCode === 201) creados.push(res.json().data.id as string);
    return res;
  }
  const editar = (id: string, payload: Record<string, unknown>) =>
    app.inject({ method: "PUT", url: `/api/projects/${id}`, headers: admin, payload });

  it("sin tasa, el proyecto se crea igual que siempre (campos nulos)", async () => {
    const res = await crear(base());
    expect(res.statusCode).toBe(201);
    expect(res.json().data.negotiatedFxRate).toBeNull();
    expect(res.json().data.negotiatedFxCurrency).toBeNull();
  });

  it("con tasa, guarda la tasa y la moneda del proyecto", async () => {
    const res = await crear(base({ negotiatedFxRate: 3500 }));
    expect(res.statusCode).toBe(201);
    expect(Number(res.json().data.negotiatedFxRate)).toBe(3500);
    expect(res.json().data.negotiatedFxCurrency).toBe("COP");
  });

  it("proyecto en USD con venta en COP: la tasa se refiere a COP", async () => {
    const res = await crear(base({ currency: "USD", budget: 10_000, negotiatedFxRate: 3500 }));
    expect(res.statusCode).toBe(201);
    expect(res.json().data.negotiatedFxCurrency).toBe("COP");
  });

  it("rechaza tasa en un proyecto todo en USD", async () => {
    const res = await crear(base({ currency: "USD", sellCurrency: "USD", negotiatedFxRate: 3500 }));
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/USD/);
  });

  it("rechaza tasa cero o negativa", async () => {
    expect((await crear(base({ negotiatedFxRate: 0 }))).statusCode).toBe(400);
    expect((await crear(base({ negotiatedFxRate: -1 }))).statusCode).toBe(400);
  });

  it("PUT: sin el campo conserva la tasa; null la quita", async () => {
    const id = (await crear(base({ negotiatedFxRate: 3500 }))).json().data.id as string;

    let res = await editar(id, base({ description: "editado" }));
    expect(res.statusCode).toBe(200);
    expect(Number(res.json().data.negotiatedFxRate)).toBe(3500);

    res = await editar(id, base({ negotiatedFxRate: 3900 }));
    expect(Number(res.json().data.negotiatedFxRate)).toBe(3900);

    res = await editar(id, base({ negotiatedFxRate: null }));
    expect(res.statusCode).toBe(200);
    expect(res.json().data.negotiatedFxRate).toBeNull();
    expect(res.json().data.negotiatedFxCurrency).toBeNull();
  });

  it("PUT: si cambia la moneda sin volver a indicar la tasa, 400", async () => {
    const id = (await crear(base({ negotiatedFxRate: 3500 }))).json().data.id as string;
    const res = await editar(id, base({ currency: "MXN", sellCurrency: "MXN" }));
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/moneda del proyecto cambió/);
  });

  it("la rentabilidad valora presupuesto y contrato con la tasa negociada", async () => {
    const id = (await crear(base({ negotiatedFxRate: 3500 }))).json().data.id as string;
    const res = await app.inject({ method: "GET", url: `/api/projects/${id}/profitability?baseCurrency=USD`, headers: admin });
    expect(res.statusCode).toBe(200);
    const p = res.json().data;
    expect(p.budget).toBeCloseTo(10_000, 4);
    expect(p.contractValue).toBeCloseTo(20_000, 4);
  });

  it("el detalle del proyecto usa la tasa negociada en el presupuesto", async () => {
    const id = (await crear(base({ negotiatedFxRate: 3500 }))).json().data.id as string;
    const res = await app.inject({ method: "GET", url: `/api/projects/${id}/detail`, headers: admin });
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.json().data)).toContain("10000");
  });

  it("un CONSULTANT sin más roles no ve la tasa negociada", async () => {
    const id = (await crear(base({ negotiatedFxRate: 3500 }))).json().data.id as string;
    const res = await app.inject({ method: "GET", url: `/api/projects/${id}`, headers: comoRol(AppRole.CONSULTANT) });
    if (res.statusCode === 200) expect(res.json().data).not.toHaveProperty("negotiatedFxRate");
  });
});

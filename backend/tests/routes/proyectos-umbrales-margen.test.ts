import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/infra/prisma.js";
import { runAlertEngine } from "../../src/modules/alerts/alerts.service.js";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";

/**
 * Dos umbrales de margen por proyecto (decisión de negocio D-2).
 *
 * Cubre lo que no puede comprobar una prueba pura: que el par de umbrales se
 * escribe y se lee por la API, que el crítico por encima del de advertencia se
 * rechaza con 400, y que el motor de alertas dispara con la severidad del nivel
 * que realmente se cruzó.
 */
describe("Umbrales de margen por proyecto (D-2)", () => {
  let app: FastifyInstance;
  const proyectosCreados: string[] = [];
  const consultoresCreados: string[] = [];

  const cuerpoBase = {
    name: "Proyecto umbrales",
    company: "Synaptica",
    country: "Colombia",
    currency: "USD",
    budget: 200_000,
    startDate: "2026-01-01",
    endDate: "2026-12-31",
  };

  beforeAll(async () => {
    app = await crearAppDePrueba();
  });

  afterAll(async () => {
    await prisma.timeEntry.deleteMany({ where: { projectId: { in: proyectosCreados } } });
    await prisma.financialEntry.deleteMany({ where: { projectId: { in: proyectosCreados } } });
    await prisma.alert.deleteMany({ where: { projectId: { in: proyectosCreados } } });
    await prisma.project.deleteMany({ where: { id: { in: proyectosCreados } } });
    await prisma.consultant.deleteMany({ where: { id: { in: consultoresCreados } } });
    await app.close();
  });

  async function crearProyecto(extra: Record<string, unknown>) {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: comoRol(AppRole.ADMIN),
      payload: { ...cuerpoBase, ...extra },
    });
    if (res.statusCode === 201) {
      proyectosCreados.push(res.json().data.id as string);
    }
    return res;
  }

  // ── Escritura y lectura del par ───────────────────────────────────────────

  it("guarda los dos umbrales al crear el proyecto", async () => {
    const res = await crearProyecto({ marginWarningPct: 35, marginCriticalPct: 20 });

    expect(res.statusCode).toBe(201);
    const enBase = await prisma.project.findUnique({ where: { id: res.json().data.id } });
    expect(Number(enBase?.marginWarningPct)).toBe(35);
    expect(Number(enBase?.marginCriticalPct)).toBe(20);
  });

  it("los campos vacíos del formulario se guardan como null (sin umbral propio)", async () => {
    const res = await crearProyecto({ marginWarningPct: "", marginCriticalPct: "" });

    expect(res.statusCode).toBe(201);
    const enBase = await prisma.project.findUnique({ where: { id: res.json().data.id } });
    expect(enBase?.marginWarningPct).toBeNull();
    expect(enBase?.marginCriticalPct).toBeNull();
  });

  it("un proyecto sin umbrales propios se reporta con los valores por defecto (30 / 15)", async () => {
    const creado = await crearProyecto({});
    const id = creado.json().data.id as string;

    const detalle = await app.inject({
      method: "GET",
      url: `/api/projects/${id}/detail`,
      headers: comoRol(AppRole.ADMIN),
    });

    expect(detalle.statusCode).toBe(200);
    const financials = detalle.json().data.financials;
    expect(financials.marginWarningPct).toBe(30);
    expect(financials.marginCriticalPct).toBe(15);
  });

  // ── Coherencia ────────────────────────────────────────────────────────────

  it("rechaza con 400 un crítico mayor que el de advertencia", async () => {
    const res = await crearProyecto({ marginWarningPct: 20, marginCriticalPct: 25 });

    expect(res.statusCode).toBe(400);
  });

  it("rechaza con 400 un crítico por encima del 30 por defecto aunque la advertencia vaya vacía", async () => {
    const res = await crearProyecto({ marginWarningPct: "", marginCriticalPct: 40 });

    expect(res.statusCode).toBe(400);
  });

  it("acepta crítico igual al de advertencia (banda de aviso vacía, pero coherente)", async () => {
    const res = await crearProyecto({ marginWarningPct: 20, marginCriticalPct: 20 });

    expect(res.statusCode).toBe(201);
  });

  it("el PUT aplica la misma validación de coherencia", async () => {
    const creado = await crearProyecto({ marginWarningPct: 35, marginCriticalPct: 20 });
    const id = creado.json().data.id as string;

    const incoherente = await app.inject({
      method: "PUT",
      url: `/api/projects/${id}`,
      headers: comoRol(AppRole.ADMIN),
      payload: { ...cuerpoBase, marginWarningPct: 10, marginCriticalPct: 25 },
    });
    expect(incoherente.statusCode).toBe(400);

    const coherente = await app.inject({
      method: "PUT",
      url: `/api/projects/${id}`,
      headers: comoRol(AppRole.ADMIN),
      payload: { ...cuerpoBase, marginWarningPct: 50, marginCriticalPct: 25 },
    });
    expect(coherente.statusCode).toBe(200);
    expect(Number(coherente.json().data.marginWarningPct)).toBe(50);
    expect(Number(coherente.json().data.marginCriticalPct)).toBe(25);
  });

  // ── La alerta de margen dispara en el nivel que corresponde ───────────────

  /**
   * Proyecto con un costo laboral real de 20 000 USD (400 h × 50 USD) y los
   * ingresos reconocidos que se le pasen:
   *   25 000 → margen 20 % → banda de advertencia con 30/15
   *   22 000 → margen 9,09 % → por debajo del crítico
   */
  async function proyectoConMargen(ingresos: number) {
    const creado = await crearProyecto({ name: `Margen ${ingresos}` });
    const projectId = creado.json().data.id as string;

    const consultor = await prisma.consultant.create({
      data: {
        fullName: `Consultor margen ${ingresos}`,
        email: `margen.${ingresos}.${Date.now()}@synaptica.test`,
        role: "Consultor",
        hourlyRate: 50,
        rateCurrency: "USD",
        country: "Colombia",
      },
    });
    consultoresCreados.push(consultor.id);

    await prisma.timeEntry.create({
      data: {
        projectId,
        consultantId: consultor.id,
        workDate: new Date(Date.UTC(2026, 3, 15)),
        hours: 400,
        status: "APPROVED",
      },
    });

    await prisma.financialEntry.create({
      data: {
        projectId,
        type: "REVENUE",
        amount: ingresos,
        currency: "USD",
        entryDate: new Date(Date.UTC(2026, 3, 30)),
        description: "Factura de prueba",
      },
    });

    return projectId;
  }

  it("margen en la banda de advertencia: alerta WARNING", async () => {
    const projectId = await proyectoConMargen(25_000);

    await runAlertEngine(prisma);

    const alerta = await prisma.alert.findFirst({
      where: { projectId, type: "MARGIN_BELOW_THRESHOLD" },
    });
    expect(alerta).not.toBeNull();
    expect(alerta?.severity).toBe("WARNING");
    expect(alerta?.message).toContain("de advertencia");
  });

  it("margen por debajo del crítico: alerta CRITICAL", async () => {
    const projectId = await proyectoConMargen(22_000);

    await runAlertEngine(prisma);

    const alerta = await prisma.alert.findFirst({
      where: { projectId, type: "MARGIN_BELOW_THRESHOLD" },
    });
    expect(alerta).not.toBeNull();
    expect(alerta?.severity).toBe("CRITICAL");
    expect(alerta?.message).toContain("crítico");
  });

  it("margen holgado: no hay alerta de margen", async () => {
    const projectId = await proyectoConMargen(100_000);

    await runAlertEngine(prisma);

    const alerta = await prisma.alert.findFirst({
      where: { projectId, type: "MARGIN_BELOW_THRESHOLD", resolvedAt: null },
    });
    expect(alerta).toBeNull();
  });
});

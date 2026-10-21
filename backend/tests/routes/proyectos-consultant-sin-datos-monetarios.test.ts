import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/infra/prisma.js";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";

/**
 * Hallazgo de la auditoría en vivo: un CONSULTANT llega a `GET /api/projects`
 * (y a `GET /api/projects/:id`) solo por `estimations:read` -- lo necesita el
 * selector "Proyecto Vinculado" de Estimaciones -- pero el backend le
 * devolvía el proyecto COMPLETO: presupuesto, precio de venta y umbrales de
 * margen de todo el portafolio, no solo el suyo.
 *
 * El recorte es por lo que la CUENTA puede ver, no por la ruta que usó para
 * llegar: quien además tenga ADMIN/PM/FINANCE/VIEWER sigue viendo todo.
 */
describe("GET /api/projects: un CONSULTANT puro no recibe campos monetarios del portafolio", () => {
  let app: FastifyInstance;
  let projectId: string;
  const CAMPOS_MONETARIOS = [
    "budget",
    "sellPrice",
    "marginWarningPct",
    "marginCriticalPct",
    "budgetAlertPct",
    "baselineBudget",
  ] as const;

  beforeAll(async () => {
    app = await crearAppDePrueba();
    const project = await prisma.project.create({
      data: {
        name: `Proyecto monetario ${Date.now()}`,
        company: "Synaptica",
        country: "Colombia",
        currency: "USD",
        budget: 123456,
        sellPrice: 200000,
        marginWarningPct: 30,
        marginCriticalPct: 15,
        budgetAlertPct: 90,
        startDate: new Date(Date.UTC(2026, 0, 1)),
        endDate: new Date(Date.UTC(2026, 11, 31)),
      },
    });
    projectId = project.id;
  });

  afterAll(async () => {
    await prisma.project.deleteMany({ where: { id: projectId } });
    await app.close();
  });

  it("un CONSULTANT puro no ve ningún campo monetario en el listado (exploit bloqueado)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/projects",
      headers: comoRol(AppRole.CONSULTANT, "consultor.proyectos@synaptica.test"),
    });

    expect(res.statusCode).toBe(200);
    const fila = (res.json().data as Array<Record<string, unknown>>).find((p) => p.id === projectId);
    expect(fila).toBeDefined();
    for (const campo of CAMPOS_MONETARIOS) {
      expect(fila).not.toHaveProperty(campo);
    }
    // Lo que sí necesita el selector de Estimaciones sigue llegando.
    expect(fila).toHaveProperty("name");
    expect(fila).toHaveProperty("id");
    expect(res.body).not.toContain("123456");
    expect(res.body).not.toContain("200000");
  });

  it("un CONSULTANT puro no ve ningún campo monetario en el detalle (exploit bloqueado)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}`,
      headers: comoRol(AppRole.CONSULTANT, "consultor.proyectos@synaptica.test"),
    });

    expect(res.statusCode).toBe(200);
    const cuerpo = res.json().data as Record<string, unknown>;
    for (const campo of CAMPOS_MONETARIOS) {
      expect(cuerpo).not.toHaveProperty(campo);
    }
    expect(cuerpo).toHaveProperty("name");
  });

  it("un ADMIN sigue viendo el proyecto completo", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}`,
      headers: comoRol(AppRole.ADMIN),
    });

    expect(res.statusCode).toBe(200);
    const cuerpo = res.json().data as Record<string, unknown>;
    expect(Number(cuerpo.budget)).toBe(123456);
    expect(Number(cuerpo.sellPrice)).toBe(200000);
  });

  it("quien tiene CONSULTANT y además PM a la vez también ve el proyecto completo", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}`,
      headers: comoRol([AppRole.CONSULTANT, AppRole.PM], "consultor-pm@synaptica.test"),
    });

    expect(res.statusCode).toBe(200);
    const cuerpo = res.json().data as Record<string, unknown>;
    expect(Number(cuerpo.budget)).toBe(123456);
  });
});

/**
 * `GET /api/stats/overview` ya no admite CONSULTANT: nada en el frontend lo
 * necesita (el dashboard de KPIs requiere `stats:read`, que CONSULTANT no
 * tiene), y el backend lo dejaba entrar igual, exponiendo presupuesto, margen
 * y rentabilidad de TODO el portafolio.
 */
describe("GET /api/stats/overview: CONSULTANT ya no entra (exploit bloqueado)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await crearAppDePrueba();
  });

  afterAll(async () => {
    await app.close();
  });

  it("un CONSULTANT recibe 403", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/stats/overview",
      headers: comoRol(AppRole.CONSULTANT, "consultor.stats@synaptica.test"),
    });
    expect(res.statusCode).toBe(403);
  });

  it("un VIEWER sigue entrando (sin cambios)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/stats/overview",
      headers: comoRol(AppRole.VIEWER, "viewer.stats@synaptica.test"),
    });
    expect(res.statusCode).toBe(200);
  });
});

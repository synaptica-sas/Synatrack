import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/infra/prisma.js";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";
import {
  crearEscenarioBasico,
  limpiarEscenario,
  type EscenarioBasico,
} from "../helpers/datos.js";

/**
 * Huecos de auditoría cerrados después de R9: cronómetro, configuración de
 * recargos, tasas FX, hitos/riesgos/issues, proyecto (salud/avance),
 * cambios de alcance y LOGIN.
 */
describe("Auditoría: huecos cerrados tras R9", () => {
  const ADMIN_EMAIL = "admin@synaptica.local";
  let app: FastifyInstance;
  let escenario: EscenarioBasico;
  const idsAuditados: string[] = [];

  async function registros(entity: string, entityId: string, action?: string) {
    idsAuditados.push(entityId);
    return prisma.auditLog.findMany({
      where: { entity, entityId, ...(action ? { action } : {}) },
      orderBy: { createdAt: "asc" },
    });
  }

  beforeAll(async () => {
    app = await crearAppDePrueba();
    escenario = await crearEscenarioBasico("huecos-audit");
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: idsAuditados } } });
    await prisma.milestone.deleteMany({ where: { projectId: escenario.projectId } });
    await prisma.risk.deleteMany({ where: { projectId: escenario.projectId } });
    await prisma.issue.deleteMany({ where: { projectId: escenario.projectId } });
    await prisma.changeRequest.deleteMany({ where: { projectId: escenario.projectId } });
    await prisma.runningTimer.deleteMany({ where: { consultantId: escenario.consultorA.id } });
    await limpiarEscenario(escenario);
    await app.close();
  });

  it("POST /api/timer/stop deja un CREATE de timeEntry con el correo del token", async () => {
    const headers = comoRol(AppRole.CONSULTANT, escenario.consultorA.email);
    const inicio = await app.inject({
      method: "POST",
      url: "/api/timer/start",
      headers,
      payload: { projectId: escenario.projectId },
    });
    expect(inicio.statusCode).toBe(201);

    const fin = await app.inject({ method: "POST", url: "/api/timer/stop", headers, payload: {} });
    expect(fin.statusCode).toBe(201);
    const entryId = fin.json().data.id as string;

    const filas = await registros("timeEntry", entryId, "CREATE");
    expect(filas).toHaveLength(1);
    expect(filas[0].changedBy).toBe(escenario.consultorA.email);
    expect((filas[0].after as Record<string, unknown>).origen).toBe("cronometro");
  });

  it("descartar el cronómetro no genera auditoría (estado efímero)", async () => {
    const headers = comoRol(AppRole.CONSULTANT, escenario.consultorA.email);
    await app.inject({ method: "POST", url: "/api/timer/start", headers, payload: { projectId: escenario.projectId } });
    const antes = await prisma.auditLog.count({ where: { entity: "timeEntry" } });
    const res = await app.inject({ method: "DELETE", url: "/api/timer", headers });
    expect(res.statusCode).toBe(204);
    expect(await prisma.auditLog.count({ where: { entity: "timeEntry" } })).toBe(antes);
  });

  it("PUT y reset de /extra-hours/config dejan extraHoursConfig con el diff del recargo", async () => {
    const headers = comoRol(AppRole.ADMIN);
    const actual = await app.inject({ method: "GET", url: "/api/extra-hours/config/Colombia", headers });
    const cfg = actual.json().data;

    const put = await app.inject({
      method: "PUT",
      url: "/api/extra-hours/config/Colombia",
      headers,
      payload: {
        weeklyExtraHoursLimit: Number(cfg.weeklyExtraHoursLimit),
        diurnalMultiplier: 1.37,
        nocturnalMultiplier: Number(cfg.nocturnalMultiplier),
        diurnalHolidayMultiplier: Number(cfg.diurnalHolidayMultiplier),
        nocturnalHolidayMultiplier: Number(cfg.nocturnalHolidayMultiplier),
        diurnalStart: "06:00",
        diurnalEnd: "21:00",
        monthlyDivisor: Number(cfg.monthlyDivisor),
      },
    });
    expect(put.statusCode).toBe(200);
    const configId = put.json().data.id as string;

    try {
      const filas = await registros("extraHoursConfig", configId);
      expect(filas.at(-1)?.action).toBe("UPDATE");
      expect(filas.at(-1)?.changedBy).toBe(ADMIN_EMAIL);
      expect(JSON.stringify(filas.at(-1)?.diff)).toContain("diurnalMultiplier");
    } finally {
      // Deja la configuración como estaba para no contaminar otras pruebas.
      const reset = await app.inject({ method: "POST", url: "/api/extra-hours/config/Colombia/reset", headers });
      expect(reset.statusCode).toBe(200);
    }

    const tras = await registros("extraHoursConfig", configId);
    expect(tras.length).toBeGreaterThanOrEqual(2);
    expect(tras.at(-1)?.changedBy).toBe(ADMIN_EMAIL);
  });

  it("/extra-hours/calculate no escribe auditoría (solo calcula)", async () => {
    const antes = await prisma.auditLog.count();
    await app.inject({
      method: "POST",
      url: "/api/extra-hours/calculate",
      headers: comoRol(AppRole.ADMIN),
      payload: {
        consultantId: escenario.consultorA.id,
        date: "2026-05-04",
        startTime: "19:00",
        endTime: "21:00",
      },
    });
    expect(await prisma.auditLog.count()).toBe(antes);
  });

  it("FX: PUT crea/actualiza y DELETE deja fxConfig", async () => {
    const headers = comoRol(AppRole.FINANCE);
    const par = { baseCode: "ZZA", quoteCode: "ZZB" };
    const crear = await app.inject({ method: "PUT", url: "/api/fx", headers, payload: { ...par, rate: 2 } });
    expect(crear.statusCode).toBe(201);
    const id = crear.json().data.id as string;
    const editar = await app.inject({ method: "PUT", url: "/api/fx", headers, payload: { ...par, rate: 3 } });
    expect(editar.statusCode).toBe(200);
    const borrar = await app.inject({ method: "DELETE", url: `/api/fx/${id}`, headers });
    expect(borrar.statusCode).toBe(204);

    const filas = await registros("fxConfig", id);
    expect(filas.map((f) => f.action)).toEqual(["CREATE", "UPDATE", "DELETE"]);
    expect(filas[1].changedBy).toBe(ADMIN_EMAIL);
    await prisma.fxRateHistory.deleteMany({ where: par });
  });

  it("hitos, riesgos e issues auditan crear, editar y borrar", async () => {
    const headers = comoRol(AppRole.PM);
    const base = `/api/projects/${escenario.projectId}`;

    const hito = await app.inject({
      method: "POST", url: `${base}/milestones`, headers,
      payload: { name: "Hito 1", plannedDate: "2026-06-01", weight: 10 },
    });
    expect(hito.statusCode).toBe(201);
    const hitoId = hito.json().data.id as string;
    await app.inject({ method: "PATCH", url: `${base}/milestones/${hitoId}/complete`, headers, payload: {} });
    await app.inject({ method: "DELETE", url: `${base}/milestones/${hitoId}`, headers });
    expect((await registros("milestone", hitoId)).map((f) => f.action)).toEqual(["CREATE", "COMPLETE", "DELETE"]);

    const riesgo = await app.inject({
      method: "POST", url: `${base}/risks`, headers,
      payload: { title: "Riesgo", probability: 2, impact: 3 },
    });
    expect(riesgo.statusCode).toBe(201);
    const riesgoId = riesgo.json().data.id as string;
    await app.inject({ method: "PATCH", url: `${base}/risks/${riesgoId}/status`, headers, payload: { status: "CLOSED" } });
    await app.inject({ method: "DELETE", url: `${base}/risks/${riesgoId}`, headers });
    expect((await registros("risk", riesgoId)).map((f) => f.action)).toEqual(["CREATE", "UPDATE", "DELETE"]);

    const issue = await app.inject({
      method: "POST", url: `${base}/issues`, headers,
      payload: { title: "Incidente" },
    });
    expect(issue.statusCode).toBe(201);
    const issueId = issue.json().data.id as string;
    await app.inject({ method: "PATCH", url: `${base}/issues/${issueId}/resolve`, headers, payload: {} });
    await app.inject({ method: "DELETE", url: `${base}/issues/${issueId}`, headers });
    const filasIssue = await registros("issue", issueId);
    expect(filasIssue.map((f) => f.action)).toEqual(["CREATE", "UPDATE", "DELETE"]);
    expect(filasIssue[0].changedBy).toBe(ADMIN_EMAIL);
  });

  it("salud y avance del proyecto dejan UPDATE con before/after", async () => {
    const headers = comoRol(AppRole.PM);
    const base = `/api/projects/${escenario.projectId}`;
    const salud = await app.inject({ method: "PATCH", url: `${base}/health`, headers, payload: { healthStatus: "RED" } });
    expect(salud.statusCode).toBe(200);
    await app.inject({ method: "PATCH", url: `${base}/completion`, headers, payload: { completionPct: 42 } });

    const filas = await registros("project", escenario.projectId, "UPDATE");
    const diffs = JSON.stringify(filas.map((f) => f.diff));
    expect(diffs).toContain("healthStatus");
    expect(diffs).toContain("completionPct");
  });

  it("crear y borrar un cambio de alcance deja changeRequest", async () => {
    const headers = comoRol(AppRole.PM);
    const base = `/api/projects/${escenario.projectId}/changes`;
    const crear = await app.inject({
      method: "POST", url: base, headers,
      payload: { title: "Cambio", description: "Más alcance", type: "SCOPE" },
    });
    expect(crear.statusCode, crear.body).toBe(201);
    const id = crear.json().data.id as string;
    const borrar = await app.inject({ method: "DELETE", url: `${base}/${id}`, headers });
    expect(borrar.statusCode).toBe(204);
    expect((await registros("changeRequest", id)).map((f) => f.action)).toEqual(["CREATE", "DELETE"]);
  });

  describe("LOGIN en GET /api/auth/me", () => {
    const email = `login.${Date.now()}@synaptica.test`;
    const userId = `local-sim:${email}`;

    it("registra un solo LOGIN aunque /me se llame varias veces (umbral)", async () => {
      const headers = comoRol(AppRole.VIEWER, email);
      for (let i = 0; i < 3; i++) {
        const res = await app.inject({ method: "GET", url: "/api/auth/me", headers });
        expect(res.statusCode).toBe(200);
      }
      const filas = await registros("user", userId, "LOGIN");
      expect(filas).toHaveLength(1);
      expect(filas[0].changedBy).toBe(email);
    });

    it("registra otro LOGIN cuando el anterior quedó fuera de la ventana", async () => {
      await prisma.auditLog.updateMany({
        where: { entity: "user", entityId: userId, action: "LOGIN" },
        data: { createdAt: new Date(Date.now() - 9 * 3_600_000) },
      });
      await app.inject({ method: "GET", url: "/api/auth/me", headers: comoRol(AppRole.VIEWER, email) });
      expect(await registros("user", userId, "LOGIN")).toHaveLength(2);
    });

    it("otras rutas autenticadas no generan LOGIN", async () => {
      const otro = `sinlogin.${Date.now()}@synaptica.test`;
      await app.inject({ method: "GET", url: "/api/alerts", headers: comoRol(AppRole.ADMIN, otro) });
      expect(await registros("user", `local-sim:${otro}`, "LOGIN")).toHaveLength(0);
    });
  });
});

import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/infra/prisma.js";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";

/**
 * Visibilidad de `GET /api/audit` por rol, filtro `action` y llave del umbral de
 * LOGIN (usuario + IP + user-agent).
 */
describe("Auditoría: visibilidad por rol, filtro action y LOGIN por origen", () => {
  const marca = `vis${Date.now()}`;
  const entityId = `ent-${marca}`;
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await crearAppDePrueba();
    const base = { entity: "user", entityId, changedBy: `${marca}@synaptica.test`, ipAddress: "10.1.2.3", userAgent: "Navegador/1.0" };
    await prisma.auditLog.createMany({
      data: [
        { ...base, action: "LOGIN" },
        { ...base, action: "CREATE" },
        { ...base, action: "UPDATE", before: { roles: ["VIEWER"] }, after: { roles: ["PM"] } },
      ],
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: [entityId, `local-sim:${marca}@synaptica.test`] } } });
    await app.close();
  });

  const consultar = (rol: AppRole, qs = "") =>
    app.inject({ method: "GET", url: `/api/audit?entityId=${entityId}${qs}`, headers: comoRol(rol, `${rol}.${marca}@synaptica.test`) });

  it("ADMIN ve LOGIN, IP y user-agent", async () => {
    const res = await consultar(AppRole.ADMIN);
    expect(res.statusCode).toBe(200);
    const filas = res.json().data as any[];
    expect(filas.map((f) => f.action).sort()).toEqual(["CREATE", "LOGIN", "UPDATE"]);
    expect(filas.every((f) => f.ipAddress === "10.1.2.3" && f.userAgent === "Navegador/1.0")).toBe(true);
  });

  it("un PM ya no tiene acceso a la auditoría general (403)", async () => {
    const res = await consultar(AppRole.PM);
    expect(res.statusCode).toBe(403);
  });

  it.each([AppRole.FINANCE])("%s no ve IP, user-agent ni LOGIN, pero sí el cambio de rol", async (rol) => {
    const res = await consultar(rol);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const filas = body.data as any[];
    expect(filas.map((f) => f.action).sort()).toEqual(["CREATE", "UPDATE"]);
    for (const f of filas) {
      expect("ipAddress" in f).toBe(false);
      expect("userAgent" in f).toBe(false);
    }
    expect(body.meta.total).toBe(2);
  });

  it("action acepta un valor o una lista separada por comas", async () => {
    const uno = await consultar(AppRole.ADMIN, "&action=LOGIN");
    expect((uno.json().data as any[]).map((f) => f.action)).toEqual(["LOGIN"]);
    const varios = await consultar(AppRole.ADMIN, "&action=CREATE,UPDATE");
    expect((varios.json().data as any[]).map((f) => f.action).sort()).toEqual(["CREATE", "UPDATE"]);
  });

  it("para no-ADMIN, action=LOGIN devuelve vacío y action=LOGIN,CREATE solo CREATE", async () => {
    const login = await consultar(AppRole.FINANCE, "&action=LOGIN");
    expect(login.statusCode).toBe(200);
    expect(login.json().data).toEqual([]);
    expect(login.json().meta.total).toBe(0);
    const mixto = await consultar(AppRole.FINANCE, "&action=LOGIN,CREATE");
    expect((mixto.json().data as any[]).map((f) => f.action)).toEqual(["CREATE"]);
  });

  describe("LOGIN por origen en /api/auth/me", () => {
    const email = `${marca}@synaptica.test`;
    const userId = `local-sim:${email}`;

    const me = (ua: string, ip: string) =>
      app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { ...comoRol(AppRole.VIEWER, email), "user-agent": ua },
        remoteAddress: ip,
      });
    const logins = () => prisma.auditLog.findMany({ where: { entity: "user", entityId: userId, action: "LOGIN" } });

    it("mismo IP y UA dentro de la ventana: un solo LOGIN", async () => {
      await me("UA-A", "10.0.0.1");
      await me("UA-A", "10.0.0.1");
      expect(await logins()).toHaveLength(1);
    });

    it("otro user-agent o otra IP dentro de la ventana: LOGIN nuevo", async () => {
      await me("UA-B", "10.0.0.1");
      expect(await logins()).toHaveLength(2);
      await me("UA-B", "10.0.0.2");
      expect(await logins()).toHaveLength(3);
      await me("UA-B", "10.0.0.2");
      expect(await logins()).toHaveLength(3);
    });
  });
});

import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rolePermissions } from "../../src/auth/roles.js";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";

/**
 * `GET /api/auth/permissions` es la fuente única de la matriz de permisos para
 * el frontend (DEP-15): el simulador de rol del encabezado la consume en vez de
 * mantener su propia copia. Si esta respuesta deja de coincidir con
 * `auth/roles.ts`, la interfaz vuelve a poder desincronizarse en silencio.
 */
describe("GET /api/auth/permissions", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await crearAppDePrueba();
  });

  afterAll(async () => {
    await app.close();
  });

  it("devuelve exactamente la matriz de roles.ts", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/permissions",
      headers: comoRol(AppRole.ADMIN),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual(rolePermissions);
  });

  it("incluye los cinco roles, VIEWER entre ellos", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/permissions",
      headers: comoRol(AppRole.CONSULTANT),
    });

    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json().data).sort()).toEqual(
      ["ADMIN", "CONSULTANT", "FINANCE", "PM", "VIEWER"],
    );
  });
});

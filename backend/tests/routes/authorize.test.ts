import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";

/**
 * `authorize([...])` es el único mecanismo de autorización real del backend.
 * Estas pruebas verifican que efectivamente corta, usando una ruta que solo
 * admite ADMIN (`GET /api/admin/users`).
 */
describe("authorize() sobre GET /api/admin/users", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await crearAppDePrueba();
  });

  afterAll(async () => {
    await app.close();
  });

  it("responde 403 a un CONSULTANT", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/users",
      headers: comoRol(AppRole.CONSULTANT, "consultor@synaptica.test"),
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ message: "Insufficient permissions" });
  });

  it("responde 200 a un ADMIN", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/users",
      headers: comoRol(AppRole.ADMIN),
    });

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
  });

  it("sin encabezados usa la identidad por defecto: admin local (comportamiento histórico)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/admin/users" });

    expect(res.statusCode).toBe(200);
  });

  it("rechaza con 400 un rol inexistente en el encabezado", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/users",
      headers: { "x-dev-roles": "SUPERADMIN" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain("x-dev-roles");
  });
});

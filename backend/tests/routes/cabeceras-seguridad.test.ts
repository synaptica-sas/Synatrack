import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";

/**
 * Cabeceras de seguridad y tope de peticiones por IP.
 *
 * `buildApp` registra `@fastify/helmet` y `@fastify/rate-limit`; aquí se
 * comprueba que ambos siguen puestos sobre la app real y que el health check
 * queda fuera del tope (Render lo consulta cada pocos segundos y, si contara,
 * acabaría tumbando el servicio él solo).
 *
 * Procede de `src/modules/__tests__/security.integration.test.ts`.
 */
describe("Cabeceras de seguridad y tope de peticiones", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await crearAppDePrueba();
  });

  afterAll(async () => {
    await app.close();
  });

  it("helmet añade las cabeceras habituales", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/time-entries",
      headers: comoRol(AppRole.ADMIN),
    });

    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBeDefined();
    expect(res.headers["strict-transport-security"]).toBeDefined();
  });

  it("el tope de peticiones anuncia el límite en cada respuesta", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/time-entries",
      headers: comoRol(AppRole.ADMIN),
    });

    expect(res.headers["x-ratelimit-limit"]).toBeDefined();
    expect(res.headers["x-ratelimit-remaining"]).toBeDefined();
  });

  it("el health check queda fuera del tope, para que Render no lo tumbe", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["x-ratelimit-limit"]).toBeUndefined();
  });
});

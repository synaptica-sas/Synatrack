import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Con autenticación real (`AUTH_ENABLED=true`, `AUTH_DEMO_BYPASS=false`) una
 * ruta protegida debe responder 401 sin token, y el simulador de rol debe ser
 * completamente inerte: ni las variables ni los encabezados pueden colarse.
 *
 * `env` se congela al importar `src/config/env.ts`, así que este archivo
 * reconstruye el grafo de módulos (`vi.resetModules`) con el entorno cambiado
 * antes de importar la app.
 */
describe("authenticate() con autenticación real", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("AUTH_ENABLED", "true");
    vi.stubEnv("AUTH_DEMO_BYPASS", "false");
    // Se deja el encabezado "habilitado" a propósito: aun así no debe servir.
    vi.stubEnv("AUTH_DEV_ROLE_HEADER", "true");
    vi.stubEnv("AUTH_DEV_ROLES", "ADMIN");
    vi.resetModules();
    const { buildApp } = await import("../../src/app.js");
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it("responde 401 sin encabezado Authorization", async () => {
    const res = await app.inject({ method: "GET", url: "/api/admin/users" });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ message: "Missing bearer token" });
  });

  it("responde 401 con un bearer inválido", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/users",
      headers: { authorization: "Bearer token-falso" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("los encabezados del simulador de rol NO permiten entrar", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/users",
      headers: { "x-dev-roles": "ADMIN", "x-dev-email": "atacante@externo.test" },
    });

    expect(res.statusCode).toBe(401);
  });
});

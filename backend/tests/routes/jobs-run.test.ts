import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { comoRol } from "../helpers/app.js";

/**
 * `POST /api/jobs/run` dispara el ciclo de mantenimiento (asignaciones +
 * alertas) y tiene la misma doble puerta que `POST /api/fx/sync`:
 * token compartido para el cron externo, o sesión ADMIN.
 *
 * `env` se congela al importar `src/config/env.ts`, así que este archivo
 * reconstruye el grafo de módulos (`vi.resetModules`) con `JOBS_RUN_TOKEN`
 * puesto antes de importar la app.
 */
const TOKEN = "token-de-prueba-para-jobs-1234567890";

describe("POST /api/jobs/run en modo demo (token compartido o sesión)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("JOBS_RUN_TOKEN", TOKEN);
    vi.resetModules();
    const { buildApp } = await import("../../src/app.js");
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("acepta el token compartido (sin sesión de usuario)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/jobs/run",
      headers: { authorization: `Bearer ${TOKEN}` },
    });

    expect(res.statusCode).toBe(200);
    const cuerpo = res.json().data;
    expect(cuerpo.omitido).toBe(false);
    expect(cuerpo.origen).toBe("http");
    expect(typeof cuerpo.duracionMs).toBe("number");
    expect(cuerpo.trabajos.map((t: { nombre: string }) => t.nombre)).toEqual([
      "assignment-maintenance",
      "alert-engine",
    ]);
    expect(cuerpo.trabajos.every((t: { ok: boolean }) => t.ok)).toBe(true);
  });

  it("rechaza con 403 un token compartido equivocado (cae a la sesión, que aquí es CONSULTANT)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/jobs/run",
      headers: {
        authorization: "Bearer token-que-no-es",
        ...comoRol(AppRole.CONSULTANT, "consultor@synaptica.test"),
      },
    });

    expect(res.statusCode).toBe(403);
  });

  it("acepta una sesión con rol ADMIN", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/jobs/run",
      headers: comoRol(AppRole.ADMIN),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.trabajos).toHaveLength(2);
  });

  it("responde 403 a un rol no autorizado (PM)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/jobs/run",
      headers: comoRol(AppRole.PM, "pm@synaptica.test"),
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ message: "Insufficient permissions" });
  });

  it("responde 403 a un CONSULTANT", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/jobs/run",
      headers: comoRol(AppRole.CONSULTANT, "consultor@synaptica.test"),
    });

    expect(res.statusCode).toBe(403);
  });

  it("GET /api/jobs/status responde a ADMIN con el estado del planificador", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/jobs/status",
      headers: comoRol(AppRole.ADMIN),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({
      intervaloMinutos: 0,
      intervaloActivo: false,
      cicloEnCurso: false,
      tokenConfigurado: true,
    });
  });
});

describe("POST /api/jobs/run con autenticación real", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("JOBS_RUN_TOKEN", TOKEN);
    vi.stubEnv("AUTH_ENABLED", "true");
    vi.stubEnv("AUTH_DEMO_BYPASS", "false");
    vi.stubEnv("AUTH_DEV_ROLE_HEADER", "true");
    vi.resetModules();
    const { buildApp } = await import("../../src/app.js");
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("responde 401 sin token ni sesión", async () => {
    const res = await app.inject({ method: "POST", url: "/api/jobs/run" });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ message: "Missing bearer token" });
  });

  it("responde 401 con un bearer que no es ni el token compartido ni un JWT válido", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/jobs/run",
      headers: { authorization: "Bearer token-falso" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("el token compartido sigue funcionando aunque la autenticación real esté activa", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/jobs/run",
      headers: { authorization: `Bearer ${TOKEN}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.omitido).toBe(false);
  });
});

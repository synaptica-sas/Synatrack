import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * El manejador global de errores no debe filtrar el interior del servidor.
 *
 * Antes devolvía `detail` (mensaje de la excepción) y `stack` (traza completa,
 * con rutas del sistema de archivos) en **cualquier** entorno. Ahora en
 * producción la respuesta 500 solo lleva `message`; el detalle queda en el log.
 *
 * `env` se congela al importar `src/config/env.ts`, así que cada caso reconstruye
 * el grafo de módulos (`vi.resetModules`) con el `NODE_ENV` que quiere probar.
 */
async function appQueExplota(nodeEnv: string): Promise<FastifyInstance> {
  vi.stubEnv("NODE_ENV", nodeEnv);
  vi.resetModules();
  const { buildApp } = await import("../../src/app.js");
  const app = await buildApp();
  // Se registra antes de `ready()`: Fastify no admite rutas nuevas después.
  app.get("/ruta-que-explota", async () => {
    throw new Error("secreto interno: cadena de conexión rota");
  });
  await app.ready();
  return app;
}

describe("manejador global de errores: no filtra el interior en producción", () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    await app?.close();
    app = null;
    vi.unstubAllEnvs();
  });

  it("en producción la respuesta 500 no lleva detail ni stack", async () => {
    app = await appQueExplota("production");

    const res = await app.inject({ method: "GET", url: "/ruta-que-explota" });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ message: "Internal server error" });
    expect(res.body).not.toContain("secreto interno");
    expect(res.body).not.toContain("stack");
  });

  it("fuera de producción sí se devuelven detail y stack, que ayudan a desarrollar", async () => {
    app = await appQueExplota("development");

    const res = await app.inject({ method: "GET", url: "/ruta-que-explota" });

    expect(res.statusCode).toBe(500);
    const cuerpo = res.json() as { message: string; detail?: string; stack?: string };
    expect(cuerpo.detail).toBe("secreto interno: cadena de conexión rota");
    expect(cuerpo.stack).toContain("Error: secreto interno");
  });
});

/**
 * Los errores del cliente conservan su código. Antes el límite de peticiones
 * salía como 500 "Internal server error": el plugin lanza el objeto de
 * `errorResponseBuilder` y, sin `statusCode`, el manejador lo trataba como un
 * fallo interno. En el frontend eso aparecía como "No se pudo iniciar sesión:
 * Internal server error" cuando `/api/auth/me` caía dentro del tope.
 */
describe("manejador global de errores: respeta los códigos 4xx", () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    await app?.close();
    app = null;
    vi.unstubAllEnvs();
  });

  it("superar el límite de peticiones responde 429 con su mensaje, no 500", async () => {
    vi.stubEnv("RATE_LIMIT_MAX", "2");
    app = await appQueExplota("production");

    const codigos: number[] = [];
    let ultima = "";
    for (let i = 0; i < 3; i++) {
      // Ruta registrada: las 404 no pasan por el limitador.
      const res = await app.inject({ method: "GET", url: "/ruta-que-explota" });
      codigos.push(res.statusCode);
      ultima = res.body;
    }

    expect(codigos).toEqual([500, 500, 429]);
    expect(JSON.parse(ultima).message).toMatch(/Demasiadas peticiones/);
  });

  it("un JSON mal formado responde 400, no 500", async () => {
    app = await appQueExplota("production");

    const res = await app.inject({
      method: "POST",
      url: "/ruta-que-explota",
      headers: { "content-type": "application/json" },
      payload: "{mal",
    });

    expect(res.statusCode).toBe(400);
  });
});

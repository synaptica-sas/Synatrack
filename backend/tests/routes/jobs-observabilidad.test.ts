import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/infra/prisma.js";
import {
  RETENCION_POR_TRABAJO,
  TRABAJOS_VIGILADOS,
  invalidarCacheFrescura,
  obtenerFrescura,
  registrarEjecucion,
} from "../../src/modules/jobs/job-runs.service.js";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";

/**
 * Observabilidad de los trabajos periódicos.
 *
 * Lo que se prueba aquí y no en `src/`: que el rastro llega de verdad a la
 * tabla `JobRun` y sobrevive a que el proceso se muera, que es exactamente el
 * problema original (el resultado vivía en una variable de módulo y el plan
 * free de Render duerme el servicio).
 */

const HORA = 60 * 60 * 1000;
const AHORA = new Date("2026-09-29T12:00:00.000Z");

/** Ejecución lista para insertar, empezada `horasAtras` antes de `AHORA`. */
function ejecucion(jobName: string, horasAtras: number, ok: boolean, error?: string) {
  const startedAt = new Date(AHORA.getTime() - horasAtras * HORA);
  return {
    jobName,
    origin: "http",
    startedAt,
    finishedAt: new Date(startedAt.getTime() + 900),
    durationMs: 900,
    ok,
    error: error ?? null,
  };
}

async function limpiarJobRuns() {
  await prisma.jobRun.deleteMany({});
  invalidarCacheFrescura();
}

describe("Registro persistente de ejecuciones (JobRun)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await crearAppDePrueba();
  });

  afterAll(async () => {
    await limpiarJobRuns();
    await app.close();
  });

  beforeEach(async () => {
    await limpiarJobRuns();
  });

  it("POST /api/jobs/run deja una fila por trabajo, con duración y origen", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/jobs/run",
      headers: comoRol(AppRole.ADMIN),
    });
    expect(res.statusCode).toBe(200);

    const filas = await prisma.jobRun.findMany({ orderBy: { startedAt: "asc" } });

    expect(filas.map((f) => f.jobName)).toEqual([
      "assignment-maintenance",
      "alert-engine",
      // R-020 + R-022: el resumen semanal también deja su rastro en cada ciclo,
      // aunque la inmensa mayoría de las veces decida que todavía no toca
      // enviar. Ese rastro es justamente lo que permite detectar que dejó de
      // evaluarse, sin esperar a que falte un correo.
      "approval-digest",
    ]);
    for (const fila of filas) {
      expect(fila.ok).toBe(true);
      expect(fila.origin).toBe("http");
      expect(fila.error).toBeNull();
      expect(fila.durationMs).toBeGreaterThanOrEqual(0);
      expect(fila.finishedAt.getTime()).toBeGreaterThanOrEqual(fila.startedAt.getTime());
    }
  });

  it("el rastro sobrevive a que se reconstruya la app (no vive en memoria)", async () => {
    await app.inject({ method: "POST", url: "/api/jobs/run", headers: comoRol(AppRole.ADMIN) });

    // Simula la siesta de Render: se tira la app y la caché en memoria.
    await app.close();
    invalidarCacheFrescura();
    app = await crearAppDePrueba();

    const frescura = await obtenerFrescura(prisma);
    const alertas = frescura.trabajos.find((t) => t.nombre === "alert-engine");

    expect(alertas?.estado).toBe("ok");
    expect(alertas?.ultimoExitoEn).not.toBeNull();
  });

  it("una ejecución fallida se registra SIN perder el mensaje del error", async () => {
    const guardado = await registrarEjecucion(prisma, {
      ...ejecucion("fx-sync", 0.1, false),
      error: "exchangerate-api respondió con estado 503",
    });
    expect(guardado).toBe(true);

    const fila = await prisma.jobRun.findFirstOrThrow({ where: { jobName: "fx-sync" } });
    expect(fila.ok).toBe(false);
    expect(fila.error).toBe("exchangerate-api respondió con estado 503");
  });

  it("recorta un error enorme en vez de guardar la excepción entera", async () => {
    await registrarEjecucion(prisma, {
      ...ejecucion("fx-sync", 0.1, false),
      error: "x".repeat(5000),
    });

    const fila = await prisma.jobRun.findFirstOrThrow({ where: { jobName: "fx-sync" } });
    expect(fila.error).toHaveLength(1000);
  });

  it("el historial no crece sin límite: se purga por encima de la retención", async () => {
    const total = RETENCION_POR_TRABAJO + 5;
    for (let i = total; i > 0; i -= 1) {
      await registrarEjecucion(prisma, ejecucion("alert-engine", i, true));
    }

    const conservadas = await prisma.jobRun.count({ where: { jobName: "alert-engine" } });
    expect(conservadas).toBe(RETENCION_POR_TRABAJO);

    // Lo que se conserva son las MÁS RECIENTES: la más vieja debía desaparecer.
    const masVieja = await prisma.jobRun.findFirst({
      where: { jobName: "alert-engine" },
      orderBy: { startedAt: "asc" },
    });
    expect(masVieja?.startedAt.getTime()).toBe(
      AHORA.getTime() - RETENCION_POR_TRABAJO * HORA,
    );
  });
});

describe("Frescura: distingue «nunca», «fallido» y «obsoleto»", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await crearAppDePrueba();
  });

  afterAll(async () => {
    await limpiarJobRuns();
    await app.close();
  });

  beforeEach(async () => {
    await limpiarJobRuns();
  });

  it("sin ninguna fila, TODOS los trabajos vigilados salen como «nunca»", async () => {
    const frescura = await obtenerFrescura(prisma, AHORA);

    expect(frescura.estado).toBe("degradado");
    expect(frescura.trabajos).toHaveLength(TRABAJOS_VIGILADOS.length);
    expect(frescura.trabajos.every((t) => t.estado === "nunca")).toBe(true);
  });

  it("los tres estados conviven y cada trabajo reporta el suyo", async () => {
    // assignment-maintenance: corrió bien hace 10 min -> ok (tolerancia 3 h).
    await registrarEjecucion(prisma, ejecucion("assignment-maintenance", 1 / 6, true));
    // alert-engine: tuvo un éxito viejo y su último intento falló -> fallido.
    await registrarEjecucion(prisma, ejecucion("alert-engine", 5, true));
    await registrarEjecucion(prisma, ejecucion("alert-engine", 1, false, "Prisma: P1001"));
    // fx-sync: último éxito hace 100 h -> obsoleto (tolerancia 72 h).
    await registrarEjecucion(prisma, ejecucion("fx-sync", 100, true));

    const frescura = await obtenerFrescura(prisma, AHORA);
    const porNombre = new Map(frescura.trabajos.map((t) => [t.nombre, t]));

    expect(porNombre.get("assignment-maintenance")?.estado).toBe("ok");

    const alertas = porNombre.get("alert-engine");
    expect(alertas?.estado).toBe("fallido");
    expect(alertas?.ultimoError).toBe("Prisma: P1001");
    // Se conserva la constancia de cuándo fue la última vez que sí salió bien.
    expect(alertas?.ultimoExitoEn).toBe(ejecucion("alert-engine", 5, true).startedAt.toISOString());

    const fx = porNombre.get("fx-sync");
    expect(fx?.estado).toBe("obsoleto");
    expect(fx?.antiguedadExitoSegundos).toBe(100 * 3600);
    expect(fx?.ultimoError).toBeNull();

    expect(frescura.estado).toBe("degradado");
  });

  it("toma el ÚLTIMO intento, no el primero ni el último por orden de inserción", async () => {
    // Se insertan desordenados a propósito: el más reciente es el del medio.
    await registrarEjecucion(prisma, ejecucion("fx-sync", 10, true));
    await registrarEjecucion(prisma, ejecucion("fx-sync", 0.5, false, "el más reciente"));
    await registrarEjecucion(prisma, ejecucion("fx-sync", 30, false, "uno viejo"));

    const frescura = await obtenerFrescura(prisma, AHORA);
    const fx = frescura.trabajos.find((t) => t.nombre === "fx-sync");

    expect(fx?.estado).toBe("fallido");
    expect(fx?.ultimoError).toBe("el más reciente");
  });

  it("GET /api/jobs/status expone la frescura persistida a un ADMIN", async () => {
    await registrarEjecucion(prisma, ejecucion("alert-engine", 0.1, false, "boom"));

    const res = await app.inject({
      method: "GET",
      url: "/api/jobs/status",
      headers: comoRol(AppRole.ADMIN),
    });

    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.estadoTrabajos).toBe("degradado");

    const alertas = data.trabajos.find((t: { nombre: string }) => t.nombre === "alert-engine");
    expect(alertas).toMatchObject({ estado: "fallido", ultimoError: "boom" });

    const fx = data.trabajos.find((t: { nombre: string }) => t.nombre === "fx-sync");
    expect(fx).toMatchObject({ estado: "nunca", ultimoIntentoEn: null });
  });
});

describe("/health informa de los trabajos pero NUNCA se cae por ellos", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await crearAppDePrueba();
  });

  afterAll(async () => {
    await limpiarJobRuns();
    await app.close();
  });

  it("con todos los trabajos sin correr, sigue respondiendo 200", async () => {
    await limpiarJobRuns();

    const res = await app.inject({ method: "GET", url: "/health" });

    // Este es el criterio que no se puede romper: Render reinicia el servicio
    // ante un 503, y un trabajo obsoleto no se arregla reiniciando.
    expect(res.statusCode).toBe(200);
    const cuerpo = res.json();
    expect(cuerpo.ok).toBe(true);
    expect(cuerpo.database).toBe("up");
    expect(cuerpo.jobs.estado).toBe("degradado");
    expect(cuerpo.jobs.trabajos.every((t: { estado: string }) => t.estado === "nunca")).toBe(true);
  });

  it("tras un ciclo real, /health muestra los trabajos del ciclo al día", async () => {
    await limpiarJobRuns();
    await app.inject({ method: "POST", url: "/api/jobs/run", headers: comoRol(AppRole.ADMIN) });
    invalidarCacheFrescura();

    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(200);
    const trabajos: { nombre: string; estado: string }[] = res.json().jobs.trabajos;
    expect(trabajos.find((t) => t.nombre === "assignment-maintenance")?.estado).toBe("ok");
    expect(trabajos.find((t) => t.nombre === "alert-engine")?.estado).toBe("ok");
    expect(trabajos.find((t) => t.nombre === "approval-digest")?.estado).toBe("ok");
    // fx-sync no entra en el ciclo: lo dispara su propio cron.
    expect(trabajos.find((t) => t.nombre === "fx-sync")?.estado).toBe("nunca");
  });

  it("no exige autenticación ni filtra nada más que el estado de los trabajos", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json()).sort()).toEqual([
      "database",
      "jobs",
      "ok",
      "service",
      "timestamp",
    ]);
  });

  it("NO publica el mensaje de error de un trabajo: /health es público", async () => {
    await limpiarJobRuns();
    await registrarEjecucion(prisma, {
      ...ejecucion("alert-engine", 0.1, false),
      error: "postgresql://postgres:secreto@interno:5432/app — connection refused",
    });
    invalidarCacheFrescura();

    const res = await app.inject({ method: "GET", url: "/health" });
    const cuerpo = res.json();

    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(cuerpo)).not.toContain("secreto");
    const alertas = cuerpo.jobs.trabajos.find(
      (t: { nombre: string }) => t.nombre === "alert-engine",
    );
    // El estado sí se ve: lo que no se filtra es el detalle interno.
    expect(alertas.estado).toBe("fallido");
    expect(alertas.ultimoError).toBeUndefined();

    // Pero un ADMIN sí puede leer el error completo por el endpoint protegido.
    const protegido = await app.inject({
      method: "GET",
      url: "/api/jobs/status",
      headers: comoRol(AppRole.ADMIN),
    });
    const detalle = protegido.json().data.trabajos.find(
      (t: { nombre: string }) => t.nombre === "alert-engine",
    );
    expect(detalle.ultimoError).toContain("connection refused");
  });
});

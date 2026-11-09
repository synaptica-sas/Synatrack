import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/infra/prisma.js";
import { runFxSyncDiario } from "../../src/modules/fx/fx-sync.service.js";
import { invalidarCacheFrescura } from "../../src/modules/jobs/job-runs.service.js";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";

/**
 * Sincronización FX dentro del ciclo (Azure, `FX_SYNC_IN_CYCLE=true`): la
 * compuerta diaria lee el historial REAL de `JobRun`. Lo que importa probar
 * contra la base es la convivencia con `POST /api/fx/sync` (cron de Render o
 * botón del frontend): si esa vía ya sincronizó hoy, el ciclo no repite.
 *
 * `fetch` se simula: estas pruebas nunca salen a internet.
 */

const TASAS = { COP: 4000, EUR: 0.9, MXN: 18, PEN: 3.7, CLP: 950 };

function respuestaProveedor() {
  return new Response(JSON.stringify({ rates: TASAS }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("runFxSyncDiario (compuerta diaria sobre JobRun)", () => {
  let app: FastifyInstance;
  let inicio: Date;
  let tasasOriginales: Awaited<ReturnType<typeof prisma.fxConfig.findMany>>;
  const fetchFalso = vi.fn(async () => respuestaProveedor());

  beforeAll(async () => {
    app = await crearAppDePrueba();
    inicio = new Date();
    // Otras pruebas dependen de las tasas USD sembradas: se guardan y se restauran.
    tasasOriginales = await prisma.fxConfig.findMany({ where: { baseCode: "USD" } });
    vi.stubGlobal("fetch", fetchFalso);
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await prisma.fxRateHistory.deleteMany({
      where: { source: "auto:exchangerate-api", createdAt: { gte: inicio } },
    });
    await prisma.fxConfig.deleteMany({ where: { baseCode: "USD" } });
    if (tasasOriginales.length > 0) await prisma.fxConfig.createMany({ data: tasasOriginales });
    await prisma.jobRun.deleteMany({ where: { jobName: "fx-sync" } });
    invalidarCacheFrescura();
    await app.close();
  });

  beforeEach(async () => {
    fetchFalso.mockClear();
    await prisma.jobRun.deleteMany({ where: { jobName: "fx-sync" } });
  });

  it("sin historial, sincroniza", async () => {
    const resultado = await runFxSyncDiario(prisma);

    expect(resultado).toMatchObject({ updated: ["COP", "EUR", "MXN", "PEN", "CLP"], failed: [] });
    expect(fetchFalso).toHaveBeenCalledTimes(1);
    const cop = await prisma.fxConfig.findFirstOrThrow({ where: { baseCode: "USD", quoteCode: "COP" } });
    expect(Number(cop.rate)).toBe(4000);
  });

  it("si POST /api/fx/sync ya sincronizó hoy, el ciclo no repite ni llama al proveedor", async () => {
    const res = await app.inject({ method: "POST", url: "/api/fx/sync", headers: comoRol(AppRole.ADMIN) });
    expect(res.statusCode).toBe(200);
    expect(fetchFalso).toHaveBeenCalledTimes(1);

    const resultado = await runFxSyncDiario(prisma);

    expect(resultado).toMatchObject({ omitido: true });
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it("un éxito de AYER no bloquea la sincronización de hoy", async () => {
    const ayer = new Date(Date.now() - 26 * 60 * 60 * 1000);
    await prisma.jobRun.create({
      data: { jobName: "fx-sync", origin: "http", startedAt: ayer, finishedAt: ayer, durationMs: 10, ok: true },
    });

    const resultado = await runFxSyncDiario(prisma);

    expect(resultado).not.toMatchObject({ omitido: true });
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });
});

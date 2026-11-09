import type { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// El servicio solo lee `env.JOBS_INTERVAL_MINUTES` como valor por defecto; se
// simula para no depender de un `.env` real al correr las pruebas unitarias.
// `FX_SYNC_IN_CYCLE` se cambia en las pruebas de FX; el objeto es el mismo que
// lee el servicio, así que basta con mutarlo.
const envFalso: { JOBS_INTERVAL_MINUTES: number; FX_SYNC_IN_CYCLE?: boolean } = { JOBS_INTERVAL_MINUTES: 0 };
vi.mock("../../../config/env.js", () => ({
  env: envFalso,
}));

const mantenimientoAsignaciones = vi.fn<() => Promise<void>>();
const motorDeAlertas = vi.fn<() => Promise<void>>();
const resumenSemanal = vi.fn<() => Promise<void>>();
const alertasCapacity = vi.fn<() => Promise<void>>();
const resumenCapacity = vi.fn<() => Promise<void>>();

vi.mock("../../assignments/assignments.job.js", () => ({
  runAssignmentMaintenance: () => mantenimientoAsignaciones(),
}));

vi.mock("../../alerts/alerts.service.js", () => ({
  runAlertEngine: () => motorDeAlertas(),
}));

vi.mock("../../approvals/weekly-digest.job.js", () => ({
  runWeeklyApprovalDigest: () => resumenSemanal(),
}));

vi.mock("../../capacity/capacity-alerts.service.js", () => ({
  runCapacityAlerts: () => alertasCapacity(),
}));

vi.mock("../../capacity/capacity-digest.service.js", () => ({
  runCapacityDigest: () => resumenCapacity(),
}));

const fxDiario = vi.fn<() => Promise<unknown>>();
vi.mock("../../fx/fx-sync.service.js", () => ({
  JOB_FX_SYNC: "fx-sync",
  runFxSyncDiario: () => fxDiario(),
}));

// El registro persistente se simula: aquí solo interesa QUÉ se manda a guardar.
// Que la fila llegue de verdad a `JobRun` se prueba en `tests/routes/`.
const registrarEjecucion = vi.fn<(...args: unknown[]) => Promise<boolean>>();

vi.mock("../job-runs.service.js", () => ({
  registrarEjecucion: (...args: unknown[]) => registrarEjecucion(...args),
}));

const {
  hayCicloEnCurso,
  runMaintenanceCycle,
  startJobsScheduler,
  stopJobsScheduler,
} = await import("../jobs.service.js");

// Los trabajos reciben el cliente Prisma pero aquí están simulados: nunca lo usan.
const prismaFalso = {} as PrismaClient;

/** Promesa que se resuelve desde fuera, para congelar un trabajo a voluntad. */
function promesaControlada() {
  let resolver: () => void = () => {};
  const promesa = new Promise<void>((resolve) => {
    resolver = resolve;
  });
  return { promesa, resolver: () => resolver() };
}

describe("runMaintenanceCycle", () => {
  beforeEach(() => {
    mantenimientoAsignaciones.mockReset().mockResolvedValue(undefined);
    motorDeAlertas.mockReset().mockResolvedValue(undefined);
    resumenSemanal.mockReset().mockResolvedValue(undefined);
    alertasCapacity.mockReset().mockResolvedValue(undefined);
    resumenCapacity.mockReset().mockResolvedValue(undefined);
    registrarEjecucion.mockReset().mockResolvedValue(true);
    stopJobsScheduler();
  });

  it("ejecuta los cinco trabajos y reporta duración y resultado", async () => {
    const resultado = await runMaintenanceCycle(prismaFalso, "http");

    expect(resultado.omitido).toBe(false);
    expect(resultado.origen).toBe("http");
    expect(resultado.trabajos.map((t) => t.nombre)).toEqual([
      "assignment-maintenance",
      "alert-engine",
      // El resumen semanal de aprobaciones (R-020 + R-022) corre el último: solo
      // observa, así que un fallo suyo no debe retrasar el mantenimiento.
      "approval-digest",
      "capacity-alerts",
      "capacity-digest",
    ]);
    expect(resultado.trabajos.every((t) => t.ok)).toBe(true);
    expect(resultado.duracionMs).toBeGreaterThanOrEqual(0);
    expect(mantenimientoAsignaciones).toHaveBeenCalledTimes(1);
    expect(motorDeAlertas).toHaveBeenCalledTimes(1);
    expect(resumenSemanal).toHaveBeenCalledTimes(1);
  });

  it("NO solapa ejecuciones: el segundo ciclo se omite mientras el primero corre", async () => {
    const bloqueo = promesaControlada();
    mantenimientoAsignaciones.mockReturnValue(bloqueo.promesa);

    const primero = runMaintenanceCycle(prismaFalso, "intervalo");
    // Ceder el turno al bucle de eventos para que el primer ciclo tome el cerrojo.
    await Promise.resolve();
    expect(hayCicloEnCurso()).toBe(true);

    const segundo = await runMaintenanceCycle(prismaFalso, "http");
    expect(segundo.omitido).toBe(true);
    expect(segundo.trabajos).toHaveLength(0);
    // El trabajo del segundo ciclo no llegó a ejecutarse.
    expect(mantenimientoAsignaciones).toHaveBeenCalledTimes(1);

    bloqueo.resolver();
    const resultadoPrimero = await primero;

    expect(resultadoPrimero.omitido).toBe(false);
    expect(hayCicloEnCurso()).toBe(false);
  });

  it("libera el cerrojo aunque un trabajo falle, y el otro se ejecuta igual", async () => {
    mantenimientoAsignaciones.mockRejectedValue(new Error("base caída"));

    const resultado = await runMaintenanceCycle(prismaFalso, "arranque");

    expect(resultado.omitido).toBe(false);
    expect(resultado.trabajos[0]).toMatchObject({
      nombre: "assignment-maintenance",
      ok: false,
      error: "base caída",
    });
    expect(resultado.trabajos[1]).toMatchObject({ nombre: "alert-engine", ok: true });
    // El segundo trabajo corrió pese al fallo del primero.
    expect(motorDeAlertas).toHaveBeenCalledTimes(1);
    expect(hayCicloEnCurso()).toBe(false);
  });

  it("deja rastro persistente de cada trabajo, con el error del que falló", async () => {
    mantenimientoAsignaciones.mockRejectedValue(new Error("base caída"));

    await runMaintenanceCycle(prismaFalso, "intervalo");

    expect(registrarEjecucion).toHaveBeenCalledTimes(5);

    const [, fallido] = registrarEjecucion.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(fallido).toMatchObject({
      jobName: "assignment-maintenance",
      origin: "intervalo",
      ok: false,
      error: "base caída",
    });
    expect(fallido.startedAt).toBeInstanceOf(Date);
    expect(fallido.finishedAt).toBeInstanceOf(Date);

    const [, correcto] = registrarEjecucion.mock.calls[1] as [unknown, Record<string, unknown>];
    expect(correcto).toMatchObject({ jobName: "alert-engine", origin: "intervalo", ok: true });
    expect(correcto.error).toBeUndefined();

    const [, resumen] = registrarEjecucion.mock.calls[2] as [unknown, Record<string, unknown>];
    expect(resumen).toMatchObject({ jobName: "approval-digest", origin: "intervalo", ok: true });
  });

  it("si no se puede guardar el rastro, el ciclo termina igual (observar no rompe lo observado)", async () => {
    registrarEjecucion.mockRejectedValue(new Error("JobRun no existe"));

    const resultado = await runMaintenanceCycle(prismaFalso, "http");

    // El fallo al registrar se contabiliza contra el trabajo, pero ni tumba el
    // ciclo ni impide que el siguiente trabajo corra, y el cerrojo se libera.
    expect(resultado.omitido).toBe(false);
    expect(resultado.trabajos).toHaveLength(5);
    expect(motorDeAlertas).toHaveBeenCalledTimes(1);
    expect(hayCicloEnCurso()).toBe(false);
  });
});

describe("runMaintenanceCycle con FX en el ciclo", () => {
  beforeEach(() => {
    mantenimientoAsignaciones.mockReset().mockResolvedValue(undefined);
    motorDeAlertas.mockReset().mockResolvedValue(undefined);
    resumenSemanal.mockReset().mockResolvedValue(undefined);
    alertasCapacity.mockReset().mockResolvedValue(undefined);
    resumenCapacity.mockReset().mockResolvedValue(undefined);
    registrarEjecucion.mockReset().mockResolvedValue(true);
    fxDiario.mockReset();
    envFalso.FX_SYNC_IN_CYCLE = true;
  });

  afterEach(() => {
    envFalso.FX_SYNC_IN_CYCLE = undefined;
  });

  it("sin FX_SYNC_IN_CYCLE, fx-sync no entra en el ciclo (Render)", async () => {
    envFalso.FX_SYNC_IN_CYCLE = false;
    const resultado = await runMaintenanceCycle(prismaFalso, "intervalo");
    expect(resultado.trabajos.map((t) => t.nombre)).not.toContain("fx-sync");
    expect(fxDiario).not.toHaveBeenCalled();
  });

  it("con la compuerta abierta, sincroniza y deja rastro en JobRun", async () => {
    fxDiario.mockResolvedValue({ updated: ["COP"], failed: [] });
    const resultado = await runMaintenanceCycle(prismaFalso, "intervalo");

    expect(resultado.trabajos.at(-1)).toMatchObject({ nombre: "fx-sync", ok: true });
    expect(resultado.trabajos.at(-1)?.omitido).toBeUndefined();
    const nombres = registrarEjecucion.mock.calls.map(([, e]) => (e as { jobName: string }).jobName);
    expect(nombres).toContain("fx-sync");
  });

  it("si la compuerta lo omite, NO escribe en JobRun (no cuenta como éxito)", async () => {
    fxDiario.mockResolvedValue({ omitido: true, motivo: "Ya hubo una sincronización correcta hoy (UTC)" });
    const resultado = await runMaintenanceCycle(prismaFalso, "intervalo");

    expect(resultado.trabajos.at(-1)).toMatchObject({ nombre: "fx-sync", ok: true, omitido: true });
    const nombres = registrarEjecucion.mock.calls.map(([, e]) => (e as { jobName: string }).jobName);
    expect(nombres).not.toContain("fx-sync");
    expect(registrarEjecucion).toHaveBeenCalledTimes(5);
  });

  it("si falla, se registra como ok=false y el ciclo termina igual", async () => {
    fxDiario.mockRejectedValue(new Error("Sin tasa para: CLP"));
    const resultado = await runMaintenanceCycle(prismaFalso, "intervalo");

    expect(resultado.trabajos.at(-1)).toMatchObject({ nombre: "fx-sync", ok: false, error: "Sin tasa para: CLP" });
    const fx = registrarEjecucion.mock.calls
      .map(([, e]) => e as { jobName: string; ok: boolean })
      .find((e) => e.jobName === "fx-sync");
    expect(fx).toMatchObject({ ok: false });
    expect(hayCicloEnCurso()).toBe(false);
  });
});

describe("startJobsScheduler", () => {
  beforeEach(() => {
    mantenimientoAsignaciones.mockReset().mockResolvedValue(undefined);
    motorDeAlertas.mockReset().mockResolvedValue(undefined);
    resumenSemanal.mockReset().mockResolvedValue(undefined);
    stopJobsScheduler();
  });

  it("queda apagado con 0 minutos", () => {
    expect(startJobsScheduler(prismaFalso, 0)).toBe(false);
  });

  it("dispara un ciclo cada intervalo y se puede detener", async () => {
    vi.useFakeTimers();
    try {
      expect(startJobsScheduler(prismaFalso, 1)).toBe(true);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(mantenimientoAsignaciones).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(mantenimientoAsignaciones).toHaveBeenCalledTimes(2);

      stopJobsScheduler();
      await vi.advanceTimersByTimeAsync(180_000);
      expect(mantenimientoAsignaciones).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("no arranca un segundo temporizador si ya hay uno activo", () => {
    expect(startJobsScheduler(prismaFalso, 5)).toBe(true);
    expect(startJobsScheduler(prismaFalso, 5)).toBe(true);
    stopJobsScheduler();
  });
});

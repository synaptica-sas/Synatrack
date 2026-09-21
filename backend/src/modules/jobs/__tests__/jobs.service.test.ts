import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

// El servicio solo lee `env.JOBS_INTERVAL_MINUTES` como valor por defecto; se
// simula para no depender de un `.env` real al correr las pruebas unitarias.
vi.mock("../../../config/env.js", () => ({
  env: { JOBS_INTERVAL_MINUTES: 0 },
}));

const mantenimientoAsignaciones = vi.fn<() => Promise<void>>();
const motorDeAlertas = vi.fn<() => Promise<void>>();

vi.mock("../../assignments/assignments.job.js", () => ({
  runAssignmentMaintenance: () => mantenimientoAsignaciones(),
}));

vi.mock("../../alerts/alerts.service.js", () => ({
  runAlertEngine: () => motorDeAlertas(),
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
    stopJobsScheduler();
  });

  it("ejecuta los dos trabajos y reporta duración y resultado", async () => {
    const resultado = await runMaintenanceCycle(prismaFalso, "http");

    expect(resultado.omitido).toBe(false);
    expect(resultado.origen).toBe("http");
    expect(resultado.trabajos.map((t) => t.nombre)).toEqual([
      "assignment-maintenance",
      "alert-engine",
    ]);
    expect(resultado.trabajos.every((t) => t.ok)).toBe(true);
    expect(resultado.duracionMs).toBeGreaterThanOrEqual(0);
    expect(mantenimientoAsignaciones).toHaveBeenCalledTimes(1);
    expect(motorDeAlertas).toHaveBeenCalledTimes(1);
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
});

describe("startJobsScheduler", () => {
  beforeEach(() => {
    mantenimientoAsignaciones.mockReset().mockResolvedValue(undefined);
    motorDeAlertas.mockReset().mockResolvedValue(undefined);
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

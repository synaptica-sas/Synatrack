import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/infra/prisma.js";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";
import { crearEscenarioBasico, limpiarEscenario, type EscenarioBasico } from "../helpers/datos.js";

/**
 * Franja horaria de un registro de horas (`startedAt` / `endedAt`).
 *
 * La ventana "Editar tiempo" del timesheet deja poner inicio y fin además de la
 * duración. El backend guarda la franja tal cual y solo exige que el fin vaya
 * después del inicio, también cuando se edita uno solo de los dos extremos.
 */
describe("Franja horaria de /api/time-entries", () => {
  let app: FastifyInstance;
  let escenario: EscenarioBasico;

  const como = () => comoRol(AppRole.CONSULTANT, escenario.consultorA.email);

  beforeAll(async () => {
    app = await crearAppDePrueba();
    escenario = await crearEscenarioBasico("te-franja");
  });

  afterAll(async () => {
    await limpiarEscenario(escenario);
    await app.close();
  });

  beforeEach(async () => {
    await prisma.timeEntry.deleteMany({ where: { consultantId: escenario.consultorA.id } });
  });

  async function crear(body: Record<string, unknown>) {
    return app.inject({
      method: "POST",
      url: "/api/time-entries",
      headers: como(),
      payload: { projectId: escenario.projectId, workDate: "2026-09-28", hours: 1, ...body },
    });
  }

  it("guarda inicio y fin al crear", async () => {
    const res = await crear({
      startedAt: "2026-09-28T14:00:00.000Z",
      endedAt: "2026-09-28T15:00:00.000Z",
    });

    expect(res.statusCode).toBe(201);
    const { data } = res.json() as { data: { startedAt: string; endedAt: string } };
    expect(data.startedAt).toBe("2026-09-28T14:00:00.000Z");
    expect(data.endedAt).toBe("2026-09-28T15:00:00.000Z");
  });

  it("sin franja, inicio y fin quedan vacíos", async () => {
    const res = await crear({});

    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({ startedAt: null, endedAt: null });
  });

  it("rechaza un fin anterior o igual al inicio", async () => {
    const res = await crear({
      startedAt: "2026-09-28T15:00:00.000Z",
      endedAt: "2026-09-28T15:00:00.000Z",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/posterior/);
  });

  it("al editar, valida la franja combinada con la que ya tenía", async () => {
    const creada = await crear({
      startedAt: "2026-09-28T14:00:00.000Z",
      endedAt: "2026-09-28T15:00:00.000Z",
    });
    const id = creada.json().data.id as string;

    // Solo cambia el fin, y queda antes del inicio guardado.
    const mal = await app.inject({
      method: "PATCH",
      url: `/api/time-entries/${id}`,
      headers: como(),
      payload: { endedAt: "2026-09-28T13:00:00.000Z" },
    });
    expect(mal.statusCode).toBe(400);

    const bien = await app.inject({
      method: "PATCH",
      url: `/api/time-entries/${id}`,
      headers: como(),
      payload: { hours: 2, endedAt: "2026-09-28T16:00:00.000Z" },
    });
    expect(bien.statusCode).toBe(200);
    expect(bien.json().data.endedAt).toBe("2026-09-28T16:00:00.000Z");
  });

  it("al editar se puede quitar la franja", async () => {
    const creada = await crear({
      startedAt: "2026-09-28T14:00:00.000Z",
      endedAt: "2026-09-28T15:00:00.000Z",
    });
    const id = creada.json().data.id as string;

    const res = await app.inject({
      method: "PATCH",
      url: `/api/time-entries/${id}`,
      headers: como(),
      payload: { startedAt: null, endedAt: null },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ startedAt: null, endedAt: null });
  });
});

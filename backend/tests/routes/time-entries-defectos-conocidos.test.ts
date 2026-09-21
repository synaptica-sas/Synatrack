import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/infra/prisma.js";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";
import { crearEscenarioBasico, limpiarEscenario, type EscenarioBasico } from "../helpers/datos.js";

/**
 * ⚠ DEFECTOS CONOCIDOS — ESTAS PRUEBAS DOCUMENTAN LO QUE HOY PASA, NO LO DESEADO.
 *
 * Las aserciones de abajo afirman el comportamiento ACTUAL de `/api/time-entries`,
 * que es inseguro. Están aquí para dejar constancia verificable del defecto antes
 * de arreglarlo (el arreglo va en otra rama).
 *
 * Cuando se corrija, estas pruebas DEBEN INVERTIRSE:
 *   - «devuelve las horas de todos»            -> debe devolver solo las propias.
 *   - «expone consultant.hourlyRate ajeno»     -> no debe exponer tarifas ajenas.
 *   - «acepta el consultantId de otro»         -> debe responder 403.
 *
 * Referencias: CLAUDE.md §7 (hallazgos del 2026-09-18) y
 * `src/modules/time-entries/time-entries.routes.ts`.
 */
describe("time-entries: defectos conocidos pendientes de arreglo", () => {
  let app: FastifyInstance;
  let escenario: EscenarioBasico;

  beforeAll(async () => {
    app = await crearAppDePrueba();
    escenario = await crearEscenarioBasico("te");

    await prisma.timeEntry.create({
      data: {
        projectId: escenario.projectId,
        consultantId: escenario.consultorA.id,
        workDate: new Date(Date.UTC(2026, 2, 10)),
        hours: 4,
      },
    });
    await prisma.timeEntry.create({
      data: {
        projectId: escenario.projectId,
        consultantId: escenario.consultorB.id,
        workDate: new Date(Date.UTC(2026, 2, 11)),
        hours: 6,
      },
    });
  });

  afterAll(async () => {
    await limpiarEscenario(escenario);
    await app.close();
  });

  it("DEFECTO: GET /api/time-entries devuelve a un CONSULTANT también las horas de OTROS consultores", async () => {
    // Comportamiento esperado tras el arreglo: solo las del propio consultor.
    const res = await app.inject({
      method: "GET",
      url: "/api/time-entries",
      headers: comoRol(AppRole.CONSULTANT, escenario.consultorA.email),
    });

    expect(res.statusCode).toBe(200);
    const filas = res.json().data as Array<{ consultantId: string }>;
    const ids = filas.map((fila) => fila.consultantId);

    expect(ids).toContain(escenario.consultorA.id);
    // ⚠ Esto es el defecto: ve las de B.
    expect(ids).toContain(escenario.consultorB.id);
  });

  it("DEFECTO: GET /api/time-entries expone consultant.hourlyRate de toda la plantilla a un CONSULTANT", async () => {
    // Comportamiento esperado tras el arreglo: la tarifa ajena no debe viajar al cliente.
    const res = await app.inject({
      method: "GET",
      url: "/api/time-entries",
      headers: comoRol(AppRole.CONSULTANT, escenario.consultorA.email),
    });

    expect(res.statusCode).toBe(200);
    const filas = res.json().data as Array<{
      consultantId: string;
      consultant?: { hourlyRate?: string | null };
    }>;
    const ajena = filas.find((fila) => fila.consultantId === escenario.consultorB.id);

    expect(ajena).toBeDefined();
    // ⚠ Esto es el defecto: la tarifa de otro consultor llega al cliente.
    expect(Number(ajena?.consultant?.hourlyRate)).toBe(999);
  });

  it("DEFECTO: POST /api/time-entries deja a un CONSULTANT registrar horas con el consultantId de OTRO (suplantación)", async () => {
    // Comportamiento esperado tras el arreglo: 403 si el consultantId no es el suyo.
    const res = await app.inject({
      method: "POST",
      url: "/api/time-entries",
      headers: comoRol(AppRole.CONSULTANT, escenario.consultorA.email),
      payload: {
        projectId: escenario.projectId,
        consultantId: escenario.consultorB.id, // ¡no es el suyo!
        workDate: "2026-03-12",
        hours: 3,
        note: "Registrada por A a nombre de B",
      },
    });

    // ⚠ Esto es el defecto: la API lo acepta.
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({ consultantId: escenario.consultorB.id });
  });
});

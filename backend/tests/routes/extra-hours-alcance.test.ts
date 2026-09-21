import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";
import {
  crearEscenarioBasico,
  crearHoraExtra,
  limpiarEscenario,
  type EscenarioBasico,
} from "../helpers/datos.js";

/**
 * REFERENCIA DEL PATRÓN CORRECTO.
 *
 * `GET /api/extra-hours` sí filtra por rol: un CONSULTANT solo ve las horas
 * extra cuyo consultor tiene su mismo correo. Es el comportamiento que
 * `GET /api/time-entries` debería imitar (ver `time-entries-defectos-conocidos.test.ts`).
 */
describe("GET /api/extra-hours filtra por rol (comportamiento correcto)", () => {
  let app: FastifyInstance;
  let escenario: EscenarioBasico;

  beforeAll(async () => {
    app = await crearAppDePrueba();
    escenario = await crearEscenarioBasico("eh");
    await crearHoraExtra({
      consultantId: escenario.consultorA.id,
      projectId: escenario.projectId,
      fecha: new Date(Date.UTC(2026, 2, 10)),
    });
    await crearHoraExtra({
      consultantId: escenario.consultorB.id,
      projectId: escenario.projectId,
      fecha: new Date(Date.UTC(2026, 2, 11)),
    });
  });

  afterAll(async () => {
    await limpiarEscenario(escenario);
    await app.close();
  });

  it("un CONSULTANT solo recibe sus propias horas extra", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/extra-hours",
      headers: comoRol(AppRole.CONSULTANT, escenario.consultorA.email),
    });

    expect(res.statusCode).toBe(200);
    const propias = res.json().data as Array<{ consultantId: string }>;
    const ajenas = propias.filter((fila) => fila.consultantId !== escenario.consultorA.id);

    expect(ajenas).toHaveLength(0);
    expect(propias.some((fila) => fila.consultantId === escenario.consultorA.id)).toBe(true);
  });

  it("un ADMIN recibe las de ambos consultores", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/extra-hours",
      headers: comoRol(AppRole.ADMIN),
    });

    expect(res.statusCode).toBe(200);
    const ids = (res.json().data as Array<{ consultantId: string }>).map((f) => f.consultantId);

    expect(ids).toContain(escenario.consultorA.id);
    expect(ids).toContain(escenario.consultorB.id);
  });
});

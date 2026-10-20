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
 * `GET /api/extra-hours` filtra por rol: un CONSULTANT solo ve las horas
 * extra de su propio consultor enlazado (`request.authUser.consultantId`),
 * igual que `GET /api/time-entries`.
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

describe("POST /api/extra-hours: no se puede registrar a nombre de otro", () => {
  let app: FastifyInstance;
  let escenario: EscenarioBasico;

  beforeAll(async () => {
    app = await crearAppDePrueba();
    escenario = await crearEscenarioBasico("eh-self");
  });

  afterAll(async () => {
    await limpiarEscenario(escenario);
    await app.close();
  });

  function cuerpo(consultantId: string, date: string) {
    return {
      projectId: escenario.projectId,
      consultantId,
      date,
      startTime: "19:00",
      endTime: "21:00",
      observations: "Prueba de enlace",
    };
  }

  // Un CONSULTANT (no ADMIN/PM) no puede solicitar horas extra para un día ya
  // pasado -- ver la validación de fecha más abajo en la ruta -- así que las
  // pruebas de autoreporte usan una fecha futura; las de ADMIN/PM (que sí
  // pueden registrar días pasados) no necesitan ese cuidado.
  const fechaFutura = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  it("un CONSULTANT que manda el consultantId de otro recibe 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/extra-hours",
      headers: comoRol(AppRole.CONSULTANT, escenario.consultorA.email),
      payload: cuerpo(escenario.consultorB.id, fechaFutura),
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().message).toContain("propio nombre");
  });

  it("un CONSULTANT registrando a su propio nombre sí puede", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/extra-hours",
      headers: comoRol(AppRole.CONSULTANT, escenario.consultorA.email),
      payload: cuerpo(escenario.consultorA.id, fechaFutura),
    });

    expect(res.statusCode).toBe(201);
  });

  it("ADMIN y PM sí pueden registrar a nombre de otro", async () => {
    const fechas: Record<string, string> = { [AppRole.ADMIN]: "2026-05-07", [AppRole.PM]: "2026-05-08" };
    for (const rol of [AppRole.ADMIN, AppRole.PM] as const) {
      const res = await app.inject({
        method: "POST",
        url: "/api/extra-hours",
        headers: comoRol(rol),
        payload: cuerpo(escenario.consultorB.id, fechas[rol]),
      });
      expect(res.statusCode, rol).toBe(201);
    }
  });
});

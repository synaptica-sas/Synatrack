import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/infra/prisma.js";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";
import {
  crearActividad,
  crearEscenarioBasico,
  limpiarEscenario,
  type EscenarioBasico,
} from "../helpers/datos.js";

/**
 * EL CRONÓMETRO (`/api/timer`) ES PERSONAL.
 *
 * Cada consultor tiene como mucho un cronómetro en marcha, solo ve el suyo, y
 * al detenerlo las horas se imputan a quien lo arrancó. ADMIN y PM sí pueden
 * manejarlo a nombre de otra persona, que es un flujo legítimo de la PMO; el
 * resto de roles queda atado al propio.
 *
 * Procede de `src/modules/__tests__/roles.integration.test.ts`. Allí vivía
 * dentro de `src/`, por lo que `npm test` (cálculo puro, sin base de datos) la
 * recogía y escribía contra la `DATABASE_URL` de desarrollo.
 */
describe("/api/timer: alcance y propiedad", () => {
  let app: FastifyInstance;
  let escenario: EscenarioBasico;
  let actividadA: string;
  let actividadB: string;

  function comoA(rol: AppRole) {
    return comoRol(rol, escenario.consultorA.email);
  }

  function comoB(rol: AppRole) {
    return comoRol(rol, escenario.consultorB.email);
  }

  async function borrarCronometros() {
    await prisma.runningTimer.deleteMany({
      where: { consultantId: { in: [escenario.consultorA.id, escenario.consultorB.id] } },
    });
  }

  beforeAll(async () => {
    app = await crearAppDePrueba();
    escenario = await crearEscenarioBasico("timer");

    const [a, b] = await Promise.all([
      crearActividad({
        consultantId: escenario.consultorA.id,
        projectId: escenario.projectId,
        titulo: `Tarea de A ${escenario.prefijo}`,
        fecha: new Date(Date.UTC(2026, 8, 21)),
      }),
      crearActividad({
        consultantId: escenario.consultorB.id,
        projectId: escenario.projectId,
        titulo: `Tarea de B ${escenario.prefijo}`,
        fecha: new Date(Date.UTC(2026, 8, 21)),
      }),
    ]);
    actividadA = a.id;
    actividadB = b.id;
  });

  afterAll(async () => {
    // El orden importa: RunningTimer y TimeEntry referencian a Consultant.
    await borrarCronometros();
    await limpiarEscenario(escenario);
    await app.close();
  });

  beforeEach(async () => {
    await borrarCronometros();
    await prisma.timeEntry.deleteMany({
      where: { consultantId: { in: [escenario.consultorA.id, escenario.consultorB.id] } },
    });
  });

  describe("Quién puede arrancarlo", () => {
    it.each([
      [AppRole.ADMIN, true],
      [AppRole.PM, true],
      [AppRole.CONSULTANT, true],
      [AppRole.FINANCE, false],
      [AppRole.VIEWER, false],
    ] as const)("%s arrancando el cronómetro: permitido=%s", async (rol, permitido) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/timer/start",
        headers: comoA(rol),
        payload: { projectId: escenario.projectId },
      });

      expect(res.statusCode).toBe(permitido ? 201 : 403);
    });
  });

  describe("El cronómetro es personal", () => {
    it("cada consultor ve el suyo y no el del otro", async () => {
      await app.inject({
        method: "POST",
        url: "/api/timer/start",
        headers: comoA(AppRole.CONSULTANT),
        payload: { projectId: escenario.projectId, description: "lo de A" },
      });

      const deB = await app.inject({
        method: "GET",
        url: "/api/timer",
        headers: comoB(AppRole.CONSULTANT),
      });
      expect(deB.json().data).toBeNull();

      const deA = await app.inject({
        method: "GET",
        url: "/api/timer",
        headers: comoA(AppRole.CONSULTANT),
      });
      expect(deA.json().data.description).toBe("lo de A");
    });

    it("no se pueden tener dos cronómetros a la vez", async () => {
      const primero = await app.inject({
        method: "POST",
        url: "/api/timer/start",
        headers: comoA(AppRole.CONSULTANT),
        payload: { projectId: escenario.projectId },
      });
      const segundo = await app.inject({
        method: "POST",
        url: "/api/timer/start",
        headers: comoA(AppRole.CONSULTANT),
        payload: { projectId: escenario.projectId },
      });

      expect(primero.statusCode).toBe(201);
      expect(segundo.statusCode).toBe(409);
    });

    it("al detenerlo, las horas quedan a nombre de quien lo arrancó y PENDIENTES", async () => {
      await app.inject({
        method: "POST",
        url: "/api/timer/start",
        headers: comoA(AppRole.CONSULTANT),
        payload: { projectId: escenario.projectId, description: "tarea" },
      });

      const parado = await app.inject({
        method: "POST",
        url: "/api/timer/stop",
        headers: comoA(AppRole.CONSULTANT),
      });

      expect(parado.statusCode).toBe(201);
      expect(parado.json().data.consultantId).toBe(escenario.consultorA.id);
      expect(parado.json().data.status).toBe("PENDING");
      expect(parado.json().data.source).toBe("TIMER");
    });

    it("no se puede enganchar el cronómetro a una tarea de otro consultor", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/timer/start",
        headers: comoA(AppRole.CONSULTANT),
        payload: { projectId: escenario.projectId, activityId: actividadB },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain("no existe o no pertenece");
    });

    it("sí se puede enganchar a una tarea propia", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/timer/start",
        headers: comoA(AppRole.CONSULTANT),
        payload: { projectId: escenario.projectId, activityId: actividadA },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().data.activityId).toBe(actividadA);
    });

    it("un usuario sin ficha de consultor no tiene cronómetro, pero la consulta no falla", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/timer",
        headers: comoRol(AppRole.CONSULTANT, `fantasma.${escenario.prefijo}@synaptica.test`),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data).toBeNull();
    });
  });

  describe("Llevar el cronómetro a nombre de otro consultor", () => {
    it("un ADMIN lo arranca, lo consulta, lo edita y lo detiene para otra persona", async () => {
      const arrancado = await app.inject({
        method: "POST",
        url: "/api/timer/start",
        headers: comoA(AppRole.ADMIN),
        payload: {
          projectId: escenario.projectId,
          consultantId: escenario.consultorB.id,
          description: "trabajo de B",
        },
      });
      expect(arrancado.statusCode).toBe(201);
      expect(arrancado.json().data.consultantId).toBe(escenario.consultorB.id);

      // Sin el consultantId vería el suyo, que no está en marcha.
      const propio = await app.inject({ method: "GET", url: "/api/timer", headers: comoA(AppRole.ADMIN) });
      expect(propio.json().data).toBeNull();

      const visto = await app.inject({
        method: "GET",
        url: `/api/timer?consultantId=${escenario.consultorB.id}`,
        headers: comoA(AppRole.ADMIN),
      });
      expect(visto.json().data.description).toBe("trabajo de B");

      const editado = await app.inject({
        method: "PATCH",
        url: "/api/timer",
        headers: comoA(AppRole.ADMIN),
        payload: { consultantId: escenario.consultorB.id, description: "corregido" },
      });
      expect(editado.json().data.description).toBe("corregido");

      const parado = await app.inject({
        method: "POST",
        url: "/api/timer/stop",
        headers: comoA(AppRole.ADMIN),
        payload: { consultantId: escenario.consultorB.id },
      });
      expect(parado.statusCode).toBe(201);
      // Lo esencial: las horas se le cuentan a B, no a quien manejó el cronómetro.
      expect(parado.json().data.consultantId).toBe(escenario.consultorB.id);
    });

    it("un CONSULTANT no puede arrancarlo a nombre de otro", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/timer/start",
        headers: comoA(AppRole.CONSULTANT),
        payload: { projectId: escenario.projectId, consultantId: escenario.consultorB.id },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain("tu propio nombre");
      expect(
        await prisma.runningTimer.findUnique({ where: { consultantId: escenario.consultorB.id } }),
      ).toBeNull();
    });

    it("un CONSULTANT tampoco puede detener el cronómetro de otro", async () => {
      await app.inject({
        method: "POST",
        url: "/api/timer/start",
        headers: comoA(AppRole.ADMIN),
        payload: { projectId: escenario.projectId, consultantId: escenario.consultorB.id },
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/timer/stop",
        headers: comoA(AppRole.CONSULTANT),
        payload: { consultantId: escenario.consultorB.id },
      });

      // Se rechaza de forma explícita en vez de resolver al cronómetro propio:
      // así queda claro que no se detuvo el de nadie.
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain("tu propio nombre");
      expect(
        await prisma.runningTimer.findUnique({ where: { consultantId: escenario.consultorB.id } }),
      ).not.toBeNull();
    });

    it("descartar el de otro tampoco está al alcance de un CONSULTANT", async () => {
      await app.inject({
        method: "POST",
        url: "/api/timer/start",
        headers: comoA(AppRole.ADMIN),
        payload: { projectId: escenario.projectId, consultantId: escenario.consultorB.id },
      });

      const comoConsultor = await app.inject({
        method: "DELETE",
        url: `/api/timer?consultantId=${escenario.consultorB.id}`,
        headers: comoA(AppRole.CONSULTANT),
      });
      expect(comoConsultor.statusCode).toBe(400);

      const comoAdmin = await app.inject({
        method: "DELETE",
        url: `/api/timer?consultantId=${escenario.consultorB.id}`,
        headers: comoA(AppRole.ADMIN),
      });
      expect(comoAdmin.statusCode).toBe(204);
    });

    it("dos consultores pueden tener su propio cronómetro a la vez", async () => {
      const deA = await app.inject({
        method: "POST",
        url: "/api/timer/start",
        headers: comoA(AppRole.ADMIN),
        payload: { projectId: escenario.projectId, consultantId: escenario.consultorA.id },
      });
      const deB = await app.inject({
        method: "POST",
        url: "/api/timer/start",
        headers: comoA(AppRole.ADMIN),
        payload: { projectId: escenario.projectId, consultantId: escenario.consultorB.id },
      });
      // Pero un segundo para el mismo consultor sigue estando prohibido.
      const repetido = await app.inject({
        method: "POST",
        url: "/api/timer/start",
        headers: comoA(AppRole.ADMIN),
        payload: { projectId: escenario.projectId, consultantId: escenario.consultorB.id },
      });

      expect(deA.statusCode).toBe(201);
      expect(deB.statusCode).toBe(201);
      expect(repetido.statusCode).toBe(409);
    });
  });
});

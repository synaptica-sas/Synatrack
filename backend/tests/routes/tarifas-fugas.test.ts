import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";
import {
  crearActividad,
  crearAsignacion,
  crearEscenarioBasico,
  crearHoraExtra,
  limpiarEscenario,
  type EscenarioBasico,
} from "../helpers/datos.js";

/**
 * DEP-38: las tarifas dejan de salir de la base para quien no debe verlas.
 *
 * R5 cerró esta fuga en `GET /api/time-entries` con un `select` de Prisma.
 * Aquí se comprueba el mismo recorte en las rutas que seguían entregando el
 * consultor completo, y el equivalente derivado en `capacity` (donde la tarifa
 * no viaja en crudo, pero `estimatedCost / committedHours` la devuelve exacta).
 *
 * El consultor B del escenario tiene una tarifa "marcada" (999.77) que no debe
 * aparecer en ninguna parte del cuerpo crudo de la respuesta.
 */
const TARIFA_MARCADA = "999.77";
const CAMPOS_SENSIBLES = ["hourlyRate", "costPerMonth", "identification"] as const;

describe("DEP-38: fugas de tarifas en las rutas que quedaban", () => {
  let app: FastifyInstance;
  let escenario: EscenarioBasico;

  beforeAll(async () => {
    app = await crearAppDePrueba();
    escenario = await crearEscenarioBasico("tarifas");

    await crearHoraExtra({
      consultantId: escenario.consultorB.id,
      projectId: escenario.projectId,
      fecha: new Date(Date.UTC(2026, 5, 10)),
    });
    await crearActividad({
      consultantId: escenario.consultorB.id,
      projectId: escenario.projectId,
      titulo: `Actividad ${escenario.prefijo}`,
      fecha: new Date(Date.UTC(2026, 5, 11)),
    });
    await crearAsignacion({
      consultantId: escenario.consultorB.id,
      projectId: escenario.projectId,
      desde: new Date(Date.UTC(2026, 5, 1)),
      hasta: new Date(Date.UTC(2026, 5, 30)),
    });
  });

  afterAll(async () => {
    await limpiarEscenario(escenario);
    await app.close();
  });

  describe("GET /api/extra-hours", () => {
    it("un VIEWER recibe las filas pero sin tarifa, costo ni documento del consultor", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/extra-hours",
        headers: comoRol(AppRole.VIEWER, "viewer@synaptica.test"),
      });

      expect(res.statusCode).toBe(200);
      const filas = res.json().data as Array<{ consultant: Record<string, unknown> }>;
      const propias = filas.filter((f) => (f.consultant as { id: string }).id === escenario.consultorB.id);

      expect(propias.length).toBeGreaterThan(0);
      for (const fila of propias) {
        for (const campo of CAMPOS_SENSIBLES) {
          expect(fila.consultant).not.toHaveProperty(campo);
        }
        expect(fila.consultant).toHaveProperty("fullName");
      }
      expect(res.body).not.toContain(TARIFA_MARCADA);
    });

    it("un ADMIN sigue recibiendo la tarifa: el recorte no se aplicó de más", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/extra-hours",
        headers: comoRol(AppRole.ADMIN),
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain(TARIFA_MARCADA);
    });

    it("un FINANCE también, porque la nómina la necesita", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/extra-hours",
        headers: comoRol(AppRole.FINANCE, "nomina@synaptica.test"),
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain(TARIFA_MARCADA);
    });
  });

  describe("GET /api/consultants", () => {
    it("un VIEWER recibe la plantilla sin tarifa, costo ni documento", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/consultants",
        headers: comoRol(AppRole.VIEWER, "viewer@synaptica.test"),
      });

      expect(res.statusCode).toBe(200);
      const filas = res.json().data as Array<Record<string, unknown>>;
      const consultorB = filas.find((c) => c.id === escenario.consultorB.id);

      expect(consultorB).toBeDefined();
      for (const campo of CAMPOS_SENSIBLES) {
        expect(consultorB).not.toHaveProperty(campo);
      }
      expect(consultorB).toHaveProperty("fullName");
      expect(res.body).not.toContain(TARIFA_MARCADA);
    });

    it("un CONSULTANT tampoco recibe las tarifas de la plantilla", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/consultants",
        headers: comoRol(AppRole.CONSULTANT, escenario.consultorA.email),
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain(TARIFA_MARCADA);
    });

    it("un PM sí, porque gestiona el equipo", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/consultants",
        headers: comoRol(AppRole.PM, "pm@synaptica.test"),
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain(TARIFA_MARCADA);
    });
  });

  describe("GET /api/activities", () => {
    it("un VIEWER ve las actividades sin los datos sensibles del consultor", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/activities",
        headers: comoRol(AppRole.VIEWER, "viewer@synaptica.test"),
      });

      expect(res.statusCode).toBe(200);
      const filas = res.json().data as Array<{ consultantId: string; consultant: Record<string, unknown> }>;
      const propias = filas.filter((f) => f.consultantId === escenario.consultorB.id);

      expect(propias.length).toBeGreaterThan(0);
      for (const fila of propias) {
        for (const campo of CAMPOS_SENSIBLES) {
          expect(fila.consultant).not.toHaveProperty(campo);
        }
      }
      expect(res.body).not.toContain(TARIFA_MARCADA);
    });

    it("un ADMIN sigue viendo la tarifa", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/activities",
        headers: comoRol(AppRole.ADMIN),
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain(TARIFA_MARCADA);
    });
  });

  describe("GET /api/capacity/by-project (costo derivado)", () => {
    it("un VIEWER recibe el costo estimado en null, no un número del que despejar la tarifa", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/capacity/by-project?from=2026-06-01&to=2026-06-30",
        headers: comoRol(AppRole.VIEWER, "viewer@synaptica.test"),
      });

      expect(res.statusCode).toBe(200);
      const proyectos = res.json().data as Array<{
        projectId: string;
        totalEstimatedCost: number | null;
        consultants: Array<{ consultantId: string; committedHours: number; estimatedCost: number | null }>;
      }>;
      const proyecto = proyectos.find((p) => p.projectId === escenario.projectId);

      expect(proyecto).toBeDefined();
      expect(proyecto!.totalEstimatedCost).toBeNull();
      for (const fila of proyecto!.consultants) {
        expect(fila.estimatedCost).toBeNull();
      }
      expect(res.body).not.toContain(TARIFA_MARCADA);
    });

    it("un ADMIN sí recibe el costo estimado", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/capacity/by-project?from=2026-06-01&to=2026-06-30",
        headers: comoRol(AppRole.ADMIN),
      });

      expect(res.statusCode).toBe(200);
      const proyectos = res.json().data as Array<{
        projectId: string;
        totalEstimatedCost: number | null;
        consultants: Array<{ estimatedCost: number | null }>;
      }>;
      const proyecto = proyectos.find((p) => p.projectId === escenario.projectId);

      expect(proyecto).toBeDefined();
      expect(typeof proyecto!.totalEstimatedCost).toBe("number");
      expect(proyecto!.totalEstimatedCost).toBeGreaterThan(0);
    });
  });

  describe("GET /api/capacity/project/:projectId (costo derivado)", () => {
    it("un VIEWER recibe null en el costo estimado y en el resumen", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/capacity/project/${escenario.projectId}?from=2026-06-01&to=2026-06-30`,
        headers: comoRol(AppRole.VIEWER, "viewer@synaptica.test"),
      });

      expect(res.statusCode).toBe(200);
      const data = res.json().data as {
        consultants: Array<{ estimatedCost: number | null }>;
        summary: { totalEstimatedCost: number | null };
      };

      expect(data.consultants.length).toBeGreaterThan(0);
      for (const fila of data.consultants) {
        expect(fila.estimatedCost).toBeNull();
      }
      expect(data.summary.totalEstimatedCost).toBeNull();
      expect(res.body).not.toContain(TARIFA_MARCADA);
    });

    it("un ADMIN recibe el costo estimado calculado", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/capacity/project/${escenario.projectId}?from=2026-06-01&to=2026-06-30`,
        headers: comoRol(AppRole.ADMIN),
      });

      expect(res.statusCode).toBe(200);
      const data = res.json().data as { summary: { totalEstimatedCost: number | null } };

      expect(typeof data.summary.totalEstimatedCost).toBe("number");
      expect(data.summary.totalEstimatedCost).toBeGreaterThan(0);
    });
  });

  describe("GET /api/assignments (revisada, sin cambios)", () => {
    it("ya entregaba el consultor con un select acotado: no hay tarifa que recortar", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/assignments",
        headers: comoRol(AppRole.VIEWER, "viewer@synaptica.test"),
      });

      expect(res.statusCode).toBe(200);
      const filas = res.json().data as Array<{ consultantId: string; consultant: Record<string, unknown> }>;
      const propia = filas.find((f) => f.consultantId === escenario.consultorB.id);

      expect(propia).toBeDefined();
      for (const campo of CAMPOS_SENSIBLES) {
        expect(propia!.consultant).not.toHaveProperty(campo);
      }
      expect(res.body).not.toContain(TARIFA_MARCADA);
    });
  });
});

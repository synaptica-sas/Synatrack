import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/infra/prisma.js";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";
import { crearEscenarioBasico, limpiarEscenario, type EscenarioBasico } from "../helpers/datos.js";

/**
 * ALCANCE POR ROL DE `/api/time-entries` (comportamiento CORRECTO).
 *
 * Este archivo sustituye a `time-entries-defectos-conocidos.test.ts`, que en la
 * rama `feat/pruebas-de-rol` afirmaba el comportamiento inseguro para dejarlo
 * documentado. Las tres pruebas con prefijo `DEFECTO:` están aquí invertidas:
 * ahora comprueban lo que debe pasar tras el arreglo de `fix/seguridad-datos`.
 *
 * Reglas que se fijan aquí (mismo patrón que `extra-hours`):
 *   - ADMIN      ve todas las horas, con la tarifa del consultor.
 *   - PM         ve las suyas + las de los proyectos que gestiona.
 *   - VIEWER     ve todas, pero SIN datos sensibles del consultor
 *                (`hourlyRate`, `costPerMonth`, `identification`).
 *   - CONSULTANT ve solo las suyas y solo puede registrar a su propio nombre.
 *   - `approvedBy` sale del token, nunca del cuerpo.
 */
describe("GET /api/time-entries: alcance por rol", () => {
  let app: FastifyInstance;
  let escenario: EscenarioBasico;
  let proyectoAjenoId: string;

  beforeAll(async () => {
    app = await crearAppDePrueba();
    escenario = await crearEscenarioBasico("te");

    // Segundo proyecto, gestionado por OTRO PM: sirve para demostrar que el PM
    // del primer proyecto no ve lo que no le corresponde.
    const proyectoAjeno = await prisma.project.create({
      data: {
        name: `Proyecto ajeno ${escenario.prefijo}`,
        company: "Synaptica",
        country: "Colombia",
        currency: "USD",
        budget: 5000,
        startDate: new Date(Date.UTC(2026, 0, 1)),
        endDate: new Date(Date.UTC(2026, 11, 31)),
        projectManagerEmail: `otro.pm.${escenario.prefijo}@synaptica.test`,
      },
    });
    proyectoAjenoId = proyectoAjeno.id;

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
    // Horas de B en el proyecto ajeno: el PM del proyecto principal NO debe verlas.
    await prisma.timeEntry.create({
      data: {
        projectId: proyectoAjenoId,
        consultantId: escenario.consultorB.id,
        workDate: new Date(Date.UTC(2026, 2, 12)),
        hours: 2,
      },
    });
  });

  afterAll(async () => {
    await prisma.timeEntry.deleteMany({ where: { projectId: proyectoAjenoId } });
    await prisma.project.deleteMany({ where: { id: proyectoAjenoId } });
    await limpiarEscenario(escenario);
    await app.close();
  });

  it("un CONSULTANT solo recibe sus propias horas, nunca las de otro consultor", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/time-entries",
      headers: comoRol(AppRole.CONSULTANT, escenario.consultorA.email),
    });

    expect(res.statusCode).toBe(200);
    const filas = res.json().data as Array<{ consultantId: string }>;
    const ids = filas.map((fila) => fila.consultantId);

    expect(ids).toContain(escenario.consultorA.id);
    expect(ids).not.toContain(escenario.consultorB.id);
  });

  it("un CONSULTANT no recibe la tarifa de ningún otro consultor", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/time-entries",
      headers: comoRol(AppRole.CONSULTANT, escenario.consultorA.email),
    });

    expect(res.statusCode).toBe(200);
    // La tarifa de B es 999. No debe aparecer en ninguna parte de la respuesta.
    expect(res.body).not.toContain("999");

    const filas = res.json().data as Array<{
      consultantId: string;
      consultant?: { hourlyRate?: string | null };
    }>;
    expect(filas.find((fila) => fila.consultantId === escenario.consultorB.id)).toBeUndefined();
    // La suya sí la ve: es su propio dato.
    const propia = filas.find((fila) => fila.consultantId === escenario.consultorA.id);
    expect(Number(propia?.consultant?.hourlyRate)).toBe(40);
  });

  it("un VIEWER ve todas las horas pero sin los datos sensibles del consultor", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/time-entries",
      headers: comoRol(AppRole.VIEWER, "viewer@synaptica.test"),
    });

    expect(res.statusCode).toBe(200);
    const filas = res.json().data as Array<{
      consultantId: string;
      consultant?: Record<string, unknown>;
    }>;
    const ids = filas.map((fila) => fila.consultantId);

    expect(ids).toContain(escenario.consultorA.id);
    expect(ids).toContain(escenario.consultorB.id);

    const delEscenario = filas.filter((fila) =>
      [escenario.consultorA.id, escenario.consultorB.id].includes(fila.consultantId),
    );
    expect(delEscenario.length).toBeGreaterThan(0);
    for (const fila of delEscenario) {
      expect(fila.consultant).toBeDefined();
      expect(fila.consultant).not.toHaveProperty("hourlyRate");
      expect(fila.consultant).not.toHaveProperty("costPerMonth");
      expect(fila.consultant).not.toHaveProperty("identification");
      // Lo que sí necesita la pantalla sigue llegando.
      expect(fila.consultant).toHaveProperty("fullName");
    }
    expect(res.body).not.toContain("999");
  });

  it("un PM ve las horas de los proyectos que gestiona y no las de otros proyectos", async () => {
    const pmEmail = `pm.${escenario.prefijo}@synaptica.test`;
    const res = await app.inject({
      method: "GET",
      url: "/api/time-entries",
      headers: comoRol(AppRole.PM, pmEmail),
    });

    expect(res.statusCode).toBe(200);
    const filas = res.json().data as Array<{ projectId: string; consultantId: string }>;

    // Ve las de su proyecto, de ambos consultores.
    const suProyecto = filas.filter((fila) => fila.projectId === escenario.projectId);
    expect(suProyecto.map((fila) => fila.consultantId)).toContain(escenario.consultorA.id);
    expect(suProyecto.map((fila) => fila.consultantId)).toContain(escenario.consultorB.id);

    // No ve las del proyecto que gestiona otro PM.
    expect(filas.some((fila) => fila.projectId === proyectoAjenoId)).toBe(false);
  });

  it("un ADMIN sigue viendo todas las horas con la tarifa del consultor", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/time-entries",
      headers: comoRol(AppRole.ADMIN),
    });

    expect(res.statusCode).toBe(200);
    const filas = res.json().data as Array<{
      projectId: string;
      consultantId: string;
      consultant?: { hourlyRate?: string | null };
    }>;

    expect(filas.some((fila) => fila.projectId === proyectoAjenoId)).toBe(true);
    const ajena = filas.find((fila) => fila.consultantId === escenario.consultorB.id);
    expect(Number(ajena?.consultant?.hourlyRate)).toBe(999);
  });
});

describe("POST /api/time-entries: no se puede registrar a nombre de otro", () => {
  let app: FastifyInstance;
  let escenario: EscenarioBasico;

  beforeAll(async () => {
    app = await crearAppDePrueba();
    escenario = await crearEscenarioBasico("te-post");
  });

  afterAll(async () => {
    await limpiarEscenario(escenario);
    await app.close();
  });

  it("un CONSULTANT que usa el consultantId de OTRO recibe 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/time-entries",
      headers: comoRol(AppRole.CONSULTANT, escenario.consultorA.email),
      payload: {
        projectId: escenario.projectId,
        consultantId: escenario.consultorB.id, // ¡no es el suyo!
        workDate: "2026-03-12",
        hours: 3,
        note: "Intento de suplantación",
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().message).toBe("Solo puedes registrar horas a tu propio nombre.");

    const creadas = await prisma.timeEntry.count({
      where: { consultantId: escenario.consultorB.id },
    });
    expect(creadas).toBe(0);
  });

  it("un CONSULTANT sí puede registrar sus propias horas", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/time-entries",
      headers: comoRol(AppRole.CONSULTANT, escenario.consultorA.email),
      payload: {
        projectId: escenario.projectId,
        consultantId: escenario.consultorA.id,
        workDate: "2026-03-13",
        hours: 3,
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({ consultantId: escenario.consultorA.id });
  });

  it("un CONSULTANT sin ficha de consultor recibe un 403 con un mensaje claro", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/time-entries",
      headers: comoRol(AppRole.CONSULTANT, `fantasma.${escenario.prefijo}@synaptica.test`),
      payload: {
        projectId: escenario.projectId,
        consultantId: escenario.consultorA.id,
        workDate: "2026-03-14",
        hours: 1,
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().message).toContain("No hay un consultor asociado al correo");
  });

  it("un PM sí puede registrar horas a nombre de otro consultor", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/time-entries",
      headers: comoRol(AppRole.PM, `pm.${escenario.prefijo}@synaptica.test`),
      payload: {
        projectId: escenario.projectId,
        consultantId: escenario.consultorB.id,
        workDate: "2026-03-15",
        hours: 5,
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({ consultantId: escenario.consultorB.id });
  });
});

describe("PATCH /api/time-entries/:id: approvedBy sale del token", () => {
  let app: FastifyInstance;
  let escenario: EscenarioBasico;

  beforeAll(async () => {
    app = await crearAppDePrueba();
    escenario = await crearEscenarioBasico("te-rev");
  });

  afterAll(async () => {
    await limpiarEscenario(escenario);
    await app.close();
  });

  async function crearHoraPendiente(dia: number) {
    return prisma.timeEntry.create({
      data: {
        projectId: escenario.projectId,
        consultantId: escenario.consultorA.id,
        workDate: new Date(Date.UTC(2026, 3, dia)),
        hours: 4,
      },
    });
  }

  it("al aprobar guarda el correo del token aunque el cliente mande otro approvedBy", async () => {
    const entrada = await crearHoraPendiente(1);
    const pmEmail = `pm.${escenario.prefijo}@synaptica.test`;

    const res = await app.inject({
      method: "PATCH",
      url: `/api/time-entries/${entrada.id}/approve`,
      headers: comoRol(AppRole.PM, pmEmail),
      payload: { approvedBy: "Director General Falsificado" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.approvedBy).toBe(pmEmail);

    const enBase = await prisma.timeEntry.findUniqueOrThrow({ where: { id: entrada.id } });
    expect(enBase.approvedBy).toBe(pmEmail);
  });

  it("al rechazar guarda el correo del token y conserva el motivo del cliente", async () => {
    const entrada = await crearHoraPendiente(2);
    const pmEmail = `pm.${escenario.prefijo}@synaptica.test`;

    const res = await app.inject({
      method: "PATCH",
      url: `/api/time-entries/${entrada.id}/reject`,
      headers: comoRol(AppRole.PM, pmEmail),
      payload: { approvedBy: "Otra Persona", rejectionNote: "Horas duplicadas" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.approvedBy).toBe(pmEmail);
    expect(res.json().data.rejectionNote).toBe("Horas duplicadas");
  });

  it("aprobar sin cuerpo funciona: el endpoint ya no exige approvedBy", async () => {
    const entrada = await crearHoraPendiente(3);

    const res = await app.inject({
      method: "PATCH",
      url: `/api/time-entries/${entrada.id}/approve`,
      headers: comoRol(AppRole.ADMIN),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.approvedBy).toBe("admin@synaptica.local");
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { prisma } from "../../src/infra/prisma.js";

/**
 * Las horas reales de una actividad se calculan sumando los registros de horas
 * enlazados a ella, en vez de escribirse a mano.
 *
 * Antes eran dos contabilidades del mismo trabajo sin nada que las conciliara:
 * se podían anotar 8 h en la actividad y 0 en el timesheet, y el informe, la
 * capacidad y el coste del proyecto no se enteraban.
 */

const RUN = `act-${Date.now()}`;
const EMAIL = `${RUN}@test.local`;

let app: FastifyInstance;
let projectId: string;
let consultantId: string;
let activityId: string;

/** Cabeceras del simulador de rol que usa el resto de pruebas de ruta. */
const como = (roles: string) => ({ "x-dev-email": EMAIL, "x-dev-roles": roles });

beforeAll(async () => {
  app = await buildApp();
  await app.ready();

  const project = await prisma.project.create({
    data: {
      name: `${RUN} Proyecto`,
      company: "Test",
      country: "Colombia",
      currency: "USD",
      budget: 1000,
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
    },
  });
  projectId = project.id;

  const consultant = await prisma.consultant.create({
    data: { fullName: `${RUN} Consultor`, email: EMAIL, role: "Consultor" },
  });
  consultantId = consultant.id;
});

afterAll(async () => {
  await prisma.timeEntry.deleteMany({ where: { consultantId } });
  await prisma.activity.deleteMany({ where: { consultantId } });
  await prisma.consultant.deleteMany({ where: { id: consultantId } });
  await prisma.project.deleteMany({ where: { id: projectId } });
  await app.close();
});

beforeEach(async () => {
  await prisma.timeEntry.deleteMany({ where: { consultantId } });
  await prisma.activity.deleteMany({ where: { consultantId } });

  const activity = await prisma.activity.create({
    data: {
      title: `${RUN} tarea`,
      consultantId,
      projectId,
      scheduledDate: new Date("2026-09-30"),
      estimatedHours: 10,
    },
  });
  activityId = activity.id;
});

/** Registra horas contra la actividad, saltándose la API. */
async function registrar(hours: number, status: "PENDING" | "APPROVED" | "REJECTED" = "PENDING") {
  return prisma.timeEntry.create({
    data: {
      projectId,
      consultantId,
      activityId,
      workDate: new Date("2026-09-30T00:00:00.000Z"),
      hours,
      status,
    },
  });
}

/** Lee la actividad por la API y devuelve sus horas reales como número. */
async function horasReales() {
  const res = await app.inject({
    method: "GET",
    url: `/api/activities?consultantId=${consultantId}`,
    headers: como("ADMIN"),
  });
  expect(res.statusCode).toBe(200);
  const activity = res.json().data.find((a: { id: string }) => a.id === activityId);
  return Number(activity.actualHours);
}

describe("Las horas reales de una actividad salen de las horas registradas", () => {
  it("una actividad sin horas registradas tiene cero, no lo que mande el cliente", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/activities",
      headers: como("ADMIN"),
      payload: {
        title: `${RUN} inventada`,
        consultantId,
        projectId,
        activityType: "project",
        scheduledDate: "2026-09-30T00:00:00.000Z",
        estimatedHours: 10,
        actualHours: 99, // debe ignorarse
        status: "pending",
        priority: "medium",
      },
    });

    expect(res.statusCode).toBe(201);
    expect(Number(res.json().data.actualHours)).toBe(0);
  });

  it("suma las horas enlazadas, vengan del timesheet o del cronómetro", async () => {
    await registrar(3);
    await registrar(2.5);

    expect(await horasReales()).toBe(5.5);
  });

  it("las horas rechazadas no cuentan como trabajo hecho", async () => {
    await registrar(3, "REJECTED");
    await registrar(2.5);

    expect(await horasReales()).toBe(2.5);
  });

  it("las pendientes sí cuentan: el trabajo ya ocurrió", async () => {
    await registrar(4, "PENDING");

    expect(await horasReales()).toBe(4);
  });

  it("al borrar las horas, el total de la actividad baja solo", async () => {
    const entry = await registrar(6);
    expect(await horasReales()).toBe(6);

    await prisma.timeEntry.delete({ where: { id: entry.id } });
    expect(await horasReales()).toBe(0);
  });

  it("las horas de OTRA actividad no se cuelan", async () => {
    const otra = await prisma.activity.create({
      data: {
        title: `${RUN} otra`,
        consultantId,
        projectId,
        scheduledDate: new Date("2026-09-30"),
        estimatedHours: 5,
      },
    });
    await prisma.timeEntry.create({
      data: {
        projectId,
        consultantId,
        activityId: otra.id,
        workDate: new Date("2026-09-30T00:00:00.000Z"),
        hours: 7,
      },
    });
    await registrar(2);

    expect(await horasReales()).toBe(2);
  });

  it("las horas sin actividad enlazada no se suman a ninguna", async () => {
    await prisma.timeEntry.create({
      data: {
        projectId,
        consultantId,
        workDate: new Date("2026-09-30T00:00:00.000Z"),
        hours: 8,
      },
    });

    expect(await horasReales()).toBe(0);
  });
});

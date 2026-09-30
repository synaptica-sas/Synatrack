import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { prisma } from "../../src/infra/prisma.js";

/**
 * Autocompletado y fusión de tareas del timesheet.
 *
 * La grilla crea una fila por cada descripción distinta, y como la descripción
 * es texto libre, cada errata abría una fila nueva. El autocompletado evita
 * que pase; la fusión arregla lo que ya pasó.
 */

const RUN = `tarea-${Date.now()}`;
const EMAIL_A = `${RUN}-ana@test.local`;
const EMAIL_B = `${RUN}-beto@test.local`;

let app: FastifyInstance;
let projectId: string;
let otroProyecto: string;
let ana: string;
let beto: string;

const como = (roles: string, email = EMAIL_A) => ({ "x-dev-email": email, "x-dev-roles": roles });

async function registrar(
  consultantId: string,
  description: string | null,
  opts: { hours?: number; day?: string; status?: "PENDING" | "APPROVED"; project?: string } = {},
) {
  return prisma.timeEntry.create({
    data: {
      projectId: opts.project ?? projectId,
      consultantId,
      description,
      workDate: new Date(`${opts.day ?? "2026-09-30"}T00:00:00.000Z`),
      hours: opts.hours ?? 1,
      status: opts.status ?? "PENDING",
    },
  });
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();

  const base = {
    company: "Test",
    country: "Colombia",
    currency: "USD",
    budget: 1000,
    startDate: new Date("2026-01-01"),
    endDate: new Date("2026-12-31"),
  };
  projectId = (await prisma.project.create({ data: { ...base, name: `${RUN} P1` } })).id;
  otroProyecto = (await prisma.project.create({ data: { ...base, name: `${RUN} P2` } })).id;

  ana = (await prisma.consultant.create({ data: { fullName: `${RUN} Ana`, email: EMAIL_A, role: "Consultor" } })).id;
  beto = (await prisma.consultant.create({ data: { fullName: `${RUN} Beto`, email: EMAIL_B, role: "Consultor" } })).id;
});

afterAll(async () => {
  await prisma.timeEntry.deleteMany({ where: { consultantId: { in: [ana, beto] } } });
  await prisma.monthlySnapshot.deleteMany({ where: { projectId: { in: [projectId, otroProyecto] } } });
  await prisma.consultant.deleteMany({ where: { id: { in: [ana, beto] } } });
  await prisma.project.deleteMany({ where: { id: { in: [projectId, otroProyecto] } } });
  await app.close();
});

beforeEach(async () => {
  await prisma.timeEntry.deleteMany({ where: { consultantId: { in: [ana, beto] } } });
  await prisma.monthlySnapshot.deleteMany({ where: { projectId: { in: [projectId, otroProyecto] } } });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/time-entries/descriptions", () => {
  it("sugiere las tareas ya usadas, sin repetir mayúsculas", async () => {
    await registrar(ana, "Revisión de código");
    await registrar(ana, "revisión de código");
    await registrar(ana, "Reunión");

    const res = await app.inject({
      method: "GET",
      url: `/api/time-entries/descriptions?projectId=${projectId}`,
      headers: como("CONSULTANT"),
    });

    expect(res.statusCode).toBe(200);
    const nombres = res.json().data.map((d: { description: string }) => d.description.toLowerCase());
    expect(nombres).toHaveLength(2);
    expect(new Set(nombres)).toEqual(new Set(["revisión de código", "reunión"]));
  });

  it("filtra por proyecto", async () => {
    await registrar(ana, "Solo en P1");
    await registrar(ana, "Solo en P2", { project: otroProyecto });

    const res = await app.inject({
      method: "GET",
      url: `/api/time-entries/descriptions?projectId=${projectId}`,
      headers: como("CONSULTANT"),
    });

    const nombres = res.json().data.map((d: { description: string }) => d.description);
    expect(nombres).toContain("Solo en P1");
    expect(nombres).not.toContain("Solo en P2");
  });

  it("no sugiere descripciones vacías", async () => {
    await registrar(ana, null);
    await registrar(ana, "");
    await registrar(ana, "Algo");

    const res = await app.inject({
      method: "GET",
      url: `/api/time-entries/descriptions?projectId=${projectId}`,
      headers: como("CONSULTANT"),
    });

    expect(res.json().data.map((d: { description: string }) => d.description)).toEqual(["Algo"]);
  });

  it("un consultor no puede ver las tareas de otro", async () => {
    await registrar(beto, "Tarea privada de Beto");

    const res = await app.inject({
      method: "GET",
      url: `/api/time-entries/descriptions?consultantId=${beto}`,
      headers: como("CONSULTANT"),
    });

    expect(res.statusCode).toBe(403);
  });

  it("un ADMIN sí puede ver las de otro", async () => {
    await registrar(beto, "Tarea de Beto");

    const res = await app.inject({
      method: "GET",
      url: `/api/time-entries/descriptions?consultantId=${beto}`,
      headers: como("ADMIN"),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.map((d: { description: string }) => d.description)).toContain("Tarea de Beto");
  });
});

describe("POST /api/time-entries/merge-task", () => {
  const fusionar = (from: string, to: string, roles = "CONSULTANT", extra: Record<string, unknown> = {}) =>
    app.inject({
      method: "POST",
      url: "/api/time-entries/merge-task",
      headers: como(roles),
      payload: {
        projectId,
        from: { description: from, activityId: null },
        to: { description: to, activityId: null },
        ...extra,
      },
    });

  it("pasa todas las horas de la errata a la tarea buena, también de otras semanas", async () => {
    await registrar(ana, "tarena de prueba", { day: "2026-09-30" });
    await registrar(ana, "Tarena de prueba", { day: "2026-09-16" }); // dos semanas antes
    await registrar(ana, "tarea");

    const res = await fusionar("tarena de prueba", "tarea");
    expect(res.statusCode).toBe(200);
    expect(res.json().data.merged).toBe(2);

    const quedan = await prisma.timeEntry.count({
      where: { consultantId: ana, description: { equals: "tarena de prueba", mode: "insensitive" } },
    });
    expect(quedan).toBe(0);
    expect(await prisma.timeEntry.count({ where: { consultantId: ana, description: "tarea" } })).toBe(3);
  });

  it("no cambia las horas, solo el nombre", async () => {
    const e = await registrar(ana, "errata", { hours: 3.5 });
    await fusionar("errata", "bien");

    const tras = await prisma.timeEntry.findUniqueOrThrow({ where: { id: e.id } });
    expect(Number(tras.hours)).toBe(3.5);
    expect(tras.description).toBe("bien");
  });

  it("no toca meses cerrados", async () => {
    await registrar(ana, "errata", { day: "2026-08-10" });
    await registrar(ana, "errata", { day: "2026-09-30" });
    await prisma.monthlySnapshot.create({
      data: {
        projectId,
        year: 2026,
        month: 8,
        baseCurrency: "USD",
        laborCostActual: 0,
        expensesActual: 0,
        totalCostActual: 0,
        revenueRecognized: 0,
        contractValue: 0,
        grossMargin: 0,
        grossMarginPct: 0,
        hoursApproved: 0,
        fxSnapshotJson: {},
        closedBy: "test",
      },
    });

    const res = await fusionar("errata", "bien");
    expect(res.json().data).toMatchObject({ merged: 1, skippedClosedMonth: 1 });
  });

  it("un consultor no reetiqueta horas ya aprobadas; un ADMIN sí", async () => {
    await registrar(ana, "errata", { status: "APPROVED" });
    await registrar(ana, "errata", { status: "PENDING" });

    const comoConsultor = await fusionar("errata", "bien");
    expect(comoConsultor.json().data).toMatchObject({ merged: 1, skippedReviewed: 1 });

    const comoAdmin = await fusionar("errata", "bien", "ADMIN", { consultantId: ana });
    expect(comoAdmin.json().data).toMatchObject({ merged: 1, skippedReviewed: 0 });
  });

  it("no fusiona una tarea consigo misma", async () => {
    const res = await fusionar("Tarea", "tarea");
    expect(res.statusCode).toBe(400);
  });

  it("un consultor no puede fusionar tareas de otro", async () => {
    await registrar(beto, "errata de Beto");

    const res = await fusionar("errata de Beto", "bien", "CONSULTANT", { consultantId: beto });
    expect(res.statusCode).toBe(403);
    expect(await prisma.timeEntry.count({ where: { consultantId: beto, description: "errata de Beto" } })).toBe(1);
  });

  it("no toca las horas de otros consultores con la misma descripción", async () => {
    await registrar(ana, "errata");
    await registrar(beto, "errata");

    await fusionar("errata", "bien");

    expect(await prisma.timeEntry.count({ where: { consultantId: beto, description: "errata" } })).toBe(1);
  });
});

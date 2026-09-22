import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { AppRole } from "@prisma/client";

/**
 * Pruebas de integración del control de acceso del Timesheet y el Tracker.
 *
 * Se inyectan peticiones reales contra la app de Fastify (rutas, validación de
 * Zod y consultas a la base incluidas) sustituyendo únicamente `authenticate`,
 * que en producción valida un token de Azure AD. `authorize` y toda la lógica
 * de negocio se ejecutan de verdad: es justamente lo que se quiere comprobar.
 *
 * Los datos se crean con un sufijo único por ejecución y se borran al final,
 * de modo que la prueba es segura contra cualquier base de datos.
 */

const state = vi.hoisted(() => ({
  user: null as { id: string; email: string; displayName: string; roles: AppRole[] } | null,
}));

vi.mock("../../auth/guard.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../auth/guard.js")>();
  return {
    ...actual,
    // `authorize` se mantiene tal cual: es la pieza bajo prueba.
    authenticate: async (request: { authUser?: unknown }, reply: { status: (c: number) => { send: (b: unknown) => unknown } }) => {
      if (!state.user) {
        return reply.status(401).send({ message: "Not authenticated" });
      }
      request.authUser = state.user;
    },
  };
});

const { buildApp } = await import("../../app.js");
const { prisma } = await import("../../infra/prisma.js");

const RUN = `rbac-${Date.now()}`;
const EMAIL_A = `${RUN}-ana@test.local`;
const EMAIL_B = `${RUN}-beto@test.local`;
const EMAIL_SIN_FICHA = `${RUN}-nadie@test.local`;

let app: FastifyInstance;
let projectId: string;
let consultantA: string;
let consultantB: string;
let activityA: string;
let activityB: string;

/** Cambia el usuario autenticado para la siguiente petición. */
function as(roles: AppRole[], email = EMAIL_A) {
  state.user = { id: `user-${email}`, email, displayName: email, roles };
}

/** Crea una entrada de horas directamente en la base, saltándose la API. */
async function seedEntry(consultantId: string, opts: { status?: "PENDING" | "APPROVED"; hours?: number } = {}) {
  return prisma.timeEntry.create({
    data: {
      projectId,
      consultantId,
      workDate: new Date("2026-09-21T00:00:00.000Z"),
      hours: opts.hours ?? 2,
      status: opts.status ?? "PENDING",
      description: `${RUN} entrada`,
    },
  });
}

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

  const [a, b] = await Promise.all([
    prisma.consultant.create({ data: { fullName: `${RUN} Ana`, email: EMAIL_A, role: "Consultor" } }),
    prisma.consultant.create({ data: { fullName: `${RUN} Beto`, email: EMAIL_B, role: "Consultor" } }),
  ]);
  consultantA = a.id;
  consultantB = b.id;

  const [actA, actB] = await Promise.all([
    prisma.activity.create({
      data: { title: `${RUN} tarea de Ana`, consultantId: consultantA, scheduledDate: new Date("2026-09-21"), estimatedHours: 4 },
    }),
    prisma.activity.create({
      data: { title: `${RUN} tarea de Beto`, consultantId: consultantB, scheduledDate: new Date("2026-09-21"), estimatedHours: 4 },
    }),
  ]);
  activityA = actA.id;
  activityB = actB.id;
});

afterAll(async () => {
  // El orden importa: TimeEntry referencia a Consultant con onDelete Restrict.
  await prisma.runningTimer.deleteMany({ where: { consultantId: { in: [consultantA, consultantB] } } });
  await prisma.timeEntry.deleteMany({ where: { consultantId: { in: [consultantA, consultantB] } } });
  await prisma.activity.deleteMany({ where: { id: { in: [activityA, activityB] } } });
  await prisma.consultant.deleteMany({ where: { id: { in: [consultantA, consultantB] } } });
  await prisma.project.deleteMany({ where: { id: projectId } });
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.runningTimer.deleteMany({ where: { consultantId: { in: [consultantA, consultantB] } } });
  await prisma.timeEntry.deleteMany({ where: { consultantId: { in: [consultantA, consultantB] } } });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Quién puede entrar a cada ruta", () => {
  const TODOS: AppRole[] = [AppRole.ADMIN, AppRole.PM, AppRole.CONSULTANT, AppRole.FINANCE, AppRole.VIEWER];

  it.each(TODOS)("%s puede consultar su propia ficha de consultor", async (role) => {
    as([role]);
    const res = await app.inject({ method: "GET", url: "/api/time-entries/me" });
    expect(res.statusCode).toBe(200);
  });

  it.each(TODOS)("%s y el listado de horas", async (role) => {
    as([role]);
    const res = await app.inject({ method: "GET", url: "/api/time-entries" });
    // FINANCE es el único que no tiene acceso al listado de horas.
    expect(res.statusCode).toBe(role === AppRole.FINANCE ? 403 : 200);
  });

  it.each([
    [AppRole.ADMIN, true],
    [AppRole.PM, true],
    [AppRole.CONSULTANT, true],
    [AppRole.FINANCE, false],
    [AppRole.VIEWER, false],
  ] as const)("%s registrando horas: permitido=%s", async (role, permitido) => {
    as([role]);
    const res = await app.inject({
      method: "POST",
      url: "/api/time-entries",
      payload: { projectId, workDate: "2026-09-21", hours: 1 },
    });
    expect(res.statusCode).toBe(permitido ? 201 : 403);
  });

  it.each([
    [AppRole.ADMIN, true],
    [AppRole.PM, true],
    [AppRole.CONSULTANT, true],
    [AppRole.FINANCE, false],
    [AppRole.VIEWER, false],
  ] as const)("%s arrancando el cronómetro: permitido=%s", async (role, permitido) => {
    as([role]);
    const res = await app.inject({ method: "POST", url: "/api/timer/start", payload: { projectId } });
    expect(res.statusCode).toBe(permitido ? 201 : 403);
  });

  it.each([AppRole.CONSULTANT, AppRole.FINANCE, AppRole.VIEWER])(
    "%s no puede aprobar horas",
    async (role) => {
      const entry = await seedEntry(consultantA);
      as([role]);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/time-entries/${entry.id}/approve`,
        payload: { approvedBy: "quien sea" },
      });
      expect(res.statusCode).toBe(403);
    },
  );

  it.each([AppRole.ADMIN, AppRole.PM])("%s sí puede aprobar horas", async (role) => {
    const entry = await seedEntry(consultantA);
    as([role]);
    const res = await app.inject({
      method: "PATCH",
      url: `/api/time-entries/${entry.id}/approve`,
      payload: { approvedBy: "revisor" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("APPROVED");
  });

  it("sin autenticar, todo devuelve 401", async () => {
    state.user = null;
    for (const url of ["/api/time-entries", "/api/timer", "/api/time-entries/me"]) {
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
    }
  });
});

describe("Un consultor solo puede imputar horas a su propio nombre", () => {
  it("ignora el consultantId de otra persona y se lo imputa a sí mismo", async () => {
    as([AppRole.CONSULTANT], EMAIL_A);
    const res = await app.inject({
      method: "POST",
      url: "/api/time-entries",
      payload: { projectId, consultantId: consultantB, workDate: "2026-09-21", hours: 3 },
    });

    expect(res.statusCode).toBe(201);
    // Pidió imputárselas a Beto; deben quedar a nombre de Ana.
    expect(res.json().data.consultantId).toBe(consultantA);
    expect(res.json().data.consultantId).not.toBe(consultantB);
  });

  it.each([AppRole.ADMIN, AppRole.PM])("%s sí puede imputar a nombre de otro", async (role) => {
    as([role], EMAIL_A);
    const res = await app.inject({
      method: "POST",
      url: "/api/time-entries",
      payload: { projectId, consultantId: consultantB, workDate: "2026-09-21", hours: 3 },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().data.consultantId).toBe(consultantB);
  });

  it("un usuario sin ficha de consultor recibe un error explicativo", async () => {
    as([AppRole.CONSULTANT], EMAIL_SIN_FICHA);
    const res = await app.inject({
      method: "POST",
      url: "/api/time-entries",
      payload: { projectId, workDate: "2026-09-21", hours: 1 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain("no esta vinculado a ningun consultor");
  });
});

describe("Edición y borrado de horas ajenas", () => {
  it("un consultor no puede editar las horas de otro", async () => {
    const deBeto = await seedEntry(consultantB);
    as([AppRole.CONSULTANT], EMAIL_A);

    const res = await app.inject({ method: "PATCH", url: `/api/time-entries/${deBeto.id}`, payload: { hours: 99 } });

    expect(res.statusCode).toBe(403);
    const sinTocar = await prisma.timeEntry.findUnique({ where: { id: deBeto.id } });
    expect(Number(sinTocar?.hours)).toBe(2);
  });

  it("un consultor no puede borrar las horas de otro", async () => {
    const deBeto = await seedEntry(consultantB);
    as([AppRole.CONSULTANT], EMAIL_A);

    const res = await app.inject({ method: "DELETE", url: `/api/time-entries/${deBeto.id}` });

    expect(res.statusCode).toBe(403);
    expect(await prisma.timeEntry.findUnique({ where: { id: deBeto.id } })).not.toBeNull();
  });

  it("un consultor sí edita y borra las suyas mientras estén pendientes", async () => {
    const propia = await seedEntry(consultantA);
    as([AppRole.CONSULTANT], EMAIL_A);

    const editada = await app.inject({ method: "PATCH", url: `/api/time-entries/${propia.id}`, payload: { hours: 5 } });
    expect(editada.statusCode).toBe(200);
    expect(Number(editada.json().data.hours)).toBe(5);

    const borrada = await app.inject({ method: "DELETE", url: `/api/time-entries/${propia.id}` });
    expect(borrada.statusCode).toBe(204);
  });

  it("una vez aprobadas, ni el dueño puede tocarlas", async () => {
    const aprobada = await seedEntry(consultantA, { status: "APPROVED" });
    as([AppRole.CONSULTANT], EMAIL_A);

    expect((await app.inject({ method: "PATCH", url: `/api/time-entries/${aprobada.id}`, payload: { hours: 8 } })).statusCode).toBe(409);
    expect((await app.inject({ method: "DELETE", url: `/api/time-entries/${aprobada.id}` })).statusCode).toBe(409);
  });

  it("un ADMIN sí puede borrar horas ya aprobadas", async () => {
    const aprobada = await seedEntry(consultantA, { status: "APPROVED" });
    as([AppRole.ADMIN], EMAIL_A);

    expect((await app.inject({ method: "DELETE", url: `/api/time-entries/${aprobada.id}` })).statusCode).toBe(204);
  });
});

describe("El cronómetro es personal", () => {
  it("cada consultor ve el suyo y no el del otro", async () => {
    as([AppRole.CONSULTANT], EMAIL_A);
    await app.inject({ method: "POST", url: "/api/timer/start", payload: { projectId, description: "lo de Ana" } });

    as([AppRole.CONSULTANT], EMAIL_B);
    const deBeto = await app.inject({ method: "GET", url: "/api/timer" });
    expect(deBeto.json().data).toBeNull();

    as([AppRole.CONSULTANT], EMAIL_A);
    expect((await app.inject({ method: "GET", url: "/api/timer" })).json().data.description).toBe("lo de Ana");
  });

  it("no se pueden tener dos cronómetros a la vez", async () => {
    as([AppRole.CONSULTANT], EMAIL_A);
    expect((await app.inject({ method: "POST", url: "/api/timer/start", payload: { projectId } })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: "/api/timer/start", payload: { projectId } })).statusCode).toBe(409);
  });

  it("al detenerlo, las horas quedan a nombre de quien lo arrancó y PENDIENTES", async () => {
    as([AppRole.CONSULTANT], EMAIL_A);
    await app.inject({ method: "POST", url: "/api/timer/start", payload: { projectId, description: "tarea" } });

    const parado = await app.inject({ method: "POST", url: "/api/timer/stop" });
    expect(parado.statusCode).toBe(201);
    expect(parado.json().data.consultantId).toBe(consultantA);
    expect(parado.json().data.status).toBe("PENDING");
    expect(parado.json().data.source).toBe("TIMER");
  });

  it("no se puede enganchar el cronómetro a una tarea de otro consultor", async () => {
    as([AppRole.CONSULTANT], EMAIL_A);
    const res = await app.inject({
      method: "POST",
      url: "/api/timer/start",
      payload: { projectId, activityId: activityB },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain("no existe o no pertenece");
  });

  it("sí se puede enganchar a una tarea propia", async () => {
    as([AppRole.CONSULTANT], EMAIL_A);
    const res = await app.inject({
      method: "POST",
      url: "/api/timer/start",
      payload: { projectId, activityId: activityA },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().data.activityId).toBe(activityA);
  });

  it("un usuario sin ficha de consultor no tiene cronómetro, pero la consulta no falla", async () => {
    as([AppRole.CONSULTANT], EMAIL_SIN_FICHA);
    const res = await app.inject({ method: "GET", url: "/api/timer" });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeNull();
  });
});

describe("Llevar el cronómetro a nombre de otro consultor", () => {
  it("un ADMIN lo arranca, lo consulta, lo edita y lo detiene para otra persona", async () => {
    as([AppRole.ADMIN], EMAIL_A);

    const arrancado = await app.inject({
      method: "POST",
      url: "/api/timer/start",
      payload: { projectId, consultantId: consultantB, description: "trabajo de Beto" },
    });
    expect(arrancado.statusCode).toBe(201);
    expect(arrancado.json().data.consultantId).toBe(consultantB);

    // Sin el consultantId vería el suyo, que no existe.
    expect((await app.inject({ method: "GET", url: "/api/timer" })).json().data).toBeNull();

    const visto = await app.inject({ method: "GET", url: `/api/timer?consultantId=${consultantB}` });
    expect(visto.json().data.description).toBe("trabajo de Beto");

    const editado = await app.inject({
      method: "PATCH",
      url: "/api/timer",
      payload: { consultantId: consultantB, description: "corregido" },
    });
    expect(editado.json().data.description).toBe("corregido");

    const parado = await app.inject({ method: "POST", url: "/api/timer/stop", payload: { consultantId: consultantB } });
    expect(parado.statusCode).toBe(201);
    // Lo esencial: las horas se le cuentan a Beto, no a quien manejó el cronómetro.
    expect(parado.json().data.consultantId).toBe(consultantB);
  });

  it("un CONSULTANT no puede arrancarlo a nombre de otro: se lo queda él", async () => {
    as([AppRole.CONSULTANT], EMAIL_A);

    const res = await app.inject({
      method: "POST",
      url: "/api/timer/start",
      payload: { projectId, consultantId: consultantB },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().data.consultantId).toBe(consultantA);
  });

  it("un CONSULTANT tampoco puede detener el cronómetro de otro", async () => {
    as([AppRole.ADMIN], EMAIL_A);
    await app.inject({ method: "POST", url: "/api/timer/start", payload: { projectId, consultantId: consultantB } });

    as([AppRole.CONSULTANT], EMAIL_A);
    const res = await app.inject({ method: "POST", url: "/api/timer/stop", payload: { consultantId: consultantB } });

    // Se resuelve a su propio cronómetro, que no existe: no llega al de Beto.
    expect(res.statusCode).toBe(404);
    expect(await prisma.runningTimer.findUnique({ where: { consultantId: consultantB } })).not.toBeNull();
  });

  it("descartar el de otro tampoco está al alcance de un CONSULTANT", async () => {
    as([AppRole.ADMIN], EMAIL_A);
    await app.inject({ method: "POST", url: "/api/timer/start", payload: { projectId, consultantId: consultantB } });

    as([AppRole.CONSULTANT], EMAIL_A);
    expect((await app.inject({ method: "DELETE", url: `/api/timer?consultantId=${consultantB}` })).statusCode).toBe(404);

    as([AppRole.ADMIN], EMAIL_A);
    expect((await app.inject({ method: "DELETE", url: `/api/timer?consultantId=${consultantB}` })).statusCode).toBe(204);
  });

  it("dos consultores pueden tener su propio cronómetro a la vez", async () => {
    as([AppRole.ADMIN], EMAIL_A);
    expect((await app.inject({ method: "POST", url: "/api/timer/start", payload: { projectId, consultantId: consultantA } })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: "/api/timer/start", payload: { projectId, consultantId: consultantB } })).statusCode).toBe(201);

    // Pero un segundo para el mismo consultor sigue estando prohibido.
    expect((await app.inject({ method: "POST", url: "/api/timer/start", payload: { projectId, consultantId: consultantB } })).statusCode).toBe(409);
  });
});

describe("Filtros del listado", () => {
  it("mine=1 devuelve solo las horas propias", async () => {
    await seedEntry(consultantA);
    await seedEntry(consultantB);

    as([AppRole.CONSULTANT], EMAIL_A);
    const res = await app.inject({ method: "GET", url: "/api/time-entries?mine=1" });

    const mias = res.json().data.filter((e: { description: string }) => e.description?.startsWith(RUN));
    expect(mias).toHaveLength(1);
    expect(mias[0].consultantId).toBe(consultantA);
  });

  it("el rango de fechas es inclusivo en ambos extremos", async () => {
    await seedEntry(consultantA); // 2026-09-21

    as([AppRole.ADMIN], EMAIL_A);
    const dentro = await app.inject({ method: "GET", url: `/api/time-entries?consultantId=${consultantA}&from=2026-09-21&to=2026-09-21` });
    const fuera = await app.inject({ method: "GET", url: `/api/time-entries?consultantId=${consultantA}&from=2026-09-22&to=2026-09-28` });

    expect(dentro.json().data).toHaveLength(1);
    expect(fuera.json().data).toHaveLength(0);
  });
});

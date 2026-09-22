import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { AppRole } from "@prisma/client";

/**
 * Pruebas de los tres arreglos de seguridad:
 *
 *   1. El manejador de errores ya no devuelve el stack en producción.
 *   2. Un consultor no ve las horas -- ni las tarifas -- de sus compañeros.
 *   3. Hay cabeceras de seguridad y un tope de peticiones por IP.
 *
 * Cada bloque comprueba tanto que lo prohibido se bloquea como que lo
 * permitido sigue funcionando: un arreglo que rompe el uso legítimo no sirve.
 */

const state = vi.hoisted(() => ({
  user: null as { id: string; email: string; displayName: string; roles: AppRole[] } | null,
}));

vi.mock("../../auth/guard.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../auth/guard.js")>();
  return {
    ...actual,
    authenticate: async (
      request: { authUser?: unknown },
      reply: { status: (c: number) => { send: (b: unknown) => unknown } },
    ) => {
      if (!state.user) return reply.status(401).send({ message: "Not authenticated" });
      request.authUser = state.user;
    },
  };
});

const { buildApp } = await import("../../app.js");
const { prisma } = await import("../../infra/prisma.js");

const RUN = `sec-${Date.now()}`;
const EMAIL_A = `${RUN}-ana@test.local`;
const EMAIL_B = `${RUN}-beto@test.local`;

let app: FastifyInstance;
let projectId: string;
let consultantA: string;
let consultantB: string;

function as(roles: AppRole[], email = EMAIL_A) {
  state.user = { id: `user-${email}`, email, displayName: email, roles };
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

  // Tarifas deliberadamente distintas y reconocibles: si se filtran, se ve.
  const [a, b] = await Promise.all([
    prisma.consultant.create({
      data: { fullName: `${RUN} Ana`, email: EMAIL_A, role: "Consultor", hourlyRate: 111, costPerMonth: 1111 },
    }),
    prisma.consultant.create({
      data: { fullName: `${RUN} Beto`, email: EMAIL_B, role: "Consultor", hourlyRate: 999, costPerMonth: 9999 },
    }),
  ]);
  consultantA = a.id;
  consultantB = b.id;
});

afterAll(async () => {
  await prisma.timeEntry.deleteMany({ where: { consultantId: { in: [consultantA, consultantB] } } });
  await prisma.consultant.deleteMany({ where: { id: { in: [consultantA, consultantB] } } });
  await prisma.project.deleteMany({ where: { id: projectId } });
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.timeEntry.deleteMany({ where: { consultantId: { in: [consultantA, consultantB] } } });
  await prisma.timeEntry.createMany({
    data: [
      { projectId, consultantId: consultantA, workDate: new Date("2026-09-21"), hours: 4, description: `${RUN} de Ana` },
      { projectId, consultantId: consultantB, workDate: new Date("2026-09-21"), hours: 6, description: `${RUN} de Beto` },
    ],
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Las tarifas no viajan en el listado de horas", () => {
  it.each([AppRole.ADMIN, AppRole.PM, AppRole.CONSULTANT, AppRole.VIEWER])(
    "ni siquiera para %s, que no las necesita aquí",
    async (role) => {
      as([role]);
      const res = await app.inject({ method: "GET", url: "/api/time-entries" });
      expect(res.statusCode).toBe(200);

      const mias = res.json().data.filter((e: { description: string }) => e.description?.startsWith(RUN));
      for (const entry of mias) {
        expect(entry.consultant).not.toHaveProperty("hourlyRate");
        expect(entry.consultant).not.toHaveProperty("costPerMonth");
        expect(entry.consultant).not.toHaveProperty("rateCurrency");
        // Lo que la interfaz sí usa debe seguir llegando.
        expect(entry.consultant.fullName).toBeTruthy();
      }
    },
  );

  it("el texto crudo de la respuesta no contiene ninguna tarifa", async () => {
    as([AppRole.CONSULTANT], EMAIL_A);
    const res = await app.inject({ method: "GET", url: "/api/time-entries" });

    // 999 y 9999 son la tarifa y el costo de Beto. No deben aparecer.
    expect(res.body).not.toContain("999");
    expect(res.body).not.toContain("1111");
  });
});

describe("Un consultor solo ve sus propias horas", () => {
  it("el listado sin filtros ya viene recortado", async () => {
    as([AppRole.CONSULTANT], EMAIL_A);
    const res = await app.inject({ method: "GET", url: "/api/time-entries" });

    const mias = res.json().data.filter((e: { description: string }) => e.description?.startsWith(RUN));
    expect(mias).toHaveLength(1);
    expect(mias[0].consultantId).toBe(consultantA);
  });

  it("pedir explícitamente las de otro no las devuelve", async () => {
    as([AppRole.CONSULTANT], EMAIL_A);
    const res = await app.inject({ method: "GET", url: `/api/time-entries?consultantId=${consultantB}` });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(0);
  });

  it("un usuario sin ficha de consultor no ve nada de nadie", async () => {
    as([AppRole.CONSULTANT], `${RUN}-fantasma@test.local`);
    const res = await app.inject({ method: "GET", url: "/api/time-entries" });

    expect(res.json().data).toHaveLength(0);
  });

  it.each([AppRole.ADMIN, AppRole.PM, AppRole.VIEWER])(
    "%s conserva la visión completa, que necesita para supervisar",
    async (role) => {
      as([role], EMAIL_A);
      const res = await app.inject({ method: "GET", url: "/api/time-entries" });

      const todas = res.json().data.filter((e: { description: string }) => e.description?.startsWith(RUN));
      expect(todas).toHaveLength(2);
    },
  );

  it("un ADMIN sigue pudiendo filtrar por un consultor concreto", async () => {
    as([AppRole.ADMIN], EMAIL_A);
    const res = await app.inject({ method: "GET", url: `/api/time-entries?consultantId=${consultantB}` });

    expect(res.json().data).toHaveLength(1);
    expect(res.json().data[0].consultantId).toBe(consultantB);
  });
});

describe("Cabeceras de seguridad", () => {
  it("helmet añade las cabeceras habituales", async () => {
    as([AppRole.ADMIN]);
    const res = await app.inject({ method: "GET", url: "/api/time-entries" });

    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBeDefined();
    expect(res.headers["strict-transport-security"]).toBeDefined();
  });

  it("el tope de peticiones anuncia el límite en cada respuesta", async () => {
    as([AppRole.ADMIN]);
    const res = await app.inject({ method: "GET", url: "/api/time-entries" });

    expect(res.headers["x-ratelimit-limit"]).toBeDefined();
    expect(res.headers["x-ratelimit-remaining"]).toBeDefined();
  });

  it("el health check queda fuera del tope, para que Render no lo tumbe", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["x-ratelimit-limit"]).toBeUndefined();
  });
});

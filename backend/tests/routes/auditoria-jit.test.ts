import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Aprovisionamiento JIT con Entra ID real (jose simulado): el alta de usuario y
 * consultor y los cambios de roles dejan rastro con el actor `sistema:entra-id`,
 * y un login que no cambia nada NO escribe.
 */
const claimsActuales = vi.hoisted(() => ({ valor: {} as Record<string, unknown> }));

vi.mock("jose", () => ({
  createRemoteJWKSet: () => () => undefined,
  jwtVerify: async () => ({ payload: claimsActuales.valor }),
}));

describe("JIT: auditoría del aprovisionamiento", () => {
  let app: FastifyInstance;
  let prisma: typeof import("../../src/infra/prisma.js").prisma;
  const email = `jit.${Date.now()}@synaptica.test`;
  const bearer = { authorization: "Bearer token-simulado" };

  beforeAll(async () => {
    vi.stubEnv("AUTH_ENABLED", "true");
    vi.stubEnv("AUTH_DEMO_BYPASS", "false");
    vi.resetModules();
    ({ prisma } = await import("../../src/infra/prisma.js"));
    const { buildApp } = await import("../../src/app.js");
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: user.id }, { changedBy: email }] } });
      await prisma.userRole.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
    const consultant = await prisma.consultant.findFirst({ where: { email } });
    if (consultant) {
      await prisma.auditLog.deleteMany({ where: { entityId: consultant.id } });
      await prisma.consultant.delete({ where: { id: consultant.id } });
    }
    await app.close();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    claimsActuales.valor = { preferred_username: email, name: "Persona JIT", roles: ["CONSULTANT"] };
  });

  it("primer login: CREATE de user y de consultant, una sola vez", async () => {
    for (let i = 0; i < 2; i++) {
      const res = await app.inject({ method: "GET", url: "/api/auth/me", headers: bearer });
      expect(res.statusCode, res.body).toBe(200);
    }
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const creaciones = await prisma.auditLog.findMany({ where: { entity: "user", entityId: user.id, action: "CREATE" } });
    expect(creaciones).toHaveLength(1);
    expect(creaciones[0].changedBy).toBe("sistema:entra-id");

    const consultant = await prisma.consultant.findFirstOrThrow({ where: { email } });
    const altaConsultor = await prisma.auditLog.findMany({ where: { entity: "consultant", entityId: consultant.id } });
    expect(altaConsultor).toHaveLength(1);
    expect(altaConsultor[0].action).toBe("CREATE");

    // Trazabilidad: lo creado por el aprovisionamiento lleva el actor del sistema.
    expect(user.createdBy).toBe("sistema:entra-id");
    expect(consultant.createdBy).toBe("sistema:entra-id");

    // El umbral deja un único LOGIN pese a las dos llamadas a /me.
    expect(await prisma.auditLog.count({ where: { entity: "user", entityId: user.id, action: "LOGIN" } })).toBe(1);
  });

  it("sin cambio de roles no hay UPDATE; con cambio queda before/after", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await app.inject({ method: "GET", url: "/api/auth/me", headers: bearer });
    expect(await prisma.auditLog.count({ where: { entity: "user", entityId: user.id, action: "UPDATE" } })).toBe(0);

    claimsActuales.valor = { preferred_username: email, name: "Persona JIT", roles: ["CONSULTANT", "PM"] };
    await app.inject({ method: "GET", url: "/api/auth/me", headers: bearer });
    const cambios = await prisma.auditLog.findMany({ where: { entity: "user", entityId: user.id, action: "UPDATE" } });
    expect(cambios).toHaveLength(1);
    expect(cambios[0].changedBy).toBe("sistema:entra-id");
    expect((cambios[0].before as { roles: string[] }).roles).toEqual(["CONSULTANT"]);
    expect((cambios[0].after as { roles: string[] }).roles).toEqual(["CONSULTANT", "PM"]);
  });
});

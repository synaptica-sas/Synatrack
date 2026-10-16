import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithActor } from "../../src/infra/actorContext.js";
import { prisma } from "../../src/infra/prisma.js";
import { runWeeklyApprovalDigest } from "../../src/modules/approvals/weekly-digest.job.js";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";

/**
 * QA: casos borde de la trazabilidad automática (createdBy/updatedBy) y del
 * LOGIN. Estas pruebas documentan fallas encontradas en la revisión; si están
 * en rojo, el defecto sigue presente.
 */
describe("trazabilidad: casos borde", () => {
  let app: FastifyInstance;
  const admin = "qa.borde.admin@synaptica.test";
  let filaOriginal: Awaited<ReturnType<typeof prisma.approvalDigestConfig.findUnique>> = null;

  beforeAll(async () => {
    app = await crearAppDePrueba();
    filaOriginal = await prisma.approvalDigestConfig.findUnique({ where: { scope: "GENERAL" } });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { changedBy: { startsWith: "qa.borde" } } });
    if (filaOriginal) {
      const { id: _id, ...resto } = filaOriginal;
      await prisma.approvalDigestConfig.update({ where: { scope: "GENERAL" }, data: resto });
    }
    await app.close();
  });

  it("un upsert sin cambios (update: {}) de un job no debe reclamar la autoría de la config", async () => {
    // El admin apaga el resumen: él es el último que modificó la fila.
    const put = await app.inject({
      method: "PUT",
      url: "/api/approval-digest",
      headers: comoRol(AppRole.ADMIN, admin),
      payload: { enabled: false, sendWeekday: 1, sendHourUtc: 13, immediateExtraHour: false },
    });
    expect(put.statusCode, put.body).toBe(200);
    const antes = await prisma.approvalDigestConfig.findUniqueOrThrow({ where: { scope: "GENERAL" } });
    expect(antes.updatedBy).toBe(admin);

    // Una pasada del trabajo con el resumen apagado: no envía nada ni cambia
    // ningún dato de la fila, solo hace el upsert de "asegurar que existe".
    await new Promise((r) => setTimeout(r, 20));
    await runWithActor("sistema:weekly-approval-digest", () => runWeeklyApprovalDigest(prisma));

    const despues = await prisma.approvalDigestConfig.findUniqueOrThrow({ where: { scope: "GENERAL" } });
    expect(despues.enabled).toBe(false);
    expect(despues.lastSentAt?.getTime() ?? null).toBe(antes.lastSentAt?.getTime() ?? null);
    // Nadie modificó la configuración: el último editor sigue siendo el admin.
    expect.soft(despues.updatedBy).toBe(admin);
    expect.soft(despues.updatedAt.getTime()).toBe(antes.updatedAt.getTime());
  });

  it("varias llamadas concurrentes a /api/auth/me registran un solo LOGIN", async () => {
    const email = "qa.borde.login@synaptica.test";
    const headers = comoRol(AppRole.VIEWER, email);
    const respuestas = await Promise.all(
      Array.from({ length: 4 }, () => app.inject({ method: "GET", url: "/api/auth/me", headers })),
    );
    respuestas.forEach((r) => expect(r.statusCode).toBe(200));
    const userId = respuestas[0].json().data.id as string;
    const filas = await prisma.auditLog.findMany({ where: { entity: "user", entityId: userId, action: "LOGIN" } });
    expect(filas).toHaveLength(1);
  });
});

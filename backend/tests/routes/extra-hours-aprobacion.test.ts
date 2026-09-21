import { AppRole, ExtraHourStatus } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/infra/prisma.js";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";
import {
  crearEscenarioBasico,
  crearHoraExtra,
  limpiarEscenario,
  type EscenarioBasico,
} from "../helpers/datos.js";

/**
 * `approvedBy` de horas extra sale del token, no del cuerpo.
 *
 * Es el caso más delicado de los tres módulos afectados porque esta columna
 * alimenta el cierre de nómina: si el cliente puede escribirla, el rastro de
 * quién autorizó un pago es falsificable.
 */
describe("PATCH /api/extra-hours/:id: la identidad de quien revisa sale del token", () => {
  const ADMIN_EMAIL = "admin@synaptica.local";
  let app: FastifyInstance;
  let escenario: EscenarioBasico;

  beforeAll(async () => {
    app = await crearAppDePrueba();
    escenario = await crearEscenarioBasico("eh-rev");
  });

  afterAll(async () => {
    await limpiarEscenario(escenario);
    await app.close();
  });

  it("la aprobación final guarda el correo del token aunque el cliente mande otro approvedBy", async () => {
    const entrada = await crearHoraExtra({
      consultantId: escenario.consultorA.id,
      projectId: escenario.projectId,
      fecha: new Date(Date.UTC(2026, 3, 5)),
    });

    // Nivel 1 (PM/ADMIN): pasa a PENDING_FINANCE, todavía sin `approvedBy`.
    const nivel1 = await app.inject({
      method: "PATCH",
      url: `/api/extra-hours/${entrada.id}/approve`,
      headers: comoRol(AppRole.ADMIN),
      payload: { approvedBy: "PM Falsificado" },
    });
    expect(nivel1.statusCode).toBe(200);
    expect(nivel1.json().data.status).toBe(ExtraHourStatus.PENDING_FINANCE);

    // Nivel 2 (FINANCE/ADMIN): aquí sí se escribe `approvedBy`.
    const nivel2 = await app.inject({
      method: "PATCH",
      url: `/api/extra-hours/${entrada.id}/approve`,
      headers: comoRol(AppRole.ADMIN),
      payload: { approvedBy: "Nómina Falsificada" },
    });

    expect(nivel2.statusCode).toBe(200);
    expect(nivel2.json().data.status).toBe(ExtraHourStatus.APPROVED);
    expect(nivel2.json().data.approvedBy).toBe(ADMIN_EMAIL);

    const enBase = await prisma.extraHourEntry.findUniqueOrThrow({ where: { id: entrada.id } });
    expect(enBase.approvedBy).toBe(ADMIN_EMAIL);
  });

  it("aprobar sin cuerpo funciona: el endpoint ya no exige approvedBy", async () => {
    const entrada = await crearHoraExtra({
      consultantId: escenario.consultorA.id,
      projectId: escenario.projectId,
      fecha: new Date(Date.UTC(2026, 3, 6)),
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/extra-hours/${entrada.id}/approve`,
      headers: comoRol(AppRole.ADMIN),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe(ExtraHourStatus.PENDING_FINANCE);
  });

  it("el rechazo guarda el correo del token y conserva el motivo enviado por el cliente", async () => {
    const entrada = await crearHoraExtra({
      consultantId: escenario.consultorA.id,
      projectId: escenario.projectId,
      fecha: new Date(Date.UTC(2026, 3, 7)),
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/extra-hours/${entrada.id}/reject`,
      headers: comoRol(AppRole.ADMIN),
      payload: { approvedBy: "Alguien Más", rejectionNote: "Fuera del límite semanal" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.approvedBy).toBe(ADMIN_EMAIL);
    expect(res.json().data.rejectionNote).toBe("Fuera del límite semanal");

    const enBase = await prisma.extraHourEntry.findUniqueOrThrow({ where: { id: entrada.id } });
    expect(enBase.approvedBy).toBe(ADMIN_EMAIL);
  });

  it("el rechazo sigue exigiendo un motivo (400 de Zod si falta)", async () => {
    const entrada = await crearHoraExtra({
      consultantId: escenario.consultorA.id,
      projectId: escenario.projectId,
      fecha: new Date(Date.UTC(2026, 3, 8)),
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/extra-hours/${entrada.id}/reject`,
      headers: comoRol(AppRole.ADMIN),
      payload: { approvedBy: "Alguien Más" },
    });

    expect(res.statusCode).toBe(400);
  });
});

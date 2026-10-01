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

  it("la aprobación guarda el correo del token aunque el cliente mande otro approvedBy", async () => {
    const entrada = await crearHoraExtra({
      consultantId: escenario.consultorA.id,
      projectId: escenario.projectId,
      fecha: new Date(Date.UTC(2026, 3, 5)),
    });

    // Aprobación única: una sola llamada deja la solicitud APPROVED y escribe
    // `approvedBy`. El `approvedBy` del cuerpo se ignora.
    const res = await app.inject({
      method: "PATCH",
      url: `/api/extra-hours/${entrada.id}/approve`,
      headers: comoRol(AppRole.ADMIN),
      payload: { approvedBy: "PM Falsificado" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe(ExtraHourStatus.APPROVED);
    expect(res.json().data.approvedBy).toBe(ADMIN_EMAIL);

    const enBase = await prisma.extraHourEntry.findUniqueOrThrow({ where: { id: entrada.id } });
    expect(enBase.approvedBy).toBe(ADMIN_EMAIL);
    expect(enBase.approvedAt).not.toBeNull();
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
    expect(res.json().data.status).toBe(ExtraHourStatus.APPROVED);
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

/**
 * Aprobación única del PM.
 *
 * El dueño del producto eliminó el segundo nivel (Finanzas): el PM conoce el
 * estado de salud de su proyecto, así que si aprueba las horas es porque se
 * pueden pagar. Finanzas desembolsa —consulta `GET /payroll`—, no decide.
 *
 * Estas pruebas fijan quién puede autorizar un pago, que es lo que no puede
 * cambiar por accidente: el PM del proyecto, un ADMIN o un delegado vigente, y
 * nadie más. `approve` y `reject` comparten el veredicto (`canReviewExtraHour`,
 * DEP-17), así que ambos se prueban juntos.
 */
describe("PATCH /api/extra-hours/:id: quién puede aprobar y rechazar", () => {
  let app: FastifyInstance;
  let escenario: EscenarioBasico;
  let pmEmail: string;
  const DELEGADO_EMAIL = "delegado.eh@synaptica.test";

  beforeAll(async () => {
    app = await crearAppDePrueba();
    escenario = await crearEscenarioBasico("eh-niveles");
    pmEmail = `pm.${escenario.prefijo}@synaptica.test`;
  });

  afterAll(async () => {
    await prisma.approvalDelegation.deleteMany({ where: { projectId: escenario.projectId } });
    await limpiarEscenario(escenario);
    await app.close();
  });

  async function nuevaEntrada(dia: number) {
    return crearHoraExtra({
      consultantId: escenario.consultorA.id,
      projectId: escenario.projectId,
      fecha: new Date(Date.UTC(2026, 4, dia)),
    });
  }

  it("el PM del proyecto aprueba y la solicitud queda directamente en APPROVED", async () => {
    const entrada = await nuevaEntrada(1);
    const res = await app.inject({
      method: "PATCH",
      url: `/api/extra-hours/${entrada.id}/approve`,
      headers: comoRol(AppRole.PM, pmEmail),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe(ExtraHourStatus.APPROVED);
    expect(res.json().data.approvedBy).toBe(pmEmail);

    // Sin pasos intermedios: nadie más tiene que tocarla.
    const enBase = await prisma.extraHourEntry.findUniqueOrThrow({ where: { id: entrada.id } });
    expect(enBase.status).toBe(ExtraHourStatus.APPROVED);
    expect(enBase.approvedAt).not.toBeNull();
  });

  it("un PM ajeno al proyecto recibe 403 tanto al aprobar como al rechazar", async () => {
    const entrada = await nuevaEntrada(2);
    const aprobar = await app.inject({
      method: "PATCH",
      url: `/api/extra-hours/${entrada.id}/approve`,
      headers: comoRol(AppRole.PM, "otro.pm@synaptica.test"),
    });
    expect(aprobar.statusCode).toBe(403);

    const rechazar = await app.inject({
      method: "PATCH",
      url: `/api/extra-hours/${entrada.id}/reject`,
      headers: comoRol(AppRole.PM, "otro.pm@synaptica.test"),
      payload: { rejectionNote: "No corresponde" },
    });
    expect(rechazar.statusCode).toBe(403);

    const enBase = await prisma.extraHourEntry.findUniqueOrThrow({ where: { id: entrada.id } });
    expect(enBase.status).toBe(ExtraHourStatus.PENDING_PM);
  });

  it("Finanzas ya no puede aprobar ni rechazar: 403 en ambos", async () => {
    const entrada = await nuevaEntrada(3);

    const aprobar = await app.inject({
      method: "PATCH",
      url: `/api/extra-hours/${entrada.id}/approve`,
      headers: comoRol(AppRole.FINANCE, "nomina@synaptica.test"),
    });
    expect(aprobar.statusCode).toBe(403);

    const rechazar = await app.inject({
      method: "PATCH",
      url: `/api/extra-hours/${entrada.id}/reject`,
      headers: comoRol(AppRole.FINANCE, "nomina@synaptica.test"),
      payload: { rejectionNote: "Fuera de presupuesto" },
    });
    expect(rechazar.statusCode).toBe(403);

    // Y la solicitud sigue intacta: Finanzas no movió nada.
    const enBase = await prisma.extraHourEntry.findUniqueOrThrow({ where: { id: entrada.id } });
    expect(enBase.status).toBe(ExtraHourStatus.PENDING_PM);
  });

  it("una delegación vigente habilita a quien no es PM", async () => {
    const entrada = await nuevaEntrada(4);
    const delegacion = await prisma.approvalDelegation.create({
      data: {
        projectId: escenario.projectId,
        fromUserEmail: pmEmail,
        toUserEmail: DELEGADO_EMAIL,
        startDate: new Date(Date.now() - 86_400_000),
        endDate: new Date(Date.now() + 86_400_000),
      },
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/extra-hours/${entrada.id}/approve`,
      headers: comoRol(AppRole.PM, DELEGADO_EMAIL),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe(ExtraHourStatus.APPROVED);

    await prisma.approvalDelegation.delete({ where: { id: delegacion.id } });
  });

  it("una delegación vencida no habilita a nadie", async () => {
    const entrada = await nuevaEntrada(5);
    const delegacion = await prisma.approvalDelegation.create({
      data: {
        projectId: escenario.projectId,
        fromUserEmail: pmEmail,
        toUserEmail: DELEGADO_EMAIL,
        startDate: new Date(Date.now() - 10 * 86_400_000),
        endDate: new Date(Date.now() - 86_400_000),
      },
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/extra-hours/${entrada.id}/approve`,
      headers: comoRol(AppRole.PM, DELEGADO_EMAIL),
    });
    expect(res.statusCode).toBe(403);

    await prisma.approvalDelegation.delete({ where: { id: delegacion.id } });
  });

  it("una solicitud ya aprobada no se puede volver a aprobar ni rechazar (409)", async () => {
    const entrada = await nuevaEntrada(6);
    const aprobacion = await app.inject({
      method: "PATCH",
      url: `/api/extra-hours/${entrada.id}/approve`,
      headers: comoRol(AppRole.PM, pmEmail),
    });
    expect(aprobacion.statusCode).toBe(200);

    // El estado es terminal: ni siquiera quien la aprobó puede reabrirla.
    const otraVez = await app.inject({
      method: "PATCH",
      url: `/api/extra-hours/${entrada.id}/approve`,
      headers: comoRol(AppRole.PM, pmEmail),
    });
    expect(otraVez.statusCode).toBe(409);

    const rechazar = await app.inject({
      method: "PATCH",
      url: `/api/extra-hours/${entrada.id}/reject`,
      headers: comoRol(AppRole.PM, pmEmail),
      payload: { rejectionNote: "Me arrepentí" },
    });
    expect(rechazar.statusCode).toBe(409);
  });

  it("el rechazo del PM deja la solicitud en REJECTED con su motivo", async () => {
    const entrada = await nuevaEntrada(7);
    const res = await app.inject({
      method: "PATCH",
      url: `/api/extra-hours/${entrada.id}/reject`,
      headers: comoRol(AppRole.PM, pmEmail),
      payload: { rejectionNote: "No estaba autorizado por el cliente" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe(ExtraHourStatus.REJECTED);
    expect(res.json().data.rejectionNote).toBe("No estaba autorizado por el cliente");
  });
});

/**
 * Lo que el PM aprueba llega a nómina sin ningún paso intermedio.
 *
 * Es la razón por la que eliminar el segundo nivel no deja a Finanzas sin
 * información: `GET /payroll` filtra por `APPROVED`, y ahora el PM produce ese
 * estado directamente.
 */
describe("GET /api/extra-hours/payroll: lo aprobado por el PM entra en el consolidado", () => {
  let app: FastifyInstance;
  let escenario: EscenarioBasico;
  let pmEmail: string;

  beforeAll(async () => {
    app = await crearAppDePrueba();
    escenario = await crearEscenarioBasico("eh-payroll");
    pmEmail = `pm.${escenario.prefijo}@synaptica.test`;
  });

  afterAll(async () => {
    await limpiarEscenario(escenario);
    await app.close();
  });

  it("tras la única aprobación del PM, la solicitud aparece en el reporte de nómina", async () => {
    const entrada = await crearHoraExtra({
      consultantId: escenario.consultorA.id,
      projectId: escenario.projectId,
      fecha: new Date(Date.UTC(2026, 5, 10)),
    });

    const nombreConsultor = `Consultor A ${escenario.prefijo}`;

    // Antes de aprobar no está: el consolidado solo mira APPROVED.
    const antes = await app.inject({
      method: "GET",
      url: "/api/extra-hours/payroll?year=2026&month=6",
      headers: comoRol(AppRole.FINANCE, "nomina@synaptica.test"),
    });
    expect(antes.statusCode).toBe(200);
    expect(
      antes.json().data.find((c: { consultantName: string }) => c.consultantName === nombreConsultor),
    ).toBeUndefined();

    // Una sola aprobación, la del PM.
    const aprobacion = await app.inject({
      method: "PATCH",
      url: `/api/extra-hours/${entrada.id}/approve`,
      headers: comoRol(AppRole.PM, pmEmail),
    });
    expect(aprobacion.statusCode).toBe(200);
    expect(aprobacion.json().data.status).toBe(ExtraHourStatus.APPROVED);

    // Y ya está en el consolidado que usa Finanzas para pagar.
    const despues = await app.inject({
      method: "GET",
      url: "/api/extra-hours/payroll?year=2026&month=6",
      headers: comoRol(AppRole.FINANCE, "nomina@synaptica.test"),
    });
    expect(despues.statusCode).toBe(200);
    const fila = despues
      .json()
      .data.find((c: { consultantName: string }) => c.consultantName === nombreConsultor);
    expect(fila).toBeDefined();
    expect(fila.totalHours).toBe(2);
    expect(fila.totalAmountLocal).toBe(100);
  });
});

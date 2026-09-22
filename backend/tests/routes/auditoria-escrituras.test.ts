import { AppRole, ExtraHourStatus, TimeEntryStatus } from "@prisma/client";
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
 * R9: las escrituras sensibles dejan rastro en `AuditLog`.
 *
 * Lo que se comprueba en cada caso no es solo que exista una fila, sino que
 * sirva para responder "¿quién hizo esto y qué cambió?":
 *   - `changedBy` es el correo del usuario autenticado (nunca del cuerpo),
 *   - `entity` usa la nomenclatura homologada en camelCase,
 *   - el `diff` recoge el campo que efectivamente cambió.
 */
describe("R9: la bitácora de auditoría registra las escrituras sensibles", () => {
  const ADMIN_EMAIL = "admin@synaptica.local";
  let app: FastifyInstance;
  let escenario: EscenarioBasico;
  const idsAuditados: string[] = [];

  /** Última entrada de bitácora de una entidad concreta. */
  async function ultimoRegistro(entity: string, entityId: string) {
    idsAuditados.push(entityId);
    return prisma.auditLog.findFirst({
      where: { entity, entityId },
      orderBy: { createdAt: "desc" },
    });
  }

  beforeAll(async () => {
    app = await crearAppDePrueba();
    escenario = await crearEscenarioBasico("r9-audit");
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: idsAuditados } } });
    await limpiarEscenario(escenario);
    await app.close();
  });

  it("crear horas extra deja un CREATE con el correo del token y la entidad extraHourEntry", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/extra-hours",
      headers: comoRol(AppRole.ADMIN),
      payload: {
        projectId: escenario.projectId,
        consultantId: escenario.consultorA.id,
        date: "2026-05-04",
        startTime: "19:00",
        endTime: "21:00",
        observations: "Cierre de sprint",
      },
    });

    expect(res.statusCode).toBe(201);
    const creada = res.json().data;

    const registro = await ultimoRegistro("extraHourEntry", creada.id);
    expect(registro).not.toBeNull();
    expect(registro!.action).toBe("CREATE");
    expect(registro!.changedBy).toBe(ADMIN_EMAIL);
    expect(registro!.entity).toBe("extraHourEntry");

    // El `after` conserva el monto calculado, que es lo que termina en nómina.
    const despues = registro!.after as Record<string, unknown>;
    expect(despues).not.toBeNull();
    expect(despues.status).toBe(ExtraHourStatus.PENDING_PM);
  });

  it("los dos niveles de aprobación de horas extra dejan cada uno su APPROVE", async () => {
    const entrada = await crearHoraExtra({
      consultantId: escenario.consultorA.id,
      projectId: escenario.projectId,
      fecha: new Date(Date.UTC(2026, 4, 6)),
    });

    // Nivel 1: aprobación operativa del PM -> PENDING_FINANCE.
    const nivel1 = await app.inject({
      method: "PATCH",
      url: `/api/extra-hours/${entrada.id}/approve`,
      headers: comoRol(AppRole.ADMIN),
    });
    expect(nivel1.statusCode).toBe(200);
    expect(nivel1.json().data.status).toBe(ExtraHourStatus.PENDING_FINANCE);

    // Nivel 2: autorización de pago -> APPROVED.
    const nivel2 = await app.inject({
      method: "PATCH",
      url: `/api/extra-hours/${entrada.id}/approve`,
      headers: comoRol(AppRole.ADMIN),
    });
    expect(nivel2.statusCode).toBe(200);
    expect(nivel2.json().data.status).toBe(ExtraHourStatus.APPROVED);

    idsAuditados.push(entrada.id);
    const registros = await prisma.auditLog.findMany({
      where: { entity: "extraHourEntry", entityId: entrada.id, action: "APPROVE" },
      orderBy: { createdAt: "asc" },
    });

    // Un registro por nivel: es lo que permite responder "quién aprobó el pago".
    expect(registros).toHaveLength(2);
    expect(registros.every((r) => r.changedBy === ADMIN_EMAIL)).toBe(true);

    const diffNivel1 = registros[0].diff as Record<string, { before: unknown; after: unknown }>;
    expect(diffNivel1.status).toEqual({
      before: ExtraHourStatus.PENDING_PM,
      after: ExtraHourStatus.PENDING_FINANCE,
    });

    const diffNivel2 = registros[1].diff as Record<string, { before: unknown; after: unknown }>;
    expect(diffNivel2.status).toEqual({
      before: ExtraHourStatus.PENDING_FINANCE,
      after: ExtraHourStatus.APPROVED,
    });
    // El nivel 2 es el que sella `approvedBy`, y el diff lo recoge.
    expect(diffNivel2.approvedBy.after).toBe(ADMIN_EMAIL);
  });

  it("rechazar horas extra deja un REJECT con el motivo en el diff", async () => {
    const entrada = await crearHoraExtra({
      consultantId: escenario.consultorA.id,
      projectId: escenario.projectId,
      fecha: new Date(Date.UTC(2026, 4, 7)),
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/extra-hours/${entrada.id}/reject`,
      headers: comoRol(AppRole.ADMIN),
      payload: { rejectionNote: "Sin autorización previa" },
    });
    expect(res.statusCode).toBe(200);

    const registro = await ultimoRegistro("extraHourEntry", entrada.id);
    expect(registro!.action).toBe("REJECT");
    expect(registro!.changedBy).toBe(ADMIN_EMAIL);

    const diff = registro!.diff as Record<string, { before: unknown; after: unknown }>;
    expect(diff.status.after).toBe(ExtraHourStatus.REJECTED);
    expect(diff.rejectionNote.after).toBe("Sin autorización previa");
  });

  it("aprobar horas registra APPROVE sobre la entidad timeEntry", async () => {
    const creacion = await app.inject({
      method: "POST",
      url: "/api/time-entries",
      headers: comoRol(AppRole.ADMIN),
      payload: {
        projectId: escenario.projectId,
        consultantId: escenario.consultorA.id,
        workDate: "2026-05-11",
        hours: 6,
        note: "Análisis funcional",
      },
    });
    expect(creacion.statusCode).toBe(201);
    const entrada = creacion.json().data;

    const creado = await ultimoRegistro("timeEntry", entrada.id);
    expect(creado!.action).toBe("CREATE");
    expect(creado!.changedBy).toBe(ADMIN_EMAIL);

    const aprobacion = await app.inject({
      method: "PATCH",
      url: `/api/time-entries/${entrada.id}/approve`,
      headers: comoRol(AppRole.ADMIN),
    });
    expect(aprobacion.statusCode).toBe(200);

    const registro = await ultimoRegistro("timeEntry", entrada.id);
    expect(registro!.action).toBe("APPROVE");
    expect(registro!.entity).toBe("timeEntry");
    expect(registro!.changedBy).toBe(ADMIN_EMAIL);

    const diff = registro!.diff as Record<string, { before: unknown; after: unknown }>;
    expect(diff.status).toEqual({
      before: TimeEntryStatus.PENDING,
      after: TimeEntryStatus.APPROVED,
    });
    expect(diff.approvedBy.after).toBe(ADMIN_EMAIL);
  });

  it("editar un consultor deja el cambio de tarifa en el diff", async () => {
    const consultor = await prisma.consultant.findUniqueOrThrow({
      where: { id: escenario.consultorA.id },
    });

    const res = await app.inject({
      method: "PUT",
      url: `/api/consultants/${consultor.id}`,
      headers: comoRol(AppRole.ADMIN),
      payload: {
        fullName: consultor.fullName,
        email: consultor.email,
        role: consultor.role,
        hourlyRate: 55,
        rateCurrency: "USD",
        country: "Colombia",
        active: true,
      },
    });
    expect(res.statusCode).toBe(200);

    const registro = await ultimoRegistro("consultant", consultor.id);
    expect(registro!.action).toBe("UPDATE");
    expect(registro!.entity).toBe("consultant");
    expect(registro!.changedBy).toBe(ADMIN_EMAIL);

    // La tarifa se audita a propósito: es el dato que mueve todos los costos.
    const diff = registro!.diff as Record<string, { before: unknown; after: unknown }>;
    expect(Number(diff.hourlyRate.before)).toBe(40);
    expect(Number(diff.hourlyRate.after)).toBe(55);
  });

  it("GET /api/audit filtra por la nomenclatura nueva y no pierde el histórico en mayúscula", async () => {
    const consultor = await prisma.consultant.findUniqueOrThrow({
      where: { id: escenario.consultorA.id },
    });

    // Fila con la nomenclatura VIEJA, como las que ya existen en producción.
    const historico = await prisma.auditLog.create({
      data: {
        entity: "Project",
        entityId: escenario.projectId,
        action: "UPDATE",
        changedBy: ADMIN_EMAIL,
      },
    });
    idsAuditados.push(escenario.projectId);

    const porProyecto = await app.inject({
      method: "GET",
      url: `/api/audit?entity=project&entityId=${escenario.projectId}`,
      headers: comoRol(AppRole.ADMIN),
    });
    expect(porProyecto.statusCode).toBe(200);
    const ids = porProyecto.json().data.map((fila: { id: string }) => fila.id);
    expect(ids).toContain(historico.id);

    // Y el filtro homologado sigue devolviendo lo nuevo.
    const porConsultor = await app.inject({
      method: "GET",
      url: `/api/audit?entity=consultant&entityId=${consultor.id}`,
      headers: comoRol(AppRole.ADMIN),
    });
    expect(porConsultor.statusCode).toBe(200);
    expect(porConsultor.json().data.length).toBeGreaterThan(0);
  });
});

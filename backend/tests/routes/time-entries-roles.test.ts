import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/infra/prisma.js";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";
import { crearEscenarioBasico, limpiarEscenario, type EscenarioBasico , idEmpresa } from "../helpers/datos.js";
import { aprobarSemana, borrarRevisiones, devolverSemana, lunesDe, marcarSemanaEnviada } from "../helpers/semana.js";

/**
 * MATRIZ DE ROLES del timesheet: quién entra a cada ruta de `/api/time-entries`
 * y quién puede tocar las horas de quién.
 *
 * Complementa a `time-entries-alcance.test.ts`, que cubre *qué filas ve* cada
 * rol en el listado. Aquí se comprueba la puerta (`authorize`) y la propiedad
 * de la fila al editar, borrar y aprobar.
 *
 * Procede de `src/modules/__tests__/roles.integration.test.ts`, que vivía
 * dentro de `src/` (y por tanto entraba en `npm test`, que es de cálculo puro)
 * y sustituía `authenticate` con un mock. Aquí se usa el simulador de rol por
 * encabezado, que es la pieza que existe justamente para esto.
 */

const TODOS: AppRole[] = [
  AppRole.ADMIN,
  AppRole.PM,
  AppRole.CONSULTANT,
  AppRole.FINANCE,
  AppRole.VIEWER,
];

describe("Matriz de roles de /api/time-entries", () => {
  let app: FastifyInstance;
  let escenario: EscenarioBasico;

  /** Identidad usada en la matriz: tiene ficha de consultor, así que el rol es la única variable. */
  function comoConsultorA(rol: AppRole) {
    return comoRol(rol, escenario.consultorA.email);
  }

  /** Crea una entrada de horas directamente en la base, saltándose la API. */
  async function sembrarHora(
    consultantId: string,
    opts: { estado?: "PENDING" | "APPROVED"; horas?: number; dia?: number } = {},
  ) {
    return prisma.timeEntry.create({
      data: {
        projectId: escenario.projectId,
        consultantId,
        workDate: new Date(Date.UTC(2026, 8, opts.dia ?? 21)),
        hours: opts.horas ?? 2,
        status: opts.estado ?? "PENDING",
        description: `${escenario.prefijo} entrada`,
      },
    });
  }

  beforeAll(async () => {
    app = await crearAppDePrueba();
    escenario = await crearEscenarioBasico("te-roles");
  });

  afterAll(async () => {
    await limpiarEscenario(escenario);
    await app.close();
  });

  beforeEach(async () => {
    await prisma.timeEntry.deleteMany({
      where: { consultantId: { in: [escenario.consultorA.id, escenario.consultorB.id] } },
    });
  });

  describe("Quién puede entrar a cada ruta", () => {
    it.each(TODOS)("%s puede consultar su propia ficha de consultor", async (rol) => {
      const res = await app.inject({
        method: "GET",
        url: "/api/time-entries/me",
        headers: comoConsultorA(rol),
      });

      expect(res.statusCode).toBe(200);
    });

    it.each(TODOS)("%s y el listado de horas", async (rol) => {
      const res = await app.inject({
        method: "GET",
        url: "/api/time-entries",
        headers: comoConsultorA(rol),
      });

      // FINANCE es el único que no tiene acceso al listado de horas.
      expect(res.statusCode).toBe(rol === AppRole.FINANCE ? 403 : 200);
    });

    it.each([
      [AppRole.ADMIN, true],
      [AppRole.PM, true],
      [AppRole.CONSULTANT, true],
      [AppRole.FINANCE, false],
      [AppRole.VIEWER, false],
    ] as const)("%s registrando horas: permitido=%s", async (rol, permitido) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/time-entries",
        headers: comoConsultorA(rol),
        payload: { projectId: escenario.projectId, workDate: "2026-09-21", hours: 1 },
      });

      expect(res.statusCode).toBe(permitido ? 201 : 403);
    });

    it.each([AppRole.CONSULTANT, AppRole.FINANCE, AppRole.VIEWER])(
      "%s no puede aprobar horas",
      async (rol) => {
        // R15: se aprueba la semana del proyecto. Sin ser su PM ni delegado, ningún rol puede.
        const entrada = await sembrarHora(escenario.consultorA.id);
        await marcarSemanaEnviada(entrada.consultantId, entrada.projectId, entrada.workDate);

        const res = await aprobarSemana(app, comoConsultorA(rol), {
          consultantId: entrada.consultantId,
          projectId: entrada.projectId,
          weekStart: lunesDe(entrada.workDate),
        });

        expect(res.statusCode).toBe(403);
        const enBase = await prisma.timeEntry.findUniqueOrThrow({ where: { id: entrada.id } });
        expect(enBase.status).toBe("SUBMITTED");
        // La semana enviada bloquearía al resto de pruebas del consultor: se deshace.
        await borrarRevisiones([entrada.consultantId]);
        await prisma.timeEntry.delete({ where: { id: entrada.id } });
      },
    );
  });

  describe("Imputar horas a nombre de otro consultor", () => {
    it("un ADMIN sí puede imputar a nombre de otro", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/time-entries",
        headers: comoConsultorA(AppRole.ADMIN),
        payload: {
          projectId: escenario.projectId,
          consultantId: escenario.consultorB.id,
          workDate: "2026-09-21",
          hours: 3,
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().data.consultantId).toBe(escenario.consultorB.id);
    });
  });

  describe("Edición y borrado de horas ajenas", () => {
    it("un consultor no puede editar las horas de otro", async () => {
      const deB = await sembrarHora(escenario.consultorB.id);

      const res = await app.inject({
        method: "PATCH",
        url: `/api/time-entries/${deB.id}`,
        headers: comoConsultorA(AppRole.CONSULTANT),
        payload: { hours: 99 },
      });

      expect(res.statusCode).toBe(403);
      const sinTocar = await prisma.timeEntry.findUniqueOrThrow({ where: { id: deB.id } });
      expect(Number(sinTocar.hours)).toBe(2);
    });

    it("un consultor no puede borrar las horas de otro", async () => {
      const deB = await sembrarHora(escenario.consultorB.id);

      const res = await app.inject({
        method: "DELETE",
        url: `/api/time-entries/${deB.id}`,
        headers: comoConsultorA(AppRole.CONSULTANT),
      });

      expect(res.statusCode).toBe(403);
      expect(await prisma.timeEntry.findUnique({ where: { id: deB.id } })).not.toBeNull();
    });

    it("un consultor sí edita y borra las suyas mientras estén pendientes", async () => {
      const propia = await sembrarHora(escenario.consultorA.id);

      const editada = await app.inject({
        method: "PATCH",
        url: `/api/time-entries/${propia.id}`,
        headers: comoConsultorA(AppRole.CONSULTANT),
        payload: { hours: 5 },
      });
      expect(editada.statusCode).toBe(200);
      expect(Number(editada.json().data.hours)).toBe(5);

      const borrada = await app.inject({
        method: "DELETE",
        url: `/api/time-entries/${propia.id}`,
        headers: comoConsultorA(AppRole.CONSULTANT),
      });
      expect(borrada.statusCode).toBe(204);
    });

    it("una vez aprobadas, ni el dueño puede tocarlas", async () => {
      const aprobada = await sembrarHora(escenario.consultorA.id, { estado: "APPROVED" });

      const editada = await app.inject({
        method: "PATCH",
        url: `/api/time-entries/${aprobada.id}`,
        headers: comoConsultorA(AppRole.CONSULTANT),
        payload: { hours: 8 },
      });
      const borrada = await app.inject({
        method: "DELETE",
        url: `/api/time-entries/${aprobada.id}`,
        headers: comoConsultorA(AppRole.CONSULTANT),
      });

      expect(editada.statusCode).toBe(409);
      expect(borrada.statusCode).toBe(409);
    });

    it("un ADMIN sí puede borrar horas ya aprobadas", async () => {
      const aprobada = await sembrarHora(escenario.consultorA.id, { estado: "APPROVED" });

      const res = await app.inject({
        method: "DELETE",
        url: `/api/time-entries/${aprobada.id}`,
        headers: comoConsultorA(AppRole.ADMIN),
      });

      expect(res.statusCode).toBe(204);
    });
  });

  describe("Filtros del listado", () => {
    it("mine=1 devuelve solo las horas propias", async () => {
      await sembrarHora(escenario.consultorA.id);
      await sembrarHora(escenario.consultorB.id);

      const res = await app.inject({
        method: "GET",
        url: "/api/time-entries?mine=1",
        headers: comoConsultorA(AppRole.ADMIN),
      });

      const filas = (res.json().data as Array<{ description: string; consultantId: string }>).filter(
        (fila) => fila.description?.startsWith(escenario.prefijo),
      );
      expect(filas).toHaveLength(1);
      expect(filas[0].consultantId).toBe(escenario.consultorA.id);
    });

    it("el rango de fechas es inclusivo en ambos extremos", async () => {
      await sembrarHora(escenario.consultorA.id, { dia: 21 });

      const dentro = await app.inject({
        method: "GET",
        url: `/api/time-entries?consultantId=${escenario.consultorA.id}&from=2026-09-21&to=2026-09-21`,
        headers: comoConsultorA(AppRole.ADMIN),
      });
      const fuera = await app.inject({
        method: "GET",
        url: `/api/time-entries?consultantId=${escenario.consultorA.id}&from=2026-09-22&to=2026-09-28`,
        headers: comoConsultorA(AppRole.ADMIN),
      });

      expect(dentro.json().data).toHaveLength(1);
      expect(fuera.json().data).toHaveLength(0);
    });
  });
});

/**
 * Dos exploits confirmados en la auditoría en vivo, ambos sobre
 * `/api/time-entries/:id/approve|reject` (y, para edición/borrado,
 * `canMutateEntry`):
 *
 *   1. Autoaprobación: un PM que registra horas como consultor de su propio
 *      proyecto podía aprobárselas y rechazárselas a sí mismo.
 *   2. Alcance: CUALQUIER PM aprobaba, rechazaba, editaba o borraba
 *      CUALQUIER hora de CUALQUIER proyecto, no solo los que gestiona.
 */
describe("/api/time-entries: alcance por proyecto del PM y autoaprobación (R-055)", () => {
  let app: FastifyInstance;
  let escenario: EscenarioBasico;
  let proyectoAjenoId: string;
  let pmEmail: string;
  // El PM del proyecto principal Y el consultor dueño de la hora son la MISMA
  // persona: mismo correo en `projectManagerEmail` y en `Consultant.email`.
  let pmConsultorId: string;

  beforeAll(async () => {
    app = await crearAppDePrueba();
    escenario = await crearEscenarioBasico("te-pm-alcance");
    pmEmail = `pm.${escenario.prefijo}@synaptica.test`;

    const proyectoAjeno = await prisma.project.create({
      data: {
        name: `Proyecto ajeno ${escenario.prefijo}`,
        companyId: await idEmpresa("Synaptica"),
        country: "Colombia",
        currency: "USD",
        budget: 5000,
        startDate: new Date(Date.UTC(2026, 0, 1)),
        endDate: new Date(Date.UTC(2026, 11, 31)),
        projectManagerEmail: `otro.pm.${escenario.prefijo}@synaptica.test`,
      },
    });
    proyectoAjenoId = proyectoAjeno.id;

    const pmComoConsultor = await prisma.consultant.create({
      data: {
        fullName: `PM-Consultor ${escenario.prefijo}`,
        email: pmEmail,
        role: "Consultor",
        hourlyRate: 60,
        rateCurrency: "USD",
        country: "Colombia",
      },
    });
    pmConsultorId = pmComoConsultor.id;
  });

  afterAll(async () => {
    await borrarRevisiones([pmConsultorId, escenario.consultorA.id, escenario.consultorB.id]);
    await prisma.timeEntry.deleteMany({ where: { projectId: proyectoAjenoId } });
    await prisma.timeEntry.deleteMany({ where: { consultantId: pmConsultorId } });
    await prisma.consultant.delete({ where: { id: pmConsultorId } });
    await prisma.project.deleteMany({ where: { id: proyectoAjenoId } });
    await limpiarEscenario(escenario);
    await app.close();
  });

  async function sembrarHoraEn(projectId: string, consultantId: string, dia: number) {
    return prisma.timeEntry.create({
      data: {
        projectId,
        consultantId,
        workDate: new Date(Date.UTC(2026, 9, dia)),
        hours: 2,
        status: "PENDING",
      },
    });
  }

  const itemDe = (e: { consultantId: string; projectId: string; workDate: Date }) => ({
    consultantId: e.consultantId,
    projectId: e.projectId,
    weekStart: lunesDe(e.workDate),
  });

  it("el PM del proyecto no puede aprobar sus propias horas (exploit bloqueado)", async () => {
    const propia = await sembrarHoraEn(escenario.projectId, pmConsultorId, 1);
    await marcarSemanaEnviada(propia.consultantId, propia.projectId, propia.workDate);

    const res = await aprobarSemana(app, comoRol(AppRole.PM, pmEmail), itemDe(propia));

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("NOT_REVIEWER");
    const enBase = await prisma.timeEntry.findUniqueOrThrow({ where: { id: propia.id } });
    expect(enBase.status).toBe("SUBMITTED");
  });

  it("el PM del proyecto no puede devolver sus propias horas (exploit bloqueado)", async () => {
    const propia = await sembrarHoraEn(escenario.projectId, pmConsultorId, 2);
    await marcarSemanaEnviada(propia.consultantId, propia.projectId, propia.workDate);

    const res = await devolverSemana(app, comoRol(AppRole.PM, pmEmail), { ...itemDe(propia), note: "Me arrepentí" });

    expect(res.statusCode).toBe(403);
  });

  it("el mismo PM sí puede aprobar y devolver horas de OTRO consultor de su proyecto", async () => {
    const deA = await sembrarHoraEn(escenario.projectId, escenario.consultorA.id, 3);
    await marcarSemanaEnviada(deA.consultantId, deA.projectId, deA.workDate);
    const aprobar = await aprobarSemana(app, comoRol(AppRole.PM, pmEmail), itemDe(deA));
    expect(aprobar.statusCode, aprobar.body).toBe(200);

    const deB = await sembrarHoraEn(escenario.projectId, escenario.consultorB.id, 4);
    await marcarSemanaEnviada(deB.consultantId, deB.projectId, deB.workDate);
    const devolver = await devolverSemana(app, comoRol(AppRole.PM, pmEmail), { ...itemDe(deB), note: "Horas duplicadas" });
    expect(devolver.statusCode, devolver.body).toBe(200);
  });

  it("un PM AJENO al proyecto recibe 403 al aprobar, devolver, editar y borrar (exploit bloqueado)", async () => {
    const entrada = await sembrarHoraEn(escenario.projectId, escenario.consultorA.id, 5);
    await marcarSemanaEnviada(entrada.consultantId, entrada.projectId, entrada.workDate);
    const ajeno = comoRol(AppRole.PM, `otro.pm.${escenario.prefijo}@synaptica.test`);

    const aprobar = await aprobarSemana(app, ajeno, itemDe(entrada));
    expect(aprobar.statusCode).toBe(403);

    const devolver = await devolverSemana(app, ajeno, { ...itemDe(entrada), note: "No me corresponde" });
    expect(devolver.statusCode).toBe(403);

    const editar = await app.inject({
      method: "PATCH",
      url: `/api/time-entries/${entrada.id}`,
      headers: ajeno,
      payload: { hours: 99 },
    });
    expect(editar.statusCode).toBe(403);

    const borrar = await app.inject({ method: "DELETE", url: `/api/time-entries/${entrada.id}`, headers: ajeno });
    expect(borrar.statusCode).toBe(403);

    const enBase = await prisma.timeEntry.findUniqueOrThrow({ where: { id: entrada.id } });
    expect(enBase.status).toBe("SUBMITTED");
    expect(Number(enBase.hours)).toBe(2);
  });

  it("un PM AJENO sí puede editar y borrar horas de un proyecto ajeno si son las suyas propias", async () => {
    // El PM ajeno también tiene ficha de consultor y puede registrar sus
    // propias horas en el proyecto que SÍ gestiona, aunque no gestione el
    // principal: `canMutateEntry` cae al criterio de "es mía" para cualquiera.
    const otroPmEmail = `otro.pm.${escenario.prefijo}@synaptica.test`;
    const otroPmConsultor = await prisma.consultant.create({
      data: {
        fullName: `Otro PM Consultor ${escenario.prefijo}`,
        email: otroPmEmail,
        role: "Consultor",
        hourlyRate: 50,
        rateCurrency: "USD",
        country: "Colombia",
      },
    });

    const propia = await sembrarHoraEn(proyectoAjenoId, otroPmConsultor.id, 6);
    const headers = comoRol(AppRole.PM, otroPmEmail);

    const editar = await app.inject({
      method: "PATCH",
      url: `/api/time-entries/${propia.id}`,
      headers,
      payload: { hours: 3 },
    });
    expect(editar.statusCode).toBe(200);

    const borrar = await app.inject({ method: "DELETE", url: `/api/time-entries/${propia.id}`, headers });
    expect(borrar.statusCode).toBe(204);

    await prisma.consultant.delete({ where: { id: otroPmConsultor.id } });
  });

  it("un PM AJENO no puede editar ni borrar horas de OTRO proyecto que tampoco son suyas", async () => {
    const deA = await sembrarHoraEn(escenario.projectId, escenario.consultorA.id, 7);
    const headers = comoRol(AppRole.PM, `otro.pm.${escenario.prefijo}@synaptica.test`);

    const editar = await app.inject({
      method: "PATCH",
      url: `/api/time-entries/${deA.id}`,
      headers,
      payload: { hours: 3 },
    });
    expect(editar.statusCode).toBe(403);

    const borrar = await app.inject({ method: "DELETE", url: `/api/time-entries/${deA.id}`, headers });
    expect(borrar.statusCode).toBe(403);
  });
});

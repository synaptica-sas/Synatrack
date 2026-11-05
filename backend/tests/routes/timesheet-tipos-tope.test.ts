import { AppRole, ExtraHourStatus } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/infra/prisma.js";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";
import { crearEscenarioBasico, crearHoraExtra, limpiarEscenario, type EscenarioBasico } from "../helpers/datos.js";

// El cronómetro imputa al día LOCAL del país (Colombia, UTC-5 sin horario de verano).
function diaLocalBogota(d: Date): Date {
  const l = new Date(d.getTime() - 5 * 3_600_000);
  return new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate()));
}

/**
 * R14: tipos de hora, tope diario por jornada, horas extra aprobadas con excedente,
 * ausencias con bloqueo de capacidad y catálogo de tipos.
 *
 * Los consultores se crean con prefijo propio y la jornada se fija con filas de `CapacityConfig`
 * por consultor o por país (que se restauran al final), sin depender del estado previo de la base.
 */

type Entry = {
  id: string;
  hours: number | string;
  isExcess: boolean;
  status: string;
  extraHourEntryId: string | null;
  type: { code: string | null; category: string };
};

describe("Timesheet R14: tope, tipos de hora y horas extra", () => {
  let app: FastifyInstance;
  let escenario: EscenarioBasico;
  let proyectoB: string;
  let semanaSinPermiso: string; // consultor sin allowWeekendWork
  let ausenciasId: string;
  const prefijo = `r14-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const ids = { regular: "", extra: "", permiso: "", vacaciones: "" };
  const restaurar: (() => Promise<void>)[] = [];

  const comoA = () => comoRol(AppRole.CONSULTANT, escenario.consultorA.email);
  const comoPM = () => comoRol(AppRole.PM, `pm.${escenario.prefijo}@synaptica.test`);
  const comoAdmin = () => comoRol(AppRole.ADMIN, "admin@synaptica.local");

  /** Fija la jornada de un país en una vigencia y la restaura al final. */
  async function fijarJornadaPais(country: string, validFromIso: string, hoursPerDay: number) {
    const validFrom = new Date(`${validFromIso}T00:00:00.000Z`);
    const previa = await prisma.capacityConfig.findUnique({ where: { country_validFrom: { country, validFrom } } });
    await prisma.capacityConfig.upsert({
      where: { country_validFrom: { country, validFrom } },
      update: { hoursPerDay },
      create: { country, validFrom, hoursPerDay },
    });
    restaurar.push(async () => {
      if (previa) {
        await prisma.capacityConfig.update({ where: { id: previa.id }, data: { hoursPerDay: previa.hoursPerDay } });
      } else {
        await prisma.capacityConfig.deleteMany({ where: { country, validFrom } });
      }
    });
  }

  async function putDia(
    projectId: string,
    workDate: string,
    entries: Record<string, unknown>[],
    headers: Record<string, string> = comoA(),
    consultantId?: string,
  ) {
    return app.inject({
      method: "PUT",
      url: "/api/time-entries/day",
      headers,
      payload: { projectId, workDate, consultantId, entries },
    });
  }

  const fila = (hours: number, extra: Record<string, unknown> = {}) => ({ typeId: ids.regular, hours, ...extra });

  beforeAll(async () => {
    app = await crearAppDePrueba();
    escenario = await crearEscenarioBasico("r14");

    const tipos = await prisma.timeEntryType.findMany();
    ids.regular = tipos.find((t) => t.code === "REGULAR")!.id;
    ids.extra = tipos.find((t) => t.code === "EXTRA")!.id;
    ids.permiso = tipos.find((t) => t.code === "PERMISO")!.id;
    ids.vacaciones = tipos.find((t) => t.code === "VACACIONES")!.id;
    ausenciasId = (await prisma.project.findFirstOrThrow({ where: { isAbsenceProject: true } })).id;

    proyectoB = (
      await prisma.project.create({
        data: {
          name: `Proyecto B ${prefijo}`,
          company: "Synaptica",
          country: "Colombia",
          currency: "USD",
          budget: 1000,
          startDate: new Date(Date.UTC(2026, 0, 1)),
          endDate: new Date(Date.UTC(2026, 11, 31)),
        },
      })
    ).id;

    semanaSinPermiso = (
      await prisma.consultant.create({
        data: {
          fullName: `Sin fin de semana ${prefijo}`,
          email: `sfs.${prefijo}@synaptica.test`,
          role: "Consultor",
          hourlyRate: 10,
          country: "Colombia",
          allowWeekendWork: false,
        },
      })
    ).id;

    // Colombia: 8 h hasta el 2026-07-14 y 8.4 h desde el 2026-07-15 (jornada con vigencia).
    await fijarJornadaPais("Colombia", "2000-01-01", 8);
    await fijarJornadaPais("Colombia", "2026-07-15", 8.4);
  });

  afterAll(async () => {
    for (const r of restaurar.reverse()) await r();
    const consultantIds = [escenario.consultorA.id, escenario.consultorB.id, semanaSinPermiso];
    await prisma.consultantBlock.deleteMany({ where: { consultantId: { in: consultantIds } } });
    await prisma.runningTimer.deleteMany({ where: { consultantId: { in: consultantIds } } });
    await prisma.timeEntry.deleteMany({ where: { consultantId: { in: consultantIds } } });
    await prisma.monthlySnapshot.deleteMany({ where: { projectId: { in: [escenario.projectId, proyectoB] } } });
    await prisma.consultant.deleteMany({ where: { id: semanaSinPermiso } });
    await prisma.timeEntryType.deleteMany({ where: { name: { startsWith: `Tipo ${prefijo}` } } });
    await limpiarEscenario(escenario);
    await prisma.project.deleteMany({ where: { id: proyectoB } });
    await app.close();
  });

  async function limpiarHoras() {
    const consultantIds = [escenario.consultorA.id, escenario.consultorB.id, semanaSinPermiso];
    await prisma.consultantBlock.deleteMany({ where: { consultantId: { in: consultantIds } } });
    await prisma.timeEntry.deleteMany({ where: { consultantId: { in: consultantIds } } });
    await prisma.extraHourEntry.deleteMany({ where: { consultantId: { in: consultantIds } } });
  }

  describe("tope diario", () => {
    it("suma todos los proyectos: lo que pasa de la jornada se rechaza con código e índice", async () => {
      await limpiarHoras();
      const a = await putDia(escenario.projectId, "2026-08-04", [fila(5)]);
      expect(a.statusCode).toBe(200);

      const excede = await putDia(proyectoB, "2026-08-04", [fila(3.5)]);
      expect(excede.statusCode).toBe(400);
      expect(excede.json()).toMatchObject({ code: "DAILY_CAP_EXCEEDED", index: 0 });
      expect(excede.json().message).toBeTruthy();

      const cabe = await putDia(proyectoB, "2026-08-04", [fila(3.4)]);
      expect(cabe.statusCode).toBe(200);
      expect(cabe.json().data.summary).toMatchObject({ hoursPerDay: 8.4, usedRegular: 8.4, remaining: 0 });
    });

    it("POST y PATCH validan el día completo (la celda del grid también)", async () => {
      await limpiarHoras();
      const creada = await app.inject({
        method: "POST",
        url: "/api/time-entries",
        headers: comoA(),
        payload: { projectId: escenario.projectId, workDate: "2026-08-04", hours: 6 },
      });
      expect(creada.statusCode).toBe(201);
      expect(creada.json().data.type.code).toBe("REGULAR");

      const excede = await app.inject({
        method: "POST",
        url: "/api/time-entries",
        headers: comoA(),
        payload: { projectId: proyectoB, workDate: "2026-08-04", hours: 3 },
      });
      expect(excede.statusCode).toBe(400);
      expect(excede.json().code).toBe("DAILY_CAP_EXCEEDED");

      const patch = await app.inject({
        method: "PATCH",
        url: `/api/time-entries/${creada.json().data.id}`,
        headers: comoA(),
        payload: { hours: 9 },
      });
      expect(patch.statusCode).toBe(400);
      expect(patch.json().code).toBe("DAILY_CAP_EXCEEDED");
    });

    it("Colombia: 8 h antes del 2026-07-15 y 8.4 h desde esa fecha", async () => {
      await limpiarHoras();
      const antes = await putDia(escenario.projectId, "2026-06-02", [fila(8.4)]);
      expect(antes.statusCode).toBe(400);
      expect(antes.json().code).toBe("DAILY_CAP_EXCEEDED");
      expect((await putDia(escenario.projectId, "2026-06-02", [fila(8)])).statusCode).toBe(200);

      const despues = await putDia(escenario.projectId, "2026-08-04", [fila(8.4)]);
      expect(despues.statusCode).toBe(200);
    });

    it("fin de semana: sin allowWeekendWork solo horas extra aprobadas", async () => {
      await limpiarHoras();
      const sinPermiso = await putDia(
        escenario.projectId,
        "2026-08-08",
        [fila(2)],
        comoAdmin(),
        semanaSinPermiso,
      );
      expect(sinPermiso.statusCode).toBe(400);
      expect(sinPermiso.json()).toMatchObject({ code: "REGULAR_ON_NON_WORKING_DAY", index: 0 });

      // El consultor A sí tiene allowWeekendWork.
      const conPermiso = await putDia(escenario.projectId, "2026-08-08", [fila(2)]);
      expect(conPermiso.statusCode).toBe(200);
    });

    it("day-summary: jornada, usado y banderas del día; un consultor solo ve lo suyo", async () => {
      await limpiarHoras();
      await putDia(escenario.projectId, "2026-08-04", [fila(3)]);

      const res = await app.inject({
        method: "GET",
        url: "/api/time-entries/day-summary?from=2026-08-04&to=2026-08-09",
        headers: comoA(),
      });
      expect(res.statusCode).toBe(200);
      const dias = res.json().data.days as { date: string; hoursPerDay: number; usedRegular: number; isWeekend: boolean }[];
      expect(dias).toHaveLength(6);
      expect(dias[0]).toMatchObject({ date: "2026-08-04", hoursPerDay: 8.4, usedRegular: 3, isWeekend: false });
      expect(dias[4]).toMatchObject({ date: "2026-08-08", isWeekend: true });

      // Solicitudes aprobadas del día por proyecto: franja "HH:MM", sin montos, ordenadas por inicio.
      const aprobada = await crearHoraExtra({
        consultantId: escenario.consultorA.id,
        projectId: escenario.projectId,
        fecha: new Date(Date.UTC(2026, 7, 4)),
      });
      await prisma.extraHourEntry.update({ where: { id: aprobada.id }, data: { status: ExtraHourStatus.APPROVED } });
      const conSolicitud = await app.inject({
        method: "GET",
        url: "/api/time-entries/day-summary?from=2026-08-04&to=2026-08-04",
        headers: comoA(),
      });
      const proyectoDia = conSolicitud
        .json()
        .data.days[0].projects.find((p: { projectId: string }) => p.projectId === escenario.projectId);
      expect(proyectoDia.approvedRequests).toEqual([
        { id: aprobada.id, startTime: "19:00", endTime: "21:00", totalHours: 2 },
      ]);
      await prisma.extraHourEntry.delete({ where: { id: aprobada.id } });

      const ajeno = await app.inject({
        method: "GET",
        url: `/api/time-entries/day-summary?from=2026-08-04&to=2026-08-04&consultantId=${escenario.consultorB.id}`,
        headers: comoA(),
      });
      expect(ajeno.statusCode).toBe(403);

      const rangoLargo = await app.inject({
        method: "GET",
        url: "/api/time-entries/day-summary?from=2026-01-01&to=2026-12-31",
        headers: comoA(),
      });
      expect(rangoLargo.statusCode).toBe(400);
    });

    it("respeta el candado de cierre mensual en PUT /day", async () => {
      await limpiarHoras();
      await prisma.monthlySnapshot.create({
        data: {
          projectId: escenario.projectId,
          year: 2026,
          month: 5,
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
      const res = await putDia(escenario.projectId, "2026-05-12", [fila(2)]);
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/mes cerrado/);
    });
  });

  describe("horas extra: saldo aprobado y excedente", () => {
    const dia = "2026-08-11";
    const extra = (hours: number, desde: string, hasta: string) => ({
      typeId: ids.extra,
      hours,
      startedAt: `2026-08-11T${desde}:00.000Z`,
      endedAt: `2026-08-11T${hasta}:00.000Z`,
    });

    it("EXTRA sin solicitud aprobada se rechaza (400) con el índice de la fila", async () => {
      await limpiarHoras();
      const res = await putDia(escenario.projectId, dia, [fila(1), extra(2, "23:00", "23:59")]);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ code: "EXTRA_WITHOUT_APPROVAL", index: 1 });
    });

    it("con solicitud aprobada de 2 h, registrar 3 h parte el registro y deja 1 h como excedente", async () => {
      await limpiarHoras();
      const solicitud = await crearHoraExtra({
        consultantId: escenario.consultorA.id,
        projectId: escenario.projectId,
        fecha: new Date(Date.UTC(2026, 7, 11)),
      });
      await prisma.extraHourEntry.update({ where: { id: solicitud.id }, data: { status: ExtraHourStatus.APPROVED } });

      const res = await putDia(escenario.projectId, dia, [extra(3, "19:00", "22:00")]);
      expect(res.statusCode, res.body).toBe(200);
      const entries = res.json().data.entries as Entry[];
      expect(entries).toHaveLength(2);
      const normal = entries.find((e) => !e.isExcess)!;
      const excedente = entries.find((e) => e.isExcess)!;
      expect(Number(normal.hours)).toBe(2);
      expect(Number(excedente.hours)).toBe(1);
      expect(normal.extraHourEntryId).toBe(solicitud.id);
      expect(excedente.status).toBe("PENDING");
      // Las horas extra no cuentan contra la jornada.
      expect(res.json().data.summary.usedAgainstCap).toBe(0);
      expect(res.json().data.summary.projects[0]).toMatchObject({
        projectId: escenario.projectId,
        extraApproved: 2,
        extraUsed: 2,
        extraExcess: 1,
      });

      // Aprobado vs. real en el listado de solicitudes.
      const lista = await app.inject({ method: "GET", url: "/api/extra-hours", headers: comoAdmin() });
      const fila_ = (lista.json().data as { id: string; realHours: number; excessHours: number; excessPendingHours: number }[]).find(
        (e) => e.id === solicitud.id,
      )!;
      expect(fila_).toMatchObject({ realHours: 2, excessHours: 1, excessPendingHours: 1 });

      // Volver a guardar es estable: no multiplica ni reclasifica los registros.
      const otraVez = await putDia(escenario.projectId, dia, (res.json().data.entries as Entry[]).map((e) => ({
        id: e.id,
        typeId: ids.extra,
        hours: Number(e.hours),
        startedAt: (e as unknown as { startedAt: string }).startedAt,
        endedAt: (e as unknown as { endedAt: string }).endedAt,
      })));
      expect(otraVez.statusCode, otraVez.body).toBe(200);
      expect((otraVez.json().data.entries as Entry[]).filter((e) => e.isExcess)).toHaveLength(1);
    });

    it("el excedente solo lo decide el PM del proyecto (ADMIN no); las horas extra no cuentan en el tope", async () => {
      await limpiarHoras();
      const solicitud = await crearHoraExtra({
        consultantId: escenario.consultorA.id,
        projectId: escenario.projectId,
        fecha: new Date(Date.UTC(2026, 7, 11)),
      });
      await prisma.extraHourEntry.update({ where: { id: solicitud.id }, data: { status: ExtraHourStatus.APPROVED } });
      const res = await putDia(escenario.projectId, dia, [fila(8.4), extra(3, "19:00", "22:00")]);
      expect(res.statusCode, res.body).toBe(200);
      const excedente = (res.json().data.entries as Entry[]).find((e) => e.isExcess)!;

      const pendientes = await app.inject({ method: "GET", url: "/api/extra-hours/excess-pending", headers: comoPM() });
      expect(pendientes.statusCode).toBe(200);
      expect((pendientes.json().data as { id: string }[]).map((e) => e.id)).toContain(excedente.id);
      expect(JSON.stringify(pendientes.json())).not.toContain("hourlyRate");

      const admin = await app.inject({
        method: "PATCH",
        url: `/api/time-entries/${excedente.id}/approve`,
        headers: comoAdmin(),
      });
      expect(admin.statusCode).toBe(403);

      const otroPm = await app.inject({
        method: "PATCH",
        url: `/api/time-entries/${excedente.id}/approve`,
        headers: comoRol(AppRole.PM, "otro.pm@synaptica.test"),
      });
      expect(otroPm.statusCode).toBe(403);

      const pm = await app.inject({
        method: "PATCH",
        url: `/api/time-entries/${excedente.id}/approve`,
        headers: comoPM(),
      });
      expect(pm.statusCode).toBe(200);
      expect(pm.json().data.status).toBe("APPROVED");
    });

    it("el cronómetro parte la franja: jornada, extra hasta el saldo y excedente", async () => {
      await limpiarHoras();
      const consultor = await prisma.consultant.create({
        data: {
          fullName: `Timer ${prefijo}`,
          email: `timer.${prefijo}@synaptica.test`,
          role: "Consultor",
          hourlyRate: 10,
          country: "Colombia",
          allowWeekendWork: true,
        },
      });
      try {
        await prisma.capacityConfig.create({
          data: { consultantId: consultor.id, validFrom: new Date(Date.UTC(2000, 0, 1)), hoursPerDay: 8 },
        });
        const inicio = new Date(Date.now() - 10 * 3_600_000);
        const workDate = diaLocalBogota(inicio);
        const solicitud = await crearHoraExtra({
          consultantId: consultor.id,
          projectId: escenario.projectId,
          fecha: workDate,
        });
        await prisma.extraHourEntry.update({
          where: { id: solicitud.id },
          data: { status: ExtraHourStatus.APPROVED, totalHours: 1 },
        });

        // Las horas extra solo las registra el propio consultor: es él quien detiene el cronómetro.
        const headers = comoRol(AppRole.CONSULTANT, consultor.email!);
        const start = await app.inject({
          method: "POST",
          url: "/api/timer/start",
          headers,
          payload: { projectId: escenario.projectId, consultantId: consultor.id, startedAt: inicio.toISOString() },
        });
        expect(start.statusCode, start.body).toBe(201);

        const stop = await app.inject({
          method: "POST",
          url: "/api/timer/stop",
          headers,
          payload: { consultantId: consultor.id },
        });
        expect(stop.statusCode, stop.body).toBe(201);
        const cuerpo = stop.json() as { entries: Entry[]; discardedHours: number; data: Entry };
        expect(cuerpo.discardedHours).toBe(0);
        expect(cuerpo.entries).toHaveLength(3);
        expect(cuerpo.entries.map((e) => [e.type.category, e.isExcess])).toEqual([
          ["REGULAR", false],
          ["EXTRA", false],
          ["EXTRA", true],
        ]);
        expect(Number(cuerpo.entries[0].hours)).toBeCloseTo(8, 3);
        expect(Number(cuerpo.entries[1].hours)).toBeCloseTo(1, 3);
        expect(cuerpo.entries[1].extraHourEntryId).toBe(solicitud.id);
        expect(cuerpo.data.id).toBe(cuerpo.entries[0].id);
        expect(await prisma.runningTimer.count({ where: { consultantId: consultor.id } })).toBe(0);

        // Sin solicitud aprobada, lo que sobra de la jornada se informa y no se guarda.
        await prisma.timeEntry.deleteMany({ where: { consultantId: consultor.id } });
        await prisma.extraHourEntry.deleteMany({ where: { consultantId: consultor.id } });
        await app.inject({
          method: "POST",
          url: "/api/timer/start",
          headers,
          payload: { projectId: escenario.projectId, consultantId: consultor.id, startedAt: inicio.toISOString() },
        });
        const sinSolicitud = await app.inject({
          method: "POST",
          url: "/api/timer/stop",
          headers,
          payload: { consultantId: consultor.id },
        });
        expect(sinSolicitud.statusCode).toBe(201);
        expect(sinSolicitud.json().entries).toHaveLength(1);
        expect(sinSolicitud.json().discardedHours).toBeCloseTo(2, 3);
      } finally {
        await prisma.runningTimer.deleteMany({ where: { consultantId: consultor.id } });
        await prisma.timeEntry.deleteMany({ where: { consultantId: consultor.id } });
        await prisma.extraHourEntry.deleteMany({ where: { consultantId: consultor.id } });
        await prisma.consultant.delete({ where: { id: consultor.id } });
      }
    });

    it("el cronómetro no admite el proyecto de Ausencias", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/timer/start",
        headers: comoA(),
        payload: { projectId: ausenciasId },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/Ausencias/);
    });

    it("la nómina paga lo real aprobado, no la solicitud", async () => {
      await limpiarHoras();
      const solicitud = await crearHoraExtra({
        consultantId: escenario.consultorA.id,
        projectId: escenario.projectId,
        fecha: new Date(Date.UTC(2026, 7, 11)),
      });
      await prisma.extraHourEntry.update({ where: { id: solicitud.id }, data: { status: ExtraHourStatus.APPROVED } });
      // 19:00-21:00 en Bogotá = 00:00-02:00 UTC del día siguiente.
      const res = await putDia(escenario.projectId, dia, [
        { typeId: ids.extra, hours: 1.5, startedAt: "2026-08-12T00:00:00.000Z", endedAt: "2026-08-12T01:30:00.000Z" },
      ]);
      expect(res.statusCode, res.body).toBe(200);
      const id = (res.json().data.entries as Entry[])[0].id;

      const finanzas = comoRol(AppRole.FINANCE, "nomina@synaptica.test");
      const nombre = `Consultor A ${escenario.prefijo}`;
      const buscar = async () =>
        (
          await app.inject({ method: "GET", url: "/api/extra-hours/payroll?year=2026&month=8", headers: finanzas })
        )
          .json()
          .data.find((c: { consultantName: string }) => c.consultantName === nombre);

      // Pendiente de aprobar: no se paga todavía.
      expect(await buscar()).toBeUndefined();

      const aprobada = await app.inject({
        method: "PATCH",
        url: `/api/time-entries/${id}/approve`,
        headers: comoAdmin(),
      });
      // Es una hora extra normal (no excedente): la aprueba ADMIN o el PM del proyecto.
      expect(aprobada.statusCode, aprobada.body).toBe(200);

      const fila_ = await buscar();
      expect(fila_).toBeDefined();
      expect(fila_.legacy).toBe(false);
      expect(fila_.realHours).toBeCloseTo(1.5, 2);
      expect(fila_.totalAmountLocal).toBeGreaterThan(0);
      expect(fila_.legacyHours).toBe(0);
    });
  });

  describe("PUT /api/time-entries/day", () => {
    it("es transaccional: un error en una fila no deja guardada ninguna", async () => {
      await limpiarHoras();
      const inicial = await putDia(escenario.projectId, "2026-08-05", [fila(2, { description: "original" })]);
      expect(inicial.statusCode).toBe(200);
      const idOriginal = (inicial.json().data.entries as Entry[])[0].id;

      const res = await putDia(escenario.projectId, "2026-08-05", [
        fila(1, { description: "nueva válida" }),
        { typeId: ids.extra, hours: 1, startedAt: "2026-08-05T23:00:00.000Z", endedAt: "2026-08-06T00:00:00.000Z" },
      ]);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ code: "EXTRA_WITHOUT_APPROVAL", index: 1 });

      const filas = await prisma.timeEntry.findMany({ where: { consultantId: escenario.consultorA.id } });
      expect(filas.map((f) => f.id)).toEqual([idOriginal]);
      expect(filas[0].description).toBe("original");
    });

    it("reemplaza solo los PENDING: actualiza, crea y borra los ausentes; no toca los aprobados", async () => {
      await limpiarHoras();
      const dia = "2026-08-06";
      const primera = await putDia(escenario.projectId, dia, [fila(1, { description: "a" }), fila(1, { description: "b" })]);
      const [a, b] = primera.json().data.entries as Entry[];
      // Se aprueba una: queda fuera del reemplazo.
      await prisma.timeEntry.update({ where: { id: b.id }, data: { status: "APPROVED" } });

      const res = await putDia(escenario.projectId, dia, [fila(2, { id: a.id, description: "a editada" }), fila(0.5, { description: "c" })]);
      expect(res.statusCode, res.body).toBe(200);
      const entries = res.json().data.entries as (Entry & { description: string })[];
      expect(entries.map((e) => e.description).sort()).toEqual(["a editada", "b", "c"]);
      expect(entries.find((e) => e.description === "b")!.status).toBe("APPROVED");

      // Un registro aprobado no se puede reescribir desde el PUT.
      const intento = await putDia(escenario.projectId, dia, [fila(1, { id: b.id })]);
      expect(intento.statusCode).toBe(409);
      expect(intento.json()).toMatchObject({ code: "ENTRY_NOT_PENDING", index: 0 });
    });

    it("un consultor no puede guardar el día de otro; la identidad sale del token", async () => {
      const res = await putDia(escenario.projectId, "2026-08-05", [fila(1)], comoA(), escenario.consultorB.id);
      expect(res.statusCode).toBe(403);
    });

    it("rechaza un tipo inexistente y valida el cuerpo con Zod", async () => {
      const tipo = await putDia(escenario.projectId, "2026-08-05", [{ typeId: "no-existe", hours: 1 }]);
      expect(tipo.statusCode).toBe(400);
      expect(tipo.json()).toMatchObject({ code: "TYPE_NOT_FOUND", index: 0 });

      const malo = await app.inject({
        method: "PUT",
        url: "/api/time-entries/day",
        headers: comoA(),
        payload: { projectId: escenario.projectId },
      });
      expect(malo.statusCode).toBe(400);
    });
  });

  describe("ausencias", () => {
    it("solo se registran en el proyecto Ausencias, y ese proyecto solo acepta ausencias", async () => {
      await limpiarHoras();
      const fuera = await putDia(escenario.projectId, "2026-08-18", [{ typeId: ids.vacaciones, hours: 8 }]);
      expect(fuera.statusCode).toBe(400);
      expect(fuera.json().code).toBe("ABSENCE_OUTSIDE_ABSENCE_PROJECT");

      const dentro = await putDia(ausenciasId, "2026-08-18", [fila(2)]);
      expect(dentro.statusCode).toBe(400);
      expect(dentro.json().code).toBe("NON_ABSENCE_IN_ABSENCE_PROJECT");
    });

    it("cuenta contra la jornada y, aprobada y completa, crea el bloqueo; al borrarla se elimina", async () => {
      await limpiarHoras();
      const dia = "2026-08-18";
      // Permiso parcial aprobado: no bloquea.
      const permiso = await putDia(ausenciasId, dia, [{ typeId: ids.permiso, hours: 2 }]);
      expect(permiso.statusCode, permiso.body).toBe(200);
      const idPermiso = (permiso.json().data.entries as Entry[])[0].id;

      // 2 h de ausencia + 7 h regulares superan 8.4.
      const tope = await putDia(escenario.projectId, dia, [fila(7)]);
      expect(tope.statusCode).toBe(400);
      expect(tope.json().code).toBe("DAILY_CAP_EXCEEDED");

      // El proyecto Ausencias no tiene PM: lo aprueba ADMIN.
      const aprobarPermiso = await app.inject({
        method: "PATCH",
        url: `/api/time-entries/${idPermiso}/approve`,
        headers: comoAdmin(),
      });
      expect(aprobarPermiso.statusCode, aprobarPermiso.body).toBe(200);
      expect(await prisma.consultantBlock.count({ where: { consultantId: escenario.consultorA.id } })).toBe(0);

      // Vacaciones por el resto de la jornada (6.4 h): ahora las ausencias cubren el día completo.
      const vac = await putDia(ausenciasId, dia, [{ typeId: ids.vacaciones, hours: 6.4 }, { id: idPermiso, typeId: ids.permiso, hours: 2 }]);
      expect(vac.statusCode).toBe(409); // el permiso ya está aprobado y no se reescribe
      const vac2 = await putDia(ausenciasId, dia, [{ typeId: ids.vacaciones, hours: 6.4 }]);
      expect(vac2.statusCode, vac2.body).toBe(200);
      const idVac = (vac2.json().data.entries as Entry[]).find((e) => e.type.code === "VACACIONES")!.id;

      const aprobarVac = await app.inject({
        method: "PATCH",
        url: `/api/time-entries/${idVac}/approve`,
        headers: comoAdmin(),
      });
      expect(aprobarVac.statusCode).toBe(200);

      const bloques = await prisma.consultantBlock.findMany({ where: { consultantId: escenario.consultorA.id } });
      expect(bloques).toHaveLength(1);
      expect(bloques[0]).toMatchObject({ blockType: "VACATION", timeEntryId: idVac });
      expect(bloques[0].startDate.toISOString().slice(0, 10)).toBe(dia);
      expect(bloques[0].endDate.toISOString().slice(0, 10)).toBe(dia);

      // Borrar la ausencia (la puede borrar un ADMIN aunque esté aprobada) elimina el bloqueo.
      const borrar = await app.inject({ method: "DELETE", url: `/api/time-entries/${idVac}`, headers: comoAdmin() });
      expect(borrar.statusCode).toBe(204);
      expect(await prisma.consultantBlock.count({ where: { consultantId: escenario.consultorA.id } })).toBe(0);
    });

    it("el cronómetro no acepta cambiar al proyecto Ausencias", async () => {
      await prisma.runningTimer.deleteMany({ where: { consultantId: escenario.consultorA.id } });
      const start = await app.inject({
        method: "POST",
        url: "/api/timer/start",
        headers: comoA(),
        payload: { projectId: escenario.projectId },
      });
      expect(start.statusCode).toBe(201);
      const patch = await app.inject({
        method: "PATCH",
        url: "/api/timer",
        headers: comoA(),
        payload: { projectId: ausenciasId },
      });
      expect(patch.statusCode).toBe(400);
      await prisma.runningTimer.deleteMany({ where: { consultantId: escenario.consultorA.id } });
    });
  });

  describe("catálogo /api/time-entry-types", () => {
    it("cualquier rol con time:read lista los activos; solo ADMIN ve inactivos con ?all=true", async () => {
      const comoConsultor = await app.inject({ method: "GET", url: "/api/time-entry-types?all=true", headers: comoA() });
      expect(comoConsultor.statusCode).toBe(200);
      const codigos = (comoConsultor.json().data as { code: string | null }[]).map((t) => t.code);
      expect(codigos).toEqual(expect.arrayContaining(["REGULAR", "EXTRA", "PERMISO", "VACACIONES"]));

      const sinPermiso = await app.inject({
        method: "GET",
        url: "/api/time-entry-types",
        headers: comoRol(AppRole.COMMERCIAL, "comercial@synaptica.test"),
      });
      expect(sinPermiso.statusCode).toBe(403);
    });

    it("solo ADMIN escribe (permiso time:types)", async () => {
      for (const rol of [AppRole.PM, AppRole.CONSULTANT, AppRole.FINANCE]) {
        const res = await app.inject({
          method: "POST",
          url: "/api/time-entry-types",
          headers: comoRol(rol, "x@synaptica.test"),
          payload: { name: `Tipo ${prefijo} no`, category: "REGULAR" },
        });
        expect(res.statusCode).toBe(403);
      }
    });

    it("crea, valida blockType, protege los tipos base y no borra tipos con registros", async () => {
      const crear = (payload: Record<string, unknown>) =>
        app.inject({ method: "POST", url: "/api/time-entry-types", headers: comoAdmin(), payload });

      // blockType obligatorio en ABSENCE y prohibido en el resto.
      expect((await crear({ name: `Tipo ${prefijo} a`, category: "ABSENCE" })).statusCode).toBe(400);
      expect((await crear({ name: `Tipo ${prefijo} b`, category: "REGULAR", blockType: "VACATION" })).statusCode).toBe(400);

      const ok = await crear({ name: `Tipo ${prefijo} Capacitación`, category: "REGULAR" });
      expect(ok.statusCode).toBe(201);
      const nuevo = ok.json().data as { id: string; code: string | null };
      expect(nuevo.code).toBeNull();
      expect((await crear({ name: `tipo ${prefijo} capacitación`, category: "REGULAR" })).statusCode).toBe(409);

      // Tipo base: ni se borra, ni cambia de categoría, y REGULAR no se desactiva.
      const base = await app.inject({ method: "DELETE", url: `/api/time-entry-types/${ids.permiso}`, headers: comoAdmin() });
      expect(base.statusCode).toBe(409);
      const categoria = await app.inject({
        method: "PATCH",
        url: `/api/time-entry-types/${ids.permiso}`,
        headers: comoAdmin(),
        payload: { category: "REGULAR" },
      });
      expect(categoria.statusCode).toBe(409);
      const desactivar = await app.inject({
        method: "PATCH",
        url: `/api/time-entry-types/${ids.regular}`,
        headers: comoAdmin(),
        payload: { active: false },
      });
      expect(desactivar.statusCode).toBe(409);
      // Renombrar un tipo base sí se puede.
      const renombrar = await app.inject({
        method: "PATCH",
        url: `/api/time-entry-types/${ids.vacaciones}`,
        headers: comoAdmin(),
        payload: { sortOrder: 3 },
      });
      expect(renombrar.statusCode).toBe(200);

      // Con registros: 409 sugiriendo desactivar. Sin registros: 204.
      await limpiarHoras();
      const conRegistro = await putDia(escenario.projectId, "2026-08-04", [{ typeId: nuevo.id, hours: 1 }]);
      expect(conRegistro.statusCode, conRegistro.body).toBe(200);
      const borrar = await app.inject({ method: "DELETE", url: `/api/time-entry-types/${nuevo.id}`, headers: comoAdmin() });
      expect(borrar.statusCode).toBe(409);
      expect(borrar.json().message).toMatch(/Desactívalo/);

      // Desactivado: ya no se acepta para registros nuevos.
      const off = await app.inject({
        method: "PATCH",
        url: `/api/time-entry-types/${nuevo.id}`,
        headers: comoAdmin(),
        payload: { active: false },
      });
      expect(off.statusCode).toBe(200);
      const nuevoUso = await putDia(escenario.projectId, "2026-08-05", [{ typeId: nuevo.id, hours: 1 }]);
      expect(nuevoUso.statusCode).toBe(400);
      expect(nuevoUso.json().code).toBe("TYPE_INACTIVE");

      await limpiarHoras();
      const libre = await crear({ name: `Tipo ${prefijo} libre`, category: "REGULAR" });
      const borrarLibre = await app.inject({
        method: "DELETE",
        url: `/api/time-entry-types/${libre.json().data.id}`,
        headers: comoAdmin(),
      });
      expect(borrarLibre.statusCode).toBe(204);

      // Queda rastro en la bitácora.
      expect(await prisma.auditLog.count({ where: { entity: "timeEntryType", entityId: nuevo.id } })).toBeGreaterThanOrEqual(2);
    });
  });
});

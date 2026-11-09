import { AppRole, ExtraHourStatus } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/infra/prisma.js";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";
import { crearEscenarioBasico, crearHoraExtra, limpiarEscenario, type EscenarioBasico , idEmpresa } from "../helpers/datos.js";
import { aprobarSemana, aprobarSemanaDeRegistro, devolverSemanaDeRegistro, lunesDe, marcarSemanaEnviada } from "../helpers/semana.js";

// El cronómetro imputa al día LOCAL del país (Colombia, UTC-5 sin horario de verano).
function diaLocalBogota(d: Date): Date {
  const l = new Date(d.getTime() - 5 * 3_600_000);
  return new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate()));
}

/**
 * R14, correcciones de la revisión de seguridad: franja atada a workDate, cierre mensual al
 * aprobar, concurrencia, límites del cronómetro, alcance de day-summary, canMutateEntry en POST y
 * revisión del excedente por el PM del proyecto con cualquier rol.
 */
describe("Timesheet R14: endurecimiento", () => {
  let app: FastifyInstance;
  let escenario: EscenarioBasico;
  let proyectoB: string;
  let regular = "";
  let extra = "";
  const pmEmail = () => `pm.${escenario.prefijo}@synaptica.test`;
  const comoA = () => comoRol(AppRole.CONSULTANT, escenario.consultorA.email);
  const comoAdmin = () => comoRol(AppRole.ADMIN, "admin@synaptica.local");
  const ids = () => [escenario.consultorA.id, escenario.consultorB.id];

  async function limpiar() {
    await prisma.timesheetWeekReview.deleteMany({ where: { consultantId: { in: ids() } } });
    await prisma.runningTimer.deleteMany({ where: { consultantId: { in: ids() } } });
    await prisma.consultantBlock.deleteMany({ where: { consultantId: { in: ids() } } });
    await prisma.timeEntry.deleteMany({ where: { consultantId: { in: ids() } } });
    await prisma.extraHourEntry.deleteMany({ where: { consultantId: { in: ids() } } });
    await prisma.monthlySnapshot.deleteMany({ where: { projectId: { in: [escenario.projectId, proyectoB] } } });
  }

  function put(projectId: string, workDate: string, entries: Record<string, unknown>[]) {
    return app.inject({ method: "PUT", url: "/api/time-entries/day", headers: comoA(), payload: { projectId, workDate, entries } });
  }

  beforeAll(async () => {
    app = await crearAppDePrueba();
    escenario = await crearEscenarioBasico("r14s");
    regular = (await prisma.timeEntryType.findFirstOrThrow({ where: { code: "REGULAR" } })).id;
    extra = (await prisma.timeEntryType.findFirstOrThrow({ where: { code: "EXTRA" } })).id;
    proyectoB = (
      await prisma.project.create({
        data: {
          name: `Proyecto B ${escenario.prefijo}`,
          companyId: await idEmpresa("Synaptica"),
          country: "Colombia",
          currency: "USD",
          budget: 1000,
          startDate: new Date(Date.UTC(2026, 0, 1)),
          endDate: new Date(Date.UTC(2026, 11, 31)),
        },
      })
    ).id;
  });

  afterAll(async () => {
    await limpiar();
    await limpiarEscenario(escenario);
    await prisma.project.deleteMany({ where: { id: proyectoB } });
    await app.close();
  });

  it("la franja debe empezar en el día local de workDate (PUT, POST y PATCH)", async () => {
    await limpiar();
    // Domingo 2026-08-09 22:00 hora de Bogotá, bajo un workDate de martes.
    const franja = { startedAt: "2026-08-10T03:00:00.000Z", endedAt: "2026-08-10T04:00:00.000Z" };

    const enPut = await put(escenario.projectId, "2026-08-11", [{ typeId: regular, hours: 1, ...franja }]);
    expect(enPut.statusCode).toBe(400);
    expect(enPut.json()).toMatchObject({ code: "SPAN_OUTSIDE_WORKDATE", index: 0 });

    const enPost = await app.inject({
      method: "POST",
      url: "/api/time-entries",
      headers: comoA(),
      payload: { projectId: escenario.projectId, workDate: "2026-08-11", hours: 1, ...franja },
    });
    expect(enPost.statusCode).toBe(400);
    expect(enPost.json().code).toBe("SPAN_OUTSIDE_WORKDATE");

    const creada = await app.inject({
      method: "POST",
      url: "/api/time-entries",
      headers: comoA(),
      payload: { projectId: escenario.projectId, workDate: "2026-08-11", hours: 1 },
    });
    expect(creada.statusCode).toBe(201);
    const enPatch = await app.inject({
      method: "PATCH",
      url: `/api/time-entries/${creada.json().data.id}`,
      headers: comoA(),
      payload: franja,
    });
    expect(enPatch.statusCode).toBe(400);
    expect(enPatch.json().code).toBe("SPAN_OUTSIDE_WORKDATE");

    // Una franja del mismo día local (aunque en UTC sea el día siguiente) sí pasa.
    const ok = await put(escenario.projectId, "2026-08-11", [
      { typeId: regular, hours: 1, startedAt: "2026-08-12T03:00:00.000Z", endedAt: "2026-08-12T04:00:00.000Z" },
    ]);
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it("aprobar y devolver la semana respetan el cierre mensual", async () => {
    await limpiar();
    const crear = () =>
      prisma.timeEntry.create({
        data: {
          projectId: escenario.projectId,
          consultantId: escenario.consultorA.id,
          workDate: new Date(Date.UTC(2026, 4, 12)),
          hours: 2,
          typeId: regular,
        },
      });
    const [a, b] = [await crear(), await crear()];
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
    const pm = comoRol(AppRole.PM, pmEmail());
    const aprobar = await aprobarSemanaDeRegistro(app, pm, a.id);
    expect(aprobar.statusCode).toBe(400);
    expect(aprobar.json().message).toMatch(/mes cerrado/);
    const devolver = await devolverSemanaDeRegistro(app, pm, b.id, "no procede");
    expect(devolver.statusCode).toBe(400);
    // Nada cambió: siguen enviados y la revisión sigue pendiente.
    expect((await prisma.timeEntry.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("SUBMITTED");
    expect((await prisma.timesheetWeekReview.findFirstOrThrow({ where: { consultantId: escenario.consultorA.id } })).status).toBe("SUBMITTED");
  });

  it("dos PUT /day concurrentes que juntos superan la jornada: uno falla", async () => {
    await limpiar();
    const [r1, r2] = await Promise.all([
      put(escenario.projectId, "2026-08-04", [{ typeId: regular, hours: 5 }]),
      put(proyectoB, "2026-08-04", [{ typeId: regular, hours: 5 }]),
    ]);
    expect([r1.statusCode, r2.statusCode].sort()).toEqual([200, 400]);
    const total = (await prisma.timeEntry.findMany({ where: { consultantId: escenario.consultorA.id } })).reduce(
      (acc, e) => acc + Number(e.hours),
      0,
    );
    expect(total).toBe(5);
  });

  describe("cronómetro", () => {
    it("no acepta un inicio de hace más de 24 h (start y PATCH)", async () => {
      await limpiar();
      const viejo = new Date(Date.now() - 30 * 3_600_000).toISOString();
      const start = await app.inject({
        method: "POST",
        url: "/api/timer/start",
        headers: comoA(),
        payload: { projectId: escenario.projectId, startedAt: viejo },
      });
      expect(start.statusCode).toBe(400);
      expect(start.json().message).toMatch(/24 horas/);

      const ok = await app.inject({ method: "POST", url: "/api/timer/start", headers: comoA(), payload: { projectId: escenario.projectId } });
      expect(ok.statusCode).toBe(201);
      const patch = await app.inject({ method: "PATCH", url: "/api/timer", headers: comoA(), payload: { startedAt: viejo } });
      expect(patch.statusCode).toBe(400);
      await prisma.runningTimer.deleteMany({ where: { consultantId: escenario.consultorA.id } });
    });

    it("al detener, un tramo se topa en 24 h y lo que exceda se suma a discardedHours (sin EXTRA)", async () => {
      await limpiar();
      const consultor = await prisma.consultant.create({
        data: {
          fullName: `Largo ${escenario.prefijo}`,
          email: `largo.${escenario.prefijo}@synaptica.test`,
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
        // Un cronómetro heredado de hace 40 h (el start ya no lo permite).
        const inicio = new Date(Date.now() - 40 * 3_600_000);
        await prisma.runningTimer.create({
          data: { consultantId: consultor.id, projectId: escenario.projectId, startedAt: inicio },
        });
        const solicitud = await crearHoraExtra({
          consultantId: consultor.id,
          projectId: escenario.projectId,
          fecha: diaLocalBogota(inicio),
        });
        await prisma.extraHourEntry.update({
          where: { id: solicitud.id },
          data: { status: ExtraHourStatus.APPROVED, totalHours: 1 },
        });

        const stop = await app.inject({ method: "POST", url: "/api/timer/stop", headers: comoRol(AppRole.CONSULTANT, consultor.email!), payload: { consultantId: consultor.id } });
        expect(stop.statusCode, stop.body).toBe(201);
        const cuerpo = stop.json() as { entries: { hours: string }[]; discardedHours: number };
        // Solo 8 h regulares (la jornada); las otras 32 h se descartan aunque haya solicitud aprobada.
        expect(cuerpo.entries.map((e) => Math.round(Number(e.hours)))).toEqual([8]);
        expect(cuerpo.discardedHours).toBeCloseTo(32, 2);
      } finally {
        await prisma.timeEntry.deleteMany({ where: { consultantId: consultor.id } });
        await prisma.extraHourEntry.deleteMany({ where: { consultantId: consultor.id } });
        await prisma.runningTimer.deleteMany({ where: { consultantId: consultor.id } });
        await prisma.consultant.delete({ where: { id: consultor.id } });
      }
    });
  });

  it("day-summary: un PM solo ve a quien tiene horas o asignación en sus proyectos", async () => {
    await limpiar();
    await prisma.timeEntry.create({
      data: {
        projectId: escenario.projectId,
        consultantId: escenario.consultorA.id,
        workDate: new Date(Date.UTC(2026, 7, 4)),
        hours: 1,
        typeId: regular,
      },
    });
    const url = (id: string) => `/api/time-entries/day-summary?from=2026-08-04&to=2026-08-04&consultantId=${id}`;
    const suyo = await app.inject({ method: "GET", url: url(escenario.consultorA.id), headers: comoRol(AppRole.PM, pmEmail()) });
    expect(suyo.statusCode).toBe(200);
    const ajeno = await app.inject({ method: "GET", url: url(escenario.consultorB.id), headers: comoRol(AppRole.PM, pmEmail()) });
    expect(ajeno.statusCode).toBe(403);
    const otroPm = await app.inject({ method: "GET", url: url(escenario.consultorA.id), headers: comoRol(AppRole.PM, "otro.pm@synaptica.test") });
    expect(otroPm.statusCode).toBe(403);
    const admin = await app.inject({ method: "GET", url: url(escenario.consultorB.id), headers: comoAdmin() });
    expect(admin.statusCode).toBe(200);
  });

  it("POST /time-entries pasa por canMutateEntry: un PM ajeno al proyecto no registra a nombre de otro", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/time-entries",
      headers: comoRol(AppRole.PM, "otro.pm@synaptica.test"),
      payload: { projectId: escenario.projectId, consultantId: escenario.consultorB.id, workDate: "2026-08-04", hours: 1 },
    });
    expect(res.statusCode).toBe(403);
  });

  it("el PM del proyecto con rol CONSULTANT revisa la semana (incluido el excedente); quien no es PM no", async () => {
    await limpiar();
    const crear = (dia: number, isExcess: boolean) =>
      prisma.timeEntry.create({
        data: {
          projectId: escenario.projectId,
          consultantId: escenario.consultorA.id,
          workDate: new Date(Date.UTC(2026, 7, dia)),
          hours: 1,
          typeId: isExcess ? extra : regular,
          isExcess,
        },
      });
    const [excedente, normal] = [await crear(11, true), await crear(11, false)];
    const pmConsultor = comoRol(AppRole.CONSULTANT, pmEmail());
    const item = { consultantId: escenario.consultorA.id, projectId: escenario.projectId, weekStart: lunesDe(excedente.workDate) };

    // Quien no es PM del proyecto no puede, sea cual sea su rol.
    await marcarSemanaEnviada(item.consultantId, item.projectId, excedente.workDate);
    const noPm = await aprobarSemana(app, comoRol(AppRole.CONSULTANT, "cualquiera@synaptica.test"), item);
    expect(noPm.statusCode).toBe(403);

    // El PM (con rol CONSULTANT) devuelve la semana: excedente y horas normales vuelven a PENDING.
    const devuelve = await app.inject({
      method: "POST",
      url: "/api/timesheet-reviews/return",
      headers: pmConsultor,
      payload: { ...item, note: "no se autoriza" },
    });
    expect(devuelve.statusCode, devuelve.body).toBe(200);
    for (const id of [excedente.id, normal.id]) {
      expect((await prisma.timeEntry.findUniqueOrThrow({ where: { id } })).status).toBe("PENDING");
    }

    // Reenvía y el PM aprueba: el excedente se aprueba junto con el resto de la semana.
    await marcarSemanaEnviada(item.consultantId, item.projectId, excedente.workDate);
    const aprueba = await aprobarSemana(app, pmConsultor, item);
    expect(aprueba.statusCode, aprueba.body).toBe(200);
    for (const id of [excedente.id, normal.id]) {
      expect((await prisma.timeEntry.findUniqueOrThrow({ where: { id } })).status).toBe("APPROVED");
    }
  });

  it("nómina: una solicitud legacy con solo registros RECHAZADOS vinculados sigue pagándose", async () => {
    await limpiar();
    const solicitud = await crearHoraExtra({
      consultantId: escenario.consultorB.id,
      projectId: escenario.projectId,
      fecha: new Date(Date.UTC(2026, 8, 10)),
    });
    await prisma.extraHourEntry.update({
      where: { id: solicitud.id },
      data: { status: ExtraHourStatus.APPROVED, createdAt: new Date(Date.UTC(2026, 9, 1)) },
    });
    await prisma.timeEntry.create({
      data: {
        projectId: escenario.projectId,
        consultantId: escenario.consultorB.id,
        workDate: new Date(Date.UTC(2026, 8, 10)),
        hours: 1,
        typeId: extra,
        status: "REJECTED",
        extraHourEntryId: solicitud.id,
      },
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/extra-hours/payroll?year=2026&month=9",
      headers: comoRol(AppRole.FINANCE, "nomina@synaptica.test"),
    });
    const fila = (res.json().data as { consultantName: string; legacy: boolean }[]).find(
      (c) => c.consultantName === `Consultor B ${escenario.prefijo}`,
    );
    expect(fila?.legacy).toBe(true);
    expect(res.json().meta.legacyRequestIds).toContain(solicitud.id);
  });
});

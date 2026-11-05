import { AppRole, ExtraHourStatus } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/infra/prisma.js";
import { addDaysIso, fromIsoDate } from "../../src/utils/isoDate.js";
import { localCalendarDay } from "../../src/modules/timesheet-weeks/timesheet-weeks.service.js";
import { weekStartOf } from "../../src/utils/timesheetWeek.js";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";
import { crearHoraExtra } from "../helpers/datos.js";
import { aprobarSemana, devolverSemana, marcarSemanaEnviada } from "../helpers/semana.js";

// El aviso de devolución por correo se intercepta (no hay SMTP en pruebas).
vi.mock("../../src/utils/notifications.js", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("../../src/utils/notifications.js")>();
  return { ...original, notifyTimesheetReturned: vi.fn(async () => {}) };
});

/**
 * QA de R15 (aprobación semanal): flujos de punta a punta SOLO por rutas, sin atajos en la base
 * salvo para sembrar datos "históricos" (anteriores a R15) que hoy ninguna ruta puede producir.
 *
 * Cubre lo que las suites `timesheet-semanal*.test.ts` no ejercitan juntas:
 *  1. Varios proyectos y PMs en la misma semana: aprobar uno, devolver otro, corregir, reenviar,
 *     con `/stats/overview` y el cierre de mes comprobados en cada paso.
 *  2. Integración con R14: excedente de horas extra aprobado con la semana y nómina; ausencia de
 *     jornada completa -> bloque de capacidad.
 *  3. Delegación por rango (creada por la ruta real).
 *  4. Validación del envío con jornada Colombia 8.4 por vigencia, festivo y fecha de ingreso.
 *  5. Cronómetro en semana enviada y luego devuelta.
 *  6. Regresión: APPROVED/REJECTED anteriores a R15 sin revisión.
 */
describe("R15 QA: flujos por rutas", () => {
  let app: FastifyInstance;
  const prefijo = `r15qa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const pm1 = `pm1.${prefijo}@synaptica.test`;
  const pm2 = `pm2.${prefijo}@synaptica.test`;
  const adminEmail = "admin@synaptica.local";
  const ids = { regular: "", extra: "", vacaciones: "", ausencias: "" };
  const consultores: string[] = [];
  const proyectos: string[] = [];
  const restaurar: (() => Promise<void>)[] = [];
  let n = 0;

  const comoAdmin = () => comoRol(AppRole.ADMIN, adminEmail);
  const comoPM1 = () => comoRol(AppRole.PM, pm1);
  const comoPM2 = () => comoRol(AppRole.PM, pm2);
  const como = (c: { email: string }) => comoRol(AppRole.CONSULTANT, c.email);
  const lunAVie = (lunes: string) => [0, 1, 2, 3, 4].map((i) => addDaysIso(lunes, i));

  async function nuevoConsultor(opts: { jornada?: number | null; hireDate?: string; allowWeekendWork?: boolean; email?: string } = {}) {
    n += 1;
    const email = opts.email ?? `c${n}.${prefijo}@synaptica.test`;
    const c = await prisma.consultant.create({
      data: {
        fullName: `QA${n} ${prefijo}`,
        email,
        role: "Consultor",
        hourlyRate: 50,
        rateCurrency: "USD",
        country: "Colombia",
        allowWeekendWork: opts.allowWeekendWork ?? false,
        hireDate: opts.hireDate ? fromIsoDate(opts.hireDate) : null,
      },
    });
    consultores.push(c.id);
    // Jornada propia (8 h) salvo que se pida la del país (null).
    if (opts.jornada !== null) {
      await prisma.capacityConfig.create({
        data: { consultantId: c.id, validFrom: new Date(Date.UTC(2000, 0, 1)), hoursPerDay: opts.jornada ?? 8 },
      });
    }
    return { id: c.id, email, fullName: c.fullName };
  }

  async function nuevoProyecto(nombre: string, pm: string | null) {
    const p = await prisma.project.create({
      data: {
        name: `${nombre} ${prefijo}`,
        company: "Synaptica",
        country: "Colombia",
        currency: "USD",
        budget: 100000,
        startDate: new Date(Date.UTC(2026, 0, 1)),
        endDate: new Date(Date.UTC(2027, 11, 31)),
        projectManagerEmail: pm,
      },
    });
    proyectos.push(p.id);
    return p.id;
  }

  const putDia = (headers: Record<string, string>, projectId: string, workDate: string, entries: Record<string, unknown>[], consultantId?: string) =>
    app.inject({ method: "PUT", url: "/api/time-entries/day", headers, payload: { projectId, workDate, entries, consultantId } });
  const enviar = (headers: Record<string, string>, weekStart: string, consultantId?: string) =>
    app.inject({ method: "POST", url: "/api/timesheet-weeks/submit", headers, payload: { weekStart, consultantId } });
  const estado = async (headers: Record<string, string>, weekStart: string) =>
    (await app.inject({ method: "GET", url: `/api/timesheet-weeks/status?weekStart=${weekStart}`, headers })).json().data;
  const cerrarMes = (projectId: string, year: number, month: number) =>
    app.inject({ method: "POST", url: "/api/snapshots/close", headers: comoAdmin(), payload: { projectId, year, month } });
  async function horasDe(projectId: string) {
    const res = await app.inject({ method: "GET", url: `/api/stats/overview?projectId=${projectId}`, headers: comoAdmin() });
    expect(res.statusCode, res.body).toBe(200);
    const fila = res.json().data.projects.find((p: { projectId: string }) => p.projectId === projectId);
    return { approved: fila.approvedHours, submitted: fila.submittedHours, pending: fila.pendingHours, total: fila.totalHours };
  }
  const regular = (hours: number, extra: Record<string, unknown> = {}) => ({ typeId: ids.regular, hours, ...extra });

  beforeAll(async () => {
    app = await crearAppDePrueba();
    const tipos = await prisma.timeEntryType.findMany();
    ids.regular = tipos.find((t) => t.code === "REGULAR")!.id;
    ids.extra = tipos.find((t) => t.code === "EXTRA")!.id;
    ids.vacaciones = tipos.find((t) => t.code === "VACACIONES")!.id;
    ids.ausencias = (await prisma.project.findFirstOrThrow({ where: { isAbsenceProject: true } })).id;

    // Jornada de Colombia con vigencia (como en producción): 8 h y 8.4 h desde el 2026-07-15.
    for (const [desde, horas] of [["2000-01-01", 8], ["2026-07-15", 8.4]] as const) {
      const validFrom = fromIsoDate(desde);
      const previa = await prisma.capacityConfig.findUnique({ where: { country_validFrom: { country: "Colombia", validFrom } } });
      await prisma.capacityConfig.upsert({
        where: { country_validFrom: { country: "Colombia", validFrom } },
        update: { hoursPerDay: horas },
        create: { country: "Colombia", validFrom, hoursPerDay: horas },
      });
      restaurar.push(async () => {
        if (previa) await prisma.capacityConfig.update({ where: { id: previa.id }, data: { hoursPerDay: previa.hoursPerDay } });
        else await prisma.capacityConfig.deleteMany({ where: { country: "Colombia", validFrom } });
      });
    }
  });

  afterAll(async () => {
    for (const r of restaurar.reverse()) await r();
    await prisma.timesheetWeekReview.deleteMany({ where: { consultantId: { in: consultores } } });
    await prisma.runningTimer.deleteMany({ where: { consultantId: { in: consultores } } });
    await prisma.consultantBlock.deleteMany({ where: { consultantId: { in: consultores } } });
    await prisma.timeEntry.deleteMany({ where: { consultantId: { in: consultores } } });
    await prisma.extraHourEntry.deleteMany({ where: { consultantId: { in: consultores } } });
    await prisma.capacityConfig.deleteMany({ where: { consultantId: { in: consultores } } });
    await prisma.consultant.deleteMany({ where: { id: { in: consultores } } });
    await prisma.monthlySnapshot.deleteMany({ where: { projectId: { in: proyectos } } });
    await prisma.approvalDelegation.deleteMany({ where: { projectId: { in: proyectos } } });
    await prisma.holiday.deleteMany({ where: { name: { startsWith: `Festivo ${prefijo}` } } });
    await prisma.project.deleteMany({ where: { id: { in: proyectos } } });
    await app.close();
  });

  // ---------------------------------------------------------------------------------------------
  describe("1. e2e: dos proyectos con PM distinto + ausencia", () => {
    it("aprobar P1, devolver P2, corregir, reenviar, aprobar y cerrar el mes", async () => {
      const p1 = await nuevoProyecto("E2E P1", pm1);
      const p2 = await nuevoProyecto("E2E P2", pm2);
      const p3 = await nuevoProyecto("E2E P3", pm1);
      const c = await nuevoConsultor();
      const lunes = "2026-09-14";
      const [lu, ma, mi, ju, vi_] = lunAVie(lunes);

      // Registro por la ruta real: lun-jue 4 h en P1 y 4 h en P2; viernes vacaciones de jornada completa.
      for (const d of [lu, ma, mi, ju]) {
        expect((await putDia(como(c), p1, d, [regular(4, { description: `P1 ${d}` })])).statusCode).toBe(200);
        expect((await putDia(como(c), p2, d, [regular(4, { description: `P2 ${d}` })])).statusCode).toBe(200);
      }
      const vac = await putDia(como(c), ids.ausencias, vi_, [{ typeId: ids.vacaciones, hours: 8 }]);
      expect(vac.statusCode, vac.body).toBe(200);

      // Paso 0: todo pendiente, nada aprobado; el mes no se cierra.
      expect(await horasDe(p1)).toEqual({ approved: 0, submitted: 0, pending: 16, total: 0 });
      expect(await horasDe(p2)).toEqual({ approved: 0, submitted: 0, pending: 16, total: 0 });
      expect((await cerrarMes(p1, 2026, 9)).statusCode).toBe(409);

      // Paso 1: envío. Viajan los tres proyectos (incluido Ausencias).
      const envio = await enviar(como(c), lunes);
      expect(envio.statusCode, envio.body).toBe(201);
      expect([...envio.json().data.submittedProjectIds].sort()).toEqual([p1, p2, ids.ausencias].sort());
      expect(envio.json().data.submittedHours).toBe(40);
      expect(await horasDe(p1)).toEqual({ approved: 0, submitted: 16, pending: 0, total: 0 });
      const cierreEnviado = await cerrarMes(p1, 2026, 9);
      expect(cierreEnviado.statusCode).toBe(409);
      expect(cierreEnviado.json()).toMatchObject({ code: "PENDING_HOURS", pending: [{ consultantId: c.id, weekStart: lunes, hours: 16, status: "SUBMITTED" }] });

      // Cada PM ve solo su proyecto en la bandeja.
      const bandeja1 = await app.inject({ method: "GET", url: `/api/timesheet-reviews?consultantId=${c.id}`, headers: comoPM1() });
      expect(bandeja1.json().data.map((r: { projectId: string }) => r.projectId)).toEqual([p1]);
      const bandeja2 = await app.inject({ method: "GET", url: `/api/timesheet-reviews?consultantId=${c.id}`, headers: comoPM2() });
      expect(bandeja2.json().data.map((r: { projectId: string }) => r.projectId)).toEqual([p2]);
      // PM1 no aprueba P2 ni la ausencia (sin PM -> ADMIN).
      expect((await aprobarSemana(app, comoPM1(), { consultantId: c.id, projectId: p2, weekStart: lunes })).statusCode).toBe(403);
      expect((await aprobarSemana(app, comoPM1(), { consultantId: c.id, projectId: ids.ausencias, weekStart: lunes })).statusCode).toBe(403);

      // Paso 2: PM1 aprueba P1.
      const ap1 = await aprobarSemana(app, comoPM1(), { consultantId: c.id, projectId: p1, weekStart: lunes });
      expect(ap1.statusCode, ap1.body).toBe(200);
      expect(await horasDe(p1)).toEqual({ approved: 16, submitted: 0, pending: 0, total: 16 });

      // Paso 3: PM2 devuelve P2 con nota.
      const nota = "Las descripciones de P2 no dicen qué entregable";
      const dev = await devolverSemana(app, comoPM2(), { consultantId: c.id, projectId: p2, weekStart: lunes, note: nota });
      expect(dev.statusCode, dev.body).toBe(200);
      const enP2 = await prisma.timeEntry.findMany({ where: { consultantId: c.id, projectId: p2 } });
      expect(enP2).toHaveLength(4);
      expect(enP2.every((e) => e.status === "PENDING" && e.rejectionNote === nota && e.rejectedBy === pm2)).toBe(true);
      const enP1 = await prisma.timeEntry.findMany({ where: { consultantId: c.id, projectId: p1 } });
      expect(enP1.every((e) => e.status === "APPROVED" && e.approvedBy === pm1)).toBe(true);
      expect(await horasDe(p2)).toEqual({ approved: 0, submitted: 0, pending: 16, total: 0 });
      const st = await estado(como(c), lunes);
      expect(st.editableProjectIds).toEqual([p2]);
      expect(st.submission.projectsToSubmit).toEqual([p2]);

      // Paso 4: P1 bloqueado por todas las vías; P3 (nuevo) tampoco; mover un registro de P2 a P1, no.
      const bloqueado = (r: { statusCode: number; json: () => { code?: string } }, etiqueta: string) => {
        expect(r.statusCode, etiqueta).toBe(409);
        expect(r.json().code, etiqueta).toBe("WEEK_LOCKED");
      };
      bloqueado(await putDia(como(c), p1, lu, [regular(4)]), "PUT /day P1");
      bloqueado(await app.inject({ method: "PATCH", url: `/api/time-entries/${enP1[0].id}`, headers: como(c), payload: { description: "x" } }), "PATCH P1");
      bloqueado(await app.inject({ method: "DELETE", url: `/api/time-entries/${enP1[0].id}`, headers: como(c) }), "DELETE P1");
      bloqueado(await app.inject({ method: "POST", url: "/api/time-entries", headers: como(c), payload: { projectId: p3, workDate: lu, hours: 1 } }), "POST P3");
      bloqueado(await putDia(como(c), p3, lu, [regular(1)]), "PUT /day P3");
      bloqueado(
        await app.inject({ method: "PATCH", url: `/api/time-entries/${enP2[0].id}`, headers: como(c), payload: { projectId: p1 } }),
        "mover P2 -> P1",
      );
      // Ni el PM de P1 ni ADMIN escriben en lo aprobado por PUT /day.
      bloqueado(await putDia(comoPM1(), p1, lu, [regular(4)], c.id), "PUT /day P1 como PM1");
      bloqueado(await putDia(comoAdmin(), p1, lu, [regular(4)], c.id), "PUT /day P1 como ADMIN");

      // Corrección de P2: dejar un día corto bloquea el reenvío; corregirlo bien, no.
      const fila = enP2.find((e) => e.workDate.toISOString().startsWith(lu))!;
      expect((await putDia(como(c), p2, lu, [regular(2, { id: fila.id, description: "Entregable: informe" })])).statusCode).toBe(200);
      const corto = await enviar(como(c), lunes);
      expect(corto.statusCode).toBe(400);
      expect(corto.json().errors).toEqual([expect.objectContaining({ code: "INCOMPLETE_DAY", date: lu, missingHours: 2 })]);
      expect((await putDia(como(c), p2, lu, [regular(4, { id: fila.id, description: "Entregable: informe" })])).statusCode).toBe(200);

      // Paso 5: reenvío -> solo viaja P2.
      const reenvio = await enviar(como(c), lunes);
      expect(reenvio.statusCode, reenvio.body).toBe(201);
      expect(reenvio.json().data.submittedProjectIds).toEqual([p2]);
      expect(await horasDe(p2)).toEqual({ approved: 0, submitted: 16, pending: 0, total: 0 });
      expect((await prisma.timeEntry.findMany({ where: { consultantId: c.id, projectId: p2 } })).every((e) => e.rejectionNote === null)).toBe(true);

      // Paso 6: PM2 aprueba P2 y ADMIN la ausencia.
      expect((await aprobarSemana(app, comoPM2(), { consultantId: c.id, projectId: p2, weekStart: lunes })).statusCode).toBe(200);
      expect((await aprobarSemana(app, comoAdmin(), { consultantId: c.id, projectId: ids.ausencias, weekStart: lunes })).statusCode).toBe(200);
      const fin = await estado(como(c), lunes);
      expect(fin.reviews.map((r: { status: string }) => r.status)).toEqual(["APPROVED", "APPROVED", "APPROVED"]);
      expect(fin.editableProjectIds).toEqual([]);
      expect(fin.submission.errors.map((e: { code: string }) => e.code)).toEqual(["NOTHING_TO_SUBMIT"]);
      expect(await horasDe(p2)).toEqual({ approved: 16, submitted: 0, pending: 0, total: 16 });
      expect((await enviar(como(c), lunes)).statusCode).toBe(409);

      // Ausencia de jornada completa aprobada -> bloque de capacidad del viernes.
      const bloques = await prisma.consultantBlock.findMany({ where: { consultantId: c.id } });
      expect(bloques.map((b) => b.startDate.toISOString().slice(0, 10))).toEqual([vi_]);

      // Paso 7: ya se puede cerrar el mes de ambos proyectos.
      const cierre1 = await cerrarMes(p1, 2026, 9);
      expect(cierre1.statusCode, cierre1.body).toBe(201);
      expect(Number(cierre1.json().data.hoursApproved)).toBe(16);
      expect((await cerrarMes(p2, 2026, 9)).statusCode).toBe(201);
      // Con el mes cerrado, ni ADMIN corrige lo aprobado.
      expect((await app.inject({ method: "DELETE", url: `/api/time-entries/${enP1[0].id}`, headers: comoAdmin() })).statusCode).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("2. integración con R14: excedente y nómina", () => {
    it("el excedente viaja y se aprueba con la semana; la nómina solo lo paga tras aprobar", async () => {
      const p = await nuevoProyecto("Extra", pm1);
      const c = await nuevoConsultor();
      const lunes = "2026-09-21";
      const dias = lunAVie(lunes);
      const martes = dias[1];
      const solicitud = await crearHoraExtra({ consultantId: c.id, projectId: p, fecha: fromIsoDate(martes) });
      await prisma.extraHourEntry.update({ where: { id: solicitud.id }, data: { status: ExtraHourStatus.APPROVED } });

      for (const d of dias) {
        const filas: Record<string, unknown>[] = [regular(8)];
        // 19:00-22:00 en Bogotá = 00:00-03:00 UTC del día siguiente: 2 h de saldo + 1 h de excedente.
        if (d === martes) filas.push({ typeId: ids.extra, hours: 3, startedAt: `${dias[2]}T00:00:00.000Z`, endedAt: `${dias[2]}T03:00:00.000Z` });
        const r = await putDia(como(c), p, d, filas);
        expect(r.statusCode, r.body).toBe(200);
      }
      const extras = await prisma.timeEntry.findMany({ where: { consultantId: c.id, typeId: ids.extra } });
      expect(extras.map((e) => [Number(e.hours), e.isExcess]).sort()).toEqual([[1, true], [2, false]]);

      const nomina = async () =>
        (await app.inject({ method: "GET", url: "/api/extra-hours/payroll?year=2026&month=9", headers: comoRol(AppRole.FINANCE, "nomina@synaptica.test") }))
          .json()
          .data.find((r: { consultantName: string }) => r.consultantName === c.fullName);
      const excesoPendiente = async () =>
        (await app.inject({ method: "GET", url: "/api/extra-hours", headers: comoAdmin() }))
          .json()
          .data.find((r: { id: string }) => r.id === solicitud.id).excessPendingHours;

      expect(await nomina()).toBeUndefined();
      expect(await excesoPendiente()).toBe(1);

      expect((await enviar(como(c), lunes)).statusCode).toBe(201);
      expect(await nomina()).toBeUndefined();
      expect(await excesoPendiente()).toBe(1);

      // Una devolución deja el excedente pendiente (sigue partido igual) y fuera de nómina.
      expect((await devolverSemana(app, comoPM1(), { consultantId: c.id, projectId: p, weekStart: lunes, note: "Justifica el excedente" })).statusCode).toBe(200);
      const trasDevolver = await prisma.timeEntry.findMany({ where: { consultantId: c.id, typeId: ids.extra } });
      expect(trasDevolver.map((e) => [Number(e.hours), e.isExcess, e.status]).sort()).toEqual([[1, true, "PENDING"], [2, false, "PENDING"]]);
      expect(await nomina()).toBeUndefined();

      expect((await enviar(como(c), lunes)).statusCode).toBe(201);
      // ADMIN no decide el excedente de un proyecto con PM.
      expect((await aprobarSemana(app, comoAdmin(), { consultantId: c.id, projectId: p, weekStart: lunes })).statusCode).toBe(403);
      const ok = await aprobarSemana(app, comoPM1(), { consultantId: c.id, projectId: p, weekStart: lunes });
      expect(ok.statusCode, ok.body).toBe(200);

      const aprobadas = await prisma.timeEntry.findMany({ where: { consultantId: c.id, typeId: ids.extra } });
      expect(aprobadas.every((e) => e.status === "APPROVED")).toBe(true);
      expect(await excesoPendiente()).toBe(0);
      const fila = await nomina();
      expect(fila).toBeDefined();
      expect(fila.realHours).toBeCloseTo(3, 4); // saldo + excedente aprobado
      expect(fila.totalAmountLocal).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("3. delegación por rango", () => {
    it("el delegado aprueba dentro del rango, recibe 403 fuera y nunca aprueba lo suyo", async () => {
      const p = await nuevoProyecto("Delegado P", pm1);
      const delegadoEmail = `dele.${prefijo}@synaptica.test`;
      // Para ser candidato, el delegado dirige otro proyecto.
      await nuevoProyecto("Proyecto del delegado", delegadoEmail);
      const c = await nuevoConsultor();
      const d = await nuevoConsultor({ email: delegadoEmail });
      const dentro = "2026-09-21";
      const antes = "2026-09-14";
      const despues = "2026-09-28";
      for (const semana of [dentro, antes, despues]) {
        for (const dia of lunAVie(semana)) await putDia(como(c), p, dia, [regular(8)]);
        expect((await enviar(como(c), semana)).statusCode).toBe(201);
      }
      for (const dia of lunAVie(dentro)) await putDia(como(d), p, dia, [regular(8)]);
      expect((await enviar(como(d), dentro)).statusCode).toBe(201);

      // PM1 delega SOLO el lunes 2026-09-21 (la semana entera queda cubierta: "algún día").
      const deleg = await app.inject({
        method: "POST",
        url: "/api/delegations",
        headers: comoPM1(),
        payload: { projectId: p, toUserEmail: delegadoEmail, startDate: "2026-09-21", endDate: "2026-09-21" },
      });
      expect(deleg.statusCode, deleg.body).toBe(201);

      const comoD = comoRol(AppRole.PM, delegadoEmail);
      // La bandeja del delegado solo trae la semana cubierta (y no la suya).
      const bandeja = await app.inject({ method: "GET", url: `/api/timesheet-reviews?projectId=${p}`, headers: comoD });
      expect(bandeja.json().data.map((r: { consultantId: string; weekStart: string }) => `${r.consultantId}|${r.weekStart}`)).toEqual([`${c.id}|${dentro}`]);

      // Fuera del rango (semana anterior y siguiente): 403 NOT_REVIEWER, al aprobar y al devolver.
      for (const semana of [antes, despues]) {
        const r = await aprobarSemana(app, comoD, { consultantId: c.id, projectId: p, weekStart: semana });
        expect(r.statusCode).toBe(403);
        expect(r.json().code).toBe("NOT_REVIEWER");
        expect((await devolverSemana(app, comoD, { consultantId: c.id, projectId: p, weekStart: semana, note: "fuera de rango" })).statusCode).toBe(403);
      }
      // Su propia semana, aunque esté dentro del rango: 403.
      const propia = await aprobarSemana(app, comoD, { consultantId: d.id, projectId: p, weekStart: dentro });
      expect(propia.statusCode).toBe(403);
      expect(propia.json().code).toBe("NOT_REVIEWER");

      // Dentro del rango: aprueba, y queda su correo como revisor.
      const ok = await aprobarSemana(app, comoD, { consultantId: c.id, projectId: p, weekStart: dentro });
      expect(ok.statusCode, ok.body).toBe(200);
      const rev = await prisma.timesheetWeekReview.findFirstOrThrow({ where: { consultantId: c.id, projectId: p, weekStart: fromIsoDate(dentro) } });
      expect(rev.reviewedBy).toBe(delegadoEmail);

      // La delegación no es exclusiva: el PM sigue aprobando (la del delegado y la de fuera del rango).
      expect((await aprobarSemana(app, comoPM1(), { consultantId: d.id, projectId: p, weekStart: dentro })).statusCode).toBe(200);
      expect((await aprobarSemana(app, comoPM1(), { consultantId: c.id, projectId: p, weekStart: antes })).statusCode).toBe(200);
    });

    // HALLAZGO: `POST /api/delegations` guarda `fromUserEmail` = quien la crea. Si la crea un ADMIN
    // para un proyecto con PM, queda `fromUserEmail = admin` y `resolveReviewer` exige
    // `fromUserEmail = PM`: la delegación se acepta (201) pero no habilita nada. `it.fails` documenta
    // el comportamiento esperado; cuando se corrija, esta prueba empezará a fallar y hay que quitar `.fails`.
    it("una delegación creada por ADMIN en nombre del PM habilita al delegado", async () => {
      const p = await nuevoProyecto("Delegado por admin", pm1);
      const delegadoEmail = `dele2.${prefijo}@synaptica.test`;
      await nuevoProyecto("Proyecto del delegado 2", delegadoEmail);
      const c = await nuevoConsultor();
      const semana = "2026-10-05";
      for (const dia of lunAVie(semana)) await putDia(como(c), p, dia, [regular(8)]);
      expect((await enviar(como(c), semana)).statusCode).toBe(201);
      const deleg = await app.inject({
        method: "POST",
        url: "/api/delegations",
        headers: comoAdmin(),
        payload: { projectId: p, toUserEmail: delegadoEmail, startDate: "2026-10-01", endDate: "2026-10-31" },
      });
      expect(deleg.statusCode, deleg.body).toBe(201);
      const r = await aprobarSemana(app, comoRol(AppRole.PM, delegadoEmail), { consultantId: c.id, projectId: p, weekStart: semana });
      expect(r.statusCode, r.body).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("4. validación del envío", () => {
    it("Colombia 8.4 vigente: 8 h por día no completa; 8.4 sí", async () => {
      const p = await nuevoProyecto("Jornada", pm1);
      const c = await nuevoConsultor({ jornada: null }); // jornada del país
      const lunes = "2026-09-07";
      for (const d of lunAVie(lunes)) expect((await putDia(como(c), p, d, [regular(8)])).statusCode).toBe(200);
      const corto = await enviar(como(c), lunes);
      expect(corto.statusCode).toBe(400);
      expect(corto.json().code).toBe("WEEK_NOT_SUBMITTABLE");
      expect(corto.json().errors).toHaveLength(5);
      for (const e of corto.json().errors) expect(e).toMatchObject({ code: "INCOMPLETE_DAY", missingHours: 0.4 });
      expect(corto.json().errors[0].message).toMatch(/faltan 0:24/);
      expect(corto.json().days.find((d: { date: string }) => d.date === lunes).required).toBe(8.4);

      for (const d of lunAVie(lunes)) expect((await putDia(como(c), p, d, [regular(8.4)])).statusCode).toBe(200);
      expect((await enviar(como(c), lunes)).statusCode).toBe(201);
    });

    it("semana que cruza el cambio de vigencia: lun-mar 8 h, mié-vie 8.4 h", async () => {
      const p = await nuevoProyecto("Vigencia", pm1);
      const c = await nuevoConsultor({ jornada: null });
      const lunes = "2026-07-13"; // la jornada de 8.4 h rige desde el miércoles 15
      const [lu, ma, mi, ju, vi_] = lunAVie(lunes);
      for (const d of [lu, ma, mi, ju, vi_]) expect((await putDia(como(c), p, d, [regular(8)])).statusCode).toBe(200);
      const corto = await enviar(como(c), lunes);
      expect(corto.statusCode).toBe(400);
      expect(corto.json().errors.map((e: { date: string }) => e.date)).toEqual([mi, ju, vi_]);
      for (const d of [mi, ju, vi_]) expect((await putDia(como(c), p, d, [regular(8.4)])).statusCode).toBe(200);
      expect((await enviar(como(c), lunes)).statusCode).toBe(201);
    });

    it("festivo nacional no se exige; festivo de otra ciudad sí", async () => {
      const p = await nuevoProyecto("Festivo", pm1);
      const c = await nuevoConsultor();
      await prisma.consultant.update({ where: { id: c.id }, data: { city: "Bogotá" } });
      const lunes = "2026-10-12";
      const [lu, ma, mi, ju, vi_] = lunAVie(lunes);
      await prisma.holiday.createMany({
        data: [
          { country: "Colombia", city: "", date: fromIsoDate(lu), name: `Festivo ${prefijo} nacional` },
          { country: "Colombia", city: "Medellín", date: fromIsoDate(ma), name: `Festivo ${prefijo} Medellín` },
        ],
        skipDuplicates: true,
      });
      for (const d of [mi, ju, vi_]) expect((await putDia(como(c), p, d, [regular(8)])).statusCode).toBe(200);
      const st = await estado(como(c), lunes);
      const lunesInfo = st.submission.days.find((d: { date: string }) => d.date === lu);
      expect(lunesInfo).toMatchObject({ isWorkday: false, nonWorkingReason: "HOLIDAY" });
      // El martes solo es festivo en Medellín: para un consultor de Bogotá falta.
      const corto = await enviar(como(c), lunes);
      expect(corto.statusCode).toBe(400);
      expect(corto.json().errors.map((e: { date: string }) => e.date)).toEqual([ma]);
      expect((await putDia(como(c), p, ma, [regular(8)])).statusCode).toBe(200);
      expect((await enviar(como(c), lunes)).statusCode).toBe(201);
    });

    it("ingreso a mitad de semana: solo se exigen los días desde el ingreso", async () => {
      const p = await nuevoProyecto("Ingreso", pm1);
      const lunes = "2026-09-28";
      const [lu, , mi, ju, vi_] = lunAVie(lunes);
      const c = await nuevoConsultor({ hireDate: mi });
      for (const d of [mi, ju, vi_]) expect((await putDia(como(c), p, d, [regular(8)])).statusCode).toBe(200);
      const st = await estado(como(c), lunes);
      expect(st.submission.days.find((d: { date: string }) => d.date === lu)).toMatchObject({ isWorkday: false, nonWorkingReason: "BEFORE_HIRE" });
      expect(st.submission.ok).toBe(true);
      const r = await enviar(como(c), lunes);
      expect(r.statusCode, r.body).toBe(201);
      // La semana cruza de septiembre a octubre: la revisión es una sola.
      expect(await prisma.timesheetWeekReview.count({ where: { consultantId: c.id } })).toBe(1);
    });

    it("errores de entrada: consultor inexistente, sin ficha, lunes inválido", async () => {
      expect((await enviar(comoAdmin(), "2026-09-07", "no-existe")).statusCode).toBe(404);
      const sinFicha = await enviar(comoRol(AppRole.CONSULTANT, `sin.ficha.${prefijo}@synaptica.test`), "2026-09-07");
      expect(sinFicha.statusCode).toBe(400);
      expect((await enviar(comoAdmin(), "2026-09-08")).statusCode).toBe(400);
      expect((await app.inject({ method: "POST", url: "/api/timesheet-weeks/submit", headers: comoAdmin(), payload: {} })).statusCode).toBe(400);
      // FINANCE y VIEWER no envían semanas.
      expect((await enviar(comoRol(AppRole.FINANCE, "fin@synaptica.test"), "2026-09-07")).statusCode).toBe(403);
      expect((await enviar(comoRol(AppRole.VIEWER, "viewer@synaptica.test"), "2026-09-07")).statusCode).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("5. cronómetro en semana enviada", () => {
    it("detener da 409 y conserva el cronómetro; tras la devolución del proyecto se registra", async () => {
      const p = await nuevoProyecto("Timer", pm1);
      const otro = await nuevoProyecto("Timer otro", pm1);
      const c = await nuevoConsultor({ allowWeekendWork: true });
      const inicio = new Date(Date.now() - 10 * 60_000);
      const lunes = weekStartOf(localCalendarDay(inicio, "Colombia"));

      const start = await app.inject({ method: "POST", url: "/api/timer/start", headers: como(c), payload: { projectId: p, startedAt: inicio.toISOString() } });
      expect(start.statusCode, start.body).toBe(201);
      await marcarSemanaEnviada(c.id, p, lunes);

      const stop = await app.inject({ method: "POST", url: "/api/timer/stop", headers: como(c), payload: {} });
      expect(stop.statusCode).toBe(409);
      expect(stop.json().code).toBe("WEEK_LOCKED");
      expect(await prisma.runningTimer.count({ where: { consultantId: c.id } })).toBe(1);
      const vivo = await app.inject({ method: "GET", url: "/api/timer", headers: como(c) });
      expect(vivo.json().data?.projectId).toBe(p);

      // Mover el cronómetro a otro proyecto de la semana bloqueada: 409.
      expect((await app.inject({ method: "PATCH", url: "/api/timer", headers: como(c), payload: { projectId: otro } })).statusCode).toBe(409);

      // El PM devuelve el proyecto: ahora sí se registra, como PENDING del proyecto devuelto.
      expect((await devolverSemana(app, comoPM1(), { consultantId: c.id, projectId: p, weekStart: lunes, note: "Registra el cronómetro" })).statusCode).toBe(200);
      const stop2 = await app.inject({ method: "POST", url: "/api/timer/stop", headers: como(c), payload: {} });
      expect(stop2.statusCode, stop2.body).toBe(201);
      expect(await prisma.runningTimer.count({ where: { consultantId: c.id } })).toBe(0);
      const creadas = await prisma.timeEntry.findMany({ where: { consultantId: c.id } });
      expect(creadas.length).toBeGreaterThan(0);
      expect(creadas.every((e) => e.projectId === p && e.status === "PENDING")).toBe(true);
      // En otro proyecto de esa semana sigue sin poder arrancar.
      const start2 = await app.inject({ method: "POST", url: "/api/timer/start", headers: como(c), payload: { projectId: otro } });
      expect(start2.statusCode).toBe(409);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("6. regresión: datos anteriores a R15", () => {
    it("APPROVED sin revisión: ni el consultor ni el PM lo editan o borran; ADMIN sí lo borra", async () => {
      const p = await nuevoProyecto("Histórico aprobado", pm1);
      const c = await nuevoConsultor();
      const lunes = "2026-08-24";
      const filas = [];
      for (const d of lunAVie(lunes)) {
        filas.push(
          await prisma.timeEntry.create({
            data: { consultantId: c.id, projectId: p, workDate: fromIsoDate(d), hours: 8, typeId: ids.regular, status: "APPROVED", approvedBy: "pm.viejo@synaptica.test", approvedAt: new Date() },
          }),
        );
      }
      const [e0] = filas;
      for (const headers of [como(c), comoPM1()]) {
        const patch = await app.inject({ method: "PATCH", url: `/api/time-entries/${e0.id}`, headers, payload: { hours: 4 } });
        expect(patch.statusCode).toBe(409);
        const del = await app.inject({ method: "DELETE", url: `/api/time-entries/${e0.id}`, headers });
        expect(del.statusCode).toBe(409);
      }
      // PUT /day apuntando al id aprobado no lo modifica; con lista vacía tampoco lo borra.
      const put = await putDia(como(c), p, lunAVie(lunes)[0], [regular(4, { id: e0.id })]);
      expect(put.statusCode).toBeGreaterThanOrEqual(400);
      expect((await putDia(comoPM1(), p, lunAVie(lunes)[0], [], c.id)).statusCode).toBe(200);
      const tras = await prisma.timeEntry.findUniqueOrThrow({ where: { id: e0.id } });
      expect({ status: tras.status, hours: Number(tras.hours) }).toEqual({ status: "APPROVED", hours: 8 });

      // No hay nada que enviar y la semana no queda bloqueada por revisiones inexistentes.
      const st = await estado(como(c), lunes);
      expect(st.locked).toBe(false);
      expect(st.submission.errors.map((e: { code: string }) => e.code)).toEqual(["NOTHING_TO_SUBMIT"]);
      expect((await enviar(como(c), lunes)).statusCode).toBe(409);

      // El cierre del mes no se bloquea por ellas y ADMIN conserva la corrección.
      expect((await app.inject({ method: "DELETE", url: `/api/time-entries/${e0.id}`, headers: comoAdmin() })).statusCode).toBe(204);
    });

    it("REJECTED histórico: no cuenta para la jornada, no bloquea el envío, la aprobación ni el cierre", async () => {
      const p = await nuevoProyecto("Histórico rechazado", pm1);
      const pSoloRechazo = await nuevoProyecto("Solo rechazo", pm2);
      const c = await nuevoConsultor();
      const lunes = "2026-08-10";
      const [lu] = lunAVie(lunes);
      const rechazada = await prisma.timeEntry.create({
        data: { consultantId: c.id, projectId: p, workDate: fromIsoDate(lu), hours: 3, typeId: ids.regular, status: "REJECTED", rejectionNote: "viejo" },
      });
      await prisma.timeEntry.create({
        data: { consultantId: c.id, projectId: pSoloRechazo, workDate: fromIsoDate(lu), hours: 2, typeId: ids.regular, status: "REJECTED", rejectionNote: "viejo" },
      });

      // Con 5 h nuevas + 3 h rechazadas el lunes NO se completa: lo rechazado no cuenta.
      expect((await putDia(como(c), p, lu, [regular(5)])).statusCode).toBe(200);
      for (const d of lunAVie(lunes).slice(1)) expect((await putDia(como(c), p, d, [regular(8)])).statusCode).toBe(200);
      const corto = await enviar(como(c), lunes);
      expect(corto.statusCode).toBe(400);
      expect(corto.json().errors[0]).toMatchObject({ code: "INCOMPLETE_DAY", date: lu, missingHours: 3 });

      const pendiente = await prisma.timeEntry.findFirstOrThrow({ where: { consultantId: c.id, projectId: p, workDate: fromIsoDate(lu), status: "PENDING" } });
      expect((await putDia(como(c), p, lu, [regular(8, { id: pendiente.id })])).statusCode).toBe(200);
      const envio = await enviar(como(c), lunes);
      expect(envio.statusCode, envio.body).toBe(201);
      // Solo viaja el proyecto con pendientes; el de solo rechazos no genera revisión.
      expect(envio.json().data.submittedProjectIds).toEqual([p]);
      const rev = await prisma.timesheetWeekReview.findFirstOrThrow({ where: { consultantId: c.id } });
      expect(Number(rev.hours)).toBe(40);

      expect((await aprobarSemana(app, comoPM1(), { consultantId: c.id, projectId: p, weekStart: lunes })).statusCode).toBe(200);
      expect((await prisma.timeEntry.findUniqueOrThrow({ where: { id: rechazada.id } })).status).toBe("REJECTED");
      expect(await horasDe(p)).toEqual({ approved: 40, submitted: 0, pending: 0, total: 40 });

      // El cierre de agosto no se bloquea por lo rechazado.
      expect((await cerrarMes(p, 2026, 8)).statusCode).toBe(201);
      expect((await cerrarMes(pSoloRechazo, 2026, 8)).statusCode).toBe(201);
    });
  });
});

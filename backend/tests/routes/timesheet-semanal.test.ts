import { AppRole, TimeEntryStatus } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/infra/prisma.js";
import { addDaysIso, fromIsoDate } from "../../src/utils/isoDate.js";
import { localCalendarDay } from "../../src/modules/timesheet-weeks/timesheet-weeks.service.js";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";
import { aprobarSemana, devolverSemana, marcarSemanaEnviada } from "../helpers/semana.js";

// Se intercepta SOLO el aviso de devolución: el resto del módulo de correo es el real.
const avisos = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock("../../src/utils/notifications.js", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("../../src/utils/notifications.js")>();
  return {
    ...original,
    notifyTimesheetReturned: vi.fn(async (params: Record<string, unknown>) => {
      avisos.push(params);
    }),
  };
});

/**
 * R15: aprobación semanal del timesheet, solo por rutas.
 *
 * Todo se crea con prefijo propio y se borra al final. Las semanas usadas son pasadas y completas
 * (lunes a viernes de septiembre y octubre de 2026), sin festivos de Colombia salvo el que se
 * inserta a propósito. Los consultores tienen jornada propia de 8 h para no depender del país.
 */
describe("Aprobación semanal del timesheet (R15)", () => {
  let app: FastifyInstance;
  const prefijo = `r15-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const pmEmail = `pm.${prefijo}@synaptica.test`;
  const pm2Email = `pm2.${prefijo}@synaptica.test`;
  const adminEmail = "admin@synaptica.local";
  let p1 = ""; // PM = pmEmail
  let p2 = ""; // PM = pm2Email
  let p3 = ""; // sin PM
  let regularId = "";
  let extraId = "";
  const consultores: { id: string; email: string; fullName: string }[] = [];
  const proyectosExtra: string[] = [];
  let contador = 0;

  const comoPM = () => comoRol(AppRole.PM, pmEmail);
  const comoPM2 = () => comoRol(AppRole.PM, pm2Email);
  const comoAdmin = () => comoRol(AppRole.ADMIN, adminEmail);
  const como = (c: { email: string }) => comoRol(AppRole.CONSULTANT, c.email);

  const dias = (lunes: string) => [0, 1, 2, 3, 4].map((i) => addDaysIso(lunes, i));

  async function nuevoConsultor(etiqueta = "C") {
    contador += 1;
    const c = await prisma.consultant.create({
      data: {
        fullName: `${etiqueta}${contador} ${prefijo}`,
        email: `${etiqueta.toLowerCase()}${contador}.${prefijo}@synaptica.test`,
        role: "Consultor",
        hourlyRate: 77.77,
        rateCurrency: "USD",
        country: "Colombia",
      },
    });
    await prisma.capacityConfig.create({
      data: { consultantId: c.id, validFrom: new Date(Date.UTC(2000, 0, 1)), hoursPerDay: 8 },
    });
    const out = { id: c.id, email: c.email!, fullName: c.fullName };
    consultores.push(out);
    return out;
  }

  async function nuevoProyecto(nombre: string, pm: string | null) {
    const p = await prisma.project.create({
      data: {
        name: `${nombre} ${prefijo}`,
        company: "Synaptica",
        country: "Colombia",
        currency: "USD",
        budget: 10000,
        startDate: new Date(Date.UTC(2026, 0, 1)),
        endDate: new Date(Date.UTC(2027, 11, 31)),
        projectManagerEmail: pm,
      },
    });
    proyectosExtra.push(p.id);
    return p.id;
  }

  /** Registro REGULAR directo en la base (rápido); las rutas se prueban aparte. */
  function hora(consultantId: string, projectId: string, fecha: string, hours: number, extra: Record<string, unknown> = {}) {
    return prisma.timeEntry.create({
      data: { consultantId, projectId, workDate: fromIsoDate(fecha), hours, typeId: regularId, ...extra },
    });
  }

  /** Lunes a viernes de 8 h en un proyecto (opcionalmente sin algunos días). */
  async function semanaCompleta(consultantId: string, projectId: string, lunes: string, omitir: string[] = []) {
    for (const d of dias(lunes)) {
      if (!omitir.includes(d)) await hora(consultantId, projectId, d, 8);
    }
  }

  const enviar = (headers: Record<string, string>, weekStart: string, consultantId?: string) =>
    app.inject({ method: "POST", url: "/api/timesheet-weeks/submit", headers, payload: { weekStart, consultantId } });
  const estado = (headers: Record<string, string>, weekStart: string, consultantId?: string) =>
    app.inject({
      method: "GET",
      url: `/api/timesheet-weeks/status?weekStart=${weekStart}${consultantId ? `&consultantId=${consultantId}` : ""}`,
      headers,
    });
  const put = (headers: Record<string, string>, projectId: string, workDate: string, entries: Record<string, unknown>[]) =>
    app.inject({ method: "PUT", url: "/api/time-entries/day", headers, payload: { projectId, workDate, entries } });
  const item = (c: { id: string }, projectId: string, weekStart: string) => ({ consultantId: c.id, projectId, weekStart });

  beforeAll(async () => {
    app = await crearAppDePrueba();
    regularId = (await prisma.timeEntryType.findFirstOrThrow({ where: { code: "REGULAR" } })).id;
    extraId = (await prisma.timeEntryType.findFirstOrThrow({ where: { code: "EXTRA" } })).id;
    p1 = await nuevoProyecto("P1", pmEmail);
    p2 = await nuevoProyecto("P2", pm2Email);
    p3 = await nuevoProyecto("P3 sin PM", null);
  });

  beforeEach(() => {
    avisos.length = 0;
  });

  afterAll(async () => {
    const ids = consultores.map((c) => c.id);
    await prisma.timesheetWeekReview.deleteMany({ where: { consultantId: { in: ids } } });
    await prisma.runningTimer.deleteMany({ where: { consultantId: { in: ids } } });
    await prisma.consultantBlock.deleteMany({ where: { consultantId: { in: ids } } });
    await prisma.timeEntry.deleteMany({ where: { consultantId: { in: ids } } });
    await prisma.capacityConfig.deleteMany({ where: { consultantId: { in: ids } } });
    await prisma.consultant.deleteMany({ where: { id: { in: ids } } });
    await prisma.monthlySnapshot.deleteMany({ where: { projectId: { in: proyectosExtra } } });
    await prisma.approvalDelegation.deleteMany({ where: { projectId: { in: proyectosExtra } } });
    await prisma.holiday.deleteMany({ where: { name: `Festivo ${prefijo}` } });
    await prisma.project.deleteMany({ where: { id: { in: proyectosExtra } } });
    await app.close();
  });

  // -------------------------------------------------------------------------------------------
  describe("envío de la semana", () => {
    it("envío feliz: todos los proyectos pasan a SUBMITTED y nace una revisión por proyecto", async () => {
      const c = await nuevoConsultor();
      const lunes = "2026-09-07";
      // Lun-mié en P1; jue-vie 4 h en P1 + 4 h en P2.
      const [lu, ma, mi, ju, vi_] = dias(lunes);
      for (const d of [lu, ma, mi]) await hora(c.id, p1, d, 8);
      for (const d of [ju, vi_]) {
        await hora(c.id, p1, d, 4);
        await hora(c.id, p2, d, 4);
      }

      // Vista previa: se puede enviar y lista los proyectos que viajan.
      const previa = await estado(como(c), lunes);
      expect(previa.statusCode, previa.body).toBe(200);
      const d = previa.json().data;
      expect(d).toMatchObject({ consultantId: c.id, weekStart: lunes, locked: false, editableProjectIds: [], reviews: [] });
      expect(d.submission.ok).toBe(true);
      expect([...d.submission.projectsToSubmit].sort()).toEqual([p1, p2].sort());
      expect(d.submission.days).toHaveLength(7);

      const res = await enviar(como(c), lunes);
      expect(res.statusCode, res.body).toBe(201);
      expect(res.json().data).toMatchObject({ consultantId: c.id, weekStart: lunes, onBehalf: false, submittedHours: 40 });
      expect([...res.json().data.submittedProjectIds].sort()).toEqual([p1, p2].sort());

      const entradas = await prisma.timeEntry.findMany({ where: { consultantId: c.id } });
      expect(entradas.every((e) => e.status === TimeEntryStatus.SUBMITTED)).toBe(true);
      const revisiones = await prisma.timesheetWeekReview.findMany({ where: { consultantId: c.id } });
      expect(revisiones).toHaveLength(2);
      expect(revisiones.every((r) => r.status === "SUBMITTED" && r.submittedBy === c.email.toLowerCase())).toBe(true);
      expect(Number(revisiones.find((r) => r.projectId === p1)!.hours)).toBe(32);

      const auditoria = await prisma.auditLog.count({
        where: { entity: "timesheetWeekReview", entityId: { in: revisiones.map((r) => r.id) }, changedBy: c.email.toLowerCase() },
      });
      expect(auditoria).toBe(2);

      // Estado tras enviar: bloqueada, nada editable, nada más que enviar.
      const despues = (await estado(como(c), lunes)).json().data;
      expect(despues.locked).toBe(true);
      expect(despues.editableProjectIds).toEqual([]);
      expect(despues.reviews.map((r: { status: string }) => r.status)).toEqual(["SUBMITTED", "SUBMITTED"]);
      expect(despues.submission.errors.map((e: { code: string }) => e.code)).toContain("NOTHING_TO_SUBMIT");

      // Reenviar lo ya enviado: 409 sin nada que enviar.
      const otra = await enviar(como(c), lunes);
      expect(otra.statusCode).toBe(409);
      expect(otra.json().errors[0].code).toBe("NOTHING_TO_SUBMIT");
    });

    it("bloqueado por un día corto: lista el día y cuánto falta", async () => {
      const c = await nuevoConsultor();
      const lunes = "2026-09-14";
      await semanaCompleta(c.id, p1, lunes, [dias(lunes)[2]]);
      await hora(c.id, p1, dias(lunes)[2], 5);

      const res = await enviar(como(c), lunes);
      expect(res.statusCode).toBe(400);
      const cuerpo = res.json();
      expect(cuerpo.code).toBe("WEEK_NOT_SUBMITTABLE");
      expect(cuerpo.errors).toHaveLength(1);
      expect(cuerpo.errors[0]).toMatchObject({ code: "INCOMPLETE_DAY", date: dias(lunes)[2], missingHours: 3 });
      expect((await prisma.timeEntry.findMany({ where: { consultantId: c.id } })).every((e) => e.status === "PENDING")).toBe(true);
      expect(await prisma.timesheetWeekReview.count({ where: { consultantId: c.id } })).toBe(0);
    });

    it("bloqueado por semana en curso: una semana futura con días sin completar no se envía", async () => {
      const c = await nuevoConsultor();
      const hoy = localCalendarDay(new Date(), "Colombia");
      const proximoLunes = addDaysIso(hoy, 7 - ((new Date(`${hoy}T00:00:00Z`).getUTCDay() + 6) % 7));
      await hora(c.id, p1, proximoLunes, 8);

      const res = await enviar(como(c), proximoLunes);
      expect(res.statusCode).toBe(400);
      expect(res.json().errors.map((e: { code: string }) => e.code)).toContain("WEEK_IN_PROGRESS");
    });

    it("un festivo no exige horas ese día", async () => {
      const c = await nuevoConsultor();
      const lunes = "2026-09-21";
      const festivo = dias(lunes)[2];
      const existe = await prisma.holiday.findFirst({ where: { country: "Colombia", city: "", date: fromIsoDate(festivo) } });
      if (!existe) {
        await prisma.holiday.create({ data: { country: "Colombia", city: "", date: fromIsoDate(festivo), name: `Festivo ${prefijo}` } });
      }
      await semanaCompleta(c.id, p1, lunes, [festivo]);

      const res = await enviar(como(c), lunes);
      expect(res.statusCode, res.body).toBe(201);
    });

    it("reenvío tras una devolución: viaja solo el proyecto devuelto", async () => {
      const c = await nuevoConsultor();
      const lunes = "2026-09-28";
      const [lu, ma, mi, ju, vi_] = dias(lunes);
      for (const d of [lu, ma, mi]) await hora(c.id, p1, d, 8);
      for (const d of [ju, vi_]) {
        await hora(c.id, p1, d, 4);
        await hora(c.id, p2, d, 4);
      }
      expect((await enviar(como(c), lunes)).statusCode).toBe(201);

      const devuelta = await devolverSemana(app, comoPM2(), { ...item(c, p2, lunes), note: "Falta detalle en la descripción" });
      expect(devuelta.statusCode, devuelta.body).toBe(200);

      // El consultor ve la nota y que solo P2 sigue editable.
      const st = (await estado(como(c), lunes)).json().data;
      expect(st.locked).toBe(true);
      expect(st.editableProjectIds).toEqual([p2]);
      const r2 = st.reviews.find((r: { projectId: string }) => r.projectId === p2);
      expect(r2).toMatchObject({ status: "RETURNED", note: "Falta detalle en la descripción", reviewedBy: pm2Email });
      expect(st.submission.projectsToSubmit).toEqual([p2]);

      // P1 sigue bloqueado; P2 se puede corregir; un proyecto nuevo en la semana, no.
      const enP1 = await put(como(c), p1, ju, [{ typeId: regularId, hours: 3 }]);
      expect(enP1.statusCode).toBe(409);
      expect(enP1.json().code).toBe("WEEK_LOCKED");
      const enP2 = await put(como(c), p2, ju, [{ typeId: regularId, hours: 4, description: "Detalle agregado" }]);
      expect(enP2.statusCode, enP2.body).toBe(200);
      const enP3 = await app.inject({
        method: "POST",
        url: "/api/time-entries",
        headers: como(c),
        payload: { projectId: p3, workDate: ju, hours: 1 },
      });
      expect(enP3.statusCode).toBe(409);
      expect(enP3.json().code).toBe("WEEK_LOCKED");

      const reenvio = await enviar(como(c), lunes);
      expect(reenvio.statusCode, reenvio.body).toBe(201);
      expect(reenvio.json().data.submittedProjectIds).toEqual([p2]);
      const revisiones = await prisma.timesheetWeekReview.findMany({ where: { consultantId: c.id } });
      expect(revisiones.find((r) => r.projectId === p2)).toMatchObject({ status: "SUBMITTED", note: null, reviewedBy: null });
      expect(revisiones.find((r) => r.projectId === p1)!.status).toBe("SUBMITTED");
      const e2 = await prisma.timeEntry.findMany({ where: { consultantId: c.id, projectId: p2 } });
      expect(e2.every((e) => e.status === "SUBMITTED" && e.rejectionNote === null && e.rejectedBy === null)).toBe(true);
    });

    it("si el consultor borra todo lo devuelto, el reenvío cierra esa revisión", async () => {
      const c = await nuevoConsultor();
      const lunes = "2026-10-19";
      await semanaCompleta(c.id, p1, lunes);
      // Horas extra de P2: no cuentan para la jornada, así que se pueden quitar sin dejar días cortos.
      const extra = await hora(c.id, p2, dias(lunes)[0], 1, { typeId: extraId });
      expect((await enviar(como(c), lunes)).statusCode).toBe(201);
      expect(await prisma.timesheetWeekReview.count({ where: { consultantId: c.id } })).toBe(2);

      expect((await devolverSemana(app, comoPM2(), { ...item(c, p2, lunes), note: "No corresponde a este proyecto" })).statusCode).toBe(200);
      const borrar = await app.inject({ method: "DELETE", url: `/api/time-entries/${extra.id}`, headers: como(c) });
      expect(borrar.statusCode).toBe(204);

      const st = (await estado(como(c), lunes)).json().data;
      expect(st.submission.returnedWithoutEntries).toEqual([p2]);
      const reenvio = await enviar(como(c), lunes);
      expect(reenvio.statusCode, reenvio.body).toBe(201);
      expect(reenvio.json().data).toMatchObject({ submittedProjectIds: [], closedReturnedProjectIds: [p2] });
      const quedan = await prisma.timesheetWeekReview.findMany({ where: { consultantId: c.id } });
      expect(quedan.map((r) => r.projectId)).toEqual([p1]);
    });

    it("ADMIN envía en nombre del consultor (auditado); nadie más puede", async () => {
      const c = await nuevoConsultor();
      const otro = await nuevoConsultor();
      const lunes = "2026-10-26";
      await semanaCompleta(c.id, p1, lunes);

      // Un consultor o un PM no envían la semana de otro.
      expect((await enviar(como(otro), lunes, c.id)).statusCode).toBe(403);
      expect((await enviar(comoPM(), lunes, c.id)).statusCode).toBe(403);
      expect(await prisma.timesheetWeekReview.count({ where: { consultantId: c.id } })).toBe(0);

      const res = await enviar(comoAdmin(), lunes, c.id);
      expect(res.statusCode, res.body).toBe(201);
      expect(res.json().data).toMatchObject({ consultantId: c.id, onBehalf: true });
      const revision = await prisma.timesheetWeekReview.findFirstOrThrow({ where: { consultantId: c.id } });
      expect(revision.submittedBy).toBe(adminEmail);
      const rastro = await prisma.auditLog.findFirstOrThrow({ where: { entity: "timesheetWeekReview", entityId: revision.id } });
      expect(rastro.changedBy).toBe(adminEmail);
      expect(JSON.stringify(rastro.after)).toContain(c.id);

      // Mismas reglas: una semana corta tampoco la envía ADMIN.
      expect((await enviar(comoAdmin(), "2026-10-05", c.id)).statusCode).toBe(400);
    });

    it("valida la entrada: weekStart debe ser un lunes", async () => {
      const c = await nuevoConsultor();
      expect((await enviar(como(c), "2026-09-09")).statusCode).toBe(400);
      expect((await estado(como(c), "2026-09-09")).statusCode).toBe(400);
      expect((await enviar(como(c), "no-es-fecha")).statusCode).toBe(400);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe("bloqueos de edición y cronómetro", () => {
    it("una semana enviada no admite crear, editar, borrar ni fusionar tareas", async () => {
      const c = await nuevoConsultor();
      const lunes = "2026-09-07";
      await semanaCompleta(c.id, p1, lunes);
      const [lu, ma] = dias(lunes);
      const primera = await prisma.timeEntry.findFirstOrThrow({ where: { consultantId: c.id, workDate: fromIsoDate(lu) } });
      await prisma.timeEntry.update({ where: { id: primera.id }, data: { description: "Tarea A" } });
      expect((await enviar(como(c), lunes)).statusCode).toBe(201);

      const bloqueado = (r: { statusCode: number; json: () => { code?: string } }) => {
        expect(r.statusCode).toBe(409);
        expect(r.json().code).toBe("WEEK_LOCKED");
      };
      bloqueado(await put(como(c), p1, lu, [{ typeId: regularId, hours: 8 }]));
      bloqueado(
        await app.inject({ method: "POST", url: "/api/time-entries", headers: como(c), payload: { projectId: p1, workDate: ma, hours: 1 } }),
      );
      bloqueado(
        await app.inject({ method: "PATCH", url: `/api/time-entries/${primera.id}`, headers: como(c), payload: { description: "otra" } }),
      );
      bloqueado(await app.inject({ method: "DELETE", url: `/api/time-entries/${primera.id}`, headers: como(c) }));
      // También para quien dirige el proyecto (el bloqueo es para todos los roles).
      bloqueado(
        await app.inject({
          method: "PUT",
          url: "/api/time-entries/day",
          headers: comoPM(),
          payload: { projectId: p1, consultantId: c.id, workDate: lu, entries: [{ typeId: regularId, hours: 8 }] },
        }),
      );

      const fusion = await app.inject({
        method: "POST",
        url: "/api/time-entries/merge-task",
        headers: como(c),
        payload: {
          projectId: p1,
          from: { description: "Tarea A", activityId: null },
          to: { description: "Tarea B", activityId: null },
        },
      });
      expect(fusion.statusCode).toBe(200);
      expect(fusion.json().data).toMatchObject({ merged: 0, skippedWeekLocked: 1 });
      expect((await prisma.timeEntry.findUniqueOrThrow({ where: { id: primera.id } })).description).toBe("Tarea A");
    });

    it("el cronómetro no inicia en una semana enviada; al detenerlo se conserva y se puede descartar", async () => {
      const c = await nuevoConsultor();
      const hoy = localCalendarDay(new Date(), "Colombia");
      const lunes = new Date(`${hoy}T00:00:00Z`);
      const lunesIso = addDaysIso(hoy, -((lunes.getUTCDay() + 6) % 7));

      // Arranca antes de que la semana se envíe.
      const inicio = await app.inject({ method: "POST", url: "/api/timer/start", headers: como(c), payload: { projectId: p1 } });
      expect(inicio.statusCode, inicio.body).toBe(201);

      await marcarSemanaEnviada(c.id, p1, lunesIso);

      const detener = await app.inject({ method: "POST", url: "/api/timer/stop", headers: como(c), payload: {} });
      expect(detener.statusCode).toBe(409);
      expect(detener.json().code).toBe("WEEK_LOCKED");
      expect(detener.json().message).toMatch(/descartarlo/);
      expect(await prisma.runningTimer.count({ where: { consultantId: c.id } })).toBe(1);
      expect(await prisma.timeEntry.count({ where: { consultantId: c.id } })).toBe(0);

      // Mover el cronómetro a otro proyecto de esa semana tampoco.
      const mover = await app.inject({ method: "PATCH", url: "/api/timer", headers: como(c), payload: { projectId: p2 } });
      expect(mover.statusCode).toBe(409);

      expect((await app.inject({ method: "DELETE", url: "/api/timer", headers: como(c) })).statusCode).toBe(204);
      const nuevo = await app.inject({ method: "POST", url: "/api/timer/start", headers: como(c), payload: { projectId: p2 } });
      expect(nuevo.statusCode).toBe(409);
      expect(nuevo.json().code).toBe("WEEK_LOCKED");
    });
  });

  // -------------------------------------------------------------------------------------------
  describe("revisión del PM", () => {
    async function semanaEnviada(c: { id: string; email: string }, projectId: string, lunes: string) {
      await semanaCompleta(c.id, projectId, lunes);
      const r = await enviar(como(c), lunes);
      expect(r.statusCode, r.body).toBe(201);
    }

    it("el PM ve la fila con días, novedades y registros, sin tarifas; el consultor no ve revisiones ajenas", async () => {
      const c = await nuevoConsultor();
      const lunes = "2026-09-07";
      await semanaEnviada(c, p1, lunes);
      // Una hora extra el viernes marca la novedad EXTRA (no cuenta para la jornada).
      await hora(c.id, p1, dias(lunes)[4], 1, { typeId: extraId, status: "SUBMITTED" });

      const lista = await app.inject({ method: "GET", url: `/api/timesheet-reviews?weekStart=${lunes}&consultantId=${c.id}`, headers: comoPM() });
      expect(lista.statusCode, lista.body).toBe(200);
      const filas = lista.json().data;
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({
        consultantId: c.id,
        consultantName: c.fullName,
        projectId: p1,
        weekStart: lunes,
        status: "SUBMITTED",
        canReview: true,
      });
      expect(filas[0].days).toHaveLength(7);
      expect(filas[0].days[4].flags).toContain("EXTRA");
      expect(filas[0].flags).toContain("EXTRA");
      expect(filas[0].entries.length).toBe(6);
      expect(filas[0].entries[0]).toHaveProperty("type.category");
      expect(lista.body).not.toContain("hourlyRate");
      expect(lista.body).not.toContain("77.77");

      // El contador del menú.
      const cuenta = await app.inject({ method: "GET", url: "/api/timesheet-reviews/count", headers: comoPM() });
      expect(cuenta.json().data.canReview).toBe(true);
      expect(cuenta.json().data.pending).toBeGreaterThanOrEqual(1);

      // Otro PM y el propio consultor no ven nada de esta fila.
      for (const headers of [comoPM2(), como(c)]) {
        const ajena = await app.inject({ method: "GET", url: `/api/timesheet-reviews?consultantId=${c.id}`, headers });
        expect(ajena.statusCode).toBe(200);
        expect(ajena.json().data).toEqual([]);
      }
      const cuentaConsultor = await app.inject({ method: "GET", url: "/api/timesheet-reviews/count", headers: como(c) });
      expect(cuentaConsultor.json().data).toEqual({ canReview: false, pending: 0 });
      // Y no consulta el estado de la semana de otro consultor.
      const otro = await nuevoConsultor();
      expect((await estado(como(otro), lunes, c.id)).statusCode).toBe(403);
    });

    it("aprueba el PM del proyecto: registros y revisión pasan a APPROVED y queda la huella", async () => {
      const c = await nuevoConsultor();
      const lunes = "2026-09-14";
      await semanaEnviada(c, p1, lunes);

      const res = await aprobarSemana(app, comoPM(), item(c, p1, lunes));
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().data.approved).toEqual([{ ...item(c, p1, lunes), entries: 5 }]);
      const entradas = await prisma.timeEntry.findMany({ where: { consultantId: c.id } });
      expect(entradas.every((e) => e.status === "APPROVED" && e.approvedBy === pmEmail && e.approvedAt)).toBe(true);
      const revision = await prisma.timesheetWeekReview.findFirstOrThrow({ where: { consultantId: c.id } });
      expect(revision).toMatchObject({ status: "APPROVED", reviewedBy: pmEmail });
      expect(revision.reviewedAt).not.toBeNull();

      // Con status=APPROVED el PM sigue viendo lo que revisó.
      const aprobadas = await app.inject({
        method: "GET",
        url: `/api/timesheet-reviews?status=APPROVED&weekStart=${lunes}&consultantId=${c.id}`,
        headers: comoPM(),
      });
      expect(aprobadas.json().data).toHaveLength(1);
      expect(aprobadas.json().data[0].status).toBe("APPROVED");
      // Lo aprobado ya no está en la bandeja por defecto.
      const pendientes = await app.inject({ method: "GET", url: `/api/timesheet-reviews?weekStart=${lunes}&consultantId=${c.id}`, headers: comoPM() });
      expect(pendientes.json().data).toEqual([]);
      // Y aprobarlo otra vez es un conflicto de estado.
      expect((await aprobarSemana(app, comoPM(), item(c, p1, lunes))).statusCode).toBe(409);
    });

    it("un delegado vigente aprueba; uno vencido recibe 403", async () => {
      const c = await nuevoConsultor();
      const c2 = await nuevoConsultor();
      const lunes = "2026-09-21";
      const delegado = `dele.${prefijo}@synaptica.test`;
      const vencido = `vencido.${prefijo}@synaptica.test`;
      await semanaEnviada(c, p1, lunes);
      await semanaEnviada(c2, p1, lunes);
      await prisma.approvalDelegation.createMany({
        data: [
          { projectId: p1, fromUserEmail: pmEmail, toUserEmail: delegado, startDate: new Date("2026-09-01T00:00:00Z"), endDate: new Date("2026-12-31T00:00:00Z") },
          { projectId: p1, fromUserEmail: pmEmail, toUserEmail: vencido, startDate: new Date("2026-01-01T00:00:00Z"), endDate: new Date("2026-02-01T00:00:00Z") },
        ],
      });

      const noVigente = await aprobarSemana(app, comoRol(AppRole.CONSULTANT, vencido), item(c, p1, lunes));
      expect(noVigente.statusCode).toBe(403);
      expect(noVigente.json().code).toBe("NOT_REVIEWER");

      // El delegado ve la bandeja y el contador.
      const cuenta = await app.inject({ method: "GET", url: "/api/timesheet-reviews/count", headers: comoRol(AppRole.CONSULTANT, delegado) });
      expect(cuenta.json().data.canReview).toBe(true);
      const bandeja = await app.inject({
        method: "GET",
        url: `/api/timesheet-reviews?weekStart=${lunes}&consultantId=${c.id}`,
        headers: comoRol(AppRole.CONSULTANT, delegado),
      });
      expect(bandeja.json().data).toHaveLength(1);

      const ok = await aprobarSemana(app, comoRol(AppRole.CONSULTANT, delegado), item(c, p1, lunes));
      expect(ok.statusCode, ok.body).toBe(200);
      expect((await prisma.timesheetWeekReview.findFirstOrThrow({ where: { consultantId: c.id } })).reviewedBy).toBe(delegado);

      // El vencido tampoco devuelve.
      const devolver = await devolverSemana(app, comoRol(AppRole.CONSULTANT, vencido), { ...item(c2, p1, lunes), note: "no debería poder" });
      expect(devolver.statusCode).toBe(403);
    });

    it("sin PM revisa ADMIN (y ningún PM); si el PM es el consultor, nadie aprueba lo suyo salvo ADMIN", async () => {
      const c = await nuevoConsultor();
      const lunes = "2026-09-28";
      await semanaEnviada(c, p3, lunes);
      expect((await aprobarSemana(app, comoPM(), item(c, p3, lunes))).statusCode).toBe(403);
      expect((await aprobarSemana(app, comoPM2(), item(c, p3, lunes))).statusCode).toBe(403);
      const lista = await app.inject({ method: "GET", url: `/api/timesheet-reviews?consultantId=${c.id}`, headers: comoAdmin() });
      expect(lista.json().data).toHaveLength(1);
      const ok = await aprobarSemana(app, comoAdmin(), item(c, p3, lunes));
      expect(ok.statusCode, ok.body).toBe(200);

      // El PM del proyecto es el propio consultor: él no puede; ADMIN sí.
      const autor = await nuevoConsultor("Autor");
      const pAutor = await nuevoProyecto("P autor", autor.email);
      await semanaEnviada(autor, pAutor, lunes);
      const propio = await aprobarSemana(app, como(autor), item(autor, pAutor, lunes));
      expect(propio.statusCode).toBe(403);
      const propioPm = await aprobarSemana(app, comoRol(AppRole.PM, autor.email), item(autor, pAutor, lunes));
      expect(propioPm.statusCode).toBe(403);
      expect(propioPm.json().code).toBe("NOT_REVIEWER");
      expect((await aprobarSemana(app, comoAdmin(), item(autor, pAutor, lunes))).statusCode).toBe(200);
    });

    it("la aprobación masiva es todo o nada y nombra al ítem culpable", async () => {
      const a = await nuevoConsultor();
      const b = await nuevoConsultor();
      const lunes = "2026-09-07";
      await semanaEnviada(a, p1, lunes);
      await semanaEnviada(b, p2, lunes); // de otro PM

      const res = await app.inject({
        method: "POST",
        url: "/api/timesheet-reviews/approve",
        headers: comoPM(),
        payload: { items: [item(a, p1, lunes), item(b, p2, lunes)] },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().item).toMatchObject({ index: 1, consultantId: b.id, projectId: p2, weekStart: lunes });
      expect((await prisma.timesheetWeekReview.findFirstOrThrow({ where: { consultantId: a.id } })).status).toBe("SUBMITTED");
      expect((await prisma.timeEntry.findMany({ where: { consultantId: a.id } })).every((e) => e.status === "SUBMITTED")).toBe(true);

      // Un ítem inexistente (404) o repetido (400) tampoco aprueba el resto.
      const inexistente = await app.inject({
        method: "POST",
        url: "/api/timesheet-reviews/approve",
        headers: comoPM(),
        payload: { items: [item(a, p1, lunes), item(a, p1, "2026-08-31")] },
      });
      expect(inexistente.statusCode).toBe(404);
      expect(inexistente.json().item.index).toBe(1);
      const repetido = await app.inject({
        method: "POST",
        url: "/api/timesheet-reviews/approve",
        headers: comoPM(),
        payload: { items: [item(a, p1, lunes), item(a, p1, lunes)] },
      });
      expect(repetido.statusCode).toBe(400);
      expect((await prisma.timesheetWeekReview.findFirstOrThrow({ where: { consultantId: a.id } })).status).toBe("SUBMITTED");

      // Sin el ítem ajeno, se aprueba en bloque; y se limita a 100 ítems.
      const bien = await app.inject({
        method: "POST",
        url: "/api/timesheet-reviews/approve",
        headers: comoPM2(),
        payload: { items: [item(b, p2, lunes)] },
      });
      expect(bien.statusCode, bien.body).toBe(200);
      const demasiados = await app.inject({
        method: "POST",
        url: "/api/timesheet-reviews/approve",
        headers: comoPM(),
        payload: { items: Array.from({ length: 101 }, () => item(a, p1, lunes)) },
      });
      expect(demasiados.statusCode).toBe(400);
      const vacio = await app.inject({ method: "POST", url: "/api/timesheet-reviews/approve", headers: comoPM(), payload: { items: [] } });
      expect(vacio.statusCode).toBe(400);
    });

    it("devolver exige nota, deja la nota visible, abre solo ese proyecto y avisa por correo", async () => {
      const c = await nuevoConsultor();
      const lunes = "2026-09-14";
      await semanaEnviada(c, p1, lunes);

      const sinNota = await devolverSemana(app, comoPM(), { ...item(c, p1, lunes), note: "  " });
      expect(sinNota.statusCode).toBe(400);
      const corta = await devolverSemana(app, comoPM(), { ...item(c, p1, lunes), note: "ab" });
      expect(corta.statusCode).toBe(400);
      expect(avisos).toHaveLength(0);

      const nota = 'Revisa la descripción de <b>lunes</b> & martes';
      const res = await devolverSemana(app, comoPM(), { ...item(c, p1, lunes), note: nota });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().data).toMatchObject({ status: "RETURNED", entries: 5 });

      // Correo: una llamada con proyecto, semana, nota y quién devolvió.
      expect(avisos).toHaveLength(1);
      expect(avisos[0]).toMatchObject({
        consultantEmail: c.email,
        consultantName: c.fullName,
        projectName: `P1 ${prefijo}`,
        weekStart: lunes,
        note: nota,
      });
      expect(String(avisos[0].reviewerName)).toBeTruthy();

      const entradas = await prisma.timeEntry.findMany({ where: { consultantId: c.id } });
      expect(entradas.every((e) => e.status === "PENDING" && e.rejectionNote === nota && e.rejectedBy === pmEmail && e.rejectedAt)).toBe(true);
      const st = (await estado(como(c), lunes)).json().data;
      expect(st.reviews[0]).toMatchObject({ status: "RETURNED", note: nota, reviewedBy: pmEmail });
      expect(st.editableProjectIds).toEqual([p1]);
      // Un ADMIN ve lo devuelto en la bandeja del PM con status=RETURNED solo si él lo devolvió o puede revisarlo.
      const devueltas = await app.inject({
        method: "GET",
        url: `/api/timesheet-reviews?status=RETURNED&consultantId=${c.id}`,
        headers: comoPM(),
      });
      expect(devueltas.json().data).toHaveLength(1);
      // Devolver dos veces: conflicto de estado.
      expect((await devolverSemana(app, comoPM(), { ...item(c, p1, lunes), note: "otra vez" })).statusCode).toBe(409);
      // El rastro de auditoría de la devolución existe.
      const revision = await prisma.timesheetWeekReview.findFirstOrThrow({ where: { consultantId: c.id } });
      expect(await prisma.auditLog.count({ where: { entity: "timesheetWeekReview", entityId: revision.id, action: "REJECT" } })).toBe(1);
    });

    it("el mes cerrado bloquea aprobar y devolver", async () => {
      const c = await nuevoConsultor();
      const proyecto = await nuevoProyecto("P mes cerrado", pmEmail);
      const lunes = "2026-09-21";
      await semanaEnviada(c, proyecto, lunes);
      await prisma.monthlySnapshot.create({
        data: {
          projectId: proyecto,
          year: 2026,
          month: 9,
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
      const aprobar = await aprobarSemana(app, comoPM(), item(c, proyecto, lunes));
      expect(aprobar.statusCode).toBe(400);
      expect(aprobar.json().code).toBe("MONTH_CLOSED");
      expect((await devolverSemana(app, comoPM(), { ...item(c, proyecto, lunes), note: "tarde" })).statusCode).toBe(400);
      expect((await prisma.timesheetWeekReview.findFirstOrThrow({ where: { consultantId: c.id, projectId: proyecto } })).status).toBe("SUBMITTED");
    });

    it("la ausencia aprobada con la semana crea su bloque de capacidad", async () => {
      const c = await nuevoConsultor();
      const ausencias = (await prisma.project.findFirstOrThrow({ where: { isAbsenceProject: true } })).id;
      const vacaciones = (await prisma.timeEntryType.findFirstOrThrow({ where: { code: "VACACIONES" } })).id;
      const lunes = "2026-10-05";
      const lu = dias(lunes)[0];
      // Vacaciones de jornada completa el lunes; el resto de la semana, trabajo regular.
      await hora(c.id, ausencias, lu, 8, { typeId: vacaciones });
      await semanaCompleta(c.id, p1, lunes, [lu]);
      expect((await enviar(como(c), lunes)).statusCode).toBe(201);
      expect(await prisma.consultantBlock.count({ where: { consultantId: c.id } })).toBe(0);

      expect((await aprobarSemana(app, comoAdmin(), item(c, ausencias, lunes))).statusCode).toBe(200);
      const bloques = await prisma.consultantBlock.findMany({ where: { consultantId: c.id } });
      expect(bloques).toHaveLength(1);
      expect(bloques[0].startDate.toISOString().slice(0, 10)).toBe(lu);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe("cierre de mes y rutas retiradas", () => {
    it("no se cierra un mes con horas PENDING o SUBMITTED: 409 con el detalle", async () => {
      const proyecto = await nuevoProyecto("P cierre", pmEmail);
      const c = await nuevoConsultor();
      await hora(c.id, proyecto, "2026-03-03", 6); // PENDING
      await hora(c.id, proyecto, "2026-03-10", 4, { status: "SUBMITTED" });
      await hora(c.id, proyecto, "2026-03-11", 2, { status: "REJECTED" }); // histórico: no bloquea

      const res = await app.inject({
        method: "POST",
        url: "/api/snapshots/close",
        headers: comoAdmin(),
        payload: { projectId: proyecto, year: 2026, month: 3 },
      });
      expect(res.statusCode).toBe(409);
      const cuerpo = res.json();
      expect(cuerpo.code).toBe("PENDING_HOURS");
      expect(cuerpo.pending).toEqual([
        { consultantId: c.id, fullName: c.fullName, weekStart: "2026-03-02", hours: 6, status: "PENDING" },
        { consultantId: c.id, fullName: c.fullName, weekStart: "2026-03-09", hours: 4, status: "SUBMITTED" },
      ]);
      expect(await prisma.monthlySnapshot.count({ where: { projectId: proyecto } })).toBe(0);
    });

    it("las rutas por registro approve/reject están retiradas (410) y la bandeja de excedentes devuelve vacío", async () => {
      const c = await nuevoConsultor();
      const e = await hora(c.id, p1, "2026-09-08", 2);
      for (const accion of ["approve", "reject"]) {
        const res = await app.inject({
          method: "PATCH",
          url: `/api/time-entries/${e.id}/${accion}`,
          headers: comoAdmin(),
          payload: { rejectionNote: "no aplica" },
        });
        expect(res.statusCode).toBe(410);
        expect(res.json().code).toBe("ENDPOINT_RETIRED");
      }
      expect((await prisma.timeEntry.findUniqueOrThrow({ where: { id: e.id } })).status).toBe("PENDING");
      const bandeja = await app.inject({ method: "GET", url: "/api/extra-hours/excess-pending", headers: comoPM() });
      expect(bandeja.statusCode).toBe(200);
      expect(bandeja.json().data).toEqual([]);
    });

    it("ADMIN conserva el borrado de registros aprobados; un consultor no", async () => {
      const c = await nuevoConsultor();
      const e = await hora(c.id, p1, "2026-09-09", 2, { status: "APPROVED" });
      await marcarSemanaEnviada(c.id, p1, "2026-09-09");
      await prisma.timesheetWeekReview.updateMany({ where: { consultantId: c.id }, data: { status: "APPROVED" } });
      expect((await app.inject({ method: "DELETE", url: `/api/time-entries/${e.id}`, headers: como(c) })).statusCode).toBe(409);
      expect((await app.inject({ method: "DELETE", url: `/api/time-entries/${e.id}`, headers: comoAdmin() })).statusCode).toBe(204);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe("informes de horas", () => {
    it("/api/stats/overview separa horas aprobadas, enviadas y pendientes", async () => {
      const c = await nuevoConsultor();
      const proyecto = await nuevoProyecto("P informe", pmEmail);
      await hora(c.id, proyecto, "2026-09-07", 8, { status: "APPROVED" });
      await hora(c.id, proyecto, "2026-09-08", 6, { status: "SUBMITTED" });
      await hora(c.id, proyecto, "2026-09-09", 3, { status: "PENDING" });
      await hora(c.id, proyecto, "2026-09-10", 5, { status: "REJECTED" });

      const res = await app.inject({ method: "GET", url: `/api/stats/overview?projectId=${proyecto}`, headers: comoAdmin() });
      expect(res.statusCode, res.body).toBe(200);
      const fila = res.json().data.projects.find((p: { projectId: string }) => p.projectId === proyecto);
      expect(fila).toMatchObject({ approvedHours: 8, submittedHours: 6, pendingHours: 3, totalHours: 8 });
      expect(res.json().data.totals).toMatchObject({ approvedHours: 8, submittedHours: 6, pendingHours: 3, totalHours: 8 });
    });
  });
});

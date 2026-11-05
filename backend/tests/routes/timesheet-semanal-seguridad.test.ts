import { AppRole, TimeEntryStatus } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/infra/prisma.js";
import { addDaysIso, fromIsoDate } from "../../src/utils/isoDate.js";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";
import { aprobarSemana, devolverSemana, marcarSemanaEnviada } from "../helpers/semana.js";

/**
 * R15, correcciones de la revisión de seguridad: identidad por id (no por correo), quién cambia el
 * PM de un proyecto, borrados de registros no pendientes, cierre de mes y revisiones atascadas.
 */
describe("Aprobación semanal: endurecimiento (R15)", () => {
  let app: FastifyInstance;
  const prefijo = `r15s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const adminEmail = "admin@synaptica.local";
  const consultores: string[] = [];
  const proyectos: string[] = [];
  const usuarios: string[] = [];
  let regularId = "";
  let contador = 0;

  const comoAdmin = () => comoRol(AppRole.ADMIN, adminEmail);
  const lunes = "2026-09-07";

  async function proyecto(nombre: string, pm: string | null) {
    const p = await prisma.project.create({
      data: {
        name: `${nombre} ${prefijo}`,
        company: "Synaptica",
        country: "Colombia",
        currency: "USD",
        budget: 1000,
        startDate: new Date(Date.UTC(2026, 0, 1)),
        endDate: new Date(Date.UTC(2027, 11, 31)),
        projectManagerEmail: pm,
      },
    });
    proyectos.push(p.id);
    return p.id;
  }

  /** Consultor enlazado por `userId` a un usuario, con el correo de la ficha vacío o distinto. */
  async function consultorEnlazado(emailUsuario: string, emailFicha: string | null) {
    contador += 1;
    const user = await prisma.user.create({ data: { email: emailUsuario, displayName: `U${contador} ${prefijo}` } });
    usuarios.push(user.id);
    const c = await prisma.consultant.create({
      data: {
        fullName: `Enlazado${contador} ${prefijo}`,
        email: emailFicha,
        role: "Consultor",
        hourlyRate: 10,
        country: "Colombia",
        userId: user.id,
      },
    });
    consultores.push(c.id);
    await prisma.capacityConfig.create({ data: { consultantId: c.id, validFrom: new Date(Date.UTC(2000, 0, 1)), hoursPerDay: 8 } });
    return c;
  }

  async function consultorSimple() {
    contador += 1;
    const c = await prisma.consultant.create({
      data: { fullName: `Simple${contador} ${prefijo}`, email: `s${contador}.${prefijo}@synaptica.test`, role: "Consultor", hourlyRate: 10, country: "Colombia" },
    });
    consultores.push(c.id);
    await prisma.capacityConfig.create({ data: { consultantId: c.id, validFrom: new Date(Date.UTC(2000, 0, 1)), hoursPerDay: 8 } });
    return c;
  }

  const hora = (consultantId: string, projectId: string, fecha: string, hours: number, extra: Record<string, unknown> = {}) =>
    prisma.timeEntry.create({ data: { consultantId, projectId, workDate: fromIsoDate(fecha), hours, typeId: regularId, ...extra } });

  beforeAll(async () => {
    app = await crearAppDePrueba();
    regularId = (await prisma.timeEntryType.findFirstOrThrow({ where: { code: "REGULAR" } })).id;
  });

  afterAll(async () => {
    await prisma.approvalDelegation.deleteMany({ where: { projectId: { in: proyectos } } });
    await prisma.timesheetWeekReview.deleteMany({ where: { consultantId: { in: consultores } } });
    await prisma.timeEntry.deleteMany({ where: { consultantId: { in: consultores } } });
    await prisma.capacityConfig.deleteMany({ where: { consultantId: { in: consultores } } });
    await prisma.consultant.deleteMany({ where: { id: { in: consultores } } });
    await prisma.monthlySnapshot.deleteMany({ where: { projectId: { in: proyectos } } });
    await prisma.project.deleteMany({ where: { id: { in: proyectos } } });
    await prisma.user.deleteMany({ where: { id: { in: usuarios } } });
    await app.close();
  });

  // ---- H1 ------------------------------------------------------------------------------------
  describe("nadie aprueba lo suyo aunque el correo de la ficha esté vacío o sea distinto (H1)", () => {
    for (const [etiqueta, emailFicha] of [
      ["Consultant.email = null", null],
      ["Consultant.email distinto del usuario", "otro.correo@synaptica.test"],
    ] as const) {
      it(`PM de su propio proyecto (${etiqueta}): ni aprueba ni devuelve; ADMIN sí`, async () => {
        const correo = `pm.yo.${++contador}.${prefijo}@synaptica.test`;
        const c = await consultorEnlazado(correo, emailFicha);
        const p = await proyecto("P propio", correo);
        await hora(c.id, p, lunes, 8);
        await marcarSemanaEnviada(c.id, p, lunes);
        const item = { consultantId: c.id, projectId: p, weekStart: lunes };

        const aprueba = await aprobarSemana(app, comoRol(AppRole.PM, correo), item);
        expect(aprueba.statusCode, aprueba.body).toBe(403);
        const devuelve = await devolverSemana(app, comoRol(AppRole.PM, correo), { ...item, note: "me devuelvo" });
        expect(devuelve.statusCode).toBe(403);
        expect((await prisma.timesheetWeekReview.findFirstOrThrow({ where: { consultantId: c.id } })).status).toBe("SUBMITTED");

        // El PM es el propio consultor: revisa ADMIN.
        expect((await aprobarSemana(app, comoAdmin(), item)).statusCode).toBe(200);
      });
    }

    it("ADMIN no se aprueba su propia semana en un proyecto sin PM", async () => {
      const correo = `adm.yo.${++contador}.${prefijo}@synaptica.test`;
      const c = await consultorEnlazado(correo, null);
      const p = await proyecto("P sin PM", null);
      await hora(c.id, p, lunes, 8);
      await marcarSemanaEnviada(c.id, p, lunes);
      const res = await aprobarSemana(app, comoRol(AppRole.ADMIN, correo), { consultantId: c.id, projectId: p, weekStart: lunes });
      expect(res.statusCode, res.body).toBe(403);
      expect((await aprobarSemana(app, comoAdmin(), { consultantId: c.id, projectId: p, weekStart: lunes })).statusCode).toBe(200);
    });

    it("un delegado del PM no aprueba su propia semana", async () => {
      const pm = `pm.${++contador}.${prefijo}@synaptica.test`;
      const correo = `del.yo.${contador}.${prefijo}@synaptica.test`;
      const c = await consultorEnlazado(correo, null);
      const p = await proyecto("P delegado", pm);
      await prisma.approvalDelegation.create({
        data: { projectId: p, fromUserEmail: pm, toUserEmail: correo, startDate: new Date("2026-01-01T00:00:00Z"), endDate: new Date("2026-12-31T00:00:00Z") },
      });
      await hora(c.id, p, lunes, 8);
      await marcarSemanaEnviada(c.id, p, lunes);
      const res = await aprobarSemana(app, comoRol(AppRole.CONSULTANT, correo), { consultantId: c.id, projectId: p, weekStart: lunes });
      expect(res.statusCode).toBe(403);
    });
  });

  // ---- H2 ------------------------------------------------------------------------------------
  describe("quién cambia el PM de un proyecto o el correo de una ficha (H2)", () => {
    const cuerpo = (nombre: string, pm?: string | null) => ({
      name: nombre,
      company: "Synaptica",
      country: "Colombia",
      currency: "USD",
      budget: 1000,
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      ...(pm !== undefined ? { projectManagerEmail: pm } : {}),
    });

    it("un PM solo edita proyectos que dirige y no puede cambiar el PM; ADMIN sí", async () => {
      const yo = `pmx.${prefijo}@synaptica.test`;
      const ajeno = await proyecto("Ajeno", `otro.${prefijo}@synaptica.test`);
      const propio = await proyecto("Propio", yo);
      const comoPm = comoRol(AppRole.PM, yo);

      const sobreAjeno = await app.inject({ method: "PUT", url: `/api/projects/${ajeno}`, headers: comoPm, payload: cuerpo("X", yo) });
      expect(sobreAjeno.statusCode).toBe(403);
      expect((await prisma.project.findUniqueOrThrow({ where: { id: ajeno } })).projectManagerEmail).not.toBe(yo);

      const cambiaPm = await app.inject({ method: "PUT", url: `/api/projects/${propio}`, headers: comoPm, payload: cuerpo("Propio", `otro.${prefijo}@synaptica.test`) });
      expect(cambiaPm.statusCode).toBe(403);
      expect(cambiaPm.json().code).toBe("PM_CHANGE_FORBIDDEN");

      const mismoPm = await app.inject({ method: "PUT", url: `/api/projects/${propio}`, headers: comoPm, payload: cuerpo("Propio editado", yo) });
      expect(mismoPm.statusCode, mismoPm.body).toBe(200);
      const sinPm = await app.inject({ method: "PUT", url: `/api/projects/${propio}`, headers: comoPm, payload: cuerpo("Propio otra vez") });
      expect(sinPm.statusCode, sinPm.body).toBe(200);
      expect((await prisma.project.findUniqueOrThrow({ where: { id: propio } })).projectManagerEmail).toBe(yo);

      const admin = await app.inject({ method: "PUT", url: `/api/projects/${propio}`, headers: comoAdmin(), payload: cuerpo("Propio", `nuevo.${prefijo}@synaptica.test`) });
      expect(admin.statusCode, admin.body).toBe(200);
    });

    it("un PM solo se pone a sí mismo (o nadie) como PM al crear un proyecto", async () => {
      const yo = `pmy.${prefijo}@synaptica.test`;
      const comoPm = comoRol(AppRole.PM, yo);
      const ajeno = await app.inject({ method: "POST", url: "/api/projects", headers: comoPm, payload: cuerpo(`Nuevo A ${prefijo}`, `otro.${prefijo}@synaptica.test`) });
      expect(ajeno.statusCode).toBe(403);
      for (const pm of [yo, undefined]) {
        const ok = await app.inject({ method: "POST", url: "/api/projects", headers: comoPm, payload: cuerpo(`Nuevo B ${prefijo} ${pm ?? "vacio"}`, pm) });
        expect(ok.statusCode, ok.body).toBe(201);
        proyectos.push(ok.json().data.id);
      }
      const admin = await app.inject({ method: "POST", url: "/api/projects", headers: comoAdmin(), payload: cuerpo(`Nuevo C ${prefijo}`, `otro.${prefijo}@synaptica.test`) });
      expect(admin.statusCode).toBe(201);
      proyectos.push(admin.json().data.id);
    });

    it("solo ADMIN cambia el correo de una ficha de consultor", async () => {
      const c = await consultorSimple();
      const base = { fullName: "Nombre", role: "Consultor" };
      const pm = comoRol(AppRole.PM, `pmz.${prefijo}@synaptica.test`);
      const cambia = await app.inject({ method: "PUT", url: `/api/consultants/${c.id}`, headers: pm, payload: { ...base, email: "null@synaptica.test" } });
      expect(cambia.statusCode).toBe(403);
      expect(cambia.json().code).toBe("EMAIL_CHANGE_FORBIDDEN");
      const vacia = await app.inject({ method: "PUT", url: `/api/consultants/${c.id}`, headers: pm, payload: { ...base, email: "" } });
      expect(vacia.statusCode).toBe(403);
      // Sin tocar el correo (mismo valor u omitido) el PM edita lo demás y el correo se conserva.
      const igual = await app.inject({ method: "PUT", url: `/api/consultants/${c.id}`, headers: pm, payload: { ...base, email: c.email } });
      expect(igual.statusCode, igual.body).toBe(200);
      const omitido = await app.inject({ method: "PUT", url: `/api/consultants/${c.id}`, headers: pm, payload: base });
      expect(omitido.statusCode, omitido.body).toBe(200);
      expect((await prisma.consultant.findUniqueOrThrow({ where: { id: c.id } })).email).toBe(c.email);

      const admin = await app.inject({ method: "PUT", url: `/api/consultants/${c.id}`, headers: comoAdmin(), payload: { ...base, email: `nuevo.${c.email}` } });
      expect(admin.statusCode, admin.body).toBe(200);
      expect((await prisma.consultant.findUniqueOrThrow({ where: { id: c.id } })).email).toBe(`nuevo.${c.email}`);
    });
  });

  // ---- H3 / H4 -------------------------------------------------------------------------------
  describe("borrar registros que no están pendientes (H3, H4)", () => {
    it("ADMIN borra APROBADOS pero no ENVIADOS; un PM no borra ninguno de los dos", async () => {
      const pm = `pmd.${prefijo}@synaptica.test`;
      const p = await proyecto("P borrado", pm);
      const c = await consultorSimple();
      const aprobado = await hora(c.id, p, lunes, 4, { status: TimeEntryStatus.APPROVED });
      const enviado = await hora(c.id, p, addDaysIso(lunes, 1), 4, { status: TimeEntryStatus.SUBMITTED });
      await marcarSemanaEnviada(c.id, p, lunes);
      const comoPm = comoRol(AppRole.PM, pm);

      // H4: el PM del proyecto ya no borra aprobados (ni enviados).
      expect((await app.inject({ method: "DELETE", url: `/api/time-entries/${aprobado.id}`, headers: comoPm })).statusCode).toBe(409);
      expect((await app.inject({ method: "DELETE", url: `/api/time-entries/${enviado.id}`, headers: comoPm })).statusCode).toBe(409);
      // H3: ni ADMIN borra uno en revisión.
      const adminEnviado = await app.inject({ method: "DELETE", url: `/api/time-entries/${enviado.id}`, headers: comoAdmin() });
      expect(adminEnviado.statusCode).toBe(409);
      expect(adminEnviado.json().code).toBe("WEEK_LOCKED");
      expect(await prisma.timeEntry.count({ where: { id: { in: [aprobado.id, enviado.id] } } })).toBe(2);
      // ADMIN sí corrige lo aprobado.
      expect((await app.inject({ method: "DELETE", url: `/api/time-entries/${aprobado.id}`, headers: comoAdmin() })).statusCode).toBe(204);
    });
  });

  // ---- H5 ------------------------------------------------------------------------------------
  describe("merge-task bajo el candado de semana (H5)", () => {
    it("fusiona lo editable y salta lo bloqueado en la misma operación", async () => {
      const c = await consultorSimple();
      const p = await proyecto("P fusion", `pmf.${prefijo}@synaptica.test`);
      await hora(c.id, p, "2026-09-14", 2, { description: "Tarea A" }); // semana libre
      await hora(c.id, p, lunes, 2, { description: "Tarea A" }); // semana enviada
      await marcarSemanaEnviada(c.id, p, lunes);
      const res = await app.inject({
        method: "POST",
        url: "/api/time-entries/merge-task",
        headers: comoRol(AppRole.CONSULTANT, c.email!),
        payload: { projectId: p, from: { description: "Tarea A", activityId: null }, to: { description: "Tarea B", activityId: null } },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().data).toMatchObject({ merged: 1, skippedWeekLocked: 1 });
    });
  });

  // ---- H6 / H7 -------------------------------------------------------------------------------
  describe("cierre de mes y envío (H6, H7)", () => {
    it("el cierre y las escrituras concurrentes no se cruzan: o hay cierre sin pendientes, o la escritura falla", async () => {
      for (let i = 0; i < 4; i++) {
        const p = await proyecto(`P carrera ${i}`, `pmc.${prefijo}@synaptica.test`);
        const c = await consultorSimple();
        const dia = ["2026-03-10", "2026-04-14", "2026-05-12", "2026-03-11"][i];
        const [cierre, escritura] = await Promise.all([
          app.inject({ method: "POST", url: "/api/snapshots/close", headers: comoAdmin(), payload: { projectId: p, year: 2026, month: Number(dia.slice(5, 7)) } }),
          app.inject({
            method: "PUT",
            url: "/api/time-entries/day",
            headers: comoRol(AppRole.CONSULTANT, c.email!),
            payload: { projectId: p, workDate: dia, entries: [{ typeId: regularId, hours: 2 }] },
          }),
        ]);
        const cerrado = (await prisma.monthlySnapshot.count({ where: { projectId: p } })) > 0;
        const pendientes = await prisma.timeEntry.count({ where: { projectId: p, status: { in: ["PENDING", "SUBMITTED"] } } });
        // Nunca un mes cerrado con horas sin aprobar dentro.
        expect(cerrado && pendientes > 0, `iteración ${i}: cierre ${cierre.statusCode}, escritura ${escritura.statusCode}`).toBe(false);
        if (cerrado) expect(escritura.statusCode).toBe(400);
        else expect(cierre.statusCode).toBe(409);
      }
    });

    it("no se envía un proyecto cuyas horas caen en un mes ya cerrado (400 MONTH_CLOSED)", async () => {
      const c = await consultorSimple();
      const p = await proyecto("P mes cerrado", `pmm.${prefijo}@synaptica.test`);
      for (let i = 0; i < 5; i++) await hora(c.id, p, addDaysIso("2026-09-14", i), 8);
      await prisma.monthlySnapshot.create({
        data: {
          projectId: p, year: 2026, month: 9, baseCurrency: "USD", laborCostActual: 0, expensesActual: 0, totalCostActual: 0,
          revenueRecognized: 0, contractValue: 0, grossMargin: 0, grossMarginPct: 0, hoursApproved: 0, fxSnapshotJson: {}, closedBy: "test",
        },
      });
      const res = await app.inject({
        method: "POST",
        url: "/api/timesheet-weeks/submit",
        headers: comoRol(AppRole.CONSULTANT, c.email!),
        payload: { weekStart: "2026-09-14" },
      });
      expect(res.statusCode, res.body).toBe(400);
      expect(res.json()).toMatchObject({ code: "MONTH_CLOSED", projectId: p, year: 2026, month: 9 });
      expect(await prisma.timesheetWeekReview.count({ where: { consultantId: c.id } })).toBe(0);
      expect((await prisma.timeEntry.findMany({ where: { consultantId: c.id } })).every((e) => e.status === "PENDING")).toBe(true);
    });

    it("la nota de una devolución no puede superar 1000 caracteres", async () => {
      const c = await consultorSimple();
      const p = await proyecto("P nota", `pmn.${prefijo}@synaptica.test`);
      await hora(c.id, p, lunes, 8);
      await marcarSemanaEnviada(c.id, p, lunes);
      const res = await devolverSemana(app, comoRol(AppRole.PM, `pmn.${prefijo}@synaptica.test`), {
        consultantId: c.id,
        projectId: p,
        weekStart: lunes,
        note: "x".repeat(1001),
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ---- QA ------------------------------------------------------------------------------------
  describe("ajustes de QA", () => {
    it("count: una delegación pasada que cubre una semana enviada habilita el menú; sin nada, no", async () => {
      const pm = `pmq.${prefijo}@synaptica.test`;
      const delegado = `delq.${prefijo}@synaptica.test`;
      const solo = `solo.${prefijo}@synaptica.test`;
      const p = await proyecto("P count", pm);
      const c = await consultorSimple();
      await hora(c.id, p, lunes, 8);
      await marcarSemanaEnviada(c.id, p, lunes);
      await prisma.approvalDelegation.create({
        data: { projectId: p, fromUserEmail: pm, toUserEmail: delegado, startDate: new Date("2026-09-01T00:00:00Z"), endDate: new Date("2026-09-30T00:00:00Z") },
      });
      const cuenta = async (email: string) =>
        (await app.inject({ method: "GET", url: "/api/timesheet-reviews/count", headers: comoRol(AppRole.CONSULTANT, email) })).json().data;
      expect(await cuenta(delegado)).toMatchObject({ canReview: true });
      expect((await cuenta(delegado)).pending).toBeGreaterThanOrEqual(1);
      expect(await cuenta(solo)).toEqual({ canReview: false, pending: 0 });
    });

    it("merge-task: un PM no reetiqueta APROBADOS sin revisión; nadie toca SUBMITTED; ADMIN sí los aprobados", async () => {
      const pm = `pmt.${prefijo}@synaptica.test`;
      const p = await proyecto("P merge", pm);
      const c = await consultorSimple();
      const aprobado = await hora(c.id, p, "2026-09-14", 2, { description: "Tarea Q", status: TimeEntryStatus.APPROVED });
      const enviado = await hora(c.id, p, "2026-09-22", 2, { description: "Tarea Q", status: TimeEntryStatus.SUBMITTED });
      const cuerpo = { projectId: p, consultantId: c.id, from: { description: "Tarea Q", activityId: null }, to: { description: "Tarea R", activityId: null } };
      const pmRes = await app.inject({ method: "POST", url: "/api/time-entries/merge-task", headers: comoRol(AppRole.PM, pm), payload: cuerpo });
      expect(pmRes.statusCode, pmRes.body).toBe(200);
      expect(pmRes.json().data.merged).toBe(0);
      const adminRes = await app.inject({ method: "POST", url: "/api/time-entries/merge-task", headers: comoAdmin(), payload: cuerpo });
      expect(adminRes.json().data.merged).toBe(1);
      expect((await prisma.timeEntry.findUniqueOrThrow({ where: { id: aprobado.id } })).description).toBe("Tarea R");
      expect((await prisma.timeEntry.findUniqueOrThrow({ where: { id: enviado.id } })).description).toBe("Tarea Q");
    });

    it("una delegación creada por ADMIN se guarda a nombre del PM; sin PM, 400", async () => {
      const pm = `pmd2.${prefijo}@synaptica.test`;
      const p = await proyecto("P deleg", pm);
      const sinPm = await proyecto("P deleg sin PM", null);
      const dele = `dd.${prefijo}@synaptica.test`;
      await proyecto("P del delegado", dele);
      const payload = { projectId: p, toUserEmail: dele, startDate: "2026-10-01", endDate: "2026-10-31" };
      const ok = await app.inject({ method: "POST", url: "/api/delegations", headers: comoAdmin(), payload });
      expect(ok.statusCode, ok.body).toBe(201);
      expect(ok.json().data.fromUserEmail).toBe(pm);
      await prisma.approvalDelegation.deleteMany({ where: { projectId: p } });
      const sin = await app.inject({ method: "POST", url: "/api/delegations", headers: comoAdmin(), payload: { ...payload, projectId: sinPm } });
      expect(sin.statusCode).toBe(400);
    });
  });
});

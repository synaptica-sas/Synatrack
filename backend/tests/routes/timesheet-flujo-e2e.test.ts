import { AppRole, ExtraHourStatus } from "@prisma/client";
import { idEmpresa } from "../helpers/datos.js";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/infra/prisma.js";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";
import {
  lunesDe as lunesDeDia,
  aprobarSemana,
  aprobarSemanaDeRegistro,
  devolverSemana,
  devolverSemanaDeRegistro,
  marcarSemanaEnviada,
} from "../helpers/semana.js";

// El cronómetro imputa al día LOCAL del país (Colombia, UTC-5 sin horario de verano).
function diaLocalBogota(d: Date): Date {
  const l = new Date(d.getTime() - 5 * 3_600_000);
  return new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate()));
}

/**
 * R14 (fase 5, QA): flujos de punta a punta SOLO por rutas, con el rol que corresponde a cada paso.
 *
 *  1. Solicitud de horas extra -> aprobación del PM -> registro real EXTRA -> excedente -> PM decide
 *     el excedente -> nómina paga lo real; y la variante con excedente rechazado.
 *  2. Ausencias: vacaciones de jornada completa -> ConsultantBlock -> la capacidad lo descuenta.
 *  3. Reclasificación: quitar la fila EXTRA normal convierte el excedente pendiente en normal.
 *  4. Vigencia de jornada de Colombia (8 -> 8.4 el 2026-07-15) a ambos lados del cambio.
 *  5. Cronómetro: partición con lo ya registrado, descarte total y día local de la franja.
 *  6. Regresión: horas sin tipo siguen siendo REGULAR y siguen el flujo de siempre.
 *
 * Nada depende del seed salvo el catálogo de tipos y el proyecto Ausencias (que crea la migración):
 * proyectos, consultores, jornadas y solicitudes se crean aquí y se borran al final.
 * Los consultores son de Colombia (UTC-5 fijo, sin horario de verano).
 */

type Entry = {
  id: string;
  hours: number | string;
  isExcess: boolean;
  status: string;
  workDate: string;
  startedAt: string | null;
  endedAt: string | null;
  extraHourEntryId: string | null;
  typeId: string;
  type: { code: string | null; category: string };
};

const BOGOTA = "-05:00";
/** Instante UTC (ISO) de una hora local de Bogotá. `hhmm` puede ser "24:00" no: usa el día siguiente. */
const local = (fechaIso: string, hhmm: string) => new Date(`${fechaIso}T${hhmm}:00${BOGOTA}`).toISOString();
const isoUtc = (d: Date) => d.toISOString().slice(0, 10);
const sumar = (xs: Entry[]) => Math.round(xs.reduce((a, e) => a + Number(e.hours), 0) * 10_000) / 10_000;

/**
 * El instante más reciente (de hace al menos 1 min y menos de 24 h) con hora UTC 01:00 o 04:00,
 * es decir, 20:00 o 23:00 del día ANTERIOR en Bogotá. Sirve a cualquier hora en que corra la prueba.
 */
function inicioNocturnoReciente(): Date {
  const ahora = Date.now();
  const candidatos: number[] = [];
  for (const diasAtras of [0, 1]) {
    for (const hora of [1, 4]) {
      const d = new Date(ahora);
      d.setUTCDate(d.getUTCDate() - diasAtras);
      d.setUTCHours(hora, 0, 0, 0);
      candidatos.push(d.getTime());
    }
  }
  const valido = candidatos.filter((t) => t <= ahora - 60_000 && t > ahora - 23 * 3_600_000).sort((a, b) => b - a)[0];
  return new Date(valido);
}

/** Un martes-jueves al menos 14 días en el futuro (el consultor no puede pedir horas extra para ayer). */
function diaHabilFuturo(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 14);
  while (![2, 3, 4].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  return isoUtc(d);
}

describe("Timesheet R14: flujos de punta a punta (QA)", () => {
  let app: FastifyInstance;
  const prefijo = `r14e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const pmEmail = `pm.${prefijo}@synaptica.test`;
  const tipos = { regular: "", extra: "", permiso: "", vacaciones: "" };
  let proyecto = "";
  let proyectoOtro = "";
  let ausencias = "";
  const consultores: { id: string; email: string; fullName: string }[] = [];
  const restaurar: (() => Promise<void>)[] = [];

  const comoAdmin = () => comoRol(AppRole.ADMIN, "admin@synaptica.local");
  const comoPM = () => comoRol(AppRole.PM, pmEmail);
  const como = (c: { email: string }) => comoRol(AppRole.CONSULTANT, c.email);
  const finanzas = () => comoRol(AppRole.FINANCE, "nomina@synaptica.test");

  async function nuevoConsultor(etiqueta: string, opciones: { jornadaPropia?: number } = {}) {
    const c = await prisma.consultant.create({
      data: {
        fullName: `${etiqueta} ${prefijo}`,
        email: `${etiqueta.toLowerCase()}.${prefijo}@synaptica.test`,
        role: "Consultor",
        hourlyRate: 40,
        rateCurrency: "USD",
        country: "Colombia",
        allowWeekendWork: true,
      },
    });
    if (opciones.jornadaPropia !== undefined) {
      await prisma.capacityConfig.create({
        data: { consultantId: c.id, validFrom: new Date(Date.UTC(2000, 0, 1)), hoursPerDay: opciones.jornadaPropia },
      });
    }
    const out = { id: c.id, email: c.email!, fullName: c.fullName };
    consultores.push(out);
    return out;
  }

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

  function putDia(
    headers: Record<string, string>,
    projectId: string,
    workDate: string,
    entries: Record<string, unknown>[],
    consultantId?: string,
  ) {
    return app.inject({
      method: "PUT",
      url: "/api/time-entries/day",
      headers,
      payload: { projectId, workDate, consultantId, entries },
    });
  }

  const extra = (fecha: string, desde: string, hasta: string, extraCampos: Record<string, unknown> = {}) => {
    const startedAt = local(fecha, desde);
    const endedAt = local(fecha, hasta);
    const hours = (Date.parse(endedAt) - Date.parse(startedAt)) / 3_600_000;
    return { typeId: tipos.extra, hours, startedAt, endedAt, ...extraCampos };
  };

  // R15: se aprueba/devuelve la SEMANA del proyecto del registro (se deja "enviada" directamente).
  const aprobar = (id: string, headers: Record<string, string>) => aprobarSemanaDeRegistro(app, headers, id);
  const devolver = (id: string, headers: Record<string, string>) =>
    devolverSemanaDeRegistro(app, headers, id, "No se autoriza este tramo");

  async function filaNomina(fecha: string, nombre: string) {
    const [y, m] = fecha.split("-").map(Number);
    const res = await app.inject({
      method: "GET",
      url: `/api/extra-hours/payroll?year=${y}&month=${m}`,
      headers: finanzas(),
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json().data as Record<string, number & string & boolean>[]).find((c) => c.consultantName === nombre);
  }

  async function filaSolicitud(id: string) {
    const res = await app.inject({ method: "GET", url: "/api/extra-hours?pageSize=100", headers: comoAdmin() });
    expect(res.statusCode).toBe(200);
    return (res.json().data as { id: string; realHours: number; excessHours: number; excessPendingHours: number }[]).find(
      (e) => e.id === id,
    );
  }

  /** Solicitud de horas extra APROBADA creada directamente (para los flujos que no prueban la aprobación). */
  async function solicitudAprobada(consultantId: string, fechaIso: string, totalHours: number, projectId = proyecto) {
    return prisma.extraHourEntry.create({
      data: {
        consultantId,
        projectId,
        date: new Date(`${fechaIso}T00:00:00.000Z`),
        startTime: "19:00:00",
        endTime: "22:00:00",
        diurnal: 0,
        nocturnal: totalHours,
        diurnalHoliday: 0,
        nocturnalHoliday: 0,
        totalHours,
        diurnalAmount: 0,
        nocturnalAmount: 100,
        diurnalHolidayAmount: 0,
        nocturnalHolidayAmount: 0,
        totalAmount: 100,
        status: ExtraHourStatus.APPROVED,
      },
    });
  }

  beforeAll(async () => {
    app = await crearAppDePrueba();
    for (const t of await prisma.timeEntryType.findMany()) {
      if (t.code === "REGULAR") tipos.regular = t.id;
      if (t.code === "EXTRA") tipos.extra = t.id;
      if (t.code === "PERMISO") tipos.permiso = t.id;
      if (t.code === "VACACIONES") tipos.vacaciones = t.id;
    }
    const empresaId = await idEmpresa("Synaptica");
    ausencias = (await prisma.project.findFirstOrThrow({ where: { isAbsenceProject: true } })).id;
    const crearProyecto = (nombre: string, pm: string | null) =>
      prisma.project.create({
        data: {
          name: `${nombre} ${prefijo}`,
          companyId: empresaId,
          country: "Colombia",
          currency: "USD",
          budget: 10000,
          startDate: new Date(Date.UTC(2026, 0, 1)),
          endDate: new Date(Date.UTC(2027, 11, 31)),
          projectManagerEmail: pm,
        },
      });
    proyecto = (await crearProyecto("Proyecto E2E", pmEmail)).id;
    proyectoOtro = (await crearProyecto("Proyecto E2E otro", `otro.${pmEmail}`)).id;
  });

  afterAll(async () => {
    for (const r of restaurar.reverse()) await r();
    const ids = consultores.map((c) => c.id);
    await prisma.timesheetWeekReview.deleteMany({ where: { consultantId: { in: ids } } });
    await prisma.runningTimer.deleteMany({ where: { consultantId: { in: ids } } });
    await prisma.consultantBlock.deleteMany({ where: { consultantId: { in: ids } } });
    await prisma.timeEntry.deleteMany({ where: { consultantId: { in: ids } } });
    await prisma.extraHourEntry.deleteMany({ where: { consultantId: { in: ids } } });
    await prisma.capacityConfig.deleteMany({ where: { consultantId: { in: ids } } });
    await prisma.consultant.deleteMany({ where: { id: { in: ids } } });
    await prisma.project.deleteMany({ where: { id: { in: [proyecto, proyectoOtro] } } });
    await app.close();
  });

  // ---------------------------------------------------------------------------------------------
  describe("1. horas extra: solicitud -> PM -> real -> excedente -> nómina", () => {
    const dia = diaHabilFuturo();

    /** Pasos comunes: el consultor pide 19:00-22:00 (3 h), el PM aprueba y registra 4 h reales. */
    async function hastaExcedente(c: { id: string; email: string }) {
      const pedida = await app.inject({
        method: "POST",
        url: "/api/extra-hours",
        headers: como(c),
        payload: { projectId: proyecto, consultantId: c.id, date: dia, startTime: "19:00", endTime: "22:00" },
      });
      expect(pedida.statusCode, pedida.body).toBe(201);
      const solicitud = pedida.json().data as { id: string; status: string; totalHours: string };
      expect(solicitud.status).toBe("PENDING_PM");
      expect(Number(solicitud.totalHours)).toBe(3);

      // Pendiente de aprobar: todavía no habilita el tipo EXTRA.
      const antes = await putDia(como(c), proyecto, dia, [extra(dia, "19:00", "21:00")]);
      expect(antes.statusCode).toBe(400);
      expect(antes.json()).toMatchObject({ code: "EXTRA_WITHOUT_APPROVAL", index: 0 });

      // Aprobación única del PM: ni el propio consultor, ni ADMIN, ni el PM de otro proyecto.
      const url = `/api/extra-hours/${solicitud.id}/approve`;
      expect((await app.inject({ method: "PATCH", url, headers: como(c) })).statusCode).toBe(403);
      expect((await app.inject({ method: "PATCH", url, headers: comoAdmin() })).statusCode).toBe(403);
      expect(
        (await app.inject({ method: "PATCH", url, headers: comoRol(AppRole.PM, `otro.${pmEmail}`) })).statusCode,
      ).toBe(403);
      const ok = await app.inject({ method: "PATCH", url, headers: comoPM() });
      expect(ok.statusCode, ok.body).toBe(200);
      expect(ok.json().data.status).toBe("APPROVED");
      // Aprobar dos veces no vale.
      expect((await app.inject({ method: "PATCH", url, headers: comoPM() })).statusCode).toBe(409);

      // El saldo es por proyecto: la aprobación en `proyecto` no habilita EXTRA en otro proyecto.
      const otro = await putDia(como(c), proyectoOtro, dia, [extra(dia, "19:00", "20:00")]);
      expect(otro.statusCode).toBe(400);
      expect(otro.json().code).toBe("EXTRA_WITHOUT_APPROVAL");

      // Registro real dentro del saldo: 19:00-21:00 (2 h de 3).
      const dentro = await putDia(como(c), proyecto, dia, [extra(dia, "19:00", "21:00")]);
      expect(dentro.statusCode, dentro.body).toBe(200);
      const [primera] = dentro.json().data.entries as Entry[];
      expect(dentro.json().data.entries).toHaveLength(1);
      expect(primera).toMatchObject({ isExcess: false, extraHourEntryId: solicitud.id, status: "PENDING" });
      expect(Number(primera.hours)).toBe(2);
      expect(dentro.json().data.summary.projects.find((p: { projectId: string }) => p.projectId === proyecto)).toMatchObject({
        extraApproved: 3,
        extraUsed: 2,
        extraExcess: 0,
      });

      // Las horas no coinciden con la franja: se rechaza con el índice de la fila.
      const desfasada = await putDia(como(c), proyecto, dia, [
        { ...extra(dia, "19:00", "21:00"), id: primera.id },
        { ...extra(dia, "21:00", "23:00"), hours: 3 },
      ]);
      expect(desfasada.statusCode).toBe(400);
      expect(desfasada.json()).toMatchObject({ code: "EXTRA_HOURS_SPAN_MISMATCH", index: 1 });

      // Registra 2 h más (21:00-23:00): 1 h cabe en el saldo y 1 h queda como excedente.
      const mas = await putDia(como(c), proyecto, dia, [
        { ...extra(dia, "19:00", "21:00"), id: primera.id },
        extra(dia, "21:00", "23:00"),
      ]);
      expect(mas.statusCode, mas.body).toBe(200);
      const entries = mas.json().data.entries as Entry[];
      const normales = entries.filter((e) => !e.isExcess);
      const excedentes = entries.filter((e) => e.isExcess);
      expect(sumar(normales)).toBe(3);
      expect(excedentes).toHaveLength(1);
      expect(Number(excedentes[0].hours)).toBe(1);
      // El corte va en el límite del saldo: el excedente es la ÚLTIMA hora de la franja (22:00-23:00).
      expect(excedentes[0].startedAt).toBe(local(dia, "22:00"));
      expect(excedentes[0].endedAt).toBe(local(dia, "23:00"));
      expect(excedentes[0].extraHourEntryId).toBe(solicitud.id);
      expect(entries.every((e) => e.status === "PENDING")).toBe(true);

      expect(await filaSolicitud(solicitud.id)).toMatchObject({ realHours: 3, excessHours: 1, excessPendingHours: 1 });

      // La bandeja aparte de excedentes se retiró (R15): el excedente se decide en la revisión semanal.
      const bandeja = await app.inject({ method: "GET", url: "/api/extra-hours/excess-pending", headers: comoPM() });
      expect(bandeja.json().data).toEqual([]);

      // Nada aprobado en el timesheet todavía: la nómina no paga nada (ni la solicitud aprobada).
      expect(await filaNomina(dia, (await prisma.consultant.findUniqueOrThrow({ where: { id: c.id } })).fullName)).toBeUndefined();
      return { solicitud, normales, excedente: excedentes[0], item: { consultantId: c.id, projectId: proyecto, weekStart: lunesDeDia(dia) } };
    }

    it("excedente APROBADO con la semana: la nómina paga las 4 h reales, no las 3 h pedidas", async () => {
      const c = await nuevoConsultor("ExtraOk", { jornadaPropia: 8 });
      const { solicitud, excedente, item } = await hastaExcedente(c);

      // Enviada la semana, tampoco se paga. Ni el consultor, ni ADMIN, ni el PM de otro proyecto la aprueban.
      await marcarSemanaEnviada(c.id, proyecto, dia);
      expect(await filaNomina(dia, c.fullName)).toBeUndefined();
      expect((await aprobarSemana(app, como(c), item)).statusCode).toBe(403);
      expect((await aprobarSemana(app, comoAdmin(), item)).statusCode).toBe(403);
      expect((await aprobarSemana(app, comoRol(AppRole.PM, `otro.${pmEmail}`), item)).statusCode).toBe(403);
      const ok = await aprobarSemana(app, comoPM(), item);
      expect(ok.statusCode, ok.body).toBe(200);
      expect((await prisma.timeEntry.findUniqueOrThrow({ where: { id: excedente.id } })).status).toBe("APPROVED");
      // Transiciones inválidas: aprobar o devolver algo ya aprobado.
      expect((await aprobarSemana(app, comoPM(), item)).statusCode).toBe(409);
      expect((await devolverSemana(app, comoPM(), { ...item, note: "tarde" })).statusCode).toBe(409);

      const fila = await filaNomina(dia, c.fullName);
      expect(fila!.realHours).toBeCloseTo(4, 2);
      expect(fila!.totalHours).toBeCloseTo(4, 2);
      // Mismo desglose y monto que el simulador de horas extra para la franja REAL 19:00-23:00
      // (en Colombia la franja nocturna empieza a las 19:00 por configuración: no se asume la hora).
      const sim = await app.inject({
        method: "POST",
        url: "/api/extra-hours/calculate",
        headers: comoAdmin(),
        payload: { consultantId: c.id, date: dia, startTime: "19:00", endTime: "23:00" },
      });
      expect(sim.statusCode, sim.body).toBe(200);
      const esperado = sim.json().data;
      expect(Number(esperado.totalHours)).toBeCloseTo(4, 2);
      expect(fila!.diurnal + fila!.diurnalHoliday).toBeCloseTo(Number(esperado.diurnal) + Number(esperado.diurnalHoliday), 2);
      expect(fila!.nocturnal + fila!.nocturnalHoliday).toBeCloseTo(Number(esperado.nocturnal) + Number(esperado.nocturnalHoliday), 2);
      expect(fila!.totalAmountLocal).toBeCloseTo(Number(esperado.totalAmount), 2);
      expect(fila!.totalAmountLocal).toBeGreaterThan(Number((await prisma.extraHourEntry.findUniqueOrThrow({ where: { id: solicitud.id } })).totalAmount));

      expect(await filaSolicitud(solicitud.id)).toMatchObject({ realHours: 3, excessHours: 1, excessPendingHours: 0 });
    });

    it("excedente DEVUELTO: el consultor lo quita y reenvía; la nómina queda en las 3 h normales", async () => {
      const c = await nuevoConsultor("ExtraNo", { jornadaPropia: 8 });
      const { solicitud, normales, excedente, item } = await hastaExcedente(c);
      await marcarSemanaEnviada(c.id, proyecto, dia);

      // Devolver exige nota.
      const sinMotivo = await app.inject({
        method: "POST",
        url: "/api/timesheet-reviews/return",
        headers: comoPM(),
        payload: item,
      });
      expect(sinMotivo.statusCode).toBe(400);

      const r = await devolverSemana(app, comoPM(), { ...item, note: "No se autoriza el excedente" });
      expect(r.statusCode, r.body).toBe(200);
      const devuelto = await prisma.timeEntry.findUniqueOrThrow({ where: { id: excedente.id } });
      expect(devuelto).toMatchObject({ status: "PENDING", rejectionNote: "No se autoriza el excedente", rejectedBy: pmEmail });
      // Devuelta no se paga todavía.
      expect(await filaNomina(dia, c.fullName)).toBeUndefined();

      // El consultor deja solo las filas normales (el proyecto devuelto sí se puede editar) y reenvía.
      const corregido = await putDia(
        como(c),
        proyecto,
        dia,
        normales.map((e) => ({
          id: e.id,
          typeId: tipos.extra,
          hours: Number(e.hours),
          startedAt: (e as unknown as { startedAt: string }).startedAt,
          endedAt: (e as unknown as { endedAt: string }).endedAt,
        })),
      );
      expect(corregido.statusCode, corregido.body).toBe(200);
      expect((corregido.json().data.entries as Entry[]).some((e) => e.isExcess)).toBe(false);
      await marcarSemanaEnviada(c.id, proyecto, dia);
      expect((await aprobarSemana(app, comoPM(), item)).statusCode).toBe(200);

      const fila = await filaNomina(dia, c.fullName);
      expect(fila!.realHours).toBeCloseTo(3, 2);

      const sim = await app.inject({
        method: "POST",
        url: "/api/extra-hours/calculate",
        headers: comoAdmin(),
        payload: { consultantId: c.id, date: dia, startTime: "19:00", endTime: "22:00" },
      });
      const esperado = sim.json().data;
      expect(fila!.diurnal + fila!.diurnalHoliday).toBeCloseTo(Number(esperado.diurnal) + Number(esperado.diurnalHoliday), 2);
      expect(fila!.nocturnal + fila!.nocturnalHoliday).toBeCloseTo(Number(esperado.nocturnal) + Number(esperado.nocturnalHoliday), 2);
      expect(fila!.totalAmountLocal).toBeCloseTo(Number(esperado.totalAmount), 2);

      // Aprobado vs. real: el excedente quitado ya no cuenta.
      expect(await filaSolicitud(solicitud.id)).toMatchObject({ realHours: 3, excessHours: 0, excessPendingHours: 0 });
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("2. ausencias: bloqueo de capacidad", () => {
    const dia = "2026-08-18"; // martes
    const capacidadAgosto = async (consultantId: string) => {
      const res = await app.inject({
        method: "GET",
        url: `/api/capacity/consultant/${consultantId}?from=2026-08-01&to=2026-08-31`,
        headers: comoAdmin(),
      });
      expect(res.statusCode, res.body).toBe(200);
      return res.json().data.timeline[0].capacityHours as number;
    };
    const bloques = (consultantId: string) => prisma.consultantBlock.findMany({ where: { consultantId } });

    it("vacaciones de jornada completa: pendiente no bloquea; aprobada bloquea y descuenta; borrada libera", async () => {
      const c = await nuevoConsultor("Vacas", { jornadaPropia: 8 });
      const base = await capacidadAgosto(c.id);
      expect(base).toBeGreaterThan(0);

      const vac = await putDia(como(c), ausencias, dia, [{ typeId: tipos.vacaciones, hours: 8 }]);
      expect(vac.statusCode, vac.body).toBe(200);
      const id = (vac.json().data.entries as Entry[])[0].id;
      expect(await bloques(c.id)).toHaveLength(0);
      expect(await capacidadAgosto(c.id)).toBe(base);

      // La ausencia cuenta contra la jornada: ya no cabe ni una hora regular ese día.
      const regular = await putDia(como(c), proyecto, dia, [{ typeId: tipos.regular, hours: 1 }]);
      expect(regular.statusCode).toBe(400);
      expect(regular.json().code).toBe("DAILY_CAP_EXCEEDED");

      // Ausencias no tiene PM: ni el consultor ni un PM cualquiera la aprueban; ADMIN sí.
      expect((await aprobar(id, como(c))).statusCode).toBe(403);
      expect((await aprobar(id, comoPM())).statusCode).toBe(403);
      const ok = await aprobar(id, comoAdmin());
      expect(ok.statusCode, ok.body).toBe(200);

      const tras = await bloques(c.id);
      expect(tras).toHaveLength(1);
      expect(tras[0]).toMatchObject({ blockType: "VACATION", timeEntryId: id });
      expect(await capacidadAgosto(c.id)).toBeCloseTo(base - 8, 1);

      // Ya aprobada: no se devuelve (409) ni la borra el consultor (409, semana bloqueada); el bloqueo sigue.
      expect(
        (
          await devolverSemana(app, comoAdmin(), { consultantId: c.id, projectId: ausencias, weekStart: lunesDeDia(dia), note: "tarde" })
        ).statusCode,
      ).toBe(409);
      expect((await app.inject({ method: "DELETE", url: `/api/time-entries/${id}`, headers: como(c) })).statusCode).toBe(409);
      expect(await bloques(c.id)).toHaveLength(1);

      // ADMIN la borra: el bloqueo desaparece y la capacidad vuelve.
      expect((await app.inject({ method: "DELETE", url: `/api/time-entries/${id}`, headers: comoAdmin() })).statusCode).toBe(204);
      expect(await bloques(c.id)).toHaveLength(0);
      expect(await capacidadAgosto(c.id)).toBe(base);
    });

    it("devuelta no bloquea ni cuenta; corregida con permiso + vacaciones que suman la jornada, sí bloquea", async () => {
      const c = await nuevoConsultor("Ausente", { jornadaPropia: 8 });
      const base = await capacidadAgosto(c.id);

      const vac = await putDia(como(c), ausencias, dia, [{ typeId: tipos.vacaciones, hours: 8 }]);
      const idVac = (vac.json().data.entries as Entry[])[0].id;
      const r = await devolver(idVac, comoAdmin());
      expect(r.statusCode, r.body).toBe(200);
      expect(await bloques(c.id)).toHaveLength(0);
      expect(await capacidadAgosto(c.id)).toBe(base);

      // El consultor corrige el proyecto devuelto: 4 h de permiso + 4 h de vacaciones.
      const mixto = await putDia(como(c), ausencias, dia, [
        { typeId: tipos.permiso, hours: 4 },
        { typeId: tipos.vacaciones, hours: 4 },
      ]);
      expect(mixto.statusCode, mixto.body).toBe(200);
      const pendientes = mixto.json().data.entries as Entry[];
      expect(pendientes).toHaveLength(2);
      expect(pendientes.every((e) => e.status === "PENDING")).toBe(true);

      // Enviada y aprobada la semana: ya cubren la jornada.
      expect((await aprobar(pendientes[0].id, comoAdmin())).statusCode).toBe(200);
      expect(await bloques(c.id)).toHaveLength(1);
      expect(await capacidadAgosto(c.id)).toBeCloseTo(base - 8, 1);

      // Al borrar cualquiera de las dos, el resto ya no cubre el día: el bloqueo se elimina.
      const vinculada = (await bloques(c.id))[0].timeEntryId!;
      const otra = pendientes.find((e) => e.id !== vinculada)!.id;
      expect((await app.inject({ method: "DELETE", url: `/api/time-entries/${otra}`, headers: comoAdmin() })).statusCode).toBe(204);
      expect(await bloques(c.id)).toHaveLength(0);
      expect(await capacidadAgosto(c.id)).toBe(base);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("3. reclasificación del excedente", () => {
    const dia = "2026-08-11";

    async function preparar(etiqueta: string) {
      const c = await nuevoConsultor(etiqueta, { jornadaPropia: 8 });
      const solicitud = await solicitudAprobada(c.id, dia, 2);
      const res = await putDia(como(c), proyecto, dia, [extra(dia, "19:00", "21:00"), extra(dia, "21:00", "22:00")]);
      expect(res.statusCode, res.body).toBe(200);
      const entries = res.json().data.entries as Entry[];
      const normal = entries.find((e) => !e.isExcess)!;
      const excedente = entries.find((e) => e.isExcess)!;
      expect(Number(normal.hours)).toBe(2);
      expect(Number(excedente.hours)).toBe(1);
      return { c, solicitud, normal, excedente };
    }

    it("PUT /day sin la fila EXTRA normal: el excedente pendiente pasa a normal y deja de contar como excedente", async () => {
      const { c, solicitud, excedente } = await preparar("Reclasif");

      const res = await putDia(como(c), proyecto, dia, [
        { ...extra(dia, "21:00", "22:00"), id: excedente.id },
      ]);
      expect(res.statusCode, res.body).toBe(200);
      const entries = res.json().data.entries as Entry[];
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ id: excedente.id, isExcess: false, extraHourEntryId: solicitud.id });
      expect(Number(entries[0].hours)).toBe(1);

      const bandeja = await app.inject({ method: "GET", url: "/api/extra-hours/excess-pending", headers: comoPM() });
      expect((bandeja.json().data as { id: string }[]).map((e) => e.id)).not.toContain(excedente.id);
      expect(await filaSolicitud(solicitud.id)).toMatchObject({ realHours: 1, excessHours: 0, excessPendingHours: 0 });

      // Y ahora el PM puede aprobarla (ya no es excedente).
      expect((await aprobar(excedente.id, comoPM())).statusCode).toBe(200);
    });

    it("devolver la semana no altera la partición: el excedente sigue siendo excedente y conserva la nota", async () => {
      const { solicitud, normal, excedente } = await preparar("ReclasRech");
      expect((await devolver(normal.id, comoPM())).statusCode).toBe(200);

      const despues = await prisma.timeEntry.findMany({ where: { id: { in: [normal.id, excedente.id] } } });
      expect(despues.every((e) => e.status === "PENDING" && e.rejectedBy === pmEmail)).toBe(true);
      expect(despues.find((e) => e.id === excedente.id)).toMatchObject({ isExcess: true, extraHourEntryId: solicitud.id });
    });

    // Hallazgo QA-R14-2 (ver informe): DELETE /api/time-entries/:id no reparte el saldo liberado.
    // (Corregido: el borrado re-evalúa la partición de excedentes.)
    // que quitar el `.fails`.
    it("DELETE de la EXTRA normal también debería reclasificar el excedente pendiente [QA-R14-2]", async () => {
      const { normal, excedente } = await preparar("ReclasDel");
      const del = await app.inject({ method: "DELETE", url: `/api/time-entries/${normal.id}`, headers: comoAdmin() });
      expect(del.statusCode).toBe(204);
      const despues = await prisma.timeEntry.findUniqueOrThrow({ where: { id: excedente.id } });
      expect(despues.isExcess).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("4. vigencia de jornada: Colombia 8 -> 8.4 el 2026-07-15", () => {
    beforeEach(async () => {
      if (restaurar.length === 0) {
        await fijarJornadaPais("Colombia", "2000-01-01", 8);
        await fijarJornadaPais("Colombia", "2026-07-15", 8.4);
      }
    });

    it("el 14 de julio el tope es 8 y el 15 es 8.4 (tope, day-summary y bloqueo por ausencia)", async () => {
      // Sin jornada propia: sale de la del país con su vigencia.
      const c = await nuevoConsultor("Vigencia");

      const resumen = await app.inject({
        method: "GET",
        url: "/api/time-entries/day-summary?from=2026-07-13&to=2026-07-16",
        headers: como(c),
      });
      expect(resumen.statusCode, resumen.body).toBe(200);
      expect((resumen.json().data.days as { date: string; hoursPerDay: number }[]).map((d) => [d.date, d.hoursPerDay])).toEqual([
        ["2026-07-13", 8],
        ["2026-07-14", 8],
        ["2026-07-15", 8.4],
        ["2026-07-16", 8.4],
      ]);

      // 14 de julio: 8.1 no cabe, 8 sí, y luego nada más en otro proyecto.
      const pasa14 = await putDia(como(c), proyecto, "2026-07-14", [{ typeId: tipos.regular, hours: 8.1 }]);
      expect(pasa14.statusCode).toBe(400);
      expect(pasa14.json().code).toBe("DAILY_CAP_EXCEEDED");
      expect((await putDia(como(c), proyecto, "2026-07-14", [{ typeId: tipos.regular, hours: 8 }])).statusCode).toBe(200);
      expect((await putDia(como(c), proyectoOtro, "2026-07-14", [{ typeId: tipos.regular, hours: 0.01 }])).statusCode).toBe(400);

      // 15 de julio: 8.4 cabe repartido en dos proyectos; un centésimo más no.
      expect((await putDia(como(c), proyecto, "2026-07-15", [{ typeId: tipos.regular, hours: 5 }])).statusCode).toBe(200);
      const cabe15 = await putDia(como(c), proyectoOtro, "2026-07-15", [{ typeId: tipos.regular, hours: 3.4 }]);
      expect(cabe15.statusCode, cabe15.body).toBe(200);
      expect(cabe15.json().data.summary).toMatchObject({ hoursPerDay: 8.4, usedRegular: 8.4, remaining: 0 });
      const pasa15 = await putDia(como(c), proyectoOtro, "2026-07-15", [{ typeId: tipos.regular, hours: 3.41 }]);
      expect(pasa15.statusCode).toBe(400);

      // Ausencia de 8 h: cubre la jornada el 13 (8 h) pero NO el 16 (8.4 h).
      const v13 = await putDia(como(c), ausencias, "2026-07-13", [{ typeId: tipos.vacaciones, hours: 8 }]);
      const v16 = await putDia(como(c), ausencias, "2026-07-16", [{ typeId: tipos.vacaciones, hours: 8 }]);
      expect(v13.statusCode, v13.body).toBe(200);
      expect(v16.statusCode, v16.body).toBe(200);
      // Ambos días son de la misma semana del proyecto Ausencias: una sola aprobación los cubre.
      expect((await aprobar((v13.json().data.entries as Entry[])[0].id, comoAdmin())).statusCode).toBe(200);
      const bloques = await prisma.consultantBlock.findMany({ where: { consultantId: c.id } });
      expect(bloques.map((b) => b.startDate.toISOString().slice(0, 10))).toEqual(["2026-07-13"]);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("5. cronómetro", () => {
    async function correrCronometro(c: { id: string }, startedAt: Date) {
      const start = await app.inject({
        method: "POST",
        url: "/api/timer/start",
        headers: comoAdmin(),
        payload: { projectId: proyecto, consultantId: c.id, startedAt: startedAt.toISOString() },
      });
      expect(start.statusCode, start.body).toBe(201);
      const stop = await app.inject({ method: "POST", url: "/api/timer/stop", headers: como(c), payload: { consultantId: c.id } });
      expect(stop.statusCode, stop.body).toBe(201);
      return stop.json() as { data: Entry | null; entries: Entry[]; discardedHours: number };
    }

    it("considera lo ya registrado ese día en OTROS proyectos y descarta lo que pasa del tope sin solicitud", async () => {
      const c = await nuevoConsultor("TimerTope", { jornadaPropia: 8 });
      const inicio = new Date(Date.now() - 3 * 3_600_000);
      const workDate = diaLocalBogota(inicio);
      await prisma.timeEntry.create({
        data: { projectId: proyectoOtro, consultantId: c.id, workDate, hours: 6, typeId: tipos.regular },
      });

      const r = await correrCronometro(c, inicio);
      expect(r.entries).toHaveLength(1);
      expect(r.entries[0].type.category).toBe("REGULAR");
      expect(Number(r.entries[0].hours)).toBeCloseTo(2, 3);
      expect(r.discardedHours).toBeCloseTo(1, 2);
      expect(await prisma.runningTimer.count({ where: { consultantId: c.id } })).toBe(0);
    });

    it("con la jornada ya completa y sin solicitud no guarda nada: 201, data null y todo descartado", async () => {
      const c = await nuevoConsultor("TimerLleno", { jornadaPropia: 8 });
      const inicio = new Date(Date.now() - 2 * 3_600_000);
      const workDate = diaLocalBogota(inicio);
      await prisma.timeEntry.create({
        data: { projectId: proyectoOtro, consultantId: c.id, workDate, hours: 8, typeId: tipos.regular, status: "APPROVED" },
      });

      const r = await correrCronometro(c, inicio);
      expect(r.entries).toHaveLength(0);
      expect(r.data).toBeNull();
      expect(r.discardedHours).toBeCloseTo(2, 2);
      // El cronómetro se elimina igual: el tiempo queda solo informado.
      expect(await prisma.runningTimer.count({ where: { consultantId: c.id } })).toBe(0);
    });

    // Hallazgo QA-R14-1 (ver informe): el cronómetro imputa al día UTC del inicio, mientras que el
    // resto de R14 ata la franja al día LOCAL del consultor (SPAN_OUTSIDE_WORKDATE). Un cronómetro
    // arrancado entre las 19:00 y las 23:59 de Bogotá cae en el día siguiente.
    it("un cronómetro arrancado a las 20:00 de Bogotá se imputa a ese día local [QA-R14-1]", async () => {
      const c = await nuevoConsultor("TimerNoche", { jornadaPropia: 8 });
      // 20:00 o 23:00 de Bogotá del día anterior (01:00 o 04:00 UTC).
      const inicio = inicioNocturnoReciente();
      const diaLocal = new Date(inicio.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);

      const r = await correrCronometro(c, inicio);
      expect(r.entries.length).toBeGreaterThan(0);
      expect(r.entries[0].workDate.slice(0, 10)).toBe(diaLocal);
    });

    it("con solicitud aprobada y jornada completa, la noche del cronómetro se descarta: no se crea EXTRA [QA-R14-1]", async () => {
      const c = await nuevoConsultor("TimerExtra", { jornadaPropia: 8 });
      const inicio = inicioNocturnoReciente();
      const diaLocal = new Date(inicio.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
      // Jornada del día local ya completa y horas extra aprobadas por el PM para esa noche.
      await prisma.timeEntry.create({
        data: { projectId: proyectoOtro, consultantId: c.id, workDate: new Date(`${diaLocal}T00:00:00.000Z`), hours: 8, typeId: tipos.regular },
      });
      await solicitudAprobada(c.id, diaLocal, 3);

      const r = await correrCronometro(c, inicio);
      expect(r.entries).toEqual([]);
      expect(r.data).toBeNull();
      expect(r.discardedHours).toBeGreaterThan(0);
    });

    it("un registro del cronómetro nocturno se puede editar (descripción) después [QA-R14-1]", async () => {
      const c = await nuevoConsultor("TimerEdita", { jornadaPropia: 8 });
      const inicio = inicioNocturnoReciente();

      const r = await correrCronometro(c, inicio);
      const patch = await app.inject({
        method: "PATCH",
        url: `/api/time-entries/${r.entries[0].id}`,
        headers: como(c),
        payload: { description: "Cierre del día" },
      });
      expect(patch.statusCode, patch.body).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("6. regresión: horas sin tipo", () => {
    it("POST sin typeId queda REGULAR, se edita, la aprueba el PM y aparece en el listado", async () => {
      const c = await nuevoConsultor("Legado", { jornadaPropia: 8 });
      const creada = await app.inject({
        method: "POST",
        url: "/api/time-entries",
        headers: como(c),
        payload: { projectId: proyecto, workDate: "2026-08-25", hours: 3, note: "sin tipo" },
      });
      expect(creada.statusCode, creada.body).toBe(201);
      const e = creada.json().data as Entry;
      expect(e).toMatchObject({ typeId: tipos.regular, isExcess: false, extraHourEntryId: null, status: "PENDING" });
      expect(e.type.code).toBe("REGULAR");

      const editada = await app.inject({
        method: "PATCH",
        url: `/api/time-entries/${e.id}`,
        headers: como(c),
        payload: { hours: 4 },
      });
      expect(editada.statusCode, editada.body).toBe(200);
      expect(Number(editada.json().data.hours)).toBe(4);

      expect((await aprobar(e.id, comoPM())).statusCode).toBe(200);
      const lista = await app.inject({
        method: "GET",
        url: `/api/time-entries?from=2026-08-25&to=2026-08-25`,
        headers: como(c),
      });
      expect(lista.statusCode).toBe(200);
      const fila = (lista.json().data as Entry[]).find((x) => x.id === e.id)!;
      expect(fila).toMatchObject({ status: "APPROVED", typeId: tipos.regular });
    });

    it("un INSERT sin typeId (código anterior a R14) toma el REGULAR por defecto de la columna", async () => {
      const c = await nuevoConsultor("Insert", { jornadaPropia: 8 });
      const fila = await prisma.timeEntry.create({
        data: { projectId: proyecto, consultantId: c.id, workDate: new Date(Date.UTC(2026, 7, 26)), hours: 2 },
        include: { type: true },
      });
      expect(fila.type.code).toBe("REGULAR");
      expect(fila.typeId).toBe(tipos.regular);
    });
  });
});

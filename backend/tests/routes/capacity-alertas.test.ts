import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/infra/prisma.js";
import { runCapacityAlerts } from "../../src/modules/capacity/capacity-alerts.service.js";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";

/**
 * Parámetros nuevos de capacity (alertas y resumen), job `capacity-alerts` y visibilidad de
 * CONSULTANT_UNDERUTILIZED (CONTRATO §5.2/§5.3).
 *
 * Fixture: la hoja del Excel (C1 sobreasignado, C2 con octubre bajo, C3 solo con probables) más C4,
 * que solo trabaja en un proyecto interno. El país lleva un nombre propio por ejecución para no
 * chocar con los feriados de otras pruebas. El job corre sobre TODOS los consultores de la base de
 * pruebas: las aserciones filtran por los ids de este fixture. "Ahora" se fija en el 15-oct-2026
 * (horizonte de 3 meses = oct, nov y dic de 2026) para que no dependa del reloj.
 */
describe("Alertas de capacity y parámetros nuevos", () => {
  let app: FastifyInstance;

  const prefijo = `calt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const EC = `EC-${prefijo}`;
  const CO = `CO-${prefijo}`;
  const AHORA = new Date("2026-10-15T12:00:00Z");

  const ids = { C1: "", C2: "", C3: "", C4: "" };
  const consultorIds: string[] = [];
  const proyectoIds: string[] = [];
  let asignacionC1Grande = "";
  let settingsOriginal: Record<string, unknown> | null = null;

  const EC_FERIADOS = ["2026-10-09", "2026-11-02", "2026-11-03", "2026-11-20", "2026-12-07", "2026-12-25"];
  const CO_FERIADOS = ["2026-10-12", "2026-11-02", "2026-11-16", "2026-12-08", "2026-12-25"];

  async function fijarSettings(datos: Record<string, unknown> = {}) {
    const base = {
      underThresholdPct: 70,
      overThresholdPct: 100,
      includeProbablesDefault: false,
      alertsEnabled: true,
      alertHorizonMonths: 3,
      digestEnabled: true,
      digestWeekday: 1,
      digestHourUtc: 13,
      digestLastSentAt: null,
      ...datos,
    };
    await prisma.capacitySettings.upsert({
      where: { scope: "GENERAL" },
      update: base,
      create: { scope: "GENERAL", ...base },
    });
  }

  const abiertas = (consultantId: string) =>
    prisma.alert.findMany({
      where: {
        consultantId,
        resolvedAt: null,
        type: { in: ["CONSULTANT_OVERLOADED", "CONSULTANT_UNDERUTILIZED"] },
      },
      orderBy: { createdAt: "asc" },
    });
  const claves = async (consultantId: string) =>
    (await abiertas(consultantId))
      .map((a) => `${a.type}:${(a.metadata as { month: string }).month}`)
      .sort();

  beforeAll(async () => {
    app = await crearAppDePrueba();
    settingsOriginal = (await prisma.capacitySettings.findUnique({
      where: { scope: "GENERAL" },
    })) as unknown as Record<string, unknown> | null;
    await fijarSettings();

    const crearConsultor = async (clave: keyof typeof ids, country: string, horas: number, nombre?: string) => {
      const c = await prisma.consultant.create({
        data: {
          fullName: nombre ?? `${clave} ${prefijo}`,
          email: `${clave.toLowerCase()}.${prefijo}@synaptica.test`,
          role: "Consultor",
          hourlyRate: 40,
          rateCurrency: "USD",
          country,
          company: `Alertas ${prefijo}`,
        },
      });
      ids[clave] = c.id;
      consultorIds.push(c.id);
      await prisma.capacityConfig.create({
        data: { consultantId: c.id, hoursPerDay: horas, validFrom: new Date("2000-01-01T00:00:00Z") },
      });
    };
    await crearConsultor("C1", EC, 8);
    await crearConsultor("C2", CO, 8);
    await crearConsultor("C3", EC, 4);
    await crearConsultor("C4", CO, 8);

    const crearProyecto = async (nombre: string, isInternal: boolean) => {
      const p = await prisma.project.create({
        data: {
          name: `${nombre} ${prefijo}`,
          company: "Synaptica",
          country: "Colombia",
          currency: "USD",
          budget: 1000,
          startDate: new Date(Date.UTC(2026, 0, 1)),
          endDate: new Date(Date.UTC(2027, 11, 31)),
          isInternal,
        },
      });
      proyectoIds.push(p.id);
      return p.id;
    };
    const proyecto = await crearProyecto("Proyecto hoja", false);
    const interno = await crearProyecto("Proyecto interno", true);

    const asignar = async (
      consultantId: string,
      projectId: string,
      desde: string,
      hasta: string,
      horasSemana: number,
      certainty: "CONFIRMED" | "PROBABLE" = "CONFIRMED",
    ) =>
      prisma.assignment.create({
        data: {
          consultantId,
          projectId,
          startDate: new Date(`${desde}T00:00:00Z`),
          endDate: new Date(`${hasta}T00:00:00Z`),
          allocationMode: "HOURS",
          hoursPerPeriod: horasSemana,
          periodUnit: "week",
          certainty,
          status: "PLANNED",
        },
      });
    asignacionC1Grande = (await asignar(ids.C1, proyecto, "2026-09-01", "2027-02-26", 32)).id;
    await asignar(ids.C1, proyecto, "2026-10-01", "2026-12-18", 16);
    await asignar(ids.C2, proyecto, "2026-10-15", "2027-03-31", 40);
    await asignar(ids.C3, proyecto, "2026-11-04", "2027-01-29", 20, "PROBABLE");
    await asignar(ids.C4, interno, "2026-10-01", "2026-10-31", 40);

    await prisma.holiday.createMany({
      data: [
        ...EC_FERIADOS.map((d) => ({ country: EC, city: "", date: new Date(`${d}T00:00:00Z`), name: "Feriado EC" })),
        ...CO_FERIADOS.map((d) => ({ country: CO, city: "", date: new Date(`${d}T00:00:00Z`), name: "Feriado CO" })),
      ],
    });
  });

  afterAll(async () => {
    await prisma.alert.deleteMany({ where: { consultantId: { in: consultorIds } } });
    await prisma.assignment.deleteMany({ where: { consultantId: { in: consultorIds } } });
    await prisma.capacityConfig.deleteMany({ where: { consultantId: { in: consultorIds } } });
    await prisma.consultant.deleteMany({ where: { id: { in: consultorIds } } });
    await prisma.project.deleteMany({ where: { id: { in: proyectoIds } } });
    await prisma.holiday.deleteMany({ where: { country: { in: [EC, CO] } } });
    if (settingsOriginal) {
      const { scope: _scope, ...resto } = settingsOriginal;
      await prisma.capacitySettings.update({ where: { scope: "GENERAL" }, data: resto as never });
    } else {
      await prisma.capacitySettings.deleteMany({ where: { scope: "GENERAL" } });
    }
    await app.close();
  });

  describe("GET/PUT /api/capacity/settings con los campos nuevos", () => {
    it("el GET trae los campos de alertas y resumen, y digestLastSentAt", async () => {
      const res = await app.inject({ method: "GET", url: "/api/capacity/settings", headers: comoRol(AppRole.ADMIN) });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toMatchObject({
        alertsEnabled: true,
        alertHorizonMonths: 3,
        digestEnabled: true,
        digestWeekday: 1,
        digestHourUtc: 13,
        digestLastSentAt: null,
      });
    });

    it("ADMIN guarda los campos nuevos, deja auditoría y digestLastSentAt es solo de lectura", async () => {
      const marca = new Date("2026-10-05T13:00:00Z");
      await prisma.capacitySettings.update({ where: { scope: "GENERAL" }, data: { digestLastSentAt: marca } });

      const res = await app.inject({
        method: "PUT",
        url: "/api/capacity/settings",
        headers: comoRol(AppRole.ADMIN, "alertas.admin@synaptica.test"),
        payload: {
          underThresholdPct: 70,
          overThresholdPct: 100,
          includeProbablesDefault: false,
          alertsEnabled: false,
          alertHorizonMonths: 6,
          digestEnabled: false,
          digestWeekday: 3,
          digestHourUtc: 9,
          digestLastSentAt: "2020-01-01T00:00:00Z",
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toMatchObject({
        alertsEnabled: false,
        alertHorizonMonths: 6,
        digestEnabled: false,
        digestWeekday: 3,
        digestHourUtc: 9,
      });
      expect(new Date(res.json().data.digestLastSentAt).toISOString()).toBe(marca.toISOString());

      const registro = await prisma.auditLog.findFirst({
        where: { entity: "capacitySettings", entityId: "GENERAL", changedBy: "alertas.admin@synaptica.test" },
        orderBy: { createdAt: "desc" },
      });
      expect(registro).not.toBeNull();
      await fijarSettings();
    });

    it("un PUT sin los campos nuevos no los modifica", async () => {
      await fijarSettings({ alertHorizonMonths: 5, digestWeekday: 4 });
      const res = await app.inject({
        method: "PUT",
        url: "/api/capacity/settings",
        headers: comoRol(AppRole.ADMIN),
        payload: { underThresholdPct: 70, overThresholdPct: 100, includeProbablesDefault: false },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toMatchObject({ alertHorizonMonths: 5, digestWeekday: 4 });
      await fijarSettings();
    });

    it("valida los rangos con 400", async () => {
      const base = { underThresholdPct: 70, overThresholdPct: 100, includeProbablesDefault: false };
      const malos = [
        { alertHorizonMonths: 0 },
        { alertHorizonMonths: 13 },
        { alertHorizonMonths: 2.5 },
        { digestWeekday: 0 },
        { digestWeekday: 8 },
        { digestHourUtc: -1 },
        { digestHourUtc: 24 },
        { alertsEnabled: "si" },
      ];
      for (const extra of malos) {
        const res = await app.inject({
          method: "PUT",
          url: "/api/capacity/settings",
          headers: comoRol(AppRole.ADMIN),
          payload: { ...base, ...extra },
        });
        expect(res.statusCode, JSON.stringify(extra)).toBe(400);
      }
    });
  });

  describe("runCapacityAlerts", () => {
    it("crea las alertas esperadas con los datos del Excel", async () => {
      const r = await runCapacityAlerts(prisma, AHORA);
      expect(r.habilitado).toBe(true);
      expect(r.creadas).toBeGreaterThanOrEqual(8);

      // C1: 120 / 120 / 104,8 % -> sobreasignado los tres meses; no es subutilizado.
      expect(await claves(ids.C1)).toEqual([
        "CONSULTANT_OVERLOADED:2026-10",
        "CONSULTANT_OVERLOADED:2026-11",
        "CONSULTANT_OVERLOADED:2026-12",
      ]);
      // C2: 57,1 % en octubre (asignación desde el 15) -> subutilizado solo ese mes.
      expect(await claves(ids.C2)).toEqual(["CONSULTANT_UNDERUTILIZED:2026-10"]);
      // C3: solo tiene probables, y no cuentan -> 0 % facturable los tres meses.
      expect(await claves(ids.C3)).toEqual([
        "CONSULTANT_UNDERUTILIZED:2026-10",
        "CONSULTANT_UNDERUTILIZED:2026-11",
        "CONSULTANT_UNDERUTILIZED:2026-12",
      ]);
      // C4: en octubre ocupado al 100 % pero en un proyecto interno (nada facturable, y no es OVER);
      // nov y dic no tiene nada.
      expect(await claves(ids.C4)).toEqual([
        "CONSULTANT_UNDERUTILIZED:2026-10",
        "CONSULTANT_UNDERUTILIZED:2026-11",
        "CONSULTANT_UNDERUTILIZED:2026-12",
      ]);
      const octC4 = (await abiertas(ids.C4)).find((x) => (x.metadata as { month: string }).month === "2026-10")!;
      expect(octC4.metadata).toMatchObject({ billablePct: 0 });
      expect((octC4.metadata as { pct: number }).pct).toBeGreaterThan(90);

      const diciembre = (await abiertas(ids.C1)).find((a) => (a.metadata as { month: string }).month === "2026-12")!;
      expect(diciembre.severity).toBe("WARNING");
      expect(diciembre.message).toMatch(/^C1 .+: 105 % asignado en dic-2026 \(sobreasignado\)$/);
      expect(diciembre.metadata).toMatchObject({ month: "2026-12", pct: 104.8 });
      expect(diciembre.projectId).toBeNull();

      const c3 = (await abiertas(ids.C3))[0];
      expect(c3.severity).toBe("WARNING");
      expect(c3.message).toMatch(/0 % facturable en oct-2026 \(subutilizado\)$/);
    });

    it("es idempotente: una segunda corrida no duplica ni modifica nada", async () => {
      const antes = await prisma.alert.findMany({ where: { consultantId: { in: consultorIds } }, orderBy: { id: "asc" } });
      const r = await runCapacityAlerts(prisma, AHORA);
      expect(r.creadas).toBe(0);
      expect(r.actualizadas).toBe(0);
      expect(r.resueltas).toBe(0);
      const despues = await prisma.alert.findMany({ where: { consultantId: { in: consultorIds } }, orderBy: { id: "asc" } });
      expect(despues).toEqual(antes);
    });

    it("al cambiar la asignación actualiza lo que sigue vigente y resuelve lo que ya no aplica", async () => {
      // La asignación grande de C1 baja de 32 a 8 h/sem: 8 + 16 = 24 de 40 h/sem (60 %).
      await prisma.assignment.update({ where: { id: asignacionC1Grande }, data: { hoursPerPeriod: 8 } });
      const r = await runCapacityAlerts(prisma, AHORA);
      expect(r.resueltas).toBeGreaterThanOrEqual(3);
      // Ya no está sobreasignado, pero con 60 % facturable pasa a subutilizado.
      expect(await claves(ids.C1)).toEqual([
        "CONSULTANT_UNDERUTILIZED:2026-10",
        "CONSULTANT_UNDERUTILIZED:2026-11",
        "CONSULTANT_UNDERUTILIZED:2026-12",
      ]);

      const resueltas = await prisma.alert.findMany({
        where: { consultantId: ids.C1, type: "CONSULTANT_OVERLOADED", resolvedAt: { not: null } },
      });
      expect(resueltas).toHaveLength(3);
      expect(resueltas.every((a) => a.resolvedBy === "system:capacity-alerts")).toBe(true);
    });

    it("si la condición vuelve, abre una alerta nueva", async () => {
      await prisma.assignment.update({ where: { id: asignacionC1Grande }, data: { hoursPerPeriod: 32 } });
      await runCapacityAlerts(prisma, AHORA);
      expect(await claves(ids.C1)).toHaveLength(3);
      const historicas = await prisma.alert.count({ where: { consultantId: ids.C1, type: "CONSULTANT_OVERLOADED" } });
      expect(historicas).toBe(6);
    });

    it("resuelve las alertas de meses que salen del horizonte y las viejas sin metadata.month", async () => {
      await prisma.alert.create({
        data: {
          type: "CONSULTANT_OVERLOADED",
          severity: "WARNING",
          consultantId: ids.C2,
          message: "Alerta vieja sin mes",
        },
      });
      // "Ahora" en noviembre con horizonte 3 -> nov, dic, ene: octubre queda fuera.
      await runCapacityAlerts(prisma, new Date("2026-11-10T12:00:00Z"));
      expect(await claves(ids.C2)).toEqual([]);
      expect((await claves(ids.C3)).some((k) => k.endsWith("2026-10"))).toBe(false);
      expect((await claves(ids.C3)).some((k) => k.endsWith("2027-01"))).toBe(true);
      // En enero C1 queda en 80 % (OK): solo nov y dic siguen sobreasignados.
      expect(await claves(ids.C1)).toEqual(["CONSULTANT_OVERLOADED:2026-11", "CONSULTANT_OVERLOADED:2026-12"]);
      // Se vuelve al "ahora" del resto de pruebas.
      await runCapacityAlerts(prisma, AHORA);
    });

    it("respeta alertsEnabled=false: no crea y resuelve todo lo abierto", async () => {
      await fijarSettings({ alertsEnabled: false });
      const r = await runCapacityAlerts(prisma, AHORA);
      expect(r.habilitado).toBe(false);
      expect(r.creadas).toBe(0);
      for (const id of consultorIds) expect(await abiertas(id)).toHaveLength(0);

      // Apagadas, una nueva corrida no vuelve a abrir nada.
      await runCapacityAlerts(prisma, AHORA);
      for (const id of consultorIds) expect(await abiertas(id)).toHaveLength(0);

      await fijarSettings({ alertsEnabled: true });
      await runCapacityAlerts(prisma, AHORA);
      expect((await claves(ids.C1)).length).toBe(3);
    });

    it("alertHorizonMonths=1 deja solo el mes en curso", async () => {
      await fijarSettings({ alertHorizonMonths: 1 });
      await runCapacityAlerts(prisma, AHORA);
      expect(await claves(ids.C1)).toEqual(["CONSULTANT_OVERLOADED:2026-10"]);
      await fijarSettings();
      await runCapacityAlerts(prisma, AHORA);
    });
  });

  describe("visibilidad en GET /api/alerts", () => {
    it("VIEWER no ve CONSULTANT_UNDERUTILIZED ni CONSULTANT_OVERLOADED; ADMIN y PM sí", async () => {
      await runCapacityAlerts(prisma, AHORA);
      const consulta = (rol: AppRole, consultantId: string) =>
        app.inject({ method: "GET", url: `/api/alerts?consultantId=${consultantId}`, headers: comoRol(rol) });

      const viewerC3 = await consulta(AppRole.VIEWER, ids.C3);
      expect(viewerC3.statusCode).toBe(200);
      expect(viewerC3.json().data).toEqual([]);
      const viewerC1 = await consulta(AppRole.VIEWER, ids.C1);
      expect(viewerC1.json().data).toEqual([]);

      for (const rol of [AppRole.ADMIN, AppRole.PM]) {
        const res = await consulta(rol, ids.C3);
        expect(res.json().data.some((a: { type: string }) => a.type === "CONSULTANT_UNDERUTILIZED"), rol).toBe(true);
      }

      const contador = await app.inject({ method: "GET", url: "/api/alerts/unread-count", headers: comoRol(AppRole.VIEWER) });
      const contadorAdmin = await app.inject({ method: "GET", url: "/api/alerts/unread-count", headers: comoRol(AppRole.ADMIN) });
      expect(contadorAdmin.json().data.count).toBeGreaterThan(contador.json().data.count);
    });
  });
});

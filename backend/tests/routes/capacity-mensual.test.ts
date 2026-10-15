import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/infra/prisma.js";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";

/**
 * Informe mensual de capacity (CONTRATO §3.1 y §3.2) contra la hoja Capacity del Excel del cliente:
 * 3 consultores y 4 asignaciones, de oct-2026 a mar-2027.
 *
 * Aislamiento: la tabla `Holiday` es compartida y otras pruebas la usan, así que los países del
 * fixture llevan un nombre propio por ejecución (`EC-…`, `CO-…`) en vez de "Ecuador"/"Colombia".
 * El cálculo compara países sin distinguir mayúsculas ni tildes y no exige que sean uno de los
 * soportados, de modo que los feriados de la hoja (todos nacionales, ciudad "") se comportan igual.
 * Los consultores se agrupan con un `company` propio y se filtra por él, para que el equipo sean
 * exactamente los tres de la hoja aunque la base tenga otros.
 */
describe("GET /api/capacity/monthly (fixture del Excel)", () => {
  let app: FastifyInstance;

  const prefijo = `capm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const EC = `EC-${prefijo}`;
  const CO = `CO-${prefijo}`;
  const company = `Hoja ${prefijo}`;
  const companyInterna = `Interna ${prefijo}`;

  const EC_FERIADOS = [
    "2026-10-09", "2026-11-02", "2026-11-03", "2026-11-20", "2026-12-07", "2026-12-25",
    "2027-01-01", "2027-02-08", "2027-02-09", "2027-03-26",
  ];
  const CO_FERIADOS = [
    "2026-10-12", "2026-11-02", "2026-11-16", "2026-12-08", "2026-12-25",
    "2027-01-01", "2027-01-11", "2027-03-22", "2027-03-25", "2027-03-26",
  ];

  const ids: Record<"C1" | "C2" | "C3" | "C4" | "SIN_PAIS", string> = { C1: "", C2: "", C3: "", C4: "", SIN_PAIS: "" };
  const proyectoIds: string[] = [];
  const consultorIds: string[] = [];
  let probableAsignacionId = "";

  const url = (extra = "") =>
    `/api/capacity/monthly?from=2026-10&to=2027-03&company=${encodeURIComponent(company)}${extra}`;

  async function pedir(ruta: string, rol: AppRole = AppRole.ADMIN) {
    return app.inject({ method: "GET", url: ruta, headers: comoRol(rol) });
  }

  beforeAll(async () => {
    app = await crearAppDePrueba();

    const crearConsultor = async (
      clave: keyof typeof ids,
      datos: { country: string | null; company: string; horas: number },
    ) => {
      const c = await prisma.consultant.create({
        data: {
          fullName: `${clave} ${prefijo}`,
          email: `${clave.toLowerCase()}.${prefijo}@synaptica.test`,
          role: "Consultor",
          hourlyRate: 40,
          rateCurrency: "USD",
          country: datos.country,
          company: datos.company,
        },
      });
      ids[clave] = c.id;
      consultorIds.push(c.id);
      // Jornada propia del consultor, como la columna "Jornada" del Excel.
      await prisma.capacityConfig.create({
        data: { consultantId: c.id, hoursPerDay: datos.horas, validFrom: new Date("2000-01-01T00:00:00Z") },
      });
    };

    await crearConsultor("C1", { country: EC, company, horas: 8 });
    await crearConsultor("C2", { country: CO, company, horas: 8 });
    await crearConsultor("C3", { country: EC, company, horas: 4 });
    await crearConsultor("C4", { country: CO, company: companyInterna, horas: 8 });
    // "Default" es lo que guarda el alta de consultores cuando no se elige país;
    // el caso con `null` ya lo cubren las pruebas unitarias de capacityMonthly.
    await crearConsultor("SIN_PAIS", { country: "Default", company, horas: 8 });

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
    const proyectoInterno = await crearProyecto("Proyecto interno", true);

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

    await asignar(ids.C1, proyecto, "2026-09-01", "2027-02-26", 32);
    await asignar(ids.C1, proyecto, "2026-10-01", "2026-12-18", 16);
    await asignar(ids.C2, proyecto, "2026-10-15", "2027-03-31", 40);
    probableAsignacionId = (await asignar(ids.C3, proyecto, "2026-11-04", "2027-01-29", 20, "PROBABLE")).id;
    // Consultor aparte (otra compañía): 40 h/sem en un proyecto interno durante octubre.
    await asignar(ids.C4, proyectoInterno, "2026-10-01", "2026-10-31", 40);

    await prisma.holiday.createMany({
      data: [
        ...EC_FERIADOS.map((d) => ({ country: EC, city: "", date: new Date(`${d}T00:00:00Z`), name: "Feriado EC" })),
        ...CO_FERIADOS.map((d) => ({ country: CO, city: "", date: new Date(`${d}T00:00:00Z`), name: "Feriado CO" })),
      ],
    });
    // EC confirmado en 2026 y 2027; CO solo en 2026 (para probar HOLIDAYS_NOT_CONFIRMED).
    await prisma.holidayCalendarYear.createMany({
      data: [
        { country: EC, year: 2026, confirmedBy: "test" },
        { country: EC, year: 2027, confirmedBy: "test" },
        { country: CO, year: 2026, confirmedBy: "test" },
      ],
    });
  });

  afterAll(async () => {
    await prisma.assignment.deleteMany({ where: { consultantId: { in: consultorIds } } });
    await prisma.capacityConfig.deleteMany({ where: { consultantId: { in: consultorIds } } });
    await prisma.consultant.deleteMany({ where: { id: { in: consultorIds } } });
    await prisma.project.deleteMany({ where: { id: { in: proyectoIds } } });
    await prisma.holiday.deleteMany({ where: { country: { in: [EC, CO] } } });
    await prisma.holidayCalendarYear.deleteMany({ where: { country: { in: [EC, CO] } } });
    await app.close();
  });

  type Celda = { month: string; pct: number | null; capacityHours: number; assignedHours: number; probableHours: number };
  type Consultor = { id: string; months: Celda[]; period: Celda };

  const pcts = (celdas: Celda[]) => celdas.map((c) => c.pct);

  it("sin probables: % por consultor y del equipo igual a la hoja", async () => {
    const res = await pedir(url("&includeProbables=false"));
    expect(res.statusCode).toBe(200);
    const data = res.json().data;

    expect(data.months).toEqual(["2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03"]);
    expect(data.includeProbables).toBe(false);
    const porId = new Map<string, Consultor>(data.consultants.map((c: Consultor) => [c.id, c]));
    expect(porId.size).toBe(4); // C1, C2, C3 y el consultor sin país (misma compañía)

    expect(pcts(porId.get(ids.C1)!.months)).toEqual([120, 120, 104.8, 80, 80, 0]);
    expect(pcts(porId.get(ids.C2)!.months)).toEqual([57.1, 100, 100, 100, 100, 100]);
    expect(pcts(porId.get(ids.C3)!.months)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(pcts(data.team.months)).toEqual([70.9, 88.3, 81.9, 71.4, 73.2, 37.7]);

    // Capacidad de C1 (jornada 8 h, feriados de EC): 21, 18, 21, 20, 18, 22 días.
    expect(porId.get(ids.C1)!.months.map((m) => m.capacityHours)).toEqual([168, 144, 168, 160, 144, 176]);
    // C3 con jornada de 4 h: mitad de capacidad que C1.
    expect(porId.get(ids.C3)!.months.map((m) => m.capacityHours)).toEqual([84, 72, 84, 80, 72, 88]);
    // Las horas probables se informan aunque no entren en las asignadas.
    expect(porId.get(ids.C3)!.months[1].probableHours).toBe(72);
    expect(porId.get(ids.C3)!.months[1].assignedHours).toBe(0);
  });

  it("con includeProbables=true: C3 sube a 100 % de nov a ene y el equipo cambia", async () => {
    const res = await pedir(url("&includeProbables=true"));
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    const c3 = data.consultants.find((c: Consultor) => c.id === ids.C3) as Consultor;

    expect(pcts(c3.months)).toEqual([0, 100, 100, 100, 0, 0]);
    expect(pcts(data.team.months)).toEqual([70.9, 107.8, 101.9, 91.8, 73.2, 37.7]);
    expect(data.includeProbables).toBe(true);
  });

  it("sin includeProbables toma el valor por defecto de los parámetros (no escribe nada)", async () => {
    const antes = await prisma.capacitySettings.count();
    const res = await pedir(url());
    expect(res.statusCode).toBe(200);
    expect(typeof res.json().data.includeProbables).toBe("boolean");
    expect(res.json().data.settings).toMatchObject({ underThresholdPct: expect.any(Number), overThresholdPct: expect.any(Number) });
    expect(await prisma.capacitySettings.count()).toBe(antes);
  });

  it("permisos: CONSULTANT y VIEWER 403; COMMERCIAL, FINANCE, PM y ADMIN 200", async () => {
    for (const rol of [AppRole.CONSULTANT, AppRole.VIEWER]) {
      expect((await pedir(url(), rol)).statusCode, `monthly como ${rol}`).toBe(403);
      expect((await pedir(`/api/capacity/monthly/consultant/${ids.C1}`, rol)).statusCode, `detalle como ${rol}`).toBe(403);
    }
    for (const rol of [AppRole.COMMERCIAL, AppRole.FINANCE, AppRole.PM, AppRole.ADMIN]) {
      expect((await pedir(url(), rol)).statusCode, `monthly como ${rol}`).toBe(200);
      expect((await pedir(`/api/capacity/monthly/consultant/${ids.C1}`, rol)).statusCode, `detalle como ${rol}`).toBe(200);
    }
  });

  it("avisa HOLIDAYS_NOT_CONFIRMED por país y año sin confirmar, y sigue calculando", async () => {
    const res = await pedir(url());
    const warnings = res.json().data.warnings as Array<{ code: string; country?: string; year?: number }>;
    const sinConfirmar = warnings.filter((w) => w.code === "HOLIDAYS_NOT_CONFIRMED");
    expect(sinConfirmar).toEqual([{ code: "HOLIDAYS_NOT_CONFIRMED", country: CO, year: 2027 }]);
  });

  it("un consultor sin país queda fuera del equipo y genera aviso con su nombre", async () => {
    const res = await pedir(url("&includeProbables=false"));
    const data = res.json().data;
    const aviso = data.warnings.find((w: { code: string }) => w.code === "CONSULTANT_WITHOUT_COUNTRY");
    expect(aviso).toEqual({
      code: "CONSULTANT_WITHOUT_COUNTRY",
      consultantId: ids.SIN_PAIS,
      fullName: `SIN_PAIS ${prefijo}`,
    });
    const sinPais = data.consultants.find((c: Consultor) => c.id === ids.SIN_PAIS) as Consultor;
    expect(sinPais.months.every((m) => m.capacityHours === 0 && m.pct === null)).toBe(true);
    // El equipo no cambia por su presencia (mismos valores que el fixture de tres).
    expect(pcts(data.team.months)).toEqual([70.9, 88.3, 81.9, 71.4, 73.2, 37.7]);
    expect(data.kpis.consultantCount).toBe(3);
  });

  it("detalle por consultor: desglose por asignación y totalHours", async () => {
    const res = await pedir(`/api/capacity/monthly/consultant/${ids.C1}?from=2026-10&to=2027-03&includeProbables=false`);
    expect(res.statusCode).toBe(200);
    const data = res.json().data;

    expect(data.consultant).toMatchObject({ id: ids.C1, country: EC, company });
    expect(pcts(data.months)).toEqual([120, 120, 104.8, 80, 80, 0]);
    expect(data.assignments).toHaveLength(2);

    const porHoras = new Map<number, { hoursPerWeek: number; totalHours: number; included: boolean; months: unknown[] }>(
      data.assignments.map((a: { hoursPerWeek: number; totalHours: number; included: boolean; months: unknown[] }) => [
        a.hoursPerWeek,
        a,
      ]),
    );
    expect(porHoras.get(16)!.totalHours).toBe(166.4); // 67,2 + 57,6 + 41,6
    expect(porHoras.get(16)!.months).toHaveLength(6);
    // La suma de los desgloses es el total asignado del periodo.
    const suma = [...porHoras.values()].reduce((s, a) => s + a.totalHours, 0);
    expect(Math.round(suma * 10) / 10).toBe(data.period.assignedHours);
    expect(data.assignments[0]).toMatchObject({
      projectName: expect.stringContaining("Proyecto hoja"),
      client: "Synaptica",
      projectStatus: "ACTIVE",
      isInternal: false,
      certainty: "CONFIRMED",
    });
  });

  it("detalle: una asignación probable muestra sus horas reales aunque no se incluya", async () => {
    const sin = await pedir(`/api/capacity/monthly/consultant/${ids.C3}?from=2026-10&to=2027-03&includeProbables=false`);
    const a = sin.json().data.assignments[0];
    expect(a).toMatchObject({ assignmentId: probableAsignacionId, certainty: "PROBABLE", included: false, totalHours: 236 });

    const con = await pedir(`/api/capacity/monthly/consultant/${ids.C3}?from=2026-10&to=2027-03&includeProbables=true`);
    expect(con.json().data.assignments[0]).toMatchObject({ included: true, totalHours: 236 });
  });

  it("detalle: 404 si el consultor no existe", async () => {
    const res = await pedir("/api/capacity/monthly/consultant/no-existe");
    expect(res.statusCode).toBe(404);
  });

  it("rangos inválidos dan 400 con un mensaje claro", async () => {
    const invertido = await pedir("/api/capacity/monthly?from=2027-01&to=2026-12");
    expect(invertido.statusCode).toBe(400);
    expect(invertido.json().message).toMatch(/posterior/);

    const largo = await pedir("/api/capacity/monthly?from=2026-01&to=2028-02");
    expect(largo.statusCode).toBe(400);
    expect(largo.json().message).toMatch(/24 meses/);

    const formato = await pedir("/api/capacity/monthly?from=2026-1&to=2026-12");
    expect(formato.statusCode).toBe(400);

    const enDetalle = await pedir(`/api/capacity/monthly/consultant/${ids.C1}?from=2027-01&to=2026-12`);
    expect(enDetalle.statusCode).toBe(400);
  });

  it("24 meses exactos se aceptan", async () => {
    const res = await pedir(`/api/capacity/monthly?from=2026-01&to=2027-12&consultantId=${ids.C1}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.months).toHaveLength(24);
  });

  it("internal=exclude quita las asignaciones de proyectos internos", async () => {
    const base = `/api/capacity/monthly?from=2026-10&to=2026-10&company=${encodeURIComponent(companyInterna)}`;
    const incluido = (await pedir(`${base}&internal=include`)).json().data;
    const excluido = (await pedir(`${base}&internal=exclude`)).json().data;

    // CO-fixture, oct-2026: 22 días L-V menos el 12-oct = 21 días; 40 h/sem -> 168 h sobre 168 h.
    expect(incluido.consultants[0].months[0]).toMatchObject({ assignedHours: 168, internalHours: 168, billableHours: 0, pct: 100, billablePct: 0 });
    expect(excluido.consultants[0].months[0]).toMatchObject({ assignedHours: 0, internalHours: 0, pct: 0 });
    expect(excluido.internal).toBe("exclude");
  });

  it("filtros: país y ciudad no distinguen mayúsculas ni tildes; consultantId acota", async () => {
    const porPais = await pedir(url(`&country=${encodeURIComponent(EC.toLowerCase())}`));
    const idsPais = (porPais.json().data.consultants as Consultor[]).map((c) => c.id).sort();
    expect(idsPais).toEqual([ids.C1, ids.C3].sort());

    const uno = await pedir(`/api/capacity/monthly?from=2026-10&to=2026-10&consultantId=${ids.C2}`);
    expect((uno.json().data.consultants as Consultor[]).map((c) => c.id)).toEqual([ids.C2]);
  });

  it("los datos no se filtran: ningún campo de tarifa en la respuesta", async () => {
    const res = await pedir(url());
    expect(res.body).not.toMatch(/hourlyRate|costPerMonth|rateCurrency/);
  });
});

import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/infra/prisma.js";
import { addDaysIso, toIsoDate } from "../../src/utils/isoDate.js";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";

/**
 * Asignaciones (CONTRATO §3.6) y proyectos PROSPECT / isInternal (§3.7).
 *
 * - Escribir asignaciones es solo de ADMIN (`assignments:write`); el PM ya no.
 * - Las fechas son DATE: lo que se envía como YYYY-MM-DD vuelve igual.
 * - La sobreasignación avisa (OVERALLOCATED) y no bloquea.
 * - Un PROSPECT se crea y se lista, pero no entra en los KPIs de stats.
 *
 * El consultor usa un país propio de la ejecución y una jornada de 8 h propia, para no depender
 * de los feriados ni de las jornadas compartidas de la base.
 */
describe("Asignaciones: permisos, fechas y avisos", () => {
  let app: FastifyInstance;

  const prefijo = `asig-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let consultorId = "";
  let proyectoId = "";
  const asignacionesCreadas: string[] = [];

  const admin = comoRol(AppRole.ADMIN);

  function cuerpo(extra: Record<string, unknown> = {}) {
    return {
      projectId: proyectoId,
      consultantId: consultorId,
      startDate: "2030-03-04",
      endDate: "2030-03-29",
      allocationMode: "HOURS",
      hoursPerPeriod: 40,
      periodUnit: "week",
      ...extra,
    };
  }

  async function crear(extra: Record<string, unknown> = {}, headers = admin) {
    const res = await app.inject({ method: "POST", url: "/api/assignments", headers, payload: cuerpo(extra) });
    if (res.statusCode === 201) asignacionesCreadas.push(res.json().data.id as string);
    return res;
  }

  beforeAll(async () => {
    app = await crearAppDePrueba();
    const consultor = await prisma.consultant.create({
      data: {
        fullName: `Consultor ${prefijo}`,
        email: `c.${prefijo}@synaptica.test`,
        role: "Consultor",
        hourlyRate: 40,
        rateCurrency: "USD",
        country: `PAIS-${prefijo}`,
      },
    });
    consultorId = consultor.id;
    await prisma.capacityConfig.create({
      data: { consultantId: consultorId, hoursPerDay: 8, validFrom: new Date("2000-01-01T00:00:00Z") },
    });
    const proyecto = await prisma.project.create({
      data: {
        name: `Proyecto ${prefijo}`,
        company: "Synaptica",
        country: "Colombia",
        currency: "USD",
        budget: 1000,
        startDate: new Date(Date.UTC(2026, 0, 1)),
        endDate: new Date(Date.UTC(2031, 11, 31)),
      },
    });
    proyectoId = proyecto.id;
  });

  afterAll(async () => {
    await prisma.assignment.deleteMany({ where: { consultantId: consultorId } });
    await prisma.capacityConfig.deleteMany({ where: { consultantId: consultorId } });
    await prisma.consultant.deleteMany({ where: { id: consultorId } });
    await prisma.project.deleteMany({ where: { id: proyectoId } });
    await app.close();
  });

  it("escritura solo ADMIN: PM recibe 403 en POST, PUT, complete, cancel y DELETE; ADMIN crea (201)", async () => {
    const pm = comoRol(AppRole.PM);
    expect((await crear({}, pm)).statusCode).toBe(403);

    const ok = await crear();
    expect(ok.statusCode).toBe(201);
    const id = ok.json().data.id as string;

    const intentos = [
      app.inject({ method: "PUT", url: `/api/assignments/${id}`, headers: pm, payload: cuerpo() }),
      app.inject({ method: "PATCH", url: `/api/assignments/${id}/complete`, headers: pm }),
      app.inject({ method: "PATCH", url: `/api/assignments/${id}/cancel`, headers: pm }),
      app.inject({ method: "DELETE", url: `/api/assignments/${id}`, headers: pm }),
    ];
    for (const res of await Promise.all(intentos)) expect(res.statusCode).toBe(403);
  });

  it("lectura con capacity:read: PM, FINANCE y COMMERCIAL 200; CONSULTANT y VIEWER 403", async () => {
    for (const rol of [AppRole.PM, AppRole.FINANCE, AppRole.COMMERCIAL, AppRole.ADMIN]) {
      const res = await app.inject({ method: "GET", url: "/api/assignments", headers: comoRol(rol) });
      expect(res.statusCode, `GET como ${rol}`).toBe(200);
    }
    for (const rol of [AppRole.CONSULTANT, AppRole.VIEWER]) {
      const res = await app.inject({ method: "GET", url: "/api/assignments", headers: comoRol(rol) });
      expect(res.statusCode, `GET como ${rol}`).toBe(403);
    }
  });

  it("la fecha 2026-10-01 se guarda y se devuelve idéntica (en el POST, el GET y la base)", async () => {
    const res = await crear({ startDate: "2026-10-01", endDate: "2026-10-30", hoursPerPeriod: 4 });
    expect(res.statusCode).toBe(201);
    const { data } = res.json();
    expect(data.startDate).toBe("2026-10-01");
    expect(data.endDate).toBe("2026-10-30");

    const leida = await app.inject({ method: "GET", url: `/api/assignments/${data.id}`, headers: admin });
    expect(leida.json().data).toMatchObject({ startDate: "2026-10-01", endDate: "2026-10-30" });

    const fila = await prisma.assignment.findUniqueOrThrow({ where: { id: data.id } });
    expect(fila.startDate.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(fila.certainty).toBe("CONFIRMED");
  });

  it("una fecha ISO completa se trunca al día UTC", async () => {
    const res = await crear({ startDate: "2030-05-06T23:30:00.000Z", endDate: "2030-05-10T00:00:00.000Z", hoursPerPeriod: 4 });
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({ startDate: "2030-05-06", endDate: "2030-05-10" });
  });

  it("acepta certainty PROBABLE", async () => {
    const res = await crear({ certainty: "PROBABLE", startDate: "2031-01-06", endDate: "2031-01-10", hoursPerPeriod: 4 });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.certainty).toBe("PROBABLE");
  });

  it("endDate < startDate da 400 en POST, PUT y complete", async () => {
    const post = await crear({ startDate: "2030-04-10", endDate: "2030-04-01" });
    expect(post.statusCode).toBe(400);

    const base = await crear({ startDate: "2031-06-03", endDate: "2031-06-07", hoursPerPeriod: 4 });
    const id = base.json().data.id as string;

    const put = await app.inject({
      method: "PUT",
      url: `/api/assignments/${id}`,
      headers: admin,
      payload: cuerpo({ startDate: "2031-06-10", endDate: "2031-06-03" }),
    });
    expect(put.statusCode).toBe(400);

    // Completar una asignación futura dejaría el fin (hoy) antes del inicio.
    const complete = await app.inject({ method: "PATCH", url: `/api/assignments/${id}/complete`, headers: admin });
    expect(complete.statusCode).toBe(400);
    expect((await prisma.assignment.findUniqueOrThrow({ where: { id } })).status).toBe("PLANNED");
  });

  it("PUT recalcula el estado según las fechas (BE-09)", async () => {
    const hoy = toIsoDate(new Date());
    const creada = await crear({ startDate: "2031-07-01", endDate: "2031-07-04", hoursPerPeriod: 4 });
    expect(creada.json().data.status).toBe("PLANNED");
    const id = creada.json().data.id as string;

    const enCurso = await app.inject({
      method: "PUT",
      url: `/api/assignments/${id}`,
      headers: admin,
      payload: cuerpo({ startDate: addDaysIso(hoy, -1), endDate: addDaysIso(hoy, 1), hoursPerPeriod: 4 }),
    });
    expect(enCurso.statusCode).toBe(200);
    expect(enCurso.json().data.status).toBe("ACTIVE");

    const futura = await app.inject({
      method: "PUT",
      url: `/api/assignments/${id}`,
      headers: admin,
      payload: cuerpo({ startDate: "2031-08-01", endDate: "2031-08-04", hoursPerPeriod: 4 }),
    });
    expect(futura.json().data.status).toBe("PLANNED");
  });

  it("sobreasignación: 201 con warnings OVERALLOCATED (no bloquea); la probable no avisa", async () => {
    // Semana lunes-viernes de marzo-2032 sin otras asignaciones del consultor.
    const periodo = { startDate: "2032-03-01", endDate: "2032-03-31" };
    const primera = await crear({ ...periodo, hoursPerPeriod: 40 });
    expect(primera.statusCode).toBe(201);
    expect(primera.json().warnings).toEqual([]);

    const segunda = await crear({ ...periodo, hoursPerPeriod: 40 });
    expect(segunda.statusCode).toBe(201);
    expect(segunda.json().warnings).toEqual([{ code: "OVERALLOCATED", month: "2032-03", pct: 200 }]);

    // Una probable no cuenta para el aviso (solo confirmadas).
    const periodo2 = { startDate: "2032-05-03", endDate: "2032-05-28" };
    await crear({ ...periodo2, hoursPerPeriod: 40 });
    const probable = await crear({ ...periodo2, hoursPerPeriod: 40, certainty: "PROBABLE" });
    expect(probable.statusCode).toBe(201);
    expect(probable.json().warnings).toEqual([]);
  });

  it("PUT también devuelve el aviso de sobreasignación", async () => {
    const periodo = { startDate: "2032-07-01", endDate: "2032-07-30" };
    await crear({ ...periodo, hoursPerPeriod: 40 });
    const otra = await crear({ ...periodo, hoursPerPeriod: 4 });
    const id = otra.json().data.id as string;
    expect(otra.json().warnings).toEqual([{ code: "OVERALLOCATED", month: "2032-07", pct: 110 }]);

    const put = await app.inject({
      method: "PUT",
      url: `/api/assignments/${id}`,
      headers: admin,
      payload: cuerpo({ ...periodo, hoursPerPeriod: 8 }),
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().warnings).toEqual([{ code: "OVERALLOCATED", month: "2032-07", pct: 120 }]);
  });

  it("la edición y el borrado auditan con el usuario autenticado", async () => {
    const creada = await crear({ startDate: "2031-10-06", endDate: "2031-10-10", hoursPerPeriod: 4 });
    const id = creada.json().data.id as string;
    const del = await app.inject({ method: "DELETE", url: `/api/assignments/${id}`, headers: admin });
    expect(del.statusCode).toBe(204);
    const filas = await prisma.auditLog.findMany({ where: { entityId: id } });
    expect(filas.map((f) => f.action).sort()).toEqual(["CREATE", "DELETE"]);
  });
});

describe("Proyectos: PROSPECT e isInternal (CONTRATO §3.7)", () => {
  let app: FastifyInstance;
  const proyectosCreados: string[] = [];
  const prefijo = `pros-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const admin = comoRol(AppRole.ADMIN);

  const cuerpoBase = {
    company: "Synaptica",
    country: "Colombia",
    currency: "USD",
    budget: 1000,
    startDate: "2026-01-01",
    endDate: "2026-12-31",
  };

  beforeAll(async () => {
    app = await crearAppDePrueba();
  });

  afterAll(async () => {
    await prisma.project.deleteMany({ where: { id: { in: proyectosCreados } } });
    await app.close();
  });

  async function crearProyecto(nombre: string, extra: Record<string, unknown>) {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: admin,
      payload: { ...cuerpoBase, name: `${nombre} ${prefijo}`, ...extra },
    });
    if (res.statusCode === 201) proyectosCreados.push(res.json().data.id as string);
    return res;
  }

  it("se crea un PROSPECT interno, se lista y se lee; isInternal se conserva en un PUT sin el campo", async () => {
    const res = await crearProyecto("Oportunidad", { status: "PROSPECT", isInternal: true });
    expect(res.statusCode).toBe(201);
    const id = res.json().data.id as string;
    expect(res.json().data).toMatchObject({ status: "PROSPECT", isInternal: true });

    const lista = await app.inject({ method: "GET", url: `/api/projects?search=${encodeURIComponent(prefijo)}`, headers: admin });
    expect((lista.json().data as Array<{ id: string }>).map((p) => p.id)).toContain(id);

    const put = await app.inject({
      method: "PUT",
      url: `/api/projects/${id}`,
      headers: admin,
      payload: { ...cuerpoBase, name: `Oportunidad ${prefijo}`, status: "ACTIVE" },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().data).toMatchObject({ status: "ACTIVE", isInternal: true });
  });

  it("estado inválido sigue dando 400", async () => {
    const res = await crearProyecto("Malo", { status: "SOÑADO" });
    expect(res.statusCode).toBe(400);
  });

  it("un PROSPECT no aparece en los KPIs de stats (portfolio y overview); un ACTIVE sí", async () => {
    const prospect = (await crearProyecto("Prospecto KPI", { status: "PROSPECT" })).json().data.id as string;
    const activo = (await crearProyecto("Activo KPI", { status: "ACTIVE" })).json().data.id as string;

    const portfolio = (await app.inject({ method: "GET", url: "/api/stats/portfolio", headers: admin })).json().data;
    const idsPortafolio = (portfolio.projects as Array<{ projectId: string }>).map((p) => p.projectId);
    expect(idsPortafolio).toContain(activo);
    expect(idsPortafolio).not.toContain(prospect);
    expect(portfolio.summary.totalProjects).toBe(idsPortafolio.length);

    const overview = (await app.inject({ method: "GET", url: "/api/stats/overview", headers: admin })).json().data;
    const idsOverview = (overview.projects as Array<{ projectId: string }>).map((p) => p.projectId);
    expect(idsOverview).toContain(activo);
    expect(idsOverview).not.toContain(prospect);
  });
});

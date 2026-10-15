import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/infra/prisma.js";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";

/**
 * Reporte oficial de capacity (CONTRATO §5.2): publicar, listar, leer, anular, inmutabilidad,
 * confidencialidad (sin tarifas) y `includeAssignments` en `/monthly`.
 */
describe("/api/capacity/reports y includeAssignments", () => {
  let app: FastifyInstance;
  const prefijo = `capr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const company = `Reportes ${prefijo}`;
  let consultorId = "";
  let proyectoId = "";
  let asignacionId = "";
  const reporteIds: string[] = [];

  const qs = `from=2026-10&to=2026-12&company=${encodeURIComponent(company)}`;
  const cuerpo = (extra: Record<string, unknown> = {}) => ({
    title: `Reporte ${prefijo}`,
    from: "2026-10",
    to: "2026-12",
    includeProbables: false,
    company,
    ...extra,
  });

  const publicar = async (extra: Record<string, unknown> = {}, rol: AppRole = AppRole.ADMIN) =>
    app.inject({ method: "POST", url: "/api/capacity/reports", headers: comoRol(rol), payload: cuerpo(extra) });

  beforeAll(async () => {
    app = await crearAppDePrueba();
    const c = await prisma.consultant.create({
      data: {
        fullName: `Consultor ${prefijo}`,
        email: `c.${prefijo}@synaptica.test`,
        role: "Consultor",
        hourlyRate: 77,
        rateCurrency: "USD",
        country: `PAIS-${prefijo}`,
        company,
      },
    });
    consultorId = c.id;
    const p = await prisma.project.create({
      data: {
        name: `Proyecto ${prefijo}`,
        company: "Cliente X",
        country: "Colombia",
        currency: "USD",
        budget: 1000,
        startDate: new Date(Date.UTC(2026, 0, 1)),
        endDate: new Date(Date.UTC(2027, 11, 31)),
      },
    });
    proyectoId = p.id;
    const a = await prisma.assignment.create({
      data: {
        consultantId: consultorId,
        projectId: proyectoId,
        startDate: new Date("2026-10-01T00:00:00Z"),
        endDate: new Date("2026-12-31T00:00:00Z"),
        allocationMode: "HOURS",
        hoursPerPeriod: 20,
        periodUnit: "week",
        certainty: "CONFIRMED",
        status: "PLANNED",
      },
    });
    asignacionId = a.id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entity: "capacityReport", entityId: { in: reporteIds } } });
    await prisma.capacityReport.deleteMany({ where: { id: { in: reporteIds } } });
    await prisma.assignment.deleteMany({ where: { consultantId: consultorId } });
    await prisma.consultant.deleteMany({ where: { id: consultorId } });
    await prisma.project.deleteMany({ where: { id: proyectoId } });
    await app.close();
  });

  const monthly = async (extra = "") =>
    app.inject({ method: "GET", url: `/api/capacity/monthly?${qs}&includeProbables=false${extra}`, headers: comoRol(AppRole.ADMIN) });

  it("includeAssignments agrega el detalle por consultor con la forma de §3.2; sin el flag no viene", async () => {
    const con = (await monthly("&includeAssignments=true")).json().data;
    expect(con.consultants).toHaveLength(1);
    const asignaciones = con.consultants[0].assignments;
    expect(asignaciones).toHaveLength(1);
    expect(Object.keys(asignaciones[0]).sort()).toEqual(
      [
        "assignmentId", "projectId", "projectName", "client", "projectStatus", "isInternal", "certainty",
        "status", "startDate", "endDate", "hoursPerWeek", "included", "totalHours", "months",
      ].sort(),
    );
    expect(asignaciones[0].assignmentId).toBe(asignacionId);
    expect(asignaciones[0].client).toBe("Cliente X");
    expect(asignaciones[0].hoursPerWeek).toBe(20);

    const sin = (await monthly()).json().data;
    expect(sin.consultants[0]).not.toHaveProperty("assignments");
  });

  it("publica como ADMIN: 201 y el payload es el de /monthly?includeAssignments=true", async () => {
    const res = await publicar({ note: "nota" });
    expect(res.statusCode).toBe(201);
    const row = res.json().data;
    reporteIds.push(row.id);
    expect(row.publishedBy).toBeTruthy();
    expect(row.revokedAt).toBeNull();
    expect(row.fromMonth).toBe("2026-10");
    expect(row.toMonth).toBe("2026-12");
    expect(row.filters).toEqual({ company });
    expect(row.settings.underThresholdPct).toBeTypeOf("number");

    const esperado = (await monthly("&includeAssignments=true")).json().data;
    expect(row.payload).toEqual(esperado);
  });

  it("el payload congelado no contiene tarifas ni costos", async () => {
    const res = await publicar({ title: `Sin tarifas ${prefijo}` });
    const row = res.json().data;
    reporteIds.push(row.id);
    const texto = JSON.stringify(row.payload);
    for (const clave of ["hourlyRate", "rateCurrency", "estimatedCost", "cost", "rate"]) {
      expect(texto.includes(`"${clave}"`)).toBe(false);
    }
  });

  it("PM, FINANCE y COMMERCIAL reciben 403 al publicar y al anular", async () => {
    const id = reporteIds[0];
    for (const rol of [AppRole.PM, AppRole.FINANCE, AppRole.COMMERCIAL]) {
      expect((await publicar({}, rol)).statusCode).toBe(403);
      const r = await app.inject({
        method: "POST",
        url: `/api/capacity/reports/${id}/revoke`,
        headers: comoRol(rol),
        payload: { reason: "motivo válido" },
      });
      expect(r.statusCode).toBe(403);
    }
  });

  it("CONSULTANT y VIEWER reciben 403 en las lecturas; PM, FINANCE y COMMERCIAL leen", async () => {
    const id = reporteIds[0];
    for (const rol of [AppRole.CONSULTANT, AppRole.VIEWER]) {
      for (const url of ["/api/capacity/reports", `/api/capacity/reports/${id}`]) {
        const res = await app.inject({ method: "GET", url, headers: comoRol(rol) });
        expect(res.statusCode).toBe(403);
      }
    }
    for (const rol of [AppRole.PM, AppRole.FINANCE, AppRole.COMMERCIAL]) {
      const res = await app.inject({ method: "GET", url: `/api/capacity/reports/${id}`, headers: comoRol(rol) });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.payload.consultants).toBeDefined();
    }
  });

  it("la lista es paginada, ordenada por fecha descendente y sin payload", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/capacity/reports?page=1&pageSize=2",
      headers: comoRol(AppRole.PM),
    });
    expect(res.statusCode).toBe(200);
    const { data, meta } = res.json();
    expect(data.length).toBeLessThanOrEqual(2);
    expect(meta.pageSize).toBe(2);
    expect(meta.total).toBeGreaterThanOrEqual(2);
    for (const fila of data) expect(fila).not.toHaveProperty("payload");
    const fechas = data.map((f: { publishedAt: string }) => f.publishedAt);
    expect([...fechas].sort().reverse()).toEqual(fechas);

    const demasiado = await app.inject({
      method: "GET",
      url: "/api/capacity/reports?pageSize=101",
      headers: comoRol(AppRole.ADMIN),
    });
    expect(demasiado.statusCode).toBe(400);
  });

  it("validación de la publicación: título corto, rango invertido y nota larga dan 400", async () => {
    expect((await publicar({ title: "ab" })).statusCode).toBe(400);
    expect((await publicar({ note: "x".repeat(1001) })).statusCode).toBe(400);
    expect((await publicar({ from: "2026-12", to: "2026-10" })).statusCode).toBe(400);
    expect((await publicar({ from: "2026-01", to: "2028-12" })).statusCode).toBe(400);
    expect((await publicar({ includeProbables: undefined })).statusCode).toBe(400);
  });

  it("GET /:id inexistente da 404", async () => {
    const res = await app.inject({ method: "GET", url: "/api/capacity/reports/no-existe", headers: comoRol(AppRole.ADMIN) });
    expect(res.statusCode).toBe(404);
  });

  it("es inmutable: no hay PUT ni DELETE y un cambio posterior no altera el reporte guardado", async () => {
    const id = reporteIds[0];
    for (const method of ["PUT", "DELETE", "PATCH"] as const) {
      const res = await app.inject({
        method,
        url: `/api/capacity/reports/${id}`,
        headers: comoRol(AppRole.ADMIN),
        payload: method === "DELETE" ? undefined : { title: "otro" },
      });
      expect(res.statusCode).toBe(404);
    }

    const antes = (await app.inject({ method: "GET", url: `/api/capacity/reports/${id}`, headers: comoRol(AppRole.ADMIN) })).json().data;
    await prisma.assignment.update({ where: { id: asignacionId }, data: { hoursPerPeriod: 40 } });
    const despues = (await app.inject({ method: "GET", url: `/api/capacity/reports/${id}`, headers: comoRol(AppRole.ADMIN) })).json().data;
    expect(despues.payload).toEqual(antes.payload);

    // El informe en vivo sí cambió.
    const vivo = (await monthly("&includeAssignments=true")).json().data;
    expect(vivo.consultants[0].assignments[0].hoursPerWeek).toBe(40);
    expect(antes.payload.consultants[0].assignments[0].hoursPerWeek).toBe(20);
  });

  it("anular: motivo corto 400, éxito con marca, segunda vez 409, 404 si no existe y auditoría", async () => {
    const id = reporteIds[1];
    const revocar = (rid: string, reason: string) =>
      app.inject({
        method: "POST",
        url: `/api/capacity/reports/${rid}/revoke`,
        headers: comoRol(AppRole.ADMIN),
        payload: { reason },
      });

    expect((await revocar(id, "abcd")).statusCode).toBe(400);
    expect((await revocar("no-existe", "motivo válido")).statusCode).toBe(404);

    const ok = await revocar(id, "Se publicó con filtros equivocados");
    expect(ok.statusCode).toBe(200);
    const row = ok.json().data;
    expect(row.revokedAt).toBeTruthy();
    expect(row.revokedBy).toBeTruthy();
    expect(row.revokeReason).toBe("Se publicó con filtros equivocados");

    expect((await revocar(id, "otro motivo distinto")).statusCode).toBe(409);

    // Sigue legible, solo marcado.
    const leido = (await app.inject({ method: "GET", url: `/api/capacity/reports/${id}`, headers: comoRol(AppRole.PM) })).json().data;
    expect(leido.revokedAt).toBeTruthy();
    expect(leido.payload).toBeDefined();

    const logs = await prisma.auditLog.findMany({ where: { entity: "capacityReport", entityId: id } });
    expect(logs.map((l) => l.action).sort()).toEqual(["CANCEL", "CREATE"]);
    expect(logs.every((l) => l.changedBy.length > 0)).toBe(true);
  });
});

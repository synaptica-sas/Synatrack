import { AlertType, AppRole, AssignmentStatus } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/infra/prisma.js";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";
import { crearEscenarioBasico, idEmpresa, limpiarEscenario, type EscenarioBasico } from "../helpers/datos.js";

/**
 * Las alertas in-app se filtran por destinatario: cada usuario ve solo las que le
 * interesan (PM: las de sus proyectos; FINANCE: dinero y FX; COMMERCIAL: capacidad;
 * CONSULTANT: las suyas; VIEWER: ninguna). El contador usa el mismo filtro que el
 * listado y resolver exige ver la alerta.
 */
const FINANCIERAS: AlertType[] = ["BUDGET_WARNING", "BUDGET_EXCEEDED", "MARGIN_BELOW_THRESHOLD", "FORECAST_DEVIATION"];

describe("Alertas filtradas por destinatario", () => {
  let app: FastifyInstance;
  let escenario: EscenarioBasico;
  let pmA: string;
  let pmB: string;
  let proyectoBId: string;
  /** clave legible -> id de la alerta sembrada. */
  const alertas = new Map<string, string>();
  const idsAlertas = () => [...alertas.values()];

  async function crearAlerta(clave: string, type: AlertType, data: { projectId?: string; consultantId?: string }) {
    const a = await prisma.alert.create({
      data: { type, severity: "WARNING", message: `${escenario.prefijo} ${clave}`, ...data },
    });
    alertas.set(clave, a.id);
  }

  /** Claves sembradas que el usuario ve (listado), ignorando alertas ajenas a esta prueba. */
  async function veDe(roles: AppRole[], email?: string) {
    const res = await app.inject({ method: "GET", url: "/api/alerts", headers: comoRol(roles, email) });
    expect(res.statusCode).toBe(200);
    const filas = res.json().data as Array<{ id: string; canResolve: boolean }>;
    const porId = new Map([...alertas].map(([k, id]) => [id, k]));
    const propias = filas.filter((f) => porId.has(f.id));
    return {
      claves: propias.map((f) => porId.get(f.id)!).sort(),
      puedeResolver: Object.fromEntries(propias.map((f) => [porId.get(f.id)!, f.canResolve])),
      total: filas.length,
    };
  }

  const contador = async (roles: AppRole[], email?: string) =>
    (await app.inject({ method: "GET", url: "/api/alerts/unread-count", headers: comoRol(roles, email) })).json().data
      .count as number;

  const finA = FINANCIERAS.map((t) => `${t}:A`);
  const finB = FINANCIERAS.map((t) => `${t}:B`);

  beforeAll(async () => {
    app = await crearAppDePrueba();
    escenario = await crearEscenarioBasico("alert-dest");
    const proyectoA = await prisma.project.findUniqueOrThrow({ where: { id: escenario.projectId } });
    pmA = proyectoA.projectManagerEmail!;
    pmB = `PM.B.${escenario.prefijo}@synaptica.test`;

    const proyectoB = await prisma.project.create({
      data: {
        name: `Proyecto B ${escenario.prefijo}`,
        companyId: await idEmpresa("Synaptica"),
        country: "Colombia",
        currency: "USD",
        budget: 1000,
        startDate: new Date(Date.UTC(2026, 0, 1)),
        endDate: new Date(Date.UTC(2026, 11, 31)),
        projectManagerEmail: pmB,
      },
    });
    proyectoBId = proyectoB.id;

    const futuro = new Date(Date.UTC(2099, 0, 1));
    const pasado = new Date(Date.UTC(2020, 0, 1));
    const asignar = (consultantId: string, projectId: string, status: AssignmentStatus, endDate: Date) =>
      prisma.assignment.create({
        data: {
          consultantId,
          projectId,
          startDate: new Date(Date.UTC(2019, 0, 1)),
          endDate,
          allocationMode: "PERCENTAGE",
          allocationPct: 50,
          status,
        },
      });
    // consultor A trabaja en el proyecto A; consultor B en el B (vigente) y en el A solo en el pasado.
    await asignar(escenario.consultorA.id, escenario.projectId, AssignmentStatus.ACTIVE, futuro);
    await asignar(escenario.consultorB.id, proyectoB.id, AssignmentStatus.PARTIAL, futuro);
    await asignar(escenario.consultorB.id, escenario.projectId, AssignmentStatus.COMPLETED, pasado);

    for (const t of FINANCIERAS) {
      await crearAlerta(`${t}:A`, t, { projectId: escenario.projectId });
      await crearAlerta(`${t}:B`, t, { projectId: proyectoB.id });
    }
    await crearAlerta("ENDING:A", "ASSIGNMENT_ENDING", { projectId: escenario.projectId, consultantId: escenario.consultorA.id });
    await crearAlerta("ENDING:B", "ASSIGNMENT_ENDING", { projectId: proyectoB.id, consultantId: escenario.consultorB.id });
    await crearAlerta("OVERLOADED:A", "CONSULTANT_OVERLOADED", { consultantId: escenario.consultorA.id });
    await crearAlerta("OVERLOADED:B", "CONSULTANT_OVERLOADED", { consultantId: escenario.consultorB.id });
    await crearAlerta("UNDERUTILIZED:A", "CONSULTANT_UNDERUTILIZED", { consultantId: escenario.consultorA.id });
    await crearAlerta("FX", "FX_RATE_MISSING", {});
  });

  afterAll(async () => {
    await prisma.alert.deleteMany({ where: { id: { in: idsAlertas() } } });
    await limpiarEscenario(escenario);
    await prisma.project.deleteMany({ where: { id: proyectoBId } });
    await app.close();
  });

  const todas = () => [...alertas.keys()].sort();

  it("ADMIN ve todas y puede resolver todas", async () => {
    const r = await veDe([AppRole.ADMIN]);
    expect(r.claves).toEqual(todas());
    expect(Object.values(r.puedeResolver).every(Boolean)).toBe(true);
  });

  it("PM A ve las financieras y el vencimiento de su proyecto y la sobrecarga de su consultor vigente", async () => {
    const r = await veDe([AppRole.PM], pmA.toUpperCase()); // el correo se compara sin mayúsculas
    expect(r.claves).toEqual([...finA, "ENDING:A", "OVERLOADED:A"].sort());
    expect(Object.values(r.puedeResolver).every(Boolean)).toBe(true);
  });

  it("PM B no ve las del proyecto A; su consultor B sí cuenta (PARTIAL vigente), no por la asignación pasada de A", async () => {
    const r = await veDe([AppRole.PM], pmB);
    expect(r.claves).toEqual([...finB, "ENDING:B", "OVERLOADED:B"].sort());
  });

  it("un PM sin proyectos no ve nada", async () => {
    const r = await veDe([AppRole.PM], `nadie.${escenario.prefijo}@synaptica.test`);
    expect(r.claves).toEqual([]);
  });

  it("FINANCE ve las financieras de todos y FX, nada de capacidad", async () => {
    const r = await veDe([AppRole.FINANCE], `fin.${escenario.prefijo}@synaptica.test`);
    expect(r.claves).toEqual([...finA, ...finB, "FX"].sort());
    expect(Object.values(r.puedeResolver).every(Boolean)).toBe(true);
  });

  it("COMMERCIAL ve solo las de capacidad de todos", async () => {
    const r = await veDe([AppRole.COMMERCIAL], `com.${escenario.prefijo}@synaptica.test`);
    expect(r.claves).toEqual(["ENDING:A", "ENDING:B", "OVERLOADED:A", "OVERLOADED:B", "UNDERUTILIZED:A"]);
    expect(Object.values(r.puedeResolver).every(Boolean)).toBe(true);
  });

  it("CONSULTANT ve solo su propio vencimiento y no puede resolverlo", async () => {
    const r = await veDe([AppRole.CONSULTANT], escenario.consultorA.email);
    expect(r.claves).toEqual(["ENDING:A"]);
    expect(r.puedeResolver["ENDING:A"]).toBe(false);
  });

  it("VIEWER no ve alertas (403) ni contador", async () => {
    for (const url of ["/api/alerts", "/api/alerts/unread-count"]) {
      const res = await app.inject({ method: "GET", url, headers: comoRol(AppRole.VIEWER) });
      expect(res.statusCode, url).toBe(403);
    }
  });

  it("PM + FINANCE: unión de lo que le toca a cada rol", async () => {
    const r = await veDe([AppRole.PM, AppRole.FINANCE], pmA);
    expect(r.claves).toEqual([...finA, ...finB, "FX", "ENDING:A", "OVERLOADED:A"].sort());
  });

  it("unread-count coincide con el largo del listado en cada rol", async () => {
    const casos: Array<[AppRole[], string | undefined]> = [
      [[AppRole.ADMIN], undefined],
      [[AppRole.PM], pmA],
      [[AppRole.PM], pmB],
      [[AppRole.FINANCE], undefined],
      [[AppRole.COMMERCIAL], undefined],
      [[AppRole.CONSULTANT], escenario.consultorA.email],
      [[AppRole.PM, AppRole.FINANCE], pmA],
    ];
    for (const [roles, email] of casos) {
      const lista = await veDe(roles, email);
      expect(await contador(roles, email), roles.join("+")).toBe(lista.total);
    }
  });

  describe("resolver", () => {
    it("404 si la alerta existe pero el usuario no la ve (no revela existencia)", async () => {
      const ajena = alertas.get("BUDGET_WARNING:B")!;
      const pm = await app.inject({ method: "PATCH", url: `/api/alerts/${ajena}/resolve`, headers: comoRol(AppRole.PM, pmA) });
      expect(pm.statusCode).toBe(404);
      const fin = await app.inject({
        method: "PATCH",
        url: `/api/alerts/${alertas.get("ENDING:A")}/resolve`,
        headers: comoRol(AppRole.FINANCE),
      });
      expect(fin.statusCode).toBe(404);
      const inexistente = await app.inject({ method: "PATCH", url: "/api/alerts/no-existe/resolve", headers: comoRol(AppRole.ADMIN) });
      expect(inexistente.statusCode).toBe(404);
    });

    it("403 para quien ve la alerta pero su rol no resuelve (CONSULTANT, VIEWER)", async () => {
      const id = alertas.get("ENDING:A")!;
      const consultor = await app.inject({
        method: "PATCH",
        url: `/api/alerts/${id}/resolve`,
        headers: comoRol(AppRole.CONSULTANT, escenario.consultorA.email),
      });
      expect(consultor.statusCode).toBe(403);
      const viewer = await app.inject({ method: "PATCH", url: `/api/alerts/${id}/resolve`, headers: comoRol(AppRole.VIEWER) });
      expect(viewer.statusCode).toBe(403);
      expect((await prisma.alert.findUniqueOrThrow({ where: { id } })).resolvedAt).toBeNull();
    });

    it("resolver una alerta la resuelve para todos", async () => {
      const id = alertas.get("UNDERUTILIZED:A")!;
      const res = await app.inject({ method: "PATCH", url: `/api/alerts/${id}/resolve`, headers: comoRol(AppRole.COMMERCIAL, "com@synaptica.test") });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.resolvedBy).toBe("com@synaptica.test");
      const admin = await veDe([AppRole.ADMIN]);
      expect(admin.claves).not.toContain("UNDERUTILIZED:A");

      const otra = await app.inject({ method: "PATCH", url: `/api/alerts/${id}/resolve`, headers: comoRol(AppRole.ADMIN) });
      expect(otra.statusCode).toBe(409);
    });

    it("FINANCE resuelve FX y el PM resuelve las de su proyecto", async () => {
      const fx = await app.inject({ method: "PATCH", url: `/api/alerts/${alertas.get("FX")}/resolve`, headers: comoRol(AppRole.FINANCE) });
      expect(fx.statusCode).toBe(200);
      const pm = await app.inject({
        method: "PATCH",
        url: `/api/alerts/${alertas.get("BUDGET_EXCEEDED:A")}/resolve`,
        headers: comoRol(AppRole.PM, pmA),
      });
      expect(pm.statusCode).toBe(200);
    });
  });
});

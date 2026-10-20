import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/infra/prisma.js";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";
import { crearAsignacion, crearEscenarioBasico, limpiarEscenario, type EscenarioBasico } from "../helpers/datos.js";

/**
 * D8: capacity, asignaciones y horas planificadas son confidenciales. Las ven
 * ADMIN, PM, FINANCE y COMMERCIAL; no CONSULTANT ni VIEWER. Cierra los huecos que
 * dejó la revisión de seguridad: detalle de proyecto, rangos sin tope,
 * fechas de vínculo, motivo de los bloqueos y alertas de capacidad.
 */
describe("Confidencialidad de capacity (D8)", () => {
  let app: FastifyInstance;
  let escenario: EscenarioBasico;

  beforeAll(async () => {
    app = await crearAppDePrueba();
    escenario = await crearEscenarioBasico("cap-conf");
    await crearAsignacion({
      consultantId: escenario.consultorB.id,
      projectId: escenario.projectId,
      desde: new Date(Date.UTC(2026, 5, 1)),
      hasta: new Date(Date.UTC(2026, 5, 30)),
    });
    await prisma.consultant.update({
      where: { id: escenario.consultorB.id },
      data: { hireDate: new Date(Date.UTC(2020, 2, 15)), exitDate: new Date(Date.UTC(2031, 6, 1)) },
    });
    await prisma.consultantBlock.create({
      data: {
        consultantId: escenario.consultorB.id,
        startDate: new Date(Date.UTC(2026, 5, 10)),
        endDate: new Date(Date.UTC(2026, 5, 12)),
        blockType: "SICK_LEAVE",
        note: "cirugia-secreta",
      },
    });
    await prisma.alert.createMany({
      data: [
        {
          type: "ASSIGNMENT_ENDING",
          severity: "INFO",
          consultantId: escenario.consultorB.id,
          projectId: escenario.projectId,
          message: "termina pronto",
        },
        {
          type: "BUDGET_WARNING",
          severity: "WARNING",
          consultantId: escenario.consultorB.id,
          projectId: escenario.projectId,
          message: "presupuesto",
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.alert.deleteMany({ where: { projectId: escenario.projectId } });
    await prisma.consultantBlock.deleteMany({ where: { consultantId: escenario.consultorB.id } });
    await limpiarEscenario(escenario);
    await app.close();
  });

  describe("GET /api/projects/:id/detail", () => {
    it("VIEWER recibe assignments vacío y assignmentsHidden, sin rastro del consultor", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/projects/${escenario.projectId}/detail`,
        headers: comoRol(AppRole.VIEWER),
      });
      expect(res.statusCode).toBe(200);
      const data = res.json().data;
      expect(data.assignments).toEqual([]);
      expect(data.assignmentsHidden).toBe(true);
      expect(res.body).not.toContain(escenario.consultorB.id);
    });

    it("ADMIN, PM y FINANCE reciben las asignaciones", async () => {
      for (const rol of [AppRole.ADMIN, AppRole.PM, AppRole.FINANCE]) {
        const res = await app.inject({
          method: "GET",
          url: `/api/projects/${escenario.projectId}/detail`,
          headers: comoRol(rol),
        });
        expect(res.statusCode, rol).toBe(200);
        const data = res.json().data;
        expect(data.assignmentsHidden, rol).toBe(false);
        expect(data.assignments.map((a: { consultantId: string }) => a.consultantId), rol).toContain(
          escenario.consultorB.id,
        );
      }
    });
  });

  describe("Rangos de fechas de capacity (DoS)", () => {
    const admin = () => comoRol(AppRole.ADMIN);

    it("rechaza más de 24 meses, from > to y años fuera de 1900-3000 con 400 y mensaje claro", async () => {
      const malas = [
        "/api/capacity/overview?from=2020-01-01&to=2030-01-01",
        "/api/capacity/overview?from=2026-06-30&to=2026-06-01",
        "/api/capacity/overview?from=1500-01-01&to=1500-02-01",
        "/api/capacity/overview?from=2020-01-01", // el "to" por defecto es el mes en curso
        "/api/capacity/available?from=2000-01-01&to=2026-01-01",
        "/api/capacity/overloaded?from=2000-01-01&to=2026-01-01",
        "/api/capacity/bench?from=2000-01-01&to=2026-01-01",
        "/api/capacity/by-project?from=2000-01-01&to=2026-01-01",
        `/api/capacity/project/${escenario.projectId}?from=2000-01-01&to=2026-01-01`,
        `/api/capacity/consultant/${escenario.consultorA.id}?from=2000-01-01&to=2026-01-01`,
        `/api/capacity/consultant/${escenario.consultorA.id}?from=2026-06-30&to=2026-06-01`,
        "/api/capacity/releasing?within=100000",
      ];
      for (const url of malas) {
        const res = await app.inject({ method: "GET", url, headers: admin() });
        expect(res.statusCode, url).toBe(400);
        expect(res.json().message, url).toBeTruthy();
      }
    });

    it("el mensaje del tope menciona los 24 meses", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/capacity/overview?from=2020-01-01&to=2030-01-01",
        headers: admin(),
      });
      expect(res.json().message).toContain("24 meses");
    });

    it("acepta exactamente 24 meses", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/capacity/overview?from=2026-01-01&to=2027-12-31",
        headers: admin(),
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("GET /api/consultants: fechas de vínculo", () => {
    it("VIEWER no recibe hireDate ni exitDate; PM y FINANCE sí", async () => {
      const viewer = await app.inject({ method: "GET", url: "/api/consultants", headers: comoRol(AppRole.VIEWER) });
      const fila = (viewer.json().data as Array<Record<string, unknown>>).find((c) => c.id === escenario.consultorB.id);
      expect(fila).toBeDefined();
      expect(fila).not.toHaveProperty("hireDate");
      expect(fila).not.toHaveProperty("exitDate");
      expect(fila).toHaveProperty("city");

      for (const rol of [AppRole.PM, AppRole.FINANCE]) {
        const res = await app.inject({ method: "GET", url: "/api/consultants", headers: comoRol(rol) });
        const f = (res.json().data as Array<Record<string, unknown>>).find((c) => c.id === escenario.consultorB.id);
        expect(f?.hireDate, rol).toBe("2020-03-15");
        expect(f?.exitDate, rol).toBe("2031-07-01");
      }
    });
  });

  describe("Bloqueos: el motivo es solo para quien gestiona", () => {
    const urls = () => [
      `/api/consultants/${escenario.consultorB.id}/blocks`,
      `/api/capacity/consultant/${escenario.consultorB.id}`,
    ];
    const bloquesDe = (url: string, body: { data: unknown }) =>
      (url.includes("/blocks") ? body.data : (body.data as { blocks: unknown }).blocks) as Array<
        Record<string, unknown>
      >;

    it("COMMERCIAL ve las fechas pero blockType y note salen null con masked: true", async () => {
      for (const url of urls()) {
        const res = await app.inject({ method: "GET", url, headers: comoRol(AppRole.COMMERCIAL) });
        expect(res.statusCode, url).toBe(200);
        const [bloque] = bloquesDe(url, res.json());
        expect(bloque.blockType, url).toBeNull();
        expect(bloque.note, url).toBeNull();
        expect(bloque.masked, url).toBe(true);
        expect(bloque.startDate, url).toBeTruthy();
        expect(res.body, url).not.toContain("cirugia-secreta");
        expect(res.body, url).not.toContain("SICK_LEAVE");
      }
    });

    it("ADMIN los recibe completos y sin masked", async () => {
      for (const url of urls()) {
        const res = await app.inject({ method: "GET", url, headers: comoRol(AppRole.ADMIN) });
        const [bloque] = bloquesDe(url, res.json());
        expect(bloque.blockType, url).toBe("SICK_LEAVE");
        expect(bloque.note, url).toBe("cirugia-secreta");
        expect(bloque).not.toHaveProperty("masked");
      }
    });
  });

  describe("Alertas de capacidad", () => {
    const alertasDe = async (rol: AppRole) => {
      const res = await app.inject({
        method: "GET",
        url: `/api/alerts?consultantId=${escenario.consultorB.id}`,
        headers: comoRol(rol),
      });
      expect(res.statusCode, rol).toBe(200);
      return (res.json().data as Array<{ type: string }>).map((a) => a.type);
    };

    it("VIEWER no ve ASSIGNMENT_ENDING pero sí el resto", async () => {
      const tipos = await alertasDe(AppRole.VIEWER);
      expect(tipos).not.toContain("ASSIGNMENT_ENDING");
      expect(tipos).toContain("BUDGET_WARNING");
    });

    it("PM ve ambas", async () => {
      const tipos = await alertasDe(AppRole.PM);
      expect(tipos).toContain("ASSIGNMENT_ENDING");
      expect(tipos).toContain("BUDGET_WARNING");
    });

    it("unread-count del VIEWER excluye las alertas de capacidad", async () => {
      const contar = async (rol: AppRole) =>
        (await app.inject({ method: "GET", url: "/api/alerts/unread-count", headers: comoRol(rol) })).json().data
          .count as number;
      expect(await contar(AppRole.PM)).toBeGreaterThan(await contar(AppRole.VIEWER));
    });
  });
});

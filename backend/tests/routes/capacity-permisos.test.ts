import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/infra/prisma.js";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";
import { crearEscenarioBasico, limpiarEscenario, type EscenarioBasico } from "../helpers/datos.js";

/**
 * Permisos de capacity (CONTRATO §4) y parámetros (§3.3).
 *
 * - `capacity:read`: ADMIN, PM, FINANCE y COMMERCIAL. CONSULTANT y VIEWER, no.
 * - `capacity:config` y `assignments:write` (bloqueos): solo ADMIN.
 * - Parámetros: `under < over`, solo ADMIN escribe, cualquiera con `capacity:read` lee.
 */
describe("Capacity: permisos y parámetros", () => {
  let app: FastifyInstance;
  let escenario: EscenarioBasico;

  const LECTORES = [AppRole.ADMIN, AppRole.PM, AppRole.FINANCE, AppRole.COMMERCIAL];
  const SIN_ACCESO = [AppRole.CONSULTANT, AppRole.VIEWER];

  beforeAll(async () => {
    app = await crearAppDePrueba();
    escenario = await crearEscenarioBasico("cap-permisos");
  });

  afterAll(async () => {
    await prisma.consultantBlock.deleteMany({ where: { consultantId: escenario.consultorA.id } });
    await limpiarEscenario(escenario);
    await app.close();
  });

  it("overview: COMMERCIAL, FINANCE, PM y ADMIN leen (200); VIEWER y CONSULTANT reciben 403", async () => {
    for (const rol of LECTORES) {
      const res = await app.inject({ method: "GET", url: "/api/capacity/overview", headers: comoRol(rol) });
      expect(res.statusCode, `overview como ${rol}`).toBe(200);
    }
    for (const rol of SIN_ACCESO) {
      const res = await app.inject({ method: "GET", url: "/api/capacity/overview", headers: comoRol(rol) });
      expect(res.statusCode, `overview como ${rol}`).toBe(403);
    }
  });

  it("el resto de las lecturas de capacity usa el mismo permiso", async () => {
    const urls = [
      "/api/capacity/available",
      "/api/capacity/bench",
      "/api/capacity/releasing",
      "/api/capacity/overloaded",
      `/api/capacity/consultant/${escenario.consultorA.id}`,
      `/api/capacity/project/${escenario.projectId}`,
      "/api/capacity/by-project",
      `/api/consultants/${escenario.consultorA.id}/blocks`,
      "/api/capacity/settings",
    ];
    for (const url of urls) {
      const permitido = await app.inject({ method: "GET", url, headers: comoRol(AppRole.COMMERCIAL) });
      expect(permitido.statusCode, `GET ${url} como COMMERCIAL`).toBe(200);
      const denegado = await app.inject({ method: "GET", url, headers: comoRol(AppRole.VIEWER) });
      expect(denegado.statusCode, `GET ${url} como VIEWER`).toBe(403);
    }
  });

  it("bloqueos: solo ADMIN escribe (PM ya no)", async () => {
    const url = `/api/consultants/${escenario.consultorA.id}/blocks`;
    const payload = { startDate: "2026-06-01", endDate: "2026-06-05", blockType: "OTHER" };

    for (const rol of [AppRole.PM, AppRole.FINANCE, AppRole.COMMERCIAL, AppRole.VIEWER, AppRole.CONSULTANT]) {
      const res = await app.inject({ method: "POST", url, headers: comoRol(rol), payload });
      expect(res.statusCode, `POST bloqueo como ${rol}`).toBe(403);
    }

    const ok = await app.inject({ method: "POST", url, headers: comoRol(AppRole.ADMIN), payload });
    expect(ok.statusCode).toBe(201);

    const pmBorra = await app.inject({
      method: "DELETE",
      url: `${url}/${ok.json().data.id}`,
      headers: comoRol(AppRole.PM),
    });
    expect(pmBorra.statusCode).toBe(403);
  });

  describe("PUT /api/capacity/settings", () => {
    let original: { underThresholdPct: number; overThresholdPct: number; includeProbablesDefault: boolean };

    beforeAll(async () => {
      const res = await app.inject({ method: "GET", url: "/api/capacity/settings", headers: comoRol(AppRole.ADMIN) });
      original = res.json().data;
    });

    afterAll(async () => {
      await app.inject({
        method: "PUT",
        url: "/api/capacity/settings",
        headers: comoRol(AppRole.ADMIN),
        payload: {
          underThresholdPct: original.underThresholdPct,
          overThresholdPct: original.overThresholdPct,
          includeProbablesDefault: original.includeProbablesDefault,
        },
      });
    });

    it("el GET devuelve los valores por defecto (70 / 100 / false) si no se ha tocado nada", async () => {
      expect(original.underThresholdPct).toBeTypeOf("number");
      expect(original.overThresholdPct).toBeGreaterThan(original.underThresholdPct);
      expect(original.includeProbablesDefault).toBeTypeOf("boolean");
    });

    it("ADMIN guarda, lee de vuelta y deja rastro en la bitácora", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/capacity/settings",
        headers: comoRol(AppRole.ADMIN, "param.admin@synaptica.test"),
        payload: { underThresholdPct: 60, overThresholdPct: 110, includeProbablesDefault: true },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toMatchObject({
        underThresholdPct: 60,
        overThresholdPct: 110,
        includeProbablesDefault: true,
        updatedBy: "param.admin@synaptica.test",
      });

      const lectura = await app.inject({ method: "GET", url: "/api/capacity/settings", headers: comoRol(AppRole.COMMERCIAL) });
      expect(lectura.json().data).toMatchObject({ underThresholdPct: 60, overThresholdPct: 110, includeProbablesDefault: true });

      const registro = await prisma.auditLog.findFirst({
        where: { entity: "capacitySettings", entityId: "GENERAL" },
        orderBy: { createdAt: "desc" },
      });
      expect(registro?.changedBy).toBe("param.admin@synaptica.test");
    });

    it("rechaza under >= over, valores fuera de rango y tipos incorrectos (400)", async () => {
      const malos = [
        { underThresholdPct: 100, overThresholdPct: 100, includeProbablesDefault: false },
        { underThresholdPct: 120, overThresholdPct: 100, includeProbablesDefault: false },
        { underThresholdPct: -1, overThresholdPct: 100, includeProbablesDefault: false },
        { underThresholdPct: 70, overThresholdPct: 301, includeProbablesDefault: false },
        { underThresholdPct: 70, overThresholdPct: 100 },
        { underThresholdPct: 70, overThresholdPct: 100, includeProbablesDefault: "si" },
      ];
      for (const payload of malos) {
        const res = await app.inject({
          method: "PUT",
          url: "/api/capacity/settings",
          headers: comoRol(AppRole.ADMIN),
          payload,
        });
        expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      }
    });

    it("solo ADMIN escribe: PM, FINANCE, COMMERCIAL, VIEWER y CONSULTANT reciben 403", async () => {
      for (const rol of [AppRole.PM, AppRole.FINANCE, AppRole.COMMERCIAL, AppRole.VIEWER, AppRole.CONSULTANT]) {
        const res = await app.inject({
          method: "PUT",
          url: "/api/capacity/settings",
          headers: comoRol(rol),
          payload: { underThresholdPct: 10, overThresholdPct: 20, includeProbablesDefault: true },
        });
        expect(res.statusCode, rol).toBe(403);
      }
      const actual = await prisma.capacitySettings.findUnique({ where: { scope: "GENERAL" } });
      expect(Number(actual?.underThresholdPct)).not.toBe(10);
    });
  });
});

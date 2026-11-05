import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/infra/prisma.js";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";
import { crearEscenarioBasico, limpiarEscenario, type EscenarioBasico } from "../helpers/datos.js";

/**
 * "Ejecutado" = horas trabajadas (decisión 2026-11-05): las horas de categoría ABSENCE no entran a
 * costo ni a los totales de horas; se exponen aparte en `absenceHours`.
 */
describe("Ejecutado sin ausencias", () => {
  let app: FastifyInstance;
  let escenario: EscenarioBasico;

  beforeAll(async () => {
    app = await crearAppDePrueba();
    escenario = await crearEscenarioBasico("ejec");
    const regular = await prisma.timeEntryType.findFirstOrThrow({ where: { code: "REGULAR" } });
    const vacaciones = await prisma.timeEntryType.findFirstOrThrow({ where: { code: "VACACIONES" } });
    const base = {
      projectId: escenario.projectId,
      consultantId: escenario.consultorA.id,
      status: "APPROVED" as const,
    };
    await prisma.timeEntry.create({ data: { ...base, workDate: new Date("2026-08-10T00:00:00Z"), hours: 4, typeId: regular.id } });
    await prisma.timeEntry.create({ data: { ...base, workDate: new Date("2026-08-11T00:00:00Z"), hours: 8, typeId: vacaciones.id } });
  });

  afterAll(async () => {
    await prisma.timeEntry.deleteMany({ where: { projectId: escenario.projectId } });
    await limpiarEscenario(escenario);
    await app.close();
  });

  it("stats/overview: horas y costo solo cuentan lo trabajado; las ausencias van en absenceHours", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/stats/overview?projectId=${escenario.projectId}`,
      headers: comoRol(AppRole.ADMIN, "admin@synaptica.local"),
    });
    expect(res.statusCode, res.body).toBe(200);
    const fila = res.json().data.projects[0];
    expect(fila.totalHours).toBe(4);
    expect(fila.approvedHours).toBe(4);
    expect(fila.absenceHours).toBe(8);
    expect(fila.laborCostActual).toBeCloseTo(4 * 40, 2); // tarifa 40 USD del escenario
    expect(res.json().data.totals.absenceHours).toBe(8);
  });

  it("detalle del proyecto: approvedHours excluye ausencias y absenceHours las expone", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${escenario.projectId}/detail`,
      headers: comoRol(AppRole.ADMIN, "admin@synaptica.local"),
    });
    expect(res.statusCode, res.body).toBe(200);
    const fin = res.json().data.financials;
    expect(fin.approvedHours).toBe(4);
    expect(fin.absenceHours).toBe(8);
  });
});

import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/infra/prisma.js";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";
import { crearEscenarioBasico, limpiarEscenario, type EscenarioBasico } from "../helpers/datos.js";

/**
 * Borrado de horas (decisión 2026-11-05): cada quien borra solo las suyas; borrar las de otro
 * consultor exige ADMIN. El PM del proyecto no puede, ni por DELETE ni vaciando el día con PUT /day.
 */
describe("Borrado de horas ajenas: solo ADMIN", () => {
  let app: FastifyInstance;
  let escenario: EscenarioBasico;
  let regularId = "";
  const dia = "2026-08-12";
  const MENSAJE = "Solo un administrador puede eliminar horas de otro consultor.";

  const dueno = () => comoRol(AppRole.CONSULTANT, escenario.consultorA.email);
  const otro = () => comoRol(AppRole.CONSULTANT, escenario.consultorB.email);
  const admin = () => comoRol(AppRole.ADMIN, "admin@synaptica.local");
  const pm = () => comoRol(AppRole.PM, `pm.${escenario.prefijo}@synaptica.test`);

  const crearHora = () =>
    prisma.timeEntry.create({
      data: {
        projectId: escenario.projectId,
        consultantId: escenario.consultorA.id,
        workDate: new Date(`${dia}T00:00:00.000Z`),
        hours: 2,
        typeId: regularId,
      },
    });
  const borrar = (id: string, headers: Record<string, string>) =>
    app.inject({ method: "DELETE", url: `/api/time-entries/${id}`, headers });

  beforeAll(async () => {
    app = await crearAppDePrueba();
    escenario = await crearEscenarioBasico("borrado");
    regularId = (await prisma.timeEntryType.findFirstOrThrow({ where: { code: "REGULAR" } })).id;
  });

  afterAll(async () => {
    await prisma.timeEntry.deleteMany({ where: { consultantId: escenario.consultorA.id } });
    await limpiarEscenario(escenario);
    await app.close();
  });

  it("el PM del proyecto no borra horas de otro consultor (403) y la hora sigue ahí", async () => {
    const hora = await crearHora();
    const res = await borrar(hora.id, pm());
    expect(res.statusCode, res.body).toBe(403);
    expect(res.json().message).toContain(MENSAJE);
    expect(await prisma.timeEntry.count({ where: { id: hora.id } })).toBe(1);
  });

  it("otro consultor tampoco borra horas ajenas (403)", async () => {
    const hora = await crearHora();
    expect((await borrar(hora.id, otro())).statusCode).toBe(403);
    expect(await prisma.timeEntry.count({ where: { id: hora.id } })).toBe(1);
  });

  it("ADMIN sí borra horas de otro consultor (204)", async () => {
    const hora = await crearHora();
    expect((await borrar(hora.id, admin())).statusCode).toBe(204);
    expect(await prisma.timeEntry.count({ where: { id: hora.id } })).toBe(0);
  });

  it("el consultor borra lo suyo (204)", async () => {
    const hora = await crearHora();
    expect((await borrar(hora.id, dueno())).statusCode).toBe(204);
    expect(await prisma.timeEntry.count({ where: { id: hora.id } })).toBe(0);
  });

  it("PUT /day: el PM no puede vaciar el día de otro consultor (403); ADMIN y el dueño sí", async () => {
    const putVacio = (headers: Record<string, string>) =>
      app.inject({
        method: "PUT",
        url: "/api/time-entries/day",
        headers,
        payload: { projectId: escenario.projectId, consultantId: escenario.consultorA.id, workDate: dia, entries: [] },
      });
    const hora = await crearHora();
    const res = await putVacio(pm());
    expect(res.statusCode, res.body).toBe(403);
    expect(res.json().message).toContain(MENSAJE);
    expect(await prisma.timeEntry.count({ where: { id: hora.id } })).toBe(1);

    expect((await putVacio(admin())).statusCode).toBe(200);
    expect(await prisma.timeEntry.count({ where: { id: hora.id } })).toBe(0);

    await crearHora();
    expect((await putVacio(dueno())).statusCode).toBe(200);
    expect(await prisma.timeEntry.count({ where: { consultantId: escenario.consultorA.id } })).toBe(0);
  });

  it("PUT /day: el PM sí edita lo REGULAR de otro si conserva todas sus filas", async () => {
    const hora = await crearHora();
    const res = await app.inject({
      method: "PUT",
      url: "/api/time-entries/day",
      headers: pm(),
      payload: {
        projectId: escenario.projectId,
        consultantId: escenario.consultorA.id,
        workDate: dia,
        entries: [{ id: hora.id, typeId: regularId, hours: 3 }],
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    await prisma.timeEntry.deleteMany({ where: { consultantId: escenario.consultorA.id } });
  });
});

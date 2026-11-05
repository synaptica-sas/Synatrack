import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/infra/prisma.js";
import { comoRol } from "../helpers/app.js";
import { crearAppDePrueba } from "../helpers/app.js";
import {
  crearEscenarioBasico,
  crearHoraExtra,
  limpiarEscenario,
  type EscenarioBasico,
} from "../helpers/datos.js";

/**
 * Los montos de horas extra (y lo real/excedente) solo los ven ADMIN, FINANCE y el
 * PM del proyecto de la fila. El consultor dueño de la solicitud recibe solo horas.
 */
const CAMPOS_OCULTOS = [
  "diurnalAmount",
  "nocturnalAmount",
  "diurnalHolidayAmount",
  "nocturnalHolidayAmount",
  "totalAmount",
  "hourlyRate",
  "divisorUsed",
  "realHours",
  "excessHours",
  "excessPendingHours",
];

describe("Montos de horas extra: solo ADMIN, FINANCE y PM del proyecto", () => {
  let app: FastifyInstance;
  let escenario: EscenarioBasico;
  let pmEmail: string;
  const fechaFutura = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  beforeAll(async () => {
    app = await crearAppDePrueba();
    escenario = await crearEscenarioBasico("eh-montos");
    pmEmail = `pm.${escenario.prefijo}@synaptica.test`;
    await crearHoraExtra({
      consultantId: escenario.consultorA.id,
      projectId: escenario.projectId,
      fecha: new Date(Date.UTC(2026, 6, 1)),
    });
    await prisma.project.update({ where: { id: escenario.projectId }, data: { allowExtraHours: true } });
  });

  afterAll(async () => {
    await limpiarEscenario(escenario);
    await app.close();
  });

  const filaDe = (res: { json: () => { data: Array<Record<string, unknown>> } }) =>
    res.json().data.find((f) => f.consultantId === escenario.consultorA.id)!;

  it("GET: el CONSULTANT dueño ve horas y buckets, pero ningún monto, tarifa ni real/excedente", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/extra-hours",
      headers: comoRol(AppRole.CONSULTANT, escenario.consultorA.email),
    });
    expect(res.statusCode).toBe(200);
    const fila = filaDe(res as never);
    for (const campo of ["totalHours", "diurnal", "nocturnal", "diurnalHoliday", "nocturnalHoliday", "status"]) {
      expect(fila, campo).toHaveProperty(campo);
    }
    for (const campo of CAMPOS_OCULTOS) expect(fila, campo).not.toHaveProperty(campo);
    expect(fila.consultant as object).not.toHaveProperty("hourlyRate");
    expect(fila.consultant as object).not.toHaveProperty("costPerMonth");
    // El proyecto viaja con proyección mínima: nombre y PM sí, presupuesto no.
    const proyecto = fila.project as Record<string, unknown>;
    expect(proyecto).toHaveProperty("name");
    expect(proyecto).toHaveProperty("projectManagerEmail");
    expect(proyecto).not.toHaveProperty("budget");
    expect(res.body).not.toContain("\"budget\"");
  });

  it("GET: ADMIN sigue recibiendo el proyecto completo", async () => {
    const res = await app.inject({ method: "GET", url: "/api/extra-hours", headers: comoRol(AppRole.ADMIN) });
    const fila = filaDe(res as never);
    expect(fila.project as object).toHaveProperty("budget");
  });

  it("GET: ADMIN, FINANCE y el PM del proyecto ven montos y real/excedente", async () => {
    const quienes: Array<[AppRole, string | undefined]> = [
      [AppRole.ADMIN, undefined],
      [AppRole.FINANCE, undefined],
      [AppRole.PM, pmEmail],
      [AppRole.CONSULTANT, pmEmail], // PM del proyecto con cuenta de rol CONSULTANT
    ];
    for (const [rol, email] of quienes) {
      const res = await app.inject({ method: "GET", url: "/api/extra-hours", headers: comoRol(rol, email) });
      expect(res.statusCode, rol).toBe(200);
      const fila = filaDe(res as never);
      expect(Number(fila.totalAmount), rol).toBe(100);
      expect(fila, rol).toHaveProperty("realHours");
      expect(fila, rol).toHaveProperty("excessHours");
      expect(fila, rol).toHaveProperty("excessPendingHours");
    }
  });

  it("GET: un PM de otro proyecto no ve montos de esta fila", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/extra-hours",
      headers: comoRol(AppRole.PM, "otro.pm@synaptica.test"),
    });
    expect(res.statusCode).toBe(200);
    // Su alcance no incluye la fila; si la incluyera, vendría sin montos.
    const fila = (res.json().data as Array<Record<string, unknown>>).find(
      (f) => f.consultantId === escenario.consultorA.id,
    );
    if (fila) expect(fila).not.toHaveProperty("totalAmount");
  });

  it("POST: la respuesta de creación al CONSULTANT no trae montos ni tarifa; ADMIN los ve al listar", async () => {
    const payload = (fecha: string) => ({
      projectId: escenario.projectId,
      consultantId: escenario.consultorA.id,
      date: fecha,
      startTime: "19:00",
      endTime: "21:00",
    });
    const propia = await app.inject({
      method: "POST",
      url: "/api/extra-hours",
      headers: comoRol(AppRole.CONSULTANT, escenario.consultorA.email),
      payload: payload(fechaFutura),
    });
    expect(propia.statusCode).toBe(201);
    const dataC = propia.json().data as Record<string, unknown>;
    expect(dataC).toHaveProperty("totalHours");
    for (const campo of CAMPOS_OCULTOS) expect(dataC, campo).not.toHaveProperty(campo);
    expect(dataC.consultant as object).not.toHaveProperty("hourlyRate");
    expect(dataC.project as object).not.toHaveProperty("budget");
    expect(propia.json()).toHaveProperty("warnings");

    // ADMIN ya no puede solicitar por otro; ve los montos al listar.
    const admin = await app.inject({ method: "GET", url: "/api/extra-hours?pageSize=100", headers: comoRol(AppRole.ADMIN) });
    const fila = (admin.json().data as Array<Record<string, unknown>>).find((f) => f.id === (propia.json().data as { id: string }).id);
    expect(fila).toHaveProperty("totalAmount");
  });

  it("calculate: el CONSULTANT no recibe montos ni tarifa, aunque mande projectId", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/extra-hours/calculate",
      headers: comoRol(AppRole.CONSULTANT, escenario.consultorA.email),
      payload: {
        consultantId: escenario.consultorA.id,
        projectId: escenario.projectId,
        date: "2026-05-04",
        startTime: "19:00",
        endTime: "21:00",
      },
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data as Record<string, unknown>;
    expect(data).toHaveProperty("totalHours");
    expect(data).toHaveProperty("warnings");
    for (const campo of CAMPOS_OCULTOS) expect(data, campo).not.toHaveProperty(campo);
  });

  it("calculate: ADMIN, FINANCE y el PM del proyecto sí reciben los montos", async () => {
    const cuerpo = {
      consultantId: escenario.consultorA.id,
      projectId: escenario.projectId,
      date: "2026-05-04",
      startTime: "19:00",
      endTime: "21:00",
    };
    for (const [rol, email] of [
      [AppRole.ADMIN, undefined],
      [AppRole.PM, pmEmail],
    ] as Array<[AppRole, string | undefined]>) {
      const res = await app.inject({
        method: "POST",
        url: "/api/extra-hours/calculate",
        headers: comoRol(rol, email),
        payload: cuerpo,
      });
      expect(res.statusCode, rol).toBe(200);
      expect(res.json().data, rol).toHaveProperty("totalAmount");
      expect(res.json().data, rol).toHaveProperty("hourlyRate");
    }
  });
});

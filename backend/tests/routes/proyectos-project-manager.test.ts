import { AppRole, ExtraHourStatus } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/infra/prisma.js";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";
import {
  crearEscenarioBasico,
  crearHoraExtra,
  limpiarEscenario,
  type EscenarioBasico,
} from "../helpers/datos.js";

/**
 * DEP-37: el Project Manager se puede asignar desde la API.
 *
 * Antes de este cambio `projectManagerEmail` se leía en nueve sitios del backend
 * y no se escribía en ninguno: la columna solo podía tener valor si alguien la
 * tocaba a mano en la base. La consecuencia medible está en el último bloque de
 * este archivo: la aprobación de nivel 1 de horas extra por el PM **no podía
 * ocurrir nunca**.
 */
describe("Asignación del Project Manager en proyectos", () => {
  let app: FastifyInstance;
  const proyectosCreados: string[] = [];

  const cuerpoBase = {
    name: "Proyecto PM",
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

  async function crearProyecto(extra: Record<string, unknown>) {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: comoRol(AppRole.ADMIN),
      payload: { ...cuerpoBase, ...extra },
    });
    if (res.statusCode === 201) {
      proyectosCreados.push(res.json().data.id as string);
    }
    return res;
  }

  it("guarda el PM al crear el proyecto y lo normaliza a minúsculas", async () => {
    const res = await crearProyecto({ projectManagerEmail: "  Ana.PEREZ@Synaptica.test " });

    expect(res.statusCode).toBe(201);
    expect(res.json().data.projectManagerEmail).toBe("ana.perez@synaptica.test");

    // Y queda así en la base, que es lo que leen las comparaciones del backend.
    const enBase = await prisma.project.findUnique({ where: { id: res.json().data.id } });
    expect(enBase?.projectManagerEmail).toBe("ana.perez@synaptica.test");
  });

  it("un proyecto sin PM sigue siendo válido", async () => {
    const res = await crearProyecto({});

    expect(res.statusCode).toBe(201);
    expect(res.json().data.projectManagerEmail).toBeNull();
  });

  it("el campo vacío del formulario se guarda como null, no como cadena vacía", async () => {
    const res = await crearProyecto({ projectManagerEmail: "" });

    expect(res.statusCode).toBe(201);
    expect(res.json().data.projectManagerEmail).toBeNull();
  });

  it("un correo inválido lo rechaza Zod con 400", async () => {
    const res = await crearProyecto({ projectManagerEmail: "no-es-un-correo" });

    expect(res.statusCode).toBe(400);
  });

  it("se puede cambiar y desasignar el PM con PUT", async () => {
    const creado = await crearProyecto({ projectManagerEmail: "primero@synaptica.test" });
    const id = creado.json().data.id as string;

    const cambio = await app.inject({
      method: "PUT",
      url: `/api/projects/${id}`,
      headers: comoRol(AppRole.ADMIN),
      payload: { ...cuerpoBase, projectManagerEmail: "Segundo@Synaptica.test" },
    });
    expect(cambio.statusCode).toBe(200);
    expect(cambio.json().data.projectManagerEmail).toBe("segundo@synaptica.test");

    const desasigna = await app.inject({
      method: "PUT",
      url: `/api/projects/${id}`,
      headers: comoRol(AppRole.ADMIN),
      payload: { ...cuerpoBase, projectManagerEmail: "" },
    });
    expect(desasigna.statusCode).toBe(200);
    expect(desasigna.json().data.projectManagerEmail).toBeNull();
  });

  it("un PM también puede asignar el PM de un proyecto (su authorize no cambió)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: comoRol(AppRole.PM, "jefe@synaptica.test"),
      payload: { ...cuerpoBase, projectManagerEmail: "jefe@synaptica.test" },
    });

    expect(res.statusCode).toBe(201);
    proyectosCreados.push(res.json().data.id as string);
    expect(res.json().data.projectManagerEmail).toBe("jefe@synaptica.test");
  });
});

/**
 * La prueba que justifica DEP-37: con el PM asignado, la aprobación de nivel 1
 * de horas extra por fin funciona.
 */
describe("Un PM asignado puede aprobar horas extra de nivel 1", () => {
  let app: FastifyInstance;
  let escenario: EscenarioBasico;
  const PM_EMAIL = "pm.aprobador@synaptica.test";

  beforeAll(async () => {
    app = await crearAppDePrueba();
    escenario = await crearEscenarioBasico("pm-aprueba");
  });

  afterAll(async () => {
    await limpiarEscenario(escenario);
    await app.close();
  });

  it("sin PM asignado, el mismo usuario recibe 403 (el estado anterior a DEP-37)", async () => {
    await prisma.project.update({
      where: { id: escenario.projectId },
      data: { projectManagerEmail: null },
    });

    const entrada = await crearHoraExtra({
      consultantId: escenario.consultorA.id,
      projectId: escenario.projectId,
      fecha: new Date(Date.UTC(2026, 4, 4)),
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/extra-hours/${entrada.id}/approve`,
      headers: comoRol(AppRole.PM, PM_EMAIL),
    });

    expect(res.statusCode).toBe(403);

    const enBase = await prisma.extraHourEntry.findUnique({ where: { id: entrada.id } });
    expect(enBase?.status).toBe(ExtraHourStatus.PENDING_PM);
  });

  it("con el PM asignado por la API, la aprobación de nivel 1 pasa a PENDING_FINANCE", async () => {
    // Se asigna por la ruta, no escribiendo en la base: es justo lo que DEP-37
    // hacía imposible.
    const asignacion = await app.inject({
      method: "PUT",
      url: `/api/projects/${escenario.projectId}`,
      headers: comoRol(AppRole.ADMIN),
      payload: {
        name: `Proyecto ${escenario.prefijo}`,
        company: "Synaptica",
        country: "Colombia",
        currency: "USD",
        budget: 10000,
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        projectManagerEmail: PM_EMAIL.toUpperCase(),
      },
    });
    expect(asignacion.statusCode).toBe(200);
    expect(asignacion.json().data.projectManagerEmail).toBe(PM_EMAIL);

    const entrada = await crearHoraExtra({
      consultantId: escenario.consultorA.id,
      projectId: escenario.projectId,
      fecha: new Date(Date.UTC(2026, 4, 5)),
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/extra-hours/${entrada.id}/approve`,
      headers: comoRol(AppRole.PM, PM_EMAIL),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe(ExtraHourStatus.PENDING_FINANCE);

    const enBase = await prisma.extraHourEntry.findUnique({ where: { id: entrada.id } });
    expect(enBase?.status).toBe(ExtraHourStatus.PENDING_FINANCE);
  });

  it("un PM de otro proyecto sigue sin poder aprobar", async () => {
    const entrada = await crearHoraExtra({
      consultantId: escenario.consultorA.id,
      projectId: escenario.projectId,
      fecha: new Date(Date.UTC(2026, 4, 6)),
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/extra-hours/${entrada.id}/approve`,
      headers: comoRol(AppRole.PM, "otro.pm@synaptica.test"),
    });

    expect(res.statusCode).toBe(403);
  });
});

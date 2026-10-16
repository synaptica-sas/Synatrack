import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/infra/prisma.js";
import { runMaintenanceCycle } from "../../src/modules/jobs/jobs.service.js";
import { addDaysIso, fromIsoDate, toIsoDate } from "../../src/utils/isoDate.js";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";
import { crearEscenarioBasico, crearHoraExtra, limpiarEscenario, type EscenarioBasico } from "../helpers/datos.js";

/**
 * Trazabilidad automática: `createdBy` / `updatedBy` se llenan solos (extensión
 * de Prisma + contexto de actor) con el correo del token, sin que el handler los
 * escriba. Se comprueba contra la base real, vía HTTP.
 */
describe("createdBy / updatedBy automáticos", () => {
  let app: FastifyInstance;
  let escenario: EscenarioBasico;
  const proyectos: string[] = [];
  const asignaciones: string[] = [];

  const ana = "ana.traza@synaptica.test";
  const beto = "beto.traza@synaptica.test";

  beforeAll(async () => {
    app = await crearAppDePrueba();
    escenario = await crearEscenarioBasico("traza");
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { changedBy: { in: [ana, beto] } } });
    await prisma.assignment.deleteMany({ where: { id: { in: asignaciones } } });
    await prisma.runningTimer.deleteMany({ where: { consultantId: escenario.consultorA.id } });
    await prisma.project.deleteMany({ where: { id: { in: proyectos } } });
    await limpiarEscenario(escenario);
    await app.close();
  });

  it("project: crear con Ana y editar con Beto cambia updatedBy y conserva createdBy", async () => {
    const cuerpo = {
      name: "Proyecto traza",
      company: "Synaptica",
      country: "Colombia",
      currency: "USD",
      budget: 1000,
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    };
    const creado = await app.inject({ method: "POST", url: "/api/projects", headers: comoRol(AppRole.ADMIN, ana), payload: cuerpo });
    expect(creado.statusCode, creado.body).toBe(201);
    const id = creado.json().data.id as string;
    proyectos.push(id);

    let fila = await prisma.project.findUniqueOrThrow({ where: { id } });
    expect(fila.createdBy).toBe(ana);
    expect(fila.updatedBy).toBe(ana);

    const editado = await app.inject({
      method: "PUT",
      url: `/api/projects/${id}`,
      headers: comoRol(AppRole.ADMIN, beto),
      payload: { ...cuerpo, name: "Proyecto traza v2" },
    });
    expect(editado.statusCode, editado.body).toBe(200);

    fila = await prisma.project.findUniqueOrThrow({ where: { id } });
    expect(fila.createdBy).toBe(ana);
    expect(fila.updatedBy).toBe(beto);
  });

  it("timeEntry: crear (Ana) y editar (Beto)", async () => {
    const creada = await app.inject({
      method: "POST",
      url: "/api/time-entries",
      headers: comoRol(AppRole.ADMIN, ana),
      payload: { projectId: escenario.projectId, consultantId: escenario.consultorA.id, workDate: "2026-05-12", hours: 3 },
    });
    expect(creada.statusCode, creada.body).toBe(201);
    const id = creada.json().data.id as string;

    let fila = await prisma.timeEntry.findUniqueOrThrow({ where: { id } });
    expect([fila.createdBy, fila.updatedBy]).toEqual([ana, ana]);

    const editada = await app.inject({
      method: "PATCH",
      url: `/api/time-entries/${id}`,
      headers: comoRol(AppRole.ADMIN, beto),
      payload: { hours: 5 },
    });
    expect(editada.statusCode, editada.body).toBe(200);

    fila = await prisma.timeEntry.findUniqueOrThrow({ where: { id } });
    expect([fila.createdBy, fila.updatedBy]).toEqual([ana, beto]);
  });

  it("extraHourEntry: crear (Ana) y aprobar (PM del proyecto); lo escrito sin petición no se toca", async () => {
    const creada = await app.inject({
      method: "POST",
      url: "/api/extra-hours",
      headers: comoRol(AppRole.ADMIN, ana),
      payload: {
        projectId: escenario.projectId,
        consultantId: escenario.consultorA.id,
        date: "2026-05-04",
        startTime: "19:00",
        endTime: "21:00",
      },
    });
    expect(creada.statusCode, creada.body).toBe(201);
    const id = creada.json().data.id as string;
    const fila0 = await prisma.extraHourEntry.findUniqueOrThrow({ where: { id } });
    expect([fila0.createdBy, fila0.updatedBy]).toEqual([ana, ana]);

    const manual = await crearHoraExtra({
      consultantId: escenario.consultorA.id,
      projectId: escenario.projectId,
      fecha: new Date(Date.UTC(2026, 4, 6)),
    });
    // Escrito directo con prisma, fuera de una petición: sin actor no se toca nada.
    expect(manual.createdBy).toBeNull();

    const pm = `pm.${escenario.prefijo}@synaptica.test`;
    const aprobada = await app.inject({
      method: "PATCH",
      url: `/api/extra-hours/${manual.id}/approve`,
      headers: comoRol(AppRole.PM, pm),
    });
    expect(aprobada.statusCode, aprobada.body).toBe(200);
    const fila = await prisma.extraHourEntry.findUniqueOrThrow({ where: { id: manual.id } });
    expect(fila.createdBy).toBeNull();
    expect(fila.updatedBy).toBe(pm);
  });

  it("assignment: crear (Ana) y editar (Beto)", async () => {
    const cuerpo = {
      projectId: escenario.projectId,
      consultantId: escenario.consultorA.id,
      startDate: "2031-03-03",
      endDate: "2031-03-28",
      allocationMode: "HOURS",
      hoursPerPeriod: 20,
      periodUnit: "week",
    };
    const creada = await app.inject({ method: "POST", url: "/api/assignments", headers: comoRol(AppRole.ADMIN, ana), payload: cuerpo });
    expect(creada.statusCode, creada.body).toBe(201);
    const id = creada.json().data.id as string;
    asignaciones.push(id);

    const editada = await app.inject({
      method: "PUT",
      url: `/api/assignments/${id}`,
      headers: comoRol(AppRole.ADMIN, beto),
      payload: { ...cuerpo, hoursPerPeriod: 30 },
    });
    expect(editada.statusCode, editada.body).toBe(200);

    const fila = await prisma.assignment.findUniqueOrThrow({ where: { id } });
    expect([fila.createdBy, fila.updatedBy]).toEqual([ana, beto]);
  });

  it("una escritura dentro de $transaction interactiva (cronómetro) también se estampa", async () => {
    const headers = comoRol(AppRole.CONSULTANT, escenario.consultorA.email);
    await app.inject({ method: "POST", url: "/api/timer/start", headers, payload: { projectId: escenario.projectId } });
    const fin = await app.inject({ method: "POST", url: "/api/timer/stop", headers, payload: {} });
    expect(fin.statusCode, fin.body).toBe(201);
    const fila = await prisma.timeEntry.findUniqueOrThrow({ where: { id: fin.json().data.id } });
    expect([fila.createdBy, fila.updatedBy]).toEqual([escenario.consultorA.email, escenario.consultorA.email]);
  });

  it("peticiones concurrentes con usuarios distintos no se cruzan", async () => {
    const correos = Array.from({ length: 12 }, (_, i) => `concurrente${i}.traza@synaptica.test`);
    const respuestas = await Promise.all(
      correos.map((email, i) =>
        app.inject({
          method: "POST",
          url: "/api/projects",
          headers: comoRol(AppRole.ADMIN, email),
          payload: {
            name: `Concurrente ${i}`,
            company: "Synaptica",
            country: "Colombia",
            currency: "USD",
            budget: 10,
            startDate: "2026-01-01",
            endDate: "2026-12-31",
          },
        }),
      ),
    );
    respuestas.forEach((r) => expect(r.statusCode, r.body).toBe(201));
    const ids = respuestas.map((r) => r.json().data.id as string);
    proyectos.push(...ids);

    const filas = await prisma.project.findMany({ where: { id: { in: ids } } });
    expect(filas).toHaveLength(12);
    respuestas.forEach((r, i) => {
      const fila = filas.find((f) => f.id === r.json().data.id)!;
      expect([fila.createdBy, fila.updatedBy]).toEqual([correos[i], correos[i]]);
    });
  });

  it("un job periódico deja sistema:<job>; disparado por un usuario deja su correo", async () => {
    const hoy = toIsoDate(new Date());
    const crearPlanificada = () =>
      prisma.assignment.create({
        data: {
          projectId: escenario.projectId,
          consultantId: escenario.consultorA.id,
          startDate: fromIsoDate(addDaysIso(hoy, -1)),
          endDate: fromIsoDate(addDaysIso(hoy, 30)),
          allocationMode: "HOURS",
          hoursPerPeriod: 10,
          periodUnit: "week",
          status: "PLANNED",
        },
      });

    const porJob = await crearPlanificada();
    asignaciones.push(porJob.id);
    const ciclo = await runMaintenanceCycle(prisma, "intervalo");
    expect(ciclo.omitido).toBe(false);
    let fila = await prisma.assignment.findUniqueOrThrow({ where: { id: porJob.id } });
    expect(fila.status).toBe("ACTIVE");
    expect(fila.updatedBy).toBe("sistema:assignment-maintenance");
    expect(fila.createdBy).toBeNull();

    const porUsuario = await crearPlanificada();
    asignaciones.push(porUsuario.id);
    const res = await app.inject({ method: "POST", url: "/api/jobs/run", headers: comoRol(AppRole.ADMIN, beto) });
    expect(res.statusCode, res.body).toBe(200);
    fila = await prisma.assignment.findUniqueOrThrow({ where: { id: porUsuario.id } });
    expect(fila.status).toBe("ACTIVE");
    expect(fila.updatedBy).toBe(beto);
  });
});

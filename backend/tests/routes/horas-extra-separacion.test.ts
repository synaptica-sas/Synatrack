import { AppRole, ExtraHourStatus } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/infra/prisma.js";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";
import { crearEscenarioBasico, crearHoraExtra, limpiarEscenario, type EscenarioBasico } from "../helpers/datos.js";

/**
 * Separación de funciones en horas extra: la solicitud y el registro del EXTRA real los hace SOLO
 * el consultor dueño. ADMIN/PM siguen pudiendo imputar horas REGULAR a otro consultor.
 */
describe("Horas extra: solo las solicita y registra el propio consultor", () => {
  let app: FastifyInstance;
  let escenario: EscenarioBasico;
  let regularId = "";
  let extraId = "";
  const dia = "2026-08-11";
  const MENSAJE_REGISTRO = "Las horas extra solo las puede registrar el propio consultor.";

  const dueno = () => comoRol(AppRole.CONSULTANT, escenario.consultorA.email);
  const admin = () => comoRol(AppRole.ADMIN, "admin@synaptica.local");
  const pm = () => comoRol(AppRole.PM, `pm.${escenario.prefijo}@synaptica.test`);

  const regular = (hours: number) => ({ typeId: regularId, hours });
  const extra = (hours: number) => ({
    typeId: extraId,
    hours,
    startedAt: `${dia}T19:00:00.000Z`,
    endedAt: `${dia}T${String(19 + hours).padStart(2, "0")}:00:00.000Z`,
  });
  const putDia = (headers: Record<string, string>, entries: unknown[]) =>
    app.inject({
      method: "PUT",
      url: "/api/time-entries/day",
      headers,
      payload: { projectId: escenario.projectId, consultantId: escenario.consultorA.id, workDate: dia, entries },
    });

  async function limpiarHoras() {
    await prisma.timeEntry.deleteMany({ where: { consultantId: escenario.consultorA.id } });
  }

  beforeAll(async () => {
    app = await crearAppDePrueba();
    escenario = await crearEscenarioBasico("eh-sep");
    regularId = (await prisma.timeEntryType.findFirstOrThrow({ where: { code: "REGULAR" } })).id;
    extraId = (await prisma.timeEntryType.findFirstOrThrow({ where: { code: "EXTRA" } })).id;
    const solicitud = await crearHoraExtra({
      consultantId: escenario.consultorA.id,
      projectId: escenario.projectId,
      fecha: new Date(Date.UTC(2026, 7, 11)),
    });
    await prisma.extraHourEntry.update({
      where: { id: solicitud.id },
      data: { status: ExtraHourStatus.APPROVED, totalHours: 3 },
    });
  });

  afterAll(async () => {
    await limpiarEscenario(escenario);
    await app.close();
  });

  it("PUT /day: ADMIN y PM no pueden crear EXTRA a nombre de otro (403); el consultor dueño sí", async () => {
    await limpiarHoras();
    for (const headers of [admin(), pm()]) {
      const res = await putDia(headers, [extra(1)]);
      expect(res.statusCode, res.body).toBe(403);
      expect(res.json().message).toBe(MENSAJE_REGISTRO);
    }
    expect(await prisma.timeEntry.count({ where: { consultantId: escenario.consultorA.id } })).toBe(0);

    const propio = await putDia(dueno(), [extra(1)]);
    expect(propio.statusCode, propio.body).toBe(200);
  });

  it("POST /: ADMIN y PM no pueden crear EXTRA por otro (403); el consultor sí", async () => {
    await limpiarHoras();
    for (const headers of [admin(), pm()]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/time-entries",
        headers,
        payload: { projectId: escenario.projectId, consultantId: escenario.consultorA.id, workDate: dia, ...extra(1) },
      });
      expect(res.statusCode, res.body).toBe(403);
      expect(res.json().message).toBe(MENSAJE_REGISTRO);
    }
    const propio = await app.inject({
      method: "POST",
      url: "/api/time-entries",
      headers: dueno(),
      payload: { projectId: escenario.projectId, workDate: dia, ...extra(1) },
    });
    expect(propio.statusCode, propio.body).toBe(201);
  });

  it("PATCH /:id: ADMIN y PM no pueden modificar un EXTRA ajeno ni convertir una fila en EXTRA", async () => {
    await limpiarHoras();
    const creada = await app.inject({
      method: "POST",
      url: "/api/time-entries",
      headers: dueno(),
      payload: { projectId: escenario.projectId, workDate: dia, ...extra(1) },
    });
    expect(creada.statusCode, creada.body).toBe(201);
    const idExtra = creada.json().data.id as string;
    const reg = await app.inject({
      method: "POST",
      url: "/api/time-entries",
      headers: dueno(),
      payload: { projectId: escenario.projectId, workDate: dia, typeId: regularId, hours: 2 },
    });
    expect(reg.statusCode, reg.body).toBe(201);
    const idRegular = reg.json().data.id as string;

    for (const headers of [admin(), pm()]) {
      const editaExtra = await app.inject({ method: "PATCH", url: `/api/time-entries/${idExtra}`, headers, payload: { description: "x" } });
      expect(editaExtra.statusCode, editaExtra.body).toBe(403);
      expect(editaExtra.json().message).toBe(MENSAJE_REGISTRO);

      const aExtra = await app.inject({ method: "PATCH", url: `/api/time-entries/${idRegular}`, headers, payload: { typeId: extraId } });
      expect(aExtra.statusCode, aExtra.body).toBe(403);
    }

    // El PM del proyecto sí sigue pudiendo editar la fila REGULAR de otro.
    const editaRegular = await app.inject({ method: "PATCH", url: `/api/time-entries/${idRegular}`, headers: pm(), payload: { hours: 3 } });
    expect(editaRegular.statusCode, editaRegular.body).toBe(200);
    // El consultor dueño sí edita su EXTRA.
    const propio = await app.inject({ method: "PATCH", url: `/api/time-entries/${idExtra}`, headers: dueno(), payload: { description: "mío" } });
    expect(propio.statusCode, propio.body).toBe(200);
  });

  it("PUT /day de PM/ADMIN sobre otro consultor: REGULAR sigue funcionando, aun con un EXTRA suyo en el día", async () => {
    await limpiarHoras();
    const base = await putDia(dueno(), [regular(2), extra(1)]);
    expect(base.statusCode, base.body).toBe(200);
    const existentes = base.json().data.entries as Array<Record<string, any>>;
    const filaExtra = existentes.find((e) => e.typeId === extraId)!;
    const filaRegular = existentes.find((e) => e.typeId === regularId)!;

    // Reenvía el EXTRA sin cambios y cambia solo lo REGULAR.
    for (const headers of [admin(), pm()]) {
      const res = await putDia(headers, [
        { id: filaRegular.id, typeId: regularId, hours: 3 },
        { id: filaExtra.id, typeId: extraId, hours: Number(filaExtra.hours), startedAt: filaExtra.startedAt, endedAt: filaExtra.endedAt },
      ]);
      expect(res.statusCode, res.body).toBe(200);
    }

    // Misma petición cambiando 1 minuto la fila EXTRA: bloqueado.
    const unMinuto = await putDia(pm(), [
      { id: filaRegular.id, typeId: regularId, hours: 3 },
      {
        id: filaExtra.id,
        typeId: extraId,
        hours: Number(filaExtra.hours),
        startedAt: new Date(new Date(filaExtra.startedAt).getTime() + 60_000).toISOString(),
        endedAt: filaExtra.endedAt,
      },
    ]);
    expect(unMinuto.statusCode, unMinuto.body).toBe(403);

    // Omitir el EXTRA existente equivale a borrarlo: bloqueado.
    const borra = await putDia(pm(), [{ id: filaRegular.id, typeId: regularId, hours: 3 }]);
    expect(borra.statusCode, borra.body).toBe(403);
    // Cambiar sus horas: bloqueado.
    const cambia = await putDia(admin(), [
      { id: filaRegular.id, typeId: regularId, hours: 3 },
      { id: filaExtra.id, typeId: extraId, hours: 2, startedAt: filaExtra.startedAt, endedAt: `${dia}T21:00:00.000Z` },
    ]);
    expect(cambia.statusCode, cambia.body).toBe(403);
    expect(await prisma.timeEntry.count({ where: { id: filaExtra.id } })).toBe(1);
  });

  it("cronómetro: nunca crea horas EXTRA, ni con solicitud aprobada; el sobrante de la jornada se descarta", async () => {
    await limpiarHoras();
    const inicio = new Date(Date.now() - 10 * 3_600_000);
    const diaLocal = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(inicio);
    const solicitud = await crearHoraExtra({
      consultantId: escenario.consultorA.id,
      projectId: escenario.projectId,
      fecha: new Date(`${diaLocal}T00:00:00.000Z`),
    });
    await prisma.extraHourEntry.update({ where: { id: solicitud.id }, data: { status: ExtraHourStatus.APPROVED, totalHours: 1 } });
    await prisma.runningTimer.create({
      data: { consultantId: escenario.consultorA.id, projectId: escenario.projectId, startedAt: inicio },
    });
    try {
      const res = await app.inject({ method: "POST", url: "/api/timer/stop", headers: dueno(), payload: {} });
      expect(res.statusCode, res.body).toBe(201);
      const cuerpo = res.json() as { entries: { type: { category: string }; isExcess: boolean }[]; discardedHours: number; discardedFrom: string; discardedTo: string };
      expect(cuerpo.entries.length).toBeGreaterThan(0);
      expect(cuerpo.entries.every((e) => e.type.category === "REGULAR" && !e.isExcess)).toBe(true);
      expect(cuerpo.discardedHours).toBeGreaterThan(0);
      expect(cuerpo.discardedFrom).toBeTruthy();
      expect(cuerpo.discardedTo).toBeTruthy();
      expect(await prisma.timeEntry.count({ where: { consultantId: escenario.consultorA.id, type: { category: "EXTRA" } } })).toBe(0);
    } finally {
      await prisma.runningTimer.deleteMany({ where: { consultantId: escenario.consultorA.id } });
    }
  });
});

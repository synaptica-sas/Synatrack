import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/infra/prisma.js";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";

/**
 * Feriados de capacity (CONTRATO §3.4): CRUD solo ADMIN, lectura para todos,
 * `generate` idempotente, cobertura, confirmación de año y fechas sin corrimiento.
 *
 * Usa años lejanos (2033 / 2034) y un prefijo en el nombre para no tocar los
 * feriados reales de la base, y limpia lo que crea.
 */
describe("API de feriados (/api/holidays)", () => {
  let app: FastifyInstance;
  const prefijo = `fer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let consultorId = "";

  const ESCRITORES_PROHIBIDOS = [
    AppRole.PM,
    AppRole.CONSULTANT,
    AppRole.FINANCE,
    AppRole.VIEWER,
    AppRole.COMMERCIAL,
  ];
  const TODOS = [AppRole.ADMIN, ...ESCRITORES_PROHIBIDOS];

  async function limpiar() {
    await prisma.holiday.deleteMany({ where: { name: { startsWith: prefijo } } });
    await prisma.holiday.deleteMany({
      where: {
        country: "Chile",
        date: { gte: new Date("2033-01-01T00:00:00Z"), lte: new Date("2033-12-31T00:00:00Z") },
      },
    });
    await prisma.holidayCalendarYear.deleteMany({
      where: { country: { in: ["Chile", "Peru"] }, year: { in: [2033, 2034] } },
    });
  }

  beforeAll(async () => {
    app = await crearAppDePrueba();
    await limpiar();
    // Un consultor activo en Perú para que aparezca en la cobertura.
    consultorId = (
      await prisma.consultant.create({
        data: {
          fullName: `Peruano ${prefijo}`,
          email: `peruano.${prefijo}@synaptica.test`,
          role: "Consultor",
          country: "Peru",
          city: `Lima ${prefijo}`,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await limpiar();
    await prisma.consultant.deleteMany({ where: { id: consultorId } });
    await app.close();
  });

  it("ADMIN crea un feriado y la fecha vuelve sin corrimiento (2026-12-07)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/holidays",
      headers: comoRol(AppRole.ADMIN, "admin.feriados@synaptica.test"),
      payload: { country: "ecuador", date: "2026-12-07", name: `${prefijo} dia de prueba`, city: "  Quito  " },
    });
    expect(res.statusCode).toBe(201);
    const creado = res.json().data;
    expect(creado).toMatchObject({
      country: "Ecuador",
      city: "Quito",
      date: "2026-12-07",
      source: "MANUAL",
      createdBy: "admin.feriados@synaptica.test",
    });

    // Lectura posterior: mismo día, sin importar la zona del servidor.
    const lista = await app.inject({
      method: "GET",
      url: "/api/holidays?country=Ecuador&from=2026-12-01&to=2026-12-31&city=quito",
      headers: comoRol(AppRole.VIEWER),
    });
    expect(lista.statusCode).toBe(200);
    const fila = (lista.json().data as { id: string; date: string }[]).find((h) => h.id === creado.id);
    expect(fila?.date).toBe("2026-12-07");

    // Auditoría con la entidad del catálogo.
    const registro = await prisma.auditLog.findFirst({
      where: { entity: "holiday", entityId: creado.id, action: "CREATE" },
    });
    expect(registro?.changedBy).toBe("admin.feriados@synaptica.test");
  });

  it("un duplicado (país, ciudad, fecha) da 409; con otra ciudad sí se acepta", async () => {
    const payload = { country: "Ecuador", date: "2026-12-08", name: `${prefijo} uno` };
    const primero = await app.inject({
      method: "POST",
      url: "/api/holidays",
      headers: comoRol(AppRole.ADMIN),
      payload,
    });
    expect(primero.statusCode).toBe(201);

    const repetido = await app.inject({
      method: "POST",
      url: "/api/holidays",
      headers: comoRol(AppRole.ADMIN),
      payload: { ...payload, name: `${prefijo} dos` },
    });
    expect(repetido.statusCode).toBe(409);

    const otraCiudad = await app.inject({
      method: "POST",
      url: "/api/holidays",
      headers: comoRol(AppRole.ADMIN),
      payload: { ...payload, name: `${prefijo} tres`, city: "Guayaquil" },
    });
    expect(otraCiudad.statusCode).toBe(201);
  });

  it("valida el cuerpo: fecha inexistente, país no soportado y nombre vacío dan 400", async () => {
    for (const payload of [
      { country: "Ecuador", date: "2026-02-30", name: `${prefijo} x` },
      { country: "Ecuador", date: "07/12/2026", name: `${prefijo} x` },
      { country: "Narnia", date: "2026-12-09", name: `${prefijo} x` },
      { country: "Ecuador", date: "2026-12-09", name: "  " },
    ]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/holidays",
        headers: comoRol(AppRole.ADMIN),
        payload,
      });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
  });

  it("PUT edita (y 409 si choca) y DELETE responde 204 y luego 404", async () => {
    const crear = await app.inject({
      method: "POST",
      url: "/api/holidays",
      headers: comoRol(AppRole.ADMIN),
      payload: { country: "Colombia", date: "2026-12-20", name: `${prefijo} editar` },
    });
    const id = crear.json().data.id as string;

    const editar = await app.inject({
      method: "PUT",
      url: `/api/holidays/${id}`,
      headers: comoRol(AppRole.ADMIN),
      payload: { name: `${prefijo} editado`, source: "DECREE" },
    });
    expect(editar.statusCode).toBe(200);
    expect(editar.json().data).toMatchObject({ name: `${prefijo} editado`, source: "DECREE", date: "2026-12-20" });

    const otro = await app.inject({
      method: "POST",
      url: "/api/holidays",
      headers: comoRol(AppRole.ADMIN),
      payload: { country: "Colombia", date: "2026-12-21", name: `${prefijo} otro` },
    });
    const choque = await app.inject({
      method: "PUT",
      url: `/api/holidays/${otro.json().data.id}`,
      headers: comoRol(AppRole.ADMIN),
      payload: { date: "2026-12-20" },
    });
    expect(choque.statusCode).toBe(409);

    const borrar = await app.inject({ method: "DELETE", url: `/api/holidays/${id}`, headers: comoRol(AppRole.ADMIN) });
    expect(borrar.statusCode).toBe(204);
    const otraVez = await app.inject({ method: "DELETE", url: `/api/holidays/${id}`, headers: comoRol(AppRole.ADMIN) });
    expect(otraVez.statusCode).toBe(404);

    const inexistente = await app.inject({
      method: "PUT",
      url: "/api/holidays/no-existe",
      headers: comoRol(AppRole.ADMIN),
      payload: { name: "x" },
    });
    expect(inexistente.statusCode).toBe(404);
  });

  it("PM, CONSULTANT, FINANCE, VIEWER y COMMERCIAL leen (200) pero no escriben (403)", async () => {
    const existente = await prisma.holiday.create({
      data: { country: "Ecuador", date: new Date("2026-12-25T00:00:00Z"), name: `${prefijo} navidad` },
    });

    for (const rol of ESCRITORES_PROHIBIDOS) {
      const leer = await app.inject({ method: "GET", url: "/api/holidays?country=Ecuador", headers: comoRol(rol) });
      expect(leer.statusCode, `GET como ${rol}`).toBe(200);

      const peticiones = [
        { method: "POST", url: "/api/holidays", payload: { country: "Ecuador", date: "2026-12-26", name: `${prefijo} no` } },
        { method: "PUT", url: `/api/holidays/${existente.id}`, payload: { name: "hackeado" } },
        { method: "DELETE", url: `/api/holidays/${existente.id}` },
        { method: "POST", url: "/api/holidays/generate", payload: { country: "Chile", year: 2033 } },
        { method: "PUT", url: "/api/holidays/calendar-years/Chile/2033" },
        { method: "DELETE", url: "/api/holidays/calendar-years/Chile/2033" },
      ] as const;
      for (const p of peticiones) {
        const res = await app.inject({
          method: p.method,
          url: p.url,
          headers: comoRol(rol),
          ...("payload" in p ? { payload: p.payload } : {}),
        });
        expect(res.statusCode, `${p.method} ${p.url} como ${rol}`).toBe(403);
      }
    }

    // Nada cambió.
    const intacto = await prisma.holiday.findUnique({ where: { id: existente.id } });
    expect(intacto?.name).toBe(`${prefijo} navidad`);
    expect(await prisma.holiday.count({ where: { name: `${prefijo} no` } })).toBe(0);
  });

  it("generate inserta los feriados del país una sola vez", async () => {
    const primera = await app.inject({
      method: "POST",
      url: "/api/holidays/generate",
      headers: comoRol(AppRole.ADMIN),
      payload: { country: "chile", year: 2033 },
    });
    expect(primera.statusCode).toBe(200);
    const { created, skipped } = primera.json().data as {
      created: { source: string; city: string; country: string; date: string }[];
      skipped: number;
    };
    expect(created.length).toBeGreaterThan(5);
    expect(skipped).toBe(0);
    for (const h of created) {
      expect(h).toMatchObject({ source: "GENERATED", city: "", country: "Chile" });
      expect(h.date.startsWith("2033-")).toBe(true);
    }

    const segunda = await app.inject({
      method: "POST",
      url: "/api/holidays/generate",
      headers: comoRol(AppRole.ADMIN),
      payload: { country: "Chile", year: 2033 },
    });
    expect(segunda.json().data.created).toHaveLength(0);
    expect(segunda.json().data.skipped).toBe(created.length);

    const total = await prisma.holiday.count({
      where: {
        country: "Chile",
        date: { gte: new Date("2033-01-01T00:00:00Z"), lte: new Date("2033-12-31T00:00:00Z") },
      },
    });
    expect(total).toBe(created.length);

    const mala = await app.inject({
      method: "POST",
      url: "/api/holidays/generate",
      headers: comoRol(AppRole.ADMIN),
      payload: { country: "Narnia", year: 2033 },
    });
    expect(mala.statusCode).toBe(400);
  });

  it("coverage cuenta feriados y refleja la confirmación del año; calendar-years PUT/DELETE", async () => {
    await app.inject({
      method: "POST",
      url: "/api/holidays",
      headers: comoRol(AppRole.ADMIN),
      payload: { country: "Peru", date: "2034-07-28", name: `${prefijo} fiestas patrias` },
    });

    const filaPeru = async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/holidays/coverage?from=2034-01&to=2034-12",
        headers: comoRol(AppRole.COMMERCIAL),
      });
      expect(res.statusCode).toBe(200);
      return (res.json().data as { country: string; year: number; holidayCount: number; confirmed: boolean; confirmedBy: string | null }[]).find(
        (f) => f.country === "Peru" && f.year === 2034,
      );
    };

    expect(await filaPeru()).toMatchObject({ holidayCount: 1, confirmed: false, confirmedBy: null });

    const confirmar = await app.inject({
      method: "PUT",
      url: "/api/holidays/calendar-years/peru/2034",
      headers: comoRol(AppRole.ADMIN, "confirma@synaptica.test"),
    });
    expect(confirmar.statusCode).toBe(200);
    expect(confirmar.json().data).toMatchObject({ country: "Peru", year: 2034, confirmedBy: "confirma@synaptica.test" });
    expect(await filaPeru()).toMatchObject({ confirmed: true, confirmedBy: "confirma@synaptica.test" });

    const desconfirmar = await app.inject({
      method: "DELETE",
      url: "/api/holidays/calendar-years/Peru/2034",
      headers: comoRol(AppRole.ADMIN),
    });
    expect(desconfirmar.statusCode).toBe(204);
    expect((await filaPeru())?.confirmed).toBe(false);

    const otraVez = await app.inject({
      method: "DELETE",
      url: "/api/holidays/calendar-years/Peru/2034",
      headers: comoRol(AppRole.ADMIN),
    });
    expect(otraVez.statusCode).toBe(404);
  });

  it("cities junta las ciudades de feriados y de consultores sin repetir", async () => {
    await prisma.holiday.create({
      data: { country: "Peru", city: `Cusco ${prefijo}`, date: new Date("2034-06-24T00:00:00Z"), name: `${prefijo} inti raymi` },
    });
    const res = await app.inject({ method: "GET", url: "/api/holidays/cities?country=Peru", headers: comoRol(AppRole.VIEWER) });
    expect(res.statusCode).toBe(200);
    const ciudades = res.json().data as string[];
    expect(ciudades).toContain(`Cusco ${prefijo}`);
    expect(ciudades).toContain(`Lima ${prefijo}`);
    expect(new Set(ciudades.map((c) => c.toLowerCase())).size).toBe(ciudades.length);
  });

  it("todos los roles pueden leer", async () => {
    for (const rol of TODOS) {
      const res = await app.inject({ method: "GET", url: "/api/holidays?year=2026", headers: comoRol(rol) });
      expect(res.statusCode, rol).toBe(200);
    }
  });

  it("/api/custom-holidays: solo ADMIN escribe; PM ya no", async () => {
    for (const rol of [AppRole.PM, AppRole.CONSULTANT, AppRole.COMMERCIAL]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/custom-holidays",
        headers: comoRol(rol),
        payload: { name: `${prefijo} corp`, date: "2034-03-03", country: "All" },
      });
      expect(res.statusCode, rol).toBe(403);
    }

    const crear = await app.inject({
      method: "POST",
      url: "/api/custom-holidays",
      headers: comoRol(AppRole.ADMIN, "admin.feriados@synaptica.test"),
      payload: { name: `${prefijo} corp`, date: "2034-03-03", country: "All" },
    });
    expect(crear.statusCode).toBe(201);
    const id = crear.json().data.id as string;
    expect(await prisma.auditLog.count({ where: { entity: "customHoliday", entityId: id, action: "CREATE" } })).toBe(1);

    const pmBorra = await app.inject({ method: "DELETE", url: `/api/custom-holidays/${id}`, headers: comoRol(AppRole.PM) });
    expect(pmBorra.statusCode).toBe(403);

    const borra = await app.inject({ method: "DELETE", url: `/api/custom-holidays/${id}`, headers: comoRol(AppRole.ADMIN) });
    expect(borra.statusCode).toBe(204);

    const lectura = await app.inject({ method: "GET", url: "/api/custom-holidays", headers: comoRol(AppRole.COMMERCIAL) });
    expect(lectura.statusCode).toBe(200);
  });
});

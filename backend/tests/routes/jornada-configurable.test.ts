import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/infra/prisma.js";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";

/**
 * Jornada laboral configurable (decisión de negocio D-5, cierra DEP-41) con
 * vigencia (`validFrom`, CONTRATO §3.5).
 *
 * Lo que no puede comprobar una prueba pura: que la jornada se escribe y se lee
 * por la API, que solo ADMIN puede escribirla, que la vigencia se respeta y —lo
 * que de verdad importa— que **la matriz de capacidad cambia** cuando se cambia
 * la jornada de un país.
 *
 * Las filas de `CapacityConfig` de los países son datos compartidos de la base,
 * así que cada prueba que las toca guarda el valor anterior (clave país +
 * vigencia) y lo restaura al final; los consultores se crean con un prefijo
 * propio y se borran.
 */
describe("Jornada laboral configurable (D-5) con vigencia", () => {
  let app: FastifyInstance;

  const prefijo = `jornada-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let colombianoId = "";
  let ecuatorianoId = "";
  let chilenoId = "";

  /** Valor de las filas de país (país + vigencia) antes de la prueba. */
  const paisesOriginales = new Map<
    string,
    { country: string; validFrom: Date; datos: { hoursPerDay: number; workDaysPerWeek: number } | null }
  >();

  async function recordarPais(country: string, validFromIso = "2000-01-01") {
    const clave = `${country}|${validFromIso}`;
    if (paisesOriginales.has(clave)) return;
    const validFrom = new Date(`${validFromIso}T00:00:00.000Z`);
    const fila = await prisma.capacityConfig.findUnique({
      where: { country_validFrom: { country, validFrom } },
    });
    paisesOriginales.set(clave, {
      country,
      validFrom,
      datos: fila
        ? { hoursPerDay: Number(fila.hoursPerDay), workDaysPerWeek: fila.workDaysPerWeek }
        : null,
    });
  }

  beforeAll(async () => {
    app = await crearAppDePrueba();

    const crear = async (fullName: string, country: string) =>
      (
        await prisma.consultant.create({
          data: {
            fullName,
            email: `${fullName.toLowerCase().replace(/\s+/g, ".")}.${prefijo}@synaptica.test`,
            role: "Consultor",
            hourlyRate: 40,
            rateCurrency: "USD",
            country,
          },
        })
      ).id;

    colombianoId = await crear(`Col ${prefijo}`, "Colombia");
    ecuatorianoId = await crear(`Ecu ${prefijo}`, "Ecuador");
    chilenoId = await crear(`Chi ${prefijo}`, "Chile");
  });

  afterAll(async () => {
    // Las jornadas propias de los consultores de prueba se van en cascada con
    // ellos, pero las borramos explícitamente por si el consultor ya no existe.
    await prisma.capacityConfig.deleteMany({
      where: { consultantId: { in: [colombianoId, ecuatorianoId, chilenoId] } },
    });
    await prisma.consultant.deleteMany({
      where: { id: { in: [colombianoId, ecuatorianoId, chilenoId] } },
    });

    // Devolver las filas de país a como estaban antes de la prueba.
    for (const { country, validFrom, datos } of paisesOriginales.values()) {
      if (datos) {
        await prisma.capacityConfig.upsert({
          where: { country_validFrom: { country, validFrom } },
          update: datos,
          create: { country, validFrom, ...datos },
        });
      } else {
        await prisma.capacityConfig.deleteMany({ where: { country, validFrom, consultantId: null } });
      }
    }

    await app.close();
  });

  function jornadaDe(cuerpo: { data: { consultants: { consultantId: string }[] } }, id: string) {
    return cuerpo.data.consultants.find((c) => c.consultantId === id);
  }

  // ── La siembra acordada ───────────────────────────────────────────────────

  it("de salida, Colombia pasa de 8 a 8,4 h desde 2026-07-15 y Ecuador queda en 8 h", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/capacity/workday",
      headers: comoRol(AppRole.ADMIN),
    });

    expect(res.statusCode).toBe(200);
    // GET devuelve TODAS las filas, cada una con su vigencia.
    const paises: { country: string; hoursPerDay: number; validFrom: string }[] =
      res.json().data.countries;
    const filaDe = (country: string, validFrom: string) =>
      paises.find((p) => p.country === country && p.validFrom === validFrom);
    expect(filaDe("Colombia", "2000-01-01")?.hoursPerDay).toBe(8);
    expect(filaDe("Colombia", "2026-07-15")?.hoursPerDay).toBe(8.4);
    expect(filaDe("Ecuador", "2000-01-01")?.hoursPerDay).toBe(8);
    expect(filaDe("Default", "2000-01-01")?.hoursPerDay).toBe(8);
  });

  // ── Precedencia, vista desde la API ───────────────────────────────────────

  it("la jornada efectiva aplica país, y un país sin configurar hereda la general", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/capacity/workday/effective?date=2026-08-01",
      headers: comoRol(AppRole.ADMIN),
    });

    expect(res.statusCode).toBe(200);
    const cuerpo = res.json();

    expect(jornadaDe(cuerpo, colombianoId)).toMatchObject({
      hoursPerDay: 8.4,
      origen: "pais",
      paisAplicado: "Colombia",
    });
    expect(jornadaDe(cuerpo, ecuatorianoId)).toMatchObject({ hoursPerDay: 8, origen: "pais" });
    // Chile no tiene fila propia: hereda la general de forma explícita.
    expect(jornadaDe(cuerpo, chilenoId)).toMatchObject({
      hoursPerDay: 8,
      origen: "general",
      paisAplicado: "Default",
    });
  });

  it("la vigencia manda: antes del 2026-07-15 Colombia está en 8 h, después en 8,4 h", async () => {
    const antes = await app.inject({
      method: "GET",
      url: "/api/capacity/workday/effective?date=2026-07-14",
      headers: comoRol(AppRole.ADMIN),
    });
    expect(jornadaDe(antes.json(), colombianoId)).toMatchObject({ hoursPerDay: 8 });

    const desde = await app.inject({
      method: "GET",
      url: "/api/capacity/workday/effective?date=2026-07-15",
      headers: comoRol(AppRole.ADMIN),
    });
    expect(jornadaDe(desde.json(), colombianoId)).toMatchObject({ hoursPerDay: 8.4 });
  });

  it("la jornada del consultor manda sobre la de su país, y al borrarla vuelve a heredar", async () => {
    const guardar = await app.inject({
      method: "PUT",
      url: `/api/capacity/workday/consultant/${colombianoId}`,
      headers: comoRol(AppRole.ADMIN),
      payload: { hoursPerDay: 6, workDaysPerWeek: 4 },
    });
    expect(guardar.statusCode).toBe(200);
    expect(guardar.json().data).toMatchObject({
      hoursPerDay: 6,
      workDaysPerWeek: 4,
      country: null,
      validFrom: "2000-01-01",
    });

    const conExcepcion = await app.inject({
      method: "GET",
      url: "/api/capacity/workday/effective?date=2026-08-01",
      headers: comoRol(AppRole.ADMIN),
    });
    expect(jornadaDe(conExcepcion.json(), colombianoId)).toMatchObject({
      hoursPerDay: 6,
      workDaysPerWeek: 4,
      origen: "consultor",
    });

    // Sin ?validFrom= se borra la fila de vigencia inicial (2000-01-01).
    const borrar = await app.inject({
      method: "DELETE",
      url: `/api/capacity/workday/consultant/${colombianoId}`,
      headers: comoRol(AppRole.ADMIN),
    });
    expect(borrar.statusCode).toBe(204);

    const sinExcepcion = await app.inject({
      method: "GET",
      url: "/api/capacity/workday/effective?date=2026-08-01",
      headers: comoRol(AppRole.ADMIN),
    });
    expect(jornadaDe(sinExcepcion.json(), colombianoId)).toMatchObject({
      hoursPerDay: 8.4,
      origen: "pais",
    });
  });

  // ── Vigencia (CONTRATO §3.5) ──────────────────────────────────────────────

  it("una fila con validFrom futuro solo aplica desde esa fecha, y se borra con ?validFrom=", async () => {
    await recordarPais("Chile", "2030-01-01");

    const crear = await app.inject({
      method: "PUT",
      url: "/api/capacity/workday/country/Chile",
      headers: comoRol(AppRole.ADMIN),
      payload: { hoursPerDay: 7, workDaysPerWeek: 5, validFrom: "2030-01-01" },
    });
    expect(crear.statusCode).toBe(200);
    expect(crear.json().data.validFrom).toBe("2030-01-01");

    // Misma clave y misma vigencia: es un upsert, no una fila nueva.
    const otraVez = await app.inject({
      method: "PUT",
      url: "/api/capacity/workday/country/Chile",
      headers: comoRol(AppRole.ADMIN),
      payload: { hoursPerDay: 7.5, workDaysPerWeek: 5, validFrom: "2030-01-01" },
    });
    expect(otraVez.json().data.id).toBe(crear.json().data.id);

    const antes = await app.inject({
      method: "GET",
      url: "/api/capacity/workday/effective?date=2029-12-31",
      headers: comoRol(AppRole.ADMIN),
    });
    expect(jornadaDe(antes.json(), chilenoId)).toMatchObject({ hoursPerDay: 8, origen: "general" });

    const despues = await app.inject({
      method: "GET",
      url: "/api/capacity/workday/effective?date=2030-01-01",
      headers: comoRol(AppRole.ADMIN),
    });
    expect(jornadaDe(despues.json(), chilenoId)).toMatchObject({
      hoursPerDay: 7.5,
      origen: "pais",
      paisAplicado: "Chile",
    });

    const borrar = await app.inject({
      method: "DELETE",
      url: "/api/capacity/workday/country/Chile?validFrom=2030-01-01",
      headers: comoRol(AppRole.ADMIN),
    });
    expect(borrar.statusCode).toBe(204);

    const otraBorrada = await app.inject({
      method: "DELETE",
      url: "/api/capacity/workday/country/Chile?validFrom=2030-01-01",
      headers: comoRol(AppRole.ADMIN),
    });
    expect(otraBorrada.statusCode).toBe(404);
  });

  it("un validFrom mal formado o inexistente da 400", async () => {
    for (const validFrom of ["2026-13-01", "2026-02-30", "ayer", "2026/01/01"]) {
      const res = await app.inject({
        method: "PUT",
        url: "/api/capacity/workday/country/Chile",
        headers: comoRol(AppRole.ADMIN),
        payload: { hoursPerDay: 8, workDaysPerWeek: 5, validFrom },
      });
      expect(res.statusCode, validFrom).toBe(400);
    }

    const query = await app.inject({
      method: "GET",
      url: "/api/capacity/workday/effective?date=no-es-fecha",
      headers: comoRol(AppRole.ADMIN),
    });
    expect(query.statusCode).toBe(400);
  });

  // ── El efecto que justifica todo esto ─────────────────────────────────────

  it("cambiar la jornada de un país cambia la capacidad que devuelve la matriz", async () => {
    // La matriz usa la jornada vigente HOY: la fila del 2026-07-15 en adelante.
    await recordarPais("Colombia", "2026-07-15");

    const capacidadDe = async (consultantId: string) => {
      const res = await app.inject({
        method: "GET",
        url: `/api/capacity/consultant/${consultantId}?from=2026-05-01&to=2026-05-31`,
        headers: comoRol(AppRole.ADMIN),
      });
      expect(res.statusCode).toBe(200);
      return res.json().data.timeline[0].capacityHours as number;
    };

    // Mayo de 2026 en Colombia: días hábiles × 8,4 h.
    const conOchoYCuatro = await capacidadDe(colombianoId);

    const bajar = await app.inject({
      method: "PUT",
      url: "/api/capacity/workday/country/Colombia",
      headers: comoRol(AppRole.ADMIN),
      payload: { hoursPerDay: 8, workDaysPerWeek: 5, validFrom: "2026-07-15" },
    });
    expect(bajar.statusCode).toBe(200);

    const conOcho = await capacidadDe(colombianoId);

    // La misma persona, el mismo mes: solo cambió la jornada.
    expect(conOchoYCuatro).toBeGreaterThan(conOcho);
    expect(conOchoYCuatro / conOcho).toBeCloseTo(8.4 / 8, 1);
  });

  it("un ecuatoriano no se ve afectado por la jornada de Colombia", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/capacity/consultant/${ecuatorianoId}?from=2026-05-01&to=2026-05-31`,
      headers: comoRol(AppRole.ADMIN),
    });
    const horas = res.json().data.timeline[0].capacityHours as number;
    // Días hábiles de mayo de 2026 en Ecuador × 8 h: múltiplo exacto de 8.
    expect(horas % 8).toBe(0);
  });

  // ── Validación ────────────────────────────────────────────────────────────

  it("rechaza una jornada imposible y un país no soportado", async () => {
    const horasAbsurdas = await app.inject({
      method: "PUT",
      url: "/api/capacity/workday/country/Colombia",
      headers: comoRol(AppRole.ADMIN),
      payload: { hoursPerDay: 30, workDaysPerWeek: 5 },
    });
    expect(horasAbsurdas.statusCode).toBe(400);

    const diasAbsurdos = await app.inject({
      method: "PUT",
      url: "/api/capacity/workday/country/Colombia",
      headers: comoRol(AppRole.ADMIN),
      payload: { hoursPerDay: 8, workDaysPerWeek: 9 },
    });
    expect(diasAbsurdos.statusCode).toBe(400);

    const paisInventado = await app.inject({
      method: "PUT",
      url: "/api/capacity/workday/country/Narnia",
      headers: comoRol(AppRole.ADMIN),
      payload: { hoursPerDay: 8, workDaysPerWeek: 5 },
    });
    expect(paisInventado.statusCode).toBe(400);
  });

  it("la única fila general vigente no se puede borrar", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/capacity/workday/country/Default?validFrom=2000-01-01",
      headers: comoRol(AppRole.ADMIN),
    });
    expect(res.statusCode).toBe(409);
    expect(
      await prisma.capacityConfig.findUnique({
        where: {
          country_validFrom: { country: "Default", validFrom: new Date("2000-01-01T00:00:00.000Z") },
        },
      }),
    ).not.toBeNull();
  });

  it("un consultor inexistente da 404, no crea una fila huérfana", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/capacity/workday/consultant/no-existe-este-id",
      headers: comoRol(AppRole.ADMIN),
      payload: { hoursPerDay: 8, workDaysPerWeek: 5 },
    });
    expect(res.statusCode).toBe(404);
  });

  // ── Autorización ──────────────────────────────────────────────────────────

  it("solo ADMIN puede escribir la jornada", async () => {
    for (const rol of [
      AppRole.PM,
      AppRole.CONSULTANT,
      AppRole.FINANCE,
      AppRole.VIEWER,
      AppRole.COMMERCIAL,
    ]) {
      const porPais = await app.inject({
        method: "PUT",
        url: "/api/capacity/workday/country/Colombia",
        headers: comoRol(rol),
        payload: { hoursPerDay: 12, workDaysPerWeek: 6 },
      });
      expect(porPais.statusCode, `PUT país como ${rol}`).toBe(403);

      const porConsultor = await app.inject({
        method: "PUT",
        url: `/api/capacity/workday/consultant/${colombianoId}`,
        headers: comoRol(rol),
        payload: { hoursPerDay: 12, workDaysPerWeek: 6 },
      });
      expect(porConsultor.statusCode, `PUT consultor como ${rol}`).toBe(403);

      const borrado = await app.inject({
        method: "DELETE",
        url: "/api/capacity/workday/country/Colombia",
        headers: comoRol(rol),
      });
      expect(borrado.statusCode, `DELETE como ${rol}`).toBe(403);
    }

    // Ninguno de los intentos dejó rastro.
    const filas = await prisma.capacityConfig.findMany({ where: { country: "Colombia" } });
    expect(filas.some((f) => Number(f.hoursPerDay) === 12)).toBe(false);
  });

  it("solo ADMIN ve la configuración completa; la jornada efectiva la ve cualquier rol", async () => {
    const comoPm = await app.inject({
      method: "GET",
      url: "/api/capacity/workday",
      headers: comoRol(AppRole.PM),
    });
    expect(comoPm.statusCode).toBe(403);

    for (const rol of [
      AppRole.PM,
      AppRole.CONSULTANT,
      AppRole.FINANCE,
      AppRole.VIEWER,
      AppRole.COMMERCIAL,
    ]) {
      const res = await app.inject({
        method: "GET",
        url: "/api/capacity/workday/effective",
        headers: comoRol(rol),
      });
      expect(res.statusCode, `GET effective como ${rol}`).toBe(200);
      // No se filtra nada de dinero por esta vía.
      expect(res.body).not.toContain("hourlyRate");
    }
  });

  // El 401 sin token no se comprueba aquí: estas pruebas corren con el bypass
  // de demo, que entra siempre como ADMIN. La propiedad "toda ruta exige token"
  // la cubre `auth-requerida.test.ts`, que levanta la app con autenticación real.

  // ── Auditoría ─────────────────────────────────────────────────────────────

  it("escribir la jornada deja rastro en la bitácora", async () => {
    await recordarPais("Ecuador");

    const res = await app.inject({
      method: "PUT",
      url: "/api/capacity/workday/country/Ecuador",
      headers: comoRol(AppRole.ADMIN, "auditor.jornada@synaptica.test"),
      payload: { hoursPerDay: 7.5, workDaysPerWeek: 5 },
    });
    expect(res.statusCode).toBe(200);

    const registro = await prisma.auditLog.findFirst({
      where: { entity: "capacityConfig", entityId: res.json().data.id },
      orderBy: { createdAt: "desc" },
    });
    expect(registro).not.toBeNull();
    expect(registro?.changedBy).toBe("auditor.jornada@synaptica.test");
    expect(["CREATE", "UPDATE"]).toContain(registro?.action);
  });
});

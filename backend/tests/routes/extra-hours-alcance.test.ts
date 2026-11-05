import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";
import {
  crearEscenarioBasico,
  crearHoraExtra,
  limpiarEscenario,
  type EscenarioBasico,
} from "../helpers/datos.js";

/**
 * `GET /api/extra-hours` filtra por rol: un CONSULTANT solo ve las horas
 * extra de su propio consultor enlazado (`request.authUser.consultantId`),
 * igual que `GET /api/time-entries`.
 */
describe("GET /api/extra-hours filtra por rol (comportamiento correcto)", () => {
  let app: FastifyInstance;
  let escenario: EscenarioBasico;

  beforeAll(async () => {
    app = await crearAppDePrueba();
    escenario = await crearEscenarioBasico("eh");
    await crearHoraExtra({
      consultantId: escenario.consultorA.id,
      projectId: escenario.projectId,
      fecha: new Date(Date.UTC(2026, 2, 10)),
    });
    await crearHoraExtra({
      consultantId: escenario.consultorB.id,
      projectId: escenario.projectId,
      fecha: new Date(Date.UTC(2026, 2, 11)),
    });
  });

  afterAll(async () => {
    await limpiarEscenario(escenario);
    await app.close();
  });

  it("un CONSULTANT solo recibe sus propias horas extra", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/extra-hours",
      headers: comoRol(AppRole.CONSULTANT, escenario.consultorA.email),
    });

    expect(res.statusCode).toBe(200);
    const propias = res.json().data as Array<{ consultantId: string }>;
    const ajenas = propias.filter((fila) => fila.consultantId !== escenario.consultorA.id);

    expect(ajenas).toHaveLength(0);
    expect(propias.some((fila) => fila.consultantId === escenario.consultorA.id)).toBe(true);
  });

  it("un ADMIN recibe las de ambos consultores", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/extra-hours",
      headers: comoRol(AppRole.ADMIN),
    });

    expect(res.statusCode).toBe(200);
    const ids = (res.json().data as Array<{ consultantId: string }>).map((f) => f.consultantId);

    expect(ids).toContain(escenario.consultorA.id);
    expect(ids).toContain(escenario.consultorB.id);
  });
});

describe("POST /api/extra-hours: no se puede registrar a nombre de otro", () => {
  let app: FastifyInstance;
  let escenario: EscenarioBasico;

  beforeAll(async () => {
    app = await crearAppDePrueba();
    escenario = await crearEscenarioBasico("eh-self");
  });

  afterAll(async () => {
    await limpiarEscenario(escenario);
    await app.close();
  });

  function cuerpo(consultantId: string, date: string) {
    return {
      projectId: escenario.projectId,
      consultantId,
      date,
      startTime: "19:00",
      endTime: "21:00",
      observations: "Prueba de enlace",
    };
  }

  // Nadie solicita horas extra para un día ya pasado: las pruebas usan una fecha futura.
  const fechaFutura = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  it("un CONSULTANT que manda el consultantId de otro recibe 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/extra-hours",
      headers: comoRol(AppRole.CONSULTANT, escenario.consultorA.email),
      payload: cuerpo(escenario.consultorB.id, fechaFutura),
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().message).toBe("Las horas extra solo las puede solicitar el propio consultor.");
  });

  it("un CONSULTANT registrando a su propio nombre sí puede", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/extra-hours",
      headers: comoRol(AppRole.CONSULTANT, escenario.consultorA.email),
      payload: cuerpo(escenario.consultorA.id, fechaFutura),
    });

    expect(res.statusCode).toBe(201);
  });

  it("ADMIN y PM NO pueden solicitar por otro consultor (403) ni por sí mismos si no tienen ficha (400)", async () => {
    for (const rol of [AppRole.ADMIN, AppRole.PM] as const) {
      const porOtro = await app.inject({
        method: "POST",
        url: "/api/extra-hours",
        headers: comoRol(rol),
        payload: cuerpo(escenario.consultorB.id, fechaFutura),
      });
      expect(porOtro.statusCode, rol).toBe(403);
      expect(porOtro.json().message).toBe("Las horas extra solo las puede solicitar el propio consultor.");

      // Sin consultantId y sin ficha de consultor: 400 con mensaje claro.
      const { consultantId: _omitido, ...sinConsultor } = cuerpo(escenario.consultorB.id, fechaFutura);
      const sinFicha = await app.inject({
        method: "POST",
        url: "/api/extra-hours",
        headers: comoRol(rol),
        payload: sinConsultor,
      });
      expect(sinFicha.statusCode, rol).toBe(400);
      expect(sinFicha.json().message).toContain("ficha de consultor");
    }
  });

  it("un ADMIN o PM con ficha de consultor propia sí solicita a su nombre; sin consultantId usa el propio", async () => {
    for (const rol of [AppRole.ADMIN, AppRole.PM] as const) {
      const { consultantId: _omitido, ...sinConsultor } = cuerpo(escenario.consultorA.id, fechaFutura);
      const res = await app.inject({
        method: "POST",
        url: "/api/extra-hours",
        headers: comoRol(rol, escenario.consultorA.email),
        payload: sinConsultor,
      });
      expect(res.statusCode, rol).toBe(201);
      expect(res.json().data.consultantId).toBe(escenario.consultorA.id);
    }
  });

  it("nadie solicita horas extra para un día anterior al actual (tampoco ADMIN/PM)", async () => {
    for (const rol of [AppRole.CONSULTANT, AppRole.ADMIN, AppRole.PM] as const) {
      const res = await app.inject({
        method: "POST",
        url: "/api/extra-hours",
        headers: comoRol(rol, escenario.consultorA.email),
        payload: cuerpo(escenario.consultorA.id, "2026-05-07"),
      });
      expect(res.statusCode, rol).toBe(400);
      expect(res.json().message).toContain("anteriores al actual");
    }
  });
});

/**
 * `POST /api/extra-hours/calculate` (exploit confirmado en la auditoría en
 * vivo): antes usaba `payload.consultantId` tal cual, así que cualquier
 * CONSULTANT podía pedir el cálculo -- y de paso la tarifa horaria implícita
 * en el resultado -- de un compañero con solo cambiar el id en el cuerpo.
 * Mismo criterio que `POST /api/extra-hours` (`resolveTargetConsultantId`).
 */
describe("POST /api/extra-hours/calculate: no se puede pedir el cálculo de otro", () => {
  let app: FastifyInstance;
  let escenario: EscenarioBasico;

  beforeAll(async () => {
    app = await crearAppDePrueba();
    escenario = await crearEscenarioBasico("eh-calc");
  });

  afterAll(async () => {
    await limpiarEscenario(escenario);
    await app.close();
  });

  function cuerpo(consultantId: string) {
    return {
      consultantId,
      date: "2026-05-04",
      startTime: "19:00",
      endTime: "21:00",
    };
  }

  it("un CONSULTANT que pide el cálculo con el consultantId de otro recibe 403 (exploit bloqueado)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/extra-hours/calculate",
      headers: comoRol(AppRole.CONSULTANT, escenario.consultorA.email),
      payload: cuerpo(escenario.consultorB.id),
    });

    expect(res.statusCode).toBe(403);
  });

  it("un CONSULTANT sí puede pedir su propio cálculo", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/extra-hours/calculate",
      headers: comoRol(AppRole.CONSULTANT, escenario.consultorA.email),
      payload: cuerpo(escenario.consultorA.id),
    });

    expect(res.statusCode).toBe(200);
    // Sin montos para el consultor: ver extra-hours-montos.test.ts.
    expect(res.json().data).toHaveProperty("totalHours");
    expect(res.json().data).not.toHaveProperty("totalAmount");
  });

  it("ADMIN y PM sí pueden pedir el cálculo de otro consultor", async () => {
    for (const rol of [AppRole.ADMIN, AppRole.PM] as const) {
      const res = await app.inject({
        method: "POST",
        url: "/api/extra-hours/calculate",
        headers: comoRol(rol),
        payload: cuerpo(escenario.consultorB.id),
      });
      expect(res.statusCode, rol).toBe(200);
    }
  });
});

/**
 * `PUT/POST /api/extra-hours/config/:country[/reset]`: la matriz de permisos
 * (`extrahours:config`) dice que esto es solo de ADMIN. Antes el `authorize()`
 * también dejaba pasar a PM y FINANCE.
 */
describe("PUT/POST /api/extra-hours/config/:country: solo ADMIN", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await crearAppDePrueba();
  });

  afterAll(async () => {
    await app.close();
  });

  const payload = {
    weeklyExtraHoursLimit: 12,
    diurnalMultiplier: 1.25,
    nocturnalMultiplier: 1.75,
    diurnalHolidayMultiplier: 2.0,
    nocturnalHolidayMultiplier: 2.5,
    diurnalStart: "06:00",
    diurnalEnd: "19:00",
    monthlyDivisor: 220,
  };

  it.each([AppRole.PM, AppRole.FINANCE])("%s recibe 403 al editar la configuración de un país", async (rol) => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/extra-hours/config/Colombia",
      headers: comoRol(rol),
      payload,
    });
    expect(res.statusCode).toBe(403);
  });

  it.each([AppRole.PM, AppRole.FINANCE])("%s recibe 403 al restablecer la configuración de un país", async (rol) => {
    const res = await app.inject({
      method: "POST",
      url: "/api/extra-hours/config/Colombia/reset",
      headers: comoRol(rol),
    });
    expect(res.statusCode).toBe(403);
  });

  it("ADMIN sí puede editar la configuración de un país", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/extra-hours/config/Colombia",
      headers: comoRol(AppRole.ADMIN),
      payload,
    });
    expect(res.statusCode).toBe(200);
  });
});

/**
 * `GET /api/extra-hours`: VIEWER es un rol de consulta sin responsabilidad
 * económica. Antes recibía el `totalAmount` (y el resto de montos) de toda la
 * plantilla; ahora ve que la solicitud existe, sus horas y su estado, pero no
 * cuánto se le pagó a nadie.
 */
describe("GET /api/extra-hours: VIEWER no ve los montos pagados", () => {
  let app: FastifyInstance;
  let escenario: EscenarioBasico;

  beforeAll(async () => {
    app = await crearAppDePrueba();
    escenario = await crearEscenarioBasico("eh-viewer-montos");
    await crearHoraExtra({
      consultantId: escenario.consultorA.id,
      projectId: escenario.projectId,
      fecha: new Date(Date.UTC(2026, 6, 1)),
    });
  });

  afterAll(async () => {
    await limpiarEscenario(escenario);
    await app.close();
  });

  it("un VIEWER ve la fila, las horas y el estado, pero ningún campo de monto", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/extra-hours",
      headers: comoRol(AppRole.VIEWER, "viewer.eh@synaptica.test"),
    });

    expect(res.statusCode).toBe(200);
    const fila = (res.json().data as Array<Record<string, unknown>>).find(
      (f) => f.consultantId === escenario.consultorA.id,
    );
    expect(fila).toBeDefined();
    expect(fila).toHaveProperty("totalHours");
    expect(fila).toHaveProperty("status");
    expect(fila).not.toHaveProperty("totalAmount");
    expect(fila).not.toHaveProperty("diurnalAmount");
    expect(fila).not.toHaveProperty("nocturnalAmount");
    expect(fila).not.toHaveProperty("diurnalHolidayAmount");
    expect(fila).not.toHaveProperty("nocturnalHolidayAmount");
    // El monto marcado (100) no debe aparecer en ninguna parte del cuerpo.
    expect(res.body).not.toContain("\"totalAmount\":100");
  });

  it("un ADMIN sigue viendo el monto completo", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/extra-hours",
      headers: comoRol(AppRole.ADMIN),
    });

    expect(res.statusCode).toBe(200);
    const fila = (res.json().data as Array<{ consultantId: string; totalAmount: string }>).find(
      (f) => f.consultantId === escenario.consultorA.id,
    );
    expect(Number(fila?.totalAmount)).toBe(100);
  });
});

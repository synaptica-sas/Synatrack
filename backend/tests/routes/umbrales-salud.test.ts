import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/infra/prisma.js";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";
import { AMBITO_GENERAL, UMBRALES_SALUD_POR_DEFECTO } from "../../src/utils/healthThresholds.js";

/**
 * Umbrales del semáforo de salud configurables (decisión de negocio D-7).
 *
 * Lo que no puede comprobar una prueba pura y sí esta:
 *  · que **solo ADMIN** puede escribirlos, y que leerlos lo puede hacer cualquiera;
 *  · que un proyecto real con CPI 0,80 sale del API con la celda y el semáforo
 *    diciendo lo mismo — el defecto exacto que se corrige;
 *  · que cambiar el umbral **por la API** cambia el veredicto sin desplegar;
 *  · que sin fila sembrada el API lo dice (`origen: "codigo"`) y sigue calculando.
 *
 * Todo lo que crea la prueba lleva prefijo propio y se borra al final. La fila
 * de umbrales es global y compartida: se guarda al empezar y se restaura tal
 * cual al terminar, pase lo que pase.
 */
describe("Umbrales del semáforo configurables (D-7)", () => {
  let app: FastifyInstance;

  const prefijo = `umbd7-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let proyectoId = "";
  /** Fila de umbrales tal y como estaba antes de la prueba, para restaurarla. */
  let umbralesOriginales: Record<string, unknown> | null = null;

  const VALORES_INICIALES = {
    cpiWarning: 0.9,
    cpiCritical: 0.75,
    spiWarning: 0.9,
    spiCritical: 0.75,
    budgetWarningPct: 90,
    budgetCriticalPct: 100,
  };

  /** Fila de este proyecto en /api/stats/portfolio. */
  async function filaPortafolio() {
    const res = await app.inject({
      method: "GET",
      url: `/api/stats/portfolio?projectId=${proyectoId}`,
      headers: comoRol(AppRole.ADMIN),
    });
    expect(res.statusCode).toBe(200);
    const cuerpo = res.json().data;
    const fila = cuerpo.projects.find((p: { projectId: string }) => p.projectId === proyectoId);
    expect(fila, "el proyecto de la prueba debe estar en el portafolio").toBeTruthy();
    return { fila, thresholds: cuerpo.thresholds };
  }

  async function escribirUmbrales(payload: Record<string, number>, rol: AppRole = AppRole.ADMIN) {
    return app.inject({
      method: "PUT",
      url: "/api/health-thresholds",
      headers: comoRol(rol),
      payload,
    });
  }

  beforeAll(async () => {
    app = await crearAppDePrueba();

    const fila = await prisma.healthThresholdConfig.findUnique({
      where: { scope: AMBITO_GENERAL },
    });
    umbralesOriginales = fila as unknown as Record<string, unknown> | null;

    // Proyecto construido para dar CPI = 0,80 exacto:
    //   EV = 40 % × 100 000 = 40 000 ; AC = 50 000 de gasto ; CPI = 0,80.
    // Sin ingresos (el margen no participa), sin riesgos ni hitos, y con un
    // consumo de presupuesto del 50 % para que la alerta de presupuesto no
    // interfiera. Lo único que mueve el semáforo es el CPI.
    proyectoId = (
      await prisma.project.create({
        data: {
          name: `Proyecto ${prefijo}`,
          company: `Empresa ${prefijo}`,
          country: "Colombia",
          budget: 100_000,
          currency: "USD",
          status: "ACTIVE",
          completionPct: 40,
          startDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
          endDate: new Date(Date.now() + 20 * 365 * 24 * 60 * 60 * 1000),
          financialEntries: {
            create: [
              {
                type: "EXPENSE",
                amount: 50_000,
                currency: "USD",
                entryDate: new Date(),
                description: `Gasto ${prefijo}`,
              },
            ],
          },
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.financialEntry.deleteMany({ where: { projectId: proyectoId } });
    await prisma.alert.deleteMany({ where: { projectId: proyectoId } });
    await prisma.project.deleteMany({ where: { id: proyectoId } });

    // Restaurar la configuración global exactamente como estaba.
    await prisma.healthThresholdConfig.deleteMany({ where: { scope: AMBITO_GENERAL } });
    if (umbralesOriginales) {
      await prisma.healthThresholdConfig.create({
        data: umbralesOriginales as never,
      });
    }
    await app.close();
  });

  // ── Lectura y valores iniciales ───────────────────────────────────────────

  it("de salida los umbrales son los que acordó dirección", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/health-thresholds",
      headers: comoRol(AppRole.ADMIN),
    });

    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data).toMatchObject(VALORES_INICIALES);
    expect(data.origen).toBe("base");
    expect(data.porDefecto).toEqual(UMBRALES_SALUD_POR_DEFECTO);
  });

  it("cualquier rol autenticado puede leerlos", async () => {
    for (const rol of [AppRole.PM, AppRole.CONSULTANT, AppRole.FINANCE, AppRole.VIEWER]) {
      const res = await app.inject({
        method: "GET",
        url: "/api/health-thresholds",
        headers: comoRol(rol),
      });
      expect(res.statusCode, `rol ${rol}`).toBe(200);
    }
  });

  // ── Autorización de escritura ─────────────────────────────────────────────

  it("solo ADMIN puede escribirlos", async () => {
    for (const rol of [AppRole.PM, AppRole.CONSULTANT, AppRole.FINANCE, AppRole.VIEWER]) {
      const res = await escribirUmbrales({ ...VALORES_INICIALES, cpiCritical: 0.5 }, rol);
      expect(res.statusCode, `rol ${rol} no debería poder escribir`).toBe(403);
    }

    // Y no cambió nada por haberlo intentado.
    const fila = await prisma.healthThresholdConfig.findUnique({
      where: { scope: AMBITO_GENERAL },
    });
    expect(Number(fila!.cpiCritical)).toBe(0.75);
  });

  it("borrar la configuración también es solo de ADMIN", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/health-thresholds",
      headers: comoRol(AppRole.PM),
    });
    expect(res.statusCode).toBe(403);
  });

  // ── Validación ────────────────────────────────────────────────────────────

  it("rechaza un crítico por encima del de advertencia", async () => {
    const res = await escribirUmbrales({ ...VALORES_INICIALES, cpiCritical: 0.95 });
    expect(res.statusCode).toBe(400);
  });

  it("rechaza un aviso de presupuesto por encima del umbral de excedido", async () => {
    const res = await escribirUmbrales({ ...VALORES_INICIALES, budgetWarningPct: 120 });
    expect(res.statusCode).toBe(400);
  });

  it("rechaza un umbral que no es un número", async () => {
    const res = await escribirUmbrales({
      ...VALORES_INICIALES,
      cpiWarning: "muy alto",
    } as unknown as Record<string, number>);
    expect(res.statusCode).toBe(400);
  });

  // ── EL DEFECTO QUE SE CORRIGE, de punta a punta ───────────────────────────

  it("un proyecto con CPI 0,80 sale del API con la celda y el semáforo de acuerdo", async () => {
    const { fila, thresholds } = await filaPortafolio();

    expect(fila.evm.cpi).toBe(0.8);
    // La celda: el veredicto lo calcula el servidor, el cliente solo lo pinta.
    expect(fila.cpiLevel).toBe("warning");
    // El semáforo de esa MISMA fila.
    expect(fila.healthStatus).toBe("YELLOW");
    // Y los umbrales con que se decidió viajan en la respuesta, para el tooltip.
    expect(thresholds).toMatchObject(VALORES_INICIALES);

    // ANTES: la celda usaba `< 0,85` → la habría pintado de rojo mientras el
    // semáforo de la fila decía ámbar. Esta es la contradicción que ya no cabe.
    expect(fila.evm.cpi < 0.85).toBe(true);
  });

  it("cambiar el umbral por la API cambia el veredicto, sin tocar código", async () => {
    // El criterio exigente que pedía la pantalla vieja.
    const res = await escribirUmbrales({
      ...VALORES_INICIALES,
      cpiWarning: 1,
      cpiCritical: 0.85,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.origen).toBe("base");

    const { fila, thresholds } = await filaPortafolio();
    expect(thresholds.cpiCritical).toBe(0.85);
    // El mismo CPI 0,80 que antes era advertencia ahora es crítico…
    expect(fila.cpiLevel).toBe("critical");
    // …y el semáforo se mueve CON él, que es lo que antes no pasaba.
    expect(fila.healthStatus).toBe("RED");

    // Volver a lo acordado deja el proyecto como estaba.
    expect((await escribirUmbrales(VALORES_INICIALES)).statusCode).toBe(200);
    const vuelta = await filaPortafolio();
    expect(vuelta.fila.cpiLevel).toBe("warning");
    expect(vuelta.fila.healthStatus).toBe("YELLOW");
  });

  it("la escritura deja rastro en la bitácora de auditoría", async () => {
    await escribirUmbrales({ ...VALORES_INICIALES, spiWarning: 0.88 });
    const registros = await prisma.auditLog.findMany({
      where: { entity: "healthThresholdConfig" },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    expect(registros).toHaveLength(1);
    expect(registros[0]!.action).toBe("UPDATE");
    await escribirUmbrales(VALORES_INICIALES);
  });

  // ── Base sin sembrar ──────────────────────────────────────────────────────

  it("sin fila sembrada el API lo dice y sigue calculando con los valores del código", async () => {
    const borrado = await app.inject({
      method: "DELETE",
      url: "/api/health-thresholds",
      headers: comoRol(AppRole.ADMIN),
    });
    expect(borrado.statusCode).toBe(204);

    const res = await app.inject({
      method: "GET",
      url: "/api/health-thresholds",
      headers: comoRol(AppRole.ADMIN),
    });
    const data = res.json().data;
    // No se hace pasar por configuración: dice de dónde salen los números.
    expect(data.origen).toBe("codigo");
    expect(data).toMatchObject(VALORES_INICIALES);

    // Y el portafolio sigue dando el mismo veredicto, no una tabla rota.
    const { fila } = await filaPortafolio();
    expect(fila.cpiLevel).toBe("warning");
    expect(fila.healthStatus).toBe("YELLOW");

    // Borrar dos veces es 404, no un 500.
    const otra = await app.inject({
      method: "DELETE",
      url: "/api/health-thresholds",
      headers: comoRol(AppRole.ADMIN),
    });
    expect(otra.statusCode).toBe(404);

    // Y volver a escribir la recrea.
    expect((await escribirUmbrales(VALORES_INICIALES)).statusCode).toBe(200);
  });

  // ── Convivencia con el umbral por proyecto ────────────────────────────────

  it("el umbral de presupuesto del proyecto manda sobre el general", async () => {
    // General al 90 %, el proyecto al 40 %: con un consumo del 50 % el proyecto
    // ya debe estar en aviso aunque el general no se haya alcanzado.
    await prisma.project.update({ where: { id: proyectoId }, data: { budgetAlertPct: 40 } });
    const propio = await filaPortafolio();
    expect(propio.fila.usedBudgetPercent).toBe(50);
    expect(propio.fila.budgetAlertPct).toBe(40);
    expect(propio.fila.budgetUseLevel).toBe("warning");

    // Vaciarlo lo devuelve a heredar el general (90 %): 50 % vuelve a estar bien.
    await prisma.project.update({ where: { id: proyectoId }, data: { budgetAlertPct: null } });
    const heredado = await filaPortafolio();
    expect(heredado.fila.budgetAlertPct).toBe(90);
    expect(heredado.fila.budgetUseLevel).toBe("ok");

    // Y si la empresa baja el general al 30 %, el proyecto que hereda lo sigue.
    await escribirUmbrales({ ...VALORES_INICIALES, budgetWarningPct: 30 });
    const sigueAlGeneral = await filaPortafolio();
    expect(sigueAlGeneral.fila.budgetAlertPct).toBe(30);
    expect(sigueAlGeneral.fila.budgetUseLevel).toBe("warning");

    await escribirUmbrales(VALORES_INICIALES);
  });
});

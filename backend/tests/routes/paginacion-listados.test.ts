import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/infra/prisma.js";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";
import { crearEscenarioBasico, crearHoraExtra, limpiarEscenario, type EscenarioBasico } from "../helpers/datos.js";

/**
 * PAGINACIÓN DE LOS LISTADOS QUE CRECEN CON EL USO.
 *
 * `/api/time-entries`, `/api/extra-hours` y `/api/financial-entries` siguen el
 * mismo contrato que estrenó `/api/audit`:
 *
 *   query:  page (entero > 0, por defecto 1)
 *           pageSize (entero > 0, máximo 100, por defecto 50)
 *   salida: { data: [...], meta: { total, page, pageSize, totalPages } }
 *
 * Lo que se fija aquí, además del contrato:
 *
 *   - El **alcance por rol manda sobre la paginación**: `meta.total` es el total
 *     que ese usuario puede ver, no el de la tabla. Si fuera el de la tabla, el
 *     contador filtraría cuántas filas hay de gente ajena.
 *   - El orden es **estable**: con varias filas en la misma fecha, recorrer las
 *     páginas devuelve cada fila exactamente una vez.
 *   - Pedir una página fuera de rango devuelve 200 con la lista vacía, no un
 *     error ni una excepción.
 */

/** Recorre todas las páginas de una URL y devuelve los ids en orden. */
async function recorrerPaginas(
  app: FastifyInstance,
  url: string,
  headers: Record<string, string>,
  pageSize: number,
): Promise<string[]> {
  const ids: string[] = [];
  let page = 1;
  for (let vuelta = 0; vuelta < 50; vuelta += 1) {
    const separador = url.includes("?") ? "&" : "?";
    const res = await app.inject({
      method: "GET",
      url: `${url}${separador}page=${page}&pageSize=${pageSize}`,
      headers,
    });
    expect(res.statusCode).toBe(200);
    const cuerpo = res.json() as { data: Array<{ id: string }>; meta: { totalPages: number } };
    ids.push(...cuerpo.data.map((fila) => fila.id));
    if (cuerpo.data.length === 0 || page >= cuerpo.meta.totalPages) break;
    page += 1;
  }
  return ids;
}

describe("GET /api/time-entries: paginación", () => {
  let app: FastifyInstance;
  let escenario: EscenarioBasico;

  /** 12 horas de A y 5 de B, todas en el mismo proyecto. */
  const HORAS_A = 12;
  const HORAS_B = 5;
  const TOTAL = HORAS_A + HORAS_B;

  beforeAll(async () => {
    app = await crearAppDePrueba();
    escenario = await crearEscenarioBasico("pag-te");

    // Las fechas se repiten a propósito (tres filas por día): sin un desempate
    // estable en el `orderBy`, recorrer las páginas podría repetir o perder
    // filas. La prueba de ids únicos es la que vigila eso.
    for (let i = 0; i < HORAS_A; i += 1) {
      await prisma.timeEntry.create({
        data: {
          projectId: escenario.projectId,
          consultantId: escenario.consultorA.id,
          workDate: new Date(Date.UTC(2026, 4, 1 + Math.floor(i / 3))),
          hours: 1 + (i % 4),
        },
      });
    }
    for (let i = 0; i < HORAS_B; i += 1) {
      await prisma.timeEntry.create({
        data: {
          projectId: escenario.projectId,
          consultantId: escenario.consultorB.id,
          workDate: new Date(Date.UTC(2026, 4, 1 + Math.floor(i / 3))),
          hours: 2,
        },
      });
    }
  });

  afterAll(async () => {
    await limpiarEscenario(escenario);
    await app.close();
  });

  const comoAdmin = () => comoRol(AppRole.ADMIN);
  const urlProyecto = () => `/api/time-entries?projectId=${escenario.projectId}`;

  it("la primera página devuelve exactamente el tamaño pedido y el meta correcto", async () => {
    const res = await app.inject({
      method: "GET",
      url: `${urlProyecto()}&pageSize=5`,
      headers: comoAdmin(),
    });

    expect(res.statusCode).toBe(200);
    const cuerpo = res.json();
    expect(cuerpo.data).toHaveLength(5);
    expect(cuerpo.meta).toEqual({
      total: TOTAL,
      page: 1,
      pageSize: 5,
      totalPages: Math.ceil(TOTAL / 5),
    });
  });

  it("la última página devuelve solo el resto", async () => {
    const ultima = Math.ceil(TOTAL / 5);
    const res = await app.inject({
      method: "GET",
      url: `${urlProyecto()}&pageSize=5&page=${ultima}`,
      headers: comoAdmin(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(TOTAL % 5 === 0 ? 5 : TOTAL % 5);
  });

  it("sin pageSize usa 50 por defecto, igual que /api/audit", async () => {
    const res = await app.inject({ method: "GET", url: urlProyecto(), headers: comoAdmin() });

    expect(res.statusCode).toBe(200);
    expect(res.json().meta.pageSize).toBe(50);
    expect(res.json().meta.page).toBe(1);
  });

  it("un pageSize por encima del tope (100) se rechaza con 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: `${urlProyecto()}&pageSize=101`,
      headers: comoAdmin(),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe("Validation error");
  });

  it("el tope exacto (100) sí se acepta", async () => {
    const res = await app.inject({
      method: "GET",
      url: `${urlProyecto()}&pageSize=100`,
      headers: comoAdmin(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().meta.pageSize).toBe(100);
  });

  it("page=0 y pageSize=0 se rechazan: la paginación empieza en 1", async () => {
    const cero = await app.inject({
      method: "GET",
      url: `${urlProyecto()}&page=0`,
      headers: comoAdmin(),
    });
    expect(cero.statusCode).toBe(400);

    const tamanoCero = await app.inject({
      method: "GET",
      url: `${urlProyecto()}&pageSize=0`,
      headers: comoAdmin(),
    });
    expect(tamanoCero.statusCode).toBe(400);
  });

  it("pedir una página fuera de rango no revienta: 200 con la lista vacía", async () => {
    const res = await app.inject({
      method: "GET",
      url: `${urlProyecto()}&pageSize=5&page=999`,
      headers: comoAdmin(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
    // El total sigue siendo el real: la pantalla puede decir "página 999 de 4".
    expect(res.json().meta.total).toBe(TOTAL);
  });

  it("recorrer las páginas devuelve cada fila una sola vez (orden estable)", async () => {
    const ids = await recorrerPaginas(app, urlProyecto(), comoAdmin(), 4);

    expect(ids).toHaveLength(TOTAL);
    expect(new Set(ids).size).toBe(TOTAL);
  });

  it("el meta.total de un CONSULTANT cuenta SOLO sus horas, no las de la tabla", async () => {
    const res = await app.inject({
      method: "GET",
      url: `${urlProyecto()}&pageSize=100`,
      headers: comoRol(AppRole.CONSULTANT, escenario.consultorA.email),
    });

    expect(res.statusCode).toBe(200);
    const cuerpo = res.json();

    // 12, no 17: el contador no puede delatar cuántas horas tienen los demás.
    expect(cuerpo.meta.total).toBe(HORAS_A);
    expect(cuerpo.data).toHaveLength(HORAS_A);
    const ajenas = (cuerpo.data as Array<{ consultantId: string }>).filter(
      (fila) => fila.consultantId === escenario.consultorB.id,
    );
    expect(ajenas).toHaveLength(0);
  });

  it("el meta.total de un CONSULTANT tampoco delata nada si la página es pequeña", async () => {
    const res = await app.inject({
      method: "GET",
      url: `${urlProyecto()}&pageSize=2`,
      headers: comoRol(AppRole.CONSULTANT, escenario.consultorA.email),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(2);
    expect(res.json().meta.total).toBe(HORAS_A);
    expect(res.json().meta.totalPages).toBe(Math.ceil(HORAS_A / 2));
  });

  it("el filtro por estado se combina con la paginación y el total lo respeta", async () => {
    const res = await app.inject({
      method: "GET",
      url: `${urlProyecto()}&status=APPROVED&pageSize=5`,
      headers: comoAdmin(),
    });

    expect(res.statusCode).toBe(200);
    // Ninguna se ha aprobado en este escenario.
    expect(res.json().meta.total).toBe(0);
    expect(res.json().data).toEqual([]);
  });
});

describe("GET /api/extra-hours: paginación", () => {
  let app: FastifyInstance;
  let escenario: EscenarioBasico;

  const EXTRA_A = 8;
  const EXTRA_B = 3;
  const TOTAL = EXTRA_A + EXTRA_B;

  beforeAll(async () => {
    app = await crearAppDePrueba();
    escenario = await crearEscenarioBasico("pag-eh");

    for (let i = 0; i < EXTRA_A; i += 1) {
      await crearHoraExtra({
        consultantId: escenario.consultorA.id,
        projectId: escenario.projectId,
        fecha: new Date(Date.UTC(2026, 5, 1 + Math.floor(i / 3))),
      });
    }
    for (let i = 0; i < EXTRA_B; i += 1) {
      await crearHoraExtra({
        consultantId: escenario.consultorB.id,
        projectId: escenario.projectId,
        fecha: new Date(Date.UTC(2026, 5, 1 + Math.floor(i / 3))),
      });
    }
  });

  afterAll(async () => {
    await limpiarEscenario(escenario);
    await app.close();
  });

  it("la primera página devuelve el tamaño pedido y el total del filtro", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/extra-hours?consultantId=${escenario.consultorA.id}&pageSize=3`,
      headers: comoRol(AppRole.ADMIN),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(3);
    expect(res.json().meta).toEqual({
      total: EXTRA_A,
      page: 1,
      pageSize: 3,
      totalPages: Math.ceil(EXTRA_A / 3),
    });
  });

  it("un pageSize por encima del tope se rechaza con 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/extra-hours?pageSize=101",
      headers: comoRol(AppRole.ADMIN),
    });

    expect(res.statusCode).toBe(400);
  });

  it("una página fuera de rango devuelve 200 con la lista vacía", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/extra-hours?consultantId=${escenario.consultorA.id}&pageSize=3&page=50`,
      headers: comoRol(AppRole.ADMIN),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
    expect(res.json().meta.total).toBe(EXTRA_A);
  });

  it("recorrer las páginas devuelve cada solicitud una sola vez", async () => {
    const ids = await recorrerPaginas(
      app,
      `/api/extra-hours?consultantId=${escenario.consultorA.id}`,
      comoRol(AppRole.ADMIN),
      2,
    );

    expect(ids).toHaveLength(EXTRA_A);
    expect(new Set(ids).size).toBe(EXTRA_A);
  });

  it("el meta.total de un CONSULTANT cuenta SOLO sus solicitudes", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/extra-hours?pageSize=100",
      headers: comoRol(AppRole.CONSULTANT, escenario.consultorA.email),
    });

    expect(res.statusCode).toBe(200);
    const cuerpo = res.json();

    // 8, no 11: las 3 de B no entran ni en las filas ni en el contador.
    expect(cuerpo.meta.total).toBe(EXTRA_A);
    const ajenas = (cuerpo.data as Array<{ consultantId: string }>).filter(
      (fila) => fila.consultantId === escenario.consultorB.id,
    );
    expect(ajenas).toHaveLength(0);
  });

  it("un CONSULTANT que filtra por el id de otro no recibe filas ni total", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/extra-hours?consultantId=${escenario.consultorB.id}`,
      headers: comoRol(AppRole.CONSULTANT, escenario.consultorA.email),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
    // El filtro se acumula sobre el alcance; no lo amplía.
    expect(res.json().meta.total).toBe(0);
  });

  it("el filtro por estado se combina con la paginación", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/extra-hours?consultantId=${escenario.consultorA.id}&status=PENDING_PM&pageSize=5`,
      headers: comoRol(AppRole.ADMIN),
    });

    expect(res.statusCode).toBe(200);
    // `crearHoraExtra` deja las filas en el estado por defecto, PENDING_PM.
    expect(res.json().meta.total).toBe(EXTRA_A);
    expect(res.json().data).toHaveLength(5);
  });

  it("un estado inexistente se rechaza con 400 en vez de ignorarse", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/extra-hours?status=INVENTADO",
      headers: comoRol(AppRole.ADMIN),
    });

    expect(res.statusCode).toBe(400);
  });
});

describe("GET /api/financial-entries: paginación", () => {
  let app: FastifyInstance;
  let escenario: EscenarioBasico;

  const MOVIMIENTOS = 7;

  beforeAll(async () => {
    app = await crearAppDePrueba();
    escenario = await crearEscenarioBasico("pag-fe");

    for (let i = 0; i < MOVIMIENTOS; i += 1) {
      await prisma.financialEntry.create({
        data: {
          projectId: escenario.projectId,
          type: i % 2 === 0 ? "EXPENSE" : "REVENUE",
          // Fechas repetidas a propósito, para ejercitar el orden estable.
          entryDate: new Date(Date.UTC(2026, 6, 1 + Math.floor(i / 3))),
          amount: 100 + i,
          currency: "USD",
          description: `Movimiento ${i}`,
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.financialEntry.deleteMany({ where: { projectId: escenario.projectId } });
    await limpiarEscenario(escenario);
    await app.close();
  });

  const urlProyecto = () => `/api/financial-entries?projectId=${escenario.projectId}`;

  it("la primera página devuelve el tamaño pedido y el meta correcto", async () => {
    const res = await app.inject({
      method: "GET",
      url: `${urlProyecto()}&pageSize=3`,
      headers: comoRol(AppRole.FINANCE),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(3);
    expect(res.json().meta).toEqual({
      total: MOVIMIENTOS,
      page: 1,
      pageSize: 3,
      totalPages: Math.ceil(MOVIMIENTOS / 3),
    });
  });

  it("un pageSize por encima del tope se rechaza con 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: `${urlProyecto()}&pageSize=101`,
      headers: comoRol(AppRole.FINANCE),
    });

    expect(res.statusCode).toBe(400);
  });

  it("una página fuera de rango devuelve 200 con la lista vacía", async () => {
    const res = await app.inject({
      method: "GET",
      url: `${urlProyecto()}&pageSize=3&page=99`,
      headers: comoRol(AppRole.FINANCE),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
    expect(res.json().meta.total).toBe(MOVIMIENTOS);
  });

  it("recorrer las páginas devuelve cada movimiento una sola vez", async () => {
    const ids = await recorrerPaginas(app, urlProyecto(), comoRol(AppRole.FINANCE), 2);

    expect(ids).toHaveLength(MOVIMIENTOS);
    expect(new Set(ids).size).toBe(MOVIMIENTOS);
  });

  it("el filtro por tipo se combina con la paginación y el total lo respeta", async () => {
    const res = await app.inject({
      method: "GET",
      url: `${urlProyecto()}&type=REVENUE&pageSize=2`,
      headers: comoRol(AppRole.FINANCE),
    });

    expect(res.statusCode).toBe(200);
    // Los índices impares son REVENUE: 1, 3 y 5.
    expect(res.json().meta.total).toBe(3);
    expect(res.json().data).toHaveLength(2);
  });
});

import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/infra/prisma.js";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";

/**
 * Categorías de ingreso configurables (decisión de negocio D-4).
 *
 * Lo que no puede comprobar una prueba pura: que el catálogo se escribe y se lee
 * por la API, que **solo ADMIN** puede editarlo, que un ingreso viaja con su
 * categoría de ida y vuelta, que los ingresos antiguos sin categoría siguen
 * funcionando, y que los gastos no cambiaron de comportamiento.
 *
 * Todo lo que crea la prueba lleva un prefijo propio y se borra al final; el
 * catálogo sembrado por la migración no se toca.
 */
describe("Categorías de ingreso configurables (D-4)", () => {
  let app: FastifyInstance;

  const prefijo = `catd4-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let proyectoId = "";
  const categoriasCreadas: string[] = [];
  const movimientosCreados: string[] = [];

  async function crearCategoria(payload: Record<string, unknown>, rol: AppRole = AppRole.ADMIN) {
    const res = await app.inject({
      method: "POST",
      url: "/api/financial-categories",
      headers: comoRol(rol),
      payload,
    });
    if (res.statusCode === 201) categoriasCreadas.push(res.json().data.id);
    return res;
  }

  beforeAll(async () => {
    app = await crearAppDePrueba();

    proyectoId = (
      await prisma.project.create({
        data: {
          name: `Proyecto ${prefijo}`,
          company: "Synaptica",
          country: "Colombia",
          budget: 100000,
          status: "ACTIVE",
          currency: "USD",
          startDate: new Date("2026-01-01T00:00:00.000Z"),
          endDate: new Date("2026-12-31T00:00:00.000Z"),
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.financialEntry.deleteMany({ where: { projectId: proyectoId } });
    await prisma.project.deleteMany({ where: { id: proyectoId } });
    await prisma.financialCategory.deleteMany({ where: { id: { in: categoriasCreadas } } });
    await prisma.financialEntry.deleteMany({ where: { id: { in: movimientosCreados } } });
    await app.close();
  });

  // ── La siembra acordada ───────────────────────────────────────────────────

  it("de salida hay exactamente dos categorías genéricas de ingreso", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/financial-categories?type=REVENUE",
      headers: comoRol(AppRole.ADMIN),
    });

    expect(res.statusCode).toBe(200);
    const nombres: string[] = res.json().data.map((c: { name: string }) => c.name);
    expect(nombres).toContain("Servicios de consultoría");
    expect(nombres).toContain("Otros ingresos");
  });

  it("las siete categorías de gasto que vivían en el frontend están en el catálogo", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/financial-categories?type=EXPENSE",
      headers: comoRol(AppRole.ADMIN),
    });

    expect(res.statusCode).toBe(200);
    const nombres: string[] = res.json().data.map((c: { name: string }) => c.name);
    for (const esperada of [
      "Viajes",
      "Alojamiento",
      "Alimentacion",
      "Transporte",
      "Software",
      "Servicios",
      "Otros",
    ]) {
      expect(nombres).toContain(esperada);
    }
  });

  // ── Un ingreso con su categoría, de ida y vuelta ──────────────────────────

  it("un ingreso se crea con categoría y se lee con ella", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/revenue",
      headers: comoRol(AppRole.ADMIN),
      payload: {
        projectId: proyectoId,
        entryDate: "2026-03-10",
        amount: 1500,
        currency: "USD",
        category: "Servicios de consultoría",
        description: `Ingreso ${prefijo}`,
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().data.category).toBe("Servicios de consultoría");
    movimientosCreados.push(res.json().data.id);

    const listado = await app.inject({
      method: `GET`,
      url: `/api/revenue?projectId=${proyectoId}`,
      headers: comoRol(AppRole.ADMIN),
    });

    const creado = listado
      .json()
      .data.find((e: { id: string }) => e.id === res.json().data.id);
    expect(creado.category).toBe("Servicios de consultoría");
  });

  it("acepta la categoría escrita con otras mayúsculas y la guarda canónica", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/revenue",
      headers: comoRol(AppRole.ADMIN),
      payload: {
        projectId: proyectoId,
        entryDate: "2026-03-11",
        amount: 100,
        currency: "USD",
        category: "otros INGRESOS",
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().data.category).toBe("Otros ingresos");
    movimientosCreados.push(res.json().data.id);
  });

  it("rechaza una categoría que no está en el catálogo", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/revenue",
      headers: comoRol(AppRole.ADMIN),
      payload: {
        projectId: proyectoId,
        entryDate: "2026-03-12",
        amount: 100,
        currency: "USD",
        category: "Categoría inventada",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain("no existe");
  });

  it("rechaza una categoría desactivada", async () => {
    const creada = await crearCategoria({
      type: "REVENUE",
      name: `Retenida ${prefijo}`,
      active: false,
    });
    expect(creada.statusCode).toBe(201);

    const res = await app.inject({
      method: "POST",
      url: "/api/revenue",
      headers: comoRol(AppRole.ADMIN),
      payload: {
        projectId: proyectoId,
        entryDate: "2026-03-13",
        amount: 100,
        currency: "USD",
        category: `Retenida ${prefijo}`,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain("desactivada");
  });

  // ── Los ingresos anteriores a D-4 ─────────────────────────────────────────

  it("un ingreso sin categoría sigue creándose y se lee con category nula", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/revenue",
      headers: comoRol(AppRole.ADMIN),
      payload: {
        projectId: proyectoId,
        entryDate: "2026-02-01",
        amount: 900,
        currency: "USD",
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().data.category).toBeNull();
    movimientosCreados.push(res.json().data.id);
  });

  it("un ingreso antiguo sin categoría se puede editar sin obligar a elegir una", async () => {
    // Escrito directamente en la base, como los que ya existen en producción.
    const antiguo = await prisma.financialEntry.create({
      data: {
        projectId: proyectoId,
        type: "REVENUE",
        entryDate: new Date("2025-11-15T00:00:00.000Z"),
        amount: 500,
        currency: "USD",
        category: null,
      },
    });
    movimientosCreados.push(antiguo.id);

    const res = await app.inject({
      method: "PUT",
      url: `/api/revenue/${antiguo.id}`,
      headers: comoRol(AppRole.ADMIN),
      payload: {
        projectId: proyectoId,
        entryDate: "2025-11-15",
        amount: 650,
        currency: "USD",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.category).toBeNull();
    expect(Number(res.json().data.amount)).toBe(650);
  });

  it("a un ingreso antiguo se le puede poner categoría después", async () => {
    const antiguo = await prisma.financialEntry.create({
      data: {
        projectId: proyectoId,
        type: "REVENUE",
        entryDate: new Date("2025-10-01T00:00:00.000Z"),
        amount: 300,
        currency: "USD",
        category: null,
      },
    });
    movimientosCreados.push(antiguo.id);

    const res = await app.inject({
      method: "PUT",
      url: `/api/revenue/${antiguo.id}`,
      headers: comoRol(AppRole.ADMIN),
      payload: {
        projectId: proyectoId,
        entryDate: "2025-10-01",
        amount: 300,
        currency: "USD",
        category: "Otros ingresos",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.category).toBe("Otros ingresos");
  });

  // ── Los gastos no cambian ─────────────────────────────────────────────────

  it("un gasto se sigue creando con su categoría como siempre", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/expenses",
      headers: comoRol(AppRole.ADMIN),
      payload: {
        projectId: proyectoId,
        expenseDate: "2026-03-10",
        category: "Viajes",
        amount: 250,
        currency: "USD",
        description: `Gasto ${prefijo}`,
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().data.category).toBe("Viajes");
    expect(res.json().data.expenseDate).toBeTruthy();
    movimientosCreados.push(res.json().data.id);
  });

  it("el backend de gastos sigue aceptando texto libre: su contrato no cambió", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/expenses",
      headers: comoRol(AppRole.ADMIN),
      payload: {
        projectId: proyectoId,
        expenseDate: "2026-03-11",
        category: `Categoría suelta ${prefijo}`,
        amount: 10,
        currency: "USD",
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().data.category).toBe(`Categoría suelta ${prefijo}`);
    movimientosCreados.push(res.json().data.id);
  });

  // ── Quién puede editar el catálogo ────────────────────────────────────────

  it("solo ADMIN puede crear una categoría", async () => {
    for (const rol of [AppRole.PM, AppRole.FINANCE, AppRole.CONSULTANT, AppRole.VIEWER]) {
      const res = await crearCategoria(
        { type: "REVENUE", name: `Intento ${rol} ${prefijo}` },
        rol,
      );
      expect(res.statusCode, `rol ${rol} no debería poder crear`).toBe(403);
    }

    const admin = await crearCategoria({ type: "REVENUE", name: `Nueva ${prefijo}` });
    expect(admin.statusCode).toBe(201);
  });

  it("cualquier rol autenticado puede leer el catálogo (lo necesita el formulario)", async () => {
    for (const rol of [
      AppRole.ADMIN,
      AppRole.PM,
      AppRole.FINANCE,
      AppRole.CONSULTANT,
      AppRole.VIEWER,
    ]) {
      const res = await app.inject({
        method: "GET",
        url: "/api/financial-categories?type=REVENUE",
        headers: comoRol(rol),
      });
      expect(res.statusCode, `rol ${rol} debería poder leer`).toBe(200);
    }
  });

  // El 401 sin token no se comprueba aquí: esta suite corre en modo demo, donde
  // `authenticate` inyecta un admin local. La regla general —toda ruta protegida
  // responde 401 sin bearer— la cubre `auth-requerida.test.ts`, que reconstruye
  // la app con autenticación real. Lo que sí se comprueba aquí es que el permiso
  // que gobierna la visibilidad de la pantalla sea exclusivo de ADMIN.
  it("`finance:categories` solo lo tiene ADMIN en la matriz de permisos", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/permissions",
      headers: comoRol(AppRole.ADMIN),
    });

    const matriz: Record<string, string[]> = res.json().data;
    expect(matriz.ADMIN).toContain("finance:categories");
    for (const rol of ["PM", "FINANCE", "CONSULTANT", "VIEWER"]) {
      expect(matriz[rol], `${rol} no debería ver la pantalla`).not.toContain("finance:categories");
    }
  });

  // ── Editar el catálogo de verdad ──────────────────────────────────────────

  it("una categoría nueva queda disponible para registrar ingresos", async () => {
    const nombre = `Licencias ${prefijo}`;
    const creada = await crearCategoria({ type: "REVENUE", name: nombre });
    expect(creada.statusCode).toBe(201);

    const res = await app.inject({
      method: "POST",
      url: "/api/revenue",
      headers: comoRol(AppRole.ADMIN),
      payload: {
        projectId: proyectoId,
        entryDate: "2026-04-01",
        amount: 700,
        currency: "USD",
        category: nombre,
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().data.category).toBe(nombre);
    movimientosCreados.push(res.json().data.id);
  });

  it("renombrar una categoría arrastra los ingresos que ya la usaban", async () => {
    const nombre = `Soporte ${prefijo}`;
    const creada = await crearCategoria({ type: "REVENUE", name: nombre });
    const categoriaId = creada.json().data.id;

    const ingreso = await app.inject({
      method: "POST",
      url: "/api/revenue",
      headers: comoRol(AppRole.ADMIN),
      payload: {
        projectId: proyectoId,
        entryDate: "2026-04-02",
        amount: 450,
        currency: "USD",
        category: nombre,
      },
    });
    const ingresoId = ingreso.json().data.id;
    movimientosCreados.push(ingresoId);

    const nuevoNombre = `Soporte y mantenimiento ${prefijo}`;
    const renombrada = await app.inject({
      method: "PUT",
      url: `/api/financial-categories/${categoriaId}`,
      headers: comoRol(AppRole.ADMIN),
      payload: { name: nuevoNombre },
    });

    expect(renombrada.statusCode).toBe(200);
    expect(renombrada.json().data.movimientosRenombrados).toBe(1);

    const tras = await prisma.financialEntry.findUnique({ where: { id: ingresoId } });
    expect(tras?.category).toBe(nuevoNombre);
  });

  it("no se puede borrar una categoría en uso, pero sí desactivarla", async () => {
    const nombre = `En uso ${prefijo}`;
    const creada = await crearCategoria({ type: "REVENUE", name: nombre });
    const categoriaId = creada.json().data.id;

    const ingreso = await app.inject({
      method: "POST",
      url: "/api/revenue",
      headers: comoRol(AppRole.ADMIN),
      payload: {
        projectId: proyectoId,
        entryDate: "2026-04-03",
        amount: 120,
        currency: "USD",
        category: nombre,
      },
    });
    movimientosCreados.push(ingreso.json().data.id);

    const borrado = await app.inject({
      method: "DELETE",
      url: `/api/financial-categories/${categoriaId}`,
      headers: comoRol(AppRole.ADMIN),
    });
    expect(borrado.statusCode).toBe(409);

    const desactivada = await app.inject({
      method: "PUT",
      url: `/api/financial-categories/${categoriaId}`,
      headers: comoRol(AppRole.ADMIN),
      payload: { active: false },
    });
    expect(desactivada.statusCode).toBe(200);
    expect(desactivada.json().data.active).toBe(false);

    // Desactivada ya no aparece en el desplegable...
    const activas = await app.inject({
      method: "GET",
      url: "/api/financial-categories?type=REVENUE",
      headers: comoRol(AppRole.ADMIN),
    });
    expect(activas.json().data.map((c: { id: string }) => c.id)).not.toContain(categoriaId);

    // ...pero sigue estando para la pantalla de administración.
    const todas = await app.inject({
      method: "GET",
      url: "/api/financial-categories?type=REVENUE&includeInactive=true",
      headers: comoRol(AppRole.ADMIN),
    });
    expect(todas.json().data.map((c: { id: string }) => c.id)).toContain(categoriaId);
  });

  it("una categoría sin uso sí se puede borrar", async () => {
    const creada = await crearCategoria({ type: "REVENUE", name: `Efímera ${prefijo}` });
    const categoriaId = creada.json().data.id;

    const res = await app.inject({
      method: "DELETE",
      url: `/api/financial-categories/${categoriaId}`,
      headers: comoRol(AppRole.ADMIN),
    });
    expect(res.statusCode).toBe(204);
  });

  it("no se admiten dos categorías con el mismo nombre en el mismo tipo", async () => {
    const nombre = `Duplicada ${prefijo}`;
    expect((await crearCategoria({ type: "REVENUE", name: nombre })).statusCode).toBe(201);

    const repetida = await crearCategoria({ type: "REVENUE", name: nombre.toUpperCase() });
    expect(repetida.statusCode).toBe(409);
  });

  it("el mismo nombre sí puede existir en gasto y en ingreso", async () => {
    const nombre = `Ambivalente ${prefijo}`;
    expect((await crearCategoria({ type: "REVENUE", name: nombre })).statusCode).toBe(201);
    expect((await crearCategoria({ type: "EXPENSE", name: nombre })).statusCode).toBe(201);
  });

  it("escribir en el catálogo deja rastro en la bitácora", async () => {
    const creada = await crearCategoria({ type: "REVENUE", name: `Auditada ${prefijo}` });
    const categoriaId = creada.json().data.id;

    const registros = await prisma.auditLog.findMany({
      where: { entity: "financialCategory", entityId: categoriaId },
    });

    expect(registros.length).toBeGreaterThanOrEqual(1);
    expect(registros[0].action).toBe("CREATE");
    expect(registros[0].changedBy).toBeTruthy();
  });
});

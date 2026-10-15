import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/infra/prisma.js";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";

/**
 * R-010: categoría de proyecto, como lista desplegable con opción de
 * personalizar. No existe ninguna pantalla de administración para el
 * catálogo (`ProjectCategory`): una categoría nueva escrita en el formulario
 * de un proyecto se agrega sola, sin distinguir mayúsculas, para que el
 * desplegable se pueda "personalizar" sin desplegar código.
 */
describe("Categoría de proyecto (R-010)", () => {
  let app: FastifyInstance;
  const proyectosCreados: string[] = [];
  const categoriasCreadas: string[] = [];

  const cuerpoBase = {
    name: "Proyecto Categoría",
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
    await prisma.projectCategory.deleteMany({ where: { id: { in: categoriasCreadas } } });
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

  it("un proyecto sin categoría sigue siendo válido", async () => {
    const res = await crearProyecto({});
    expect(res.statusCode).toBe(201);
    expect(res.json().data.category).toBeNull();
  });

  it("el campo vacío del formulario se guarda como null, no como cadena vacía", async () => {
    const res = await crearProyecto({ category: "" });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.category).toBeNull();
  });

  it("una categoría nueva se agrega sola al catálogo", async () => {
    const nombre = `Migración a la nube ${Date.now()}`;
    const res = await crearProyecto({ category: nombre });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.category).toBe(nombre);

    const enCatalogo = await prisma.projectCategory.findFirst({ where: { name: nombre } });
    expect(enCatalogo).not.toBeNull();
    categoriasCreadas.push(enCatalogo!.id);

    const lista = await app.inject({
      method: "GET",
      url: "/api/project-categories",
      headers: comoRol(AppRole.VIEWER, "viewer@synaptica.test"),
    });
    expect(lista.statusCode).toBe(200);
    const nombres = (lista.json().data as Array<{ name: string }>).map((c) => c.name);
    expect(nombres).toContain(nombre);
  });

  it("reusar la misma categoría con otra mayúscula no crea una fila duplicada", async () => {
    const nombre = `Soporte ${Date.now()}`;
    const primero = await crearProyecto({ category: nombre });
    expect(primero.statusCode).toBe(201);

    const segundo = await crearProyecto({ category: nombre.toUpperCase() });
    expect(segundo.statusCode).toBe(201);
    // Se resuelve al nombre YA guardado en el catálogo, no al que mandó el segundo formulario.
    expect(segundo.json().data.category).toBe(nombre);

    const filas = await prisma.projectCategory.findMany({ where: { name: { equals: nombre, mode: "insensitive" } } });
    expect(filas).toHaveLength(1);
    categoriasCreadas.push(filas[0]!.id);
  });

  it("se puede cambiar y desasignar la categoría con PUT", async () => {
    const nombreA = `Consultoría ${Date.now()}`;
    const creado = await crearProyecto({ category: nombreA });
    const id = creado.json().data.id as string;
    categoriasCreadas.push((await prisma.projectCategory.findFirstOrThrow({ where: { name: nombreA } })).id);

    const nombreB = `Staffing ${Date.now()}`;
    const cambio = await app.inject({
      method: "PUT",
      url: `/api/projects/${id}`,
      headers: comoRol(AppRole.ADMIN),
      payload: { ...cuerpoBase, category: nombreB },
    });
    expect(cambio.statusCode).toBe(200);
    expect(cambio.json().data.category).toBe(nombreB);
    categoriasCreadas.push((await prisma.projectCategory.findFirstOrThrow({ where: { name: nombreB } })).id);

    const desasigna = await app.inject({
      method: "PUT",
      url: `/api/projects/${id}`,
      headers: comoRol(AppRole.ADMIN),
      payload: { ...cuerpoBase, category: "" },
    });
    expect(desasigna.statusCode).toBe(200);
    expect(desasigna.json().data.category).toBeNull();
  });

  it("omitir el campo en el PUT no toca la categoría ya guardada", async () => {
    const nombre = `Implementación ${Date.now()}`;
    const creado = await crearProyecto({ category: nombre });
    const id = creado.json().data.id as string;
    categoriasCreadas.push((await prisma.projectCategory.findFirstOrThrow({ where: { name: nombre } })).id);

    const sinCategoria = await app.inject({
      method: "PUT",
      url: `/api/projects/${id}`,
      headers: comoRol(AppRole.ADMIN),
      payload: { ...cuerpoBase },
    });
    expect(sinCategoria.statusCode).toBe(200);
    expect(sinCategoria.json().data.category).toBe(nombre);
  });
});

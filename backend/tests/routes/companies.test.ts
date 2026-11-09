import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/infra/prisma.js";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";

/**
 * Catálogo de empresas (clientes de los proyectos) y su efecto en Proyectos:
 * CRUD, unicidad de nombre (sin distinguir mayúsculas) y de NIT, borrado
 * bloqueado con proyectos, validación de la empresa al crear/editar un proyecto
 * y compatibilidad de `company` (string) en las respuestas.
 */
describe("Empresas (catálogo de clientes)", () => {
  let app: FastifyInstance;
  const prefijo = `emp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const empresasCreadas: string[] = [];
  const proyectosCreados: string[] = [];
  const admin = comoRol(AppRole.ADMIN);
  const pm = comoRol(AppRole.PM, `pm.${prefijo}@synaptica.test`);

  beforeAll(async () => {
    app = await crearAppDePrueba();
  });

  afterAll(async () => {
    await prisma.project.deleteMany({ where: { id: { in: proyectosCreados } } });
    await prisma.company.deleteMany({ where: { id: { in: empresasCreadas } } });
    await app.close();
  });

  async function crearEmpresa(payload: Record<string, unknown>, headers = admin) {
    const res = await app.inject({ method: "POST", url: "/api/companies", headers, payload });
    if (res.statusCode === 201) empresasCreadas.push(res.json().data.id as string);
    return res;
  }

  async function crearProyecto(payload: Record<string, unknown>) {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: admin,
      payload: {
        name: `Proyecto ${prefijo} ${Math.random().toString(36).slice(2, 6)}`,
        country: "Colombia",
        currency: "USD",
        budget: 1000,
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        ...payload,
      },
    });
    if (res.statusCode === 201) proyectosCreados.push(res.json().data.id as string);
    return res;
  }

  describe("CRUD", () => {
    it("crea, lee, edita, desactiva y elimina una empresa", async () => {
      const nombre = `Acme ${prefijo}`;
      const creada = await crearEmpresa({
        name: `  ${nombre}  `,
        nit: " 900123456-1 ",
        contactName: "Ana",
        contactEmail: "ana@acme.test",
        contactPhone: "3000000000",
      });
      expect(creada.statusCode).toBe(201);
      const empresa = creada.json().data;
      expect(empresa).toMatchObject({
        name: nombre,
        nit: "900123456-1",
        contactName: "Ana",
        contactEmail: "ana@acme.test",
        active: true,
        projectCount: 0,
      });
      expect(empresa.createdBy).toBeTruthy();

      const lectura = await app.inject({ method: "GET", url: `/api/companies/${empresa.id}`, headers: admin });
      expect(lectura.statusCode).toBe(200);
      expect(lectura.json().data.projects).toEqual([]);

      const edicion = await app.inject({
        method: "PUT",
        url: `/api/companies/${empresa.id}`,
        headers: admin,
        payload: { contactName: "Beto", contactEmail: "" },
      });
      expect(edicion.statusCode).toBe(200);
      expect(edicion.json().data).toMatchObject({ name: nombre, contactName: "Beto", contactEmail: null });

      const desactivada = await app.inject({
        method: "PUT",
        url: `/api/companies/${empresa.id}`,
        headers: admin,
        payload: { active: false },
      });
      expect(desactivada.json().data.active).toBe(false);

      const soloInactivas = await app.inject({ method: "GET", url: "/api/companies?active=false", headers: admin });
      expect(soloInactivas.json().data.some((e: { id: string }) => e.id === empresa.id)).toBe(true);
      const soloActivas = await app.inject({ method: "GET", url: "/api/companies?active=true", headers: admin });
      expect(soloActivas.json().data.some((e: { id: string }) => e.id === empresa.id)).toBe(false);

      const busqueda = await app.inject({ method: "GET", url: `/api/companies?search=${prefijo}`, headers: admin });
      expect(busqueda.json().data.map((e: { id: string }) => e.id)).toContain(empresa.id);

      const borrado = await app.inject({ method: "DELETE", url: `/api/companies/${empresa.id}`, headers: admin });
      expect(borrado.statusCode).toBe(204);
      expect(borrado.body).toBe("");
      const ya = await app.inject({ method: "GET", url: `/api/companies/${empresa.id}`, headers: admin });
      expect(ya.statusCode).toBe(404);
    });

    it("deja rastro en la auditoría", async () => {
      const res = await crearEmpresa({ name: `Auditada ${prefijo}` });
      const id = res.json().data.id as string;
      const log = await prisma.auditLog.findFirst({ where: { entity: "company", entityId: id, action: "CREATE" } });
      expect(log).not.toBeNull();
    });

    it("validaciones: nombre obligatorio, correo inválido, 404 inexistente", async () => {
      expect((await crearEmpresa({ name: "   " })).statusCode).toBe(400);
      expect((await crearEmpresa({ name: `Mala ${prefijo}`, contactEmail: "no-es-correo" })).statusCode).toBe(400);
      const put = await app.inject({ method: "PUT", url: "/api/companies/no-existe", headers: admin, payload: { active: false } });
      expect(put.statusCode).toBe(404);
      const del = await app.inject({ method: "DELETE", url: "/api/companies/no-existe", headers: admin });
      expect(del.statusCode).toBe(404);
    });
  });

  describe("unicidad", () => {
    it("409 si el nombre ya existe con otras mayúsculas (POST y PUT)", async () => {
      const base = await crearEmpresa({ name: `Unica ${prefijo}` });
      expect(base.statusCode).toBe(201);
      const dup = await crearEmpresa({ name: `UNICA ${prefijo}`.toUpperCase() });
      expect(dup.statusCode).toBe(409);
      expect(dup.json().message).toMatch(/nombre/i);

      const otra = await crearEmpresa({ name: `Otra ${prefijo}` });
      const put = await app.inject({
        method: "PUT",
        url: `/api/companies/${otra.json().data.id}`,
        headers: admin,
        payload: { name: `unica ${prefijo}` },
      });
      expect(put.statusCode).toBe(409);
    });

    it("409 si el NIT ya existe; dos empresas sin NIT conviven", async () => {
      const nit = `NIT-${prefijo}`;
      expect((await crearEmpresa({ name: `ConNit1 ${prefijo}`, nit })).statusCode).toBe(201);
      const dup = await crearEmpresa({ name: `ConNit2 ${prefijo}`, nit });
      expect(dup.statusCode).toBe(409);
      expect(dup.json().message).toMatch(/NIT/);

      expect((await crearEmpresa({ name: `SinNit1 ${prefijo}` })).statusCode).toBe(201);
      expect((await crearEmpresa({ name: `SinNit2 ${prefijo}`, nit: "" })).statusCode).toBe(201);
    });

    it("editar una empresa conservando su propio nombre y NIT no es conflicto", async () => {
      const nit = `PROPIO-${prefijo}`;
      const e = await crearEmpresa({ name: `Propia ${prefijo}`, nit });
      const put = await app.inject({
        method: "PUT",
        url: `/api/companies/${e.json().data.id}`,
        headers: admin,
        payload: { name: `Propia ${prefijo}`, nit, contactName: "X" },
      });
      expect(put.statusCode).toBe(200);
    });
  });

  describe("borrado y proyectos", () => {
    it("DELETE con proyectos -> 409 con el conteo, y la empresa sigue ahí; sin proyectos -> 204", async () => {
      const e = await crearEmpresa({ name: `ConProy ${prefijo}` });
      const empresaId = e.json().data.id as string;
      expect((await crearProyecto({ companyId: empresaId })).statusCode).toBe(201);
      expect((await crearProyecto({ companyId: empresaId })).statusCode).toBe(201);

      const del = await app.inject({ method: "DELETE", url: `/api/companies/${empresaId}`, headers: admin });
      expect(del.statusCode).toBe(409);
      expect(del.json().message).toMatch(/2 proyectos/);
      expect(del.json().message).toMatch(/desactiva/i);

      const sigue = await app.inject({ method: "GET", url: `/api/companies/${empresaId}`, headers: admin });
      expect(sigue.statusCode).toBe(200);
      expect(sigue.json().data.projectCount).toBe(2);
      expect(sigue.json().data.projects).toHaveLength(2);

      await prisma.project.deleteMany({ where: { companyId: empresaId } });
      const ok = await app.inject({ method: "DELETE", url: `/api/companies/${empresaId}`, headers: admin });
      expect(ok.statusCode).toBe(204);
    });
  });

  describe("Proyectos con empresa", () => {
    it("POST proyecto: companyId obligatorio, inexistente o inactiva -> 400", async () => {
      expect((await crearProyecto({})).statusCode).toBe(400);
      const inexistente = await crearProyecto({ companyId: "no-existe" });
      expect(inexistente.statusCode).toBe(400);
      expect(inexistente.json().message).toMatch(/no existe/i);

      const e = await crearEmpresa({ name: `Inactiva ${prefijo}`, active: false });
      const inactiva = await crearProyecto({ companyId: e.json().data.id });
      expect(inactiva.statusCode).toBe(400);
      expect(inactiva.json().message).toMatch(/inactiva/i);
    });

    it("la respuesta de proyecto trae company (string) y companyId, en POST, GET, lista y PUT", async () => {
      const nombre = `Cliente ${prefijo}`;
      const e = await crearEmpresa({ name: nombre });
      const empresaId = e.json().data.id as string;

      const creado = await crearProyecto({ companyId: empresaId });
      expect(creado.statusCode).toBe(201);
      const p = creado.json().data;
      expect(p.company).toBe(nombre);
      expect(p.companyId).toBe(empresaId);

      const uno = await app.inject({ method: "GET", url: `/api/projects/${p.id}`, headers: admin });
      expect(uno.json().data).toMatchObject({ company: nombre, companyId: empresaId });

      const lista = await app.inject({ method: "GET", url: `/api/projects?companyId=${empresaId}`, headers: admin });
      expect(lista.json().data).toHaveLength(1);
      expect(lista.json().data[0]).toMatchObject({ company: nombre, companyId: empresaId });

      const porNombre = await app.inject({ method: "GET", url: `/api/projects?company=${encodeURIComponent(nombre.toUpperCase())}`, headers: admin });
      expect(porNombre.json().data).toHaveLength(1);

      const porTexto = await app.inject({ method: "GET", url: `/api/projects?search=${encodeURIComponent(nombre)}`, headers: admin });
      expect(porTexto.json().data.map((x: { id: string }) => x.id)).toContain(p.id);

      const put = await app.inject({
        method: "PUT",
        url: `/api/projects/${p.id}`,
        headers: admin,
        payload: { name: p.name, country: "Colombia", currency: "USD", budget: 2000, startDate: "2026-01-01", endDate: "2026-12-31" },
      });
      expect(put.statusCode).toBe(200);
      expect(put.json().data).toMatchObject({ company: nombre, companyId: empresaId });
    });

    it("PUT proyecto: conserva una empresa que quedó inactiva, pero no permite pasarse a otra inactiva", async () => {
      const e = await crearEmpresa({ name: `Se apaga ${prefijo}` });
      const empresaId = e.json().data.id as string;
      const p = (await crearProyecto({ companyId: empresaId })).json().data;

      await app.inject({ method: "PUT", url: `/api/companies/${empresaId}`, headers: admin, payload: { active: false } });

      const cuerpo = { name: p.name, country: "Colombia", currency: "USD", budget: 5000, startDate: "2026-01-01", endDate: "2026-12-31" };
      const conserva = await app.inject({ method: "PUT", url: `/api/projects/${p.id}`, headers: admin, payload: { ...cuerpo, companyId: empresaId } });
      expect(conserva.statusCode).toBe(200);

      const otraInactiva = await crearEmpresa({ name: `Otra apagada ${prefijo}`, active: false });
      const mueve = await app.inject({ method: "PUT", url: `/api/projects/${p.id}`, headers: admin, payload: { ...cuerpo, companyId: otraInactiva.json().data.id } });
      expect(mueve.statusCode).toBe(400);

      const activa = await crearEmpresa({ name: `Destino ${prefijo}` });
      const reasigna = await app.inject({ method: "PUT", url: `/api/projects/${p.id}`, headers: admin, payload: { ...cuerpo, companyId: activa.json().data.id } });
      expect(reasigna.statusCode).toBe(200);
      expect(reasigna.json().data.company).toBe(`Destino ${prefijo}`);
    });
  });

  describe("permisos por rol", () => {
    it("PM puede escribir; CONSULTANT y VIEWER no", async () => {
      expect((await crearEmpresa({ name: `DePm ${prefijo}` }, pm)).statusCode).toBe(201);

      for (const rol of [AppRole.CONSULTANT, AppRole.VIEWER]) {
        const headers = comoRol(rol, `${rol.toLowerCase()}.${prefijo}@synaptica.test`);
        expect((await crearEmpresa({ name: `Prohibida ${rol} ${prefijo}` }, headers)).statusCode).toBe(403);
        const e = await crearEmpresa({ name: `Objetivo ${rol} ${prefijo}` });
        const id = e.json().data.id;
        const put = await app.inject({ method: "PUT", url: `/api/companies/${id}`, headers, payload: { active: false } });
        expect(put.statusCode).toBe(403);
        const del = await app.inject({ method: "DELETE", url: `/api/companies/${id}`, headers });
        expect(del.statusCode).toBe(403);
      }
    });

    it("leer: VIEWER sí; CONSULTANT y COMMERCIAL no", async () => {
      const viewer = comoRol(AppRole.VIEWER, `viewer.${prefijo}@synaptica.test`);
      expect((await app.inject({ method: "GET", url: "/api/companies", headers: viewer })).statusCode).toBe(200);
      for (const rol of [AppRole.CONSULTANT, AppRole.COMMERCIAL]) {
        const headers = comoRol(rol, `${rol.toLowerCase()}.${prefijo}@synaptica.test`);
        expect((await app.inject({ method: "GET", url: "/api/companies", headers })).statusCode).toBe(403);
      }
    });
  });
});

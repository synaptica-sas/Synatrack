import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/infra/prisma.js";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";

/**
 * Enlace Consultant.userId <-> User, en sus tres momentos: crear/editar un
 * consultor por correo coincidente, y el enlace/desenlace manual de ADMIN.
 * El enlace en el login real (JWT de Microsoft) no se prueba aquí -- este
 * repo no tiene infraestructura para simular un token válido -- pero usa
 * exactamente la misma lógica de búsqueda/creación que se ejerce vía el modo
 * demo en otros archivos (p. ej. `time-entries-roles.test.ts`).
 */
describe("Enlace Consultant <-> User", () => {
  let app: FastifyInstance;
  const prefijo = `enlace-${Date.now()}`;
  const usuariosCreados: string[] = [];
  const consultoresCreados: string[] = [];

  beforeAll(async () => {
    app = await crearAppDePrueba();
  });

  afterAll(async () => {
    await prisma.consultant.deleteMany({ where: { id: { in: consultoresCreados } } });
    await prisma.user.deleteMany({ where: { id: { in: usuariosCreados } } });
    await app.close();
  });

  async function crearUsuario(email: string) {
    const user = await prisma.user.create({ data: { email, displayName: email.split("@")[0] } });
    usuariosCreados.push(user.id);
    return user;
  }

  function registrarConsultor(id: string) {
    consultoresCreados.push(id);
    return id;
  }

  it("crear un consultor con el correo de un usuario sin enlazar lo enlaza solo", async () => {
    const email = `${prefijo}-a@synaptica.test`;
    const user = await crearUsuario(email);

    const res = await app.inject({
      method: "POST",
      url: "/api/consultants",
      headers: comoRol(AppRole.ADMIN),
      payload: { fullName: "Enlace A", email, role: "Consultor", country: "Colombia" },
    });

    expect(res.statusCode).toBe(201);
    registrarConsultor(res.json().data.id);
    expect(res.json().data.userId).toBe(user.id);
  });

  it("crear un consultor con un correo que no corresponde a ningún usuario no enlaza nada", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/consultants",
      headers: comoRol(AppRole.ADMIN),
      payload: { fullName: "Enlace Huérfano", email: `${prefijo}-sin-usuario@synaptica.test`, role: "Consultor", country: "Colombia" },
    });

    expect(res.statusCode).toBe(201);
    registrarConsultor(res.json().data.id);
    expect(res.json().data.userId).toBeNull();
  });

  it("no enlaza dos consultores al mismo usuario: el segundo con el mismo correo queda sin enlazar", async () => {
    const email = `${prefijo}-b@synaptica.test`;
    await crearUsuario(email);

    const primero = await app.inject({
      method: "POST",
      url: "/api/consultants",
      headers: comoRol(AppRole.ADMIN),
      payload: { fullName: "Enlace B1", email, role: "Consultor", country: "Colombia" },
    });
    registrarConsultor(primero.json().data.id);
    expect(primero.json().data.userId).not.toBeNull();

    const segundo = await app.inject({
      method: "POST",
      url: "/api/consultants",
      headers: comoRol(AppRole.ADMIN),
      payload: { fullName: "Enlace B2 (duplicado)", email, role: "Consultor", country: "Colombia" },
    });
    registrarConsultor(segundo.json().data.id);
    expect(segundo.json().data.userId).toBeNull();
  });

  it("editar un consultor sin enlazar, poniéndole el correo de un usuario, lo enlaza", async () => {
    const email = `${prefijo}-c@synaptica.test`;
    const user = await crearUsuario(email);

    const creado = await app.inject({
      method: "POST",
      url: "/api/consultants",
      headers: comoRol(AppRole.ADMIN),
      payload: { fullName: "Enlace C", role: "Consultor", country: "Colombia" },
    });
    const id = registrarConsultor(creado.json().data.id);
    expect(creado.json().data.userId).toBeNull();

    const editado = await app.inject({
      method: "PUT",
      url: `/api/consultants/${id}`,
      headers: comoRol(AppRole.ADMIN),
      payload: { fullName: "Enlace C", email, role: "Consultor", country: "Colombia" },
    });
    expect(editado.json().data.userId).toBe(user.id);
  });

  it("editar un consultor YA enlazado no toca su enlace aunque cambie el correo", async () => {
    const emailOriginal = `${prefijo}-d1@synaptica.test`;
    const emailNuevo = `${prefijo}-d2@synaptica.test`;
    const userOriginal = await crearUsuario(emailOriginal);
    await crearUsuario(emailNuevo);

    const creado = await app.inject({
      method: "POST",
      url: "/api/consultants",
      headers: comoRol(AppRole.ADMIN),
      payload: { fullName: "Enlace D", email: emailOriginal, role: "Consultor", country: "Colombia" },
    });
    const id = registrarConsultor(creado.json().data.id);
    expect(creado.json().data.userId).toBe(userOriginal.id);

    const editado = await app.inject({
      method: "PUT",
      url: `/api/consultants/${id}`,
      headers: comoRol(AppRole.ADMIN),
      payload: { fullName: "Enlace D", email: emailNuevo, role: "Consultor", country: "Colombia" },
    });
    expect(editado.statusCode).toBe(200);
    expect(editado.json().data.userId).toBe(userOriginal.id);
  });

  describe("PATCH /:id/link-user (enlace manual)", () => {
    it("ADMIN enlaza un consultor a un usuario que no coincide en correo", async () => {
      const user = await crearUsuario(`${prefijo}-e@synaptica.test`);
      const creado = await app.inject({
        method: "POST",
        url: "/api/consultants",
        headers: comoRol(AppRole.ADMIN),
        payload: { fullName: "Enlace E", email: `${prefijo}-e-distinto@synaptica.test`, role: "Consultor", country: "Colombia" },
      });
      const id = registrarConsultor(creado.json().data.id);
      expect(creado.json().data.userId).toBeNull();

      const res = await app.inject({
        method: "PATCH",
        url: `/api/consultants/${id}/link-user`,
        headers: comoRol(AppRole.ADMIN),
        payload: { userId: user.id },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.userId).toBe(user.id);
    });

    it("rechaza enlazar un usuario que ya está enlazado a otro consultor", async () => {
      const user = await crearUsuario(`${prefijo}-f@synaptica.test`);
      const ya = await app.inject({
        method: "POST",
        url: "/api/consultants",
        headers: comoRol(AppRole.ADMIN),
        payload: { fullName: "Enlace F ya enlazado", email: `${prefijo}-f@synaptica.test`, role: "Consultor", country: "Colombia" },
      });
      registrarConsultor(ya.json().data.id);

      const otro = await app.inject({
        method: "POST",
        url: "/api/consultants",
        headers: comoRol(AppRole.ADMIN),
        payload: { fullName: "Enlace F otro", role: "Consultor", country: "Colombia" },
      });
      const otroId = registrarConsultor(otro.json().data.id);

      const res = await app.inject({
        method: "PATCH",
        url: `/api/consultants/${otroId}/link-user`,
        headers: comoRol(AppRole.ADMIN),
        payload: { userId: user.id },
      });
      expect(res.statusCode).toBe(409);
    });

    it("userId: null desenlaza", async () => {
      const user = await crearUsuario(`${prefijo}-g@synaptica.test`);
      const creado = await app.inject({
        method: "POST",
        url: "/api/consultants",
        headers: comoRol(AppRole.ADMIN),
        payload: { fullName: "Enlace G", email: `${prefijo}-g@synaptica.test`, role: "Consultor", country: "Colombia" },
      });
      const id = registrarConsultor(creado.json().data.id);
      expect(creado.json().data.userId).toBe(user.id);

      const res = await app.inject({
        method: "PATCH",
        url: `/api/consultants/${id}/link-user`,
        headers: comoRol(AppRole.ADMIN),
        payload: { userId: null },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.userId).toBeNull();
    });

    it("PM no puede usar el enlace manual (solo ADMIN)", async () => {
      const creado = await app.inject({
        method: "POST",
        url: "/api/consultants",
        headers: comoRol(AppRole.ADMIN),
        payload: { fullName: "Enlace H", role: "Consultor", country: "Colombia" },
      });
      const id = registrarConsultor(creado.json().data.id);

      const res = await app.inject({
        method: "PATCH",
        url: `/api/consultants/${id}/link-user`,
        headers: comoRol(AppRole.PM),
        payload: { userId: null },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  it("GET /api/auth/me expone el consultantId del usuario autenticado", async () => {
    const email = `${prefijo}-i@synaptica.test`;
    const user = await crearUsuario(email);
    const consultor = await app.inject({
      method: "POST",
      url: "/api/consultants",
      headers: comoRol(AppRole.ADMIN),
      payload: { fullName: "Enlace I", email, role: "Consultor", country: "Colombia" },
    });
    registrarConsultor(consultor.json().data.id);
    expect(consultor.json().data.userId).toBe(user.id);

    const me = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: comoRol(AppRole.PM, email),
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().data.consultantId).toBe(consultor.json().data.id);
  });
});

import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/infra/prisma.js";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";

/** Campos city, hireDate y exitDate de los consultores (CONTRATO §1). */
describe("Consultores: ciudad y fechas de ingreso y salida", () => {
  let app: FastifyInstance;
  const prefijo = `vinc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const base = { fullName: `Vinculo ${prefijo}`, role: "Consultor", country: "Ecuador" };

  beforeAll(async () => {
    app = await crearAppDePrueba();
  });

  afterAll(async () => {
    await prisma.consultant.deleteMany({ where: { fullName: { startsWith: `Vinculo ${prefijo}` } } });
    await app.close();
  });

  async function crear(extra: Record<string, unknown>, nombre = base.fullName) {
    return app.inject({
      method: "POST",
      url: "/api/consultants",
      headers: comoRol(AppRole.ADMIN),
      payload: { ...base, fullName: nombre, ...extra },
    });
  }

  it("guarda la ciudad con espacios simples y devuelve las fechas como YYYY-MM-DD", async () => {
    const res = await crear({ city: "  San   Francisco de Quito ", hireDate: "2026-01-05", exitDate: "2026-12-07" });
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({
      city: "San Francisco de Quito",
      hireDate: "2026-01-05",
      exitDate: "2026-12-07",
    });

    // Sin corrimiento en la base: es una columna DATE.
    const fila = await prisma.consultant.findUnique({ where: { id: res.json().data.id } });
    expect(fila?.hireDate?.toISOString()).toBe("2026-01-05T00:00:00.000Z");

    const lista = await app.inject({ method: "GET", url: "/api/consultants", headers: comoRol(AppRole.ADMIN) });
    const enLista = (lista.json().data as { id: string; hireDate: string | null }[]).find(
      (c) => c.id === res.json().data.id,
    );
    expect(enLista?.hireDate).toBe("2026-01-05");
  });

  it("ciudad vacía se guarda como null; sin los campos nuevos todo sigue igual", async () => {
    const vacia = await crear({ city: "   " }, `${base.fullName} vacia`);
    expect(vacia.statusCode).toBe(201);
    expect(vacia.json().data).toMatchObject({ city: null, hireDate: null, exitDate: null });

    const sin = await crear({}, `${base.fullName} sin`);
    expect(sin.statusCode).toBe(201);
    expect(sin.json().data).toMatchObject({ city: null, hireDate: null, exitDate: null });
  });

  it("exitDate anterior a hireDate da 400, y también fechas inexistentes o mal formadas", async () => {
    const anterior = await crear({ hireDate: "2026-06-01", exitDate: "2026-05-31" }, `${base.fullName} mal`);
    expect(anterior.statusCode).toBe(400);

    const mismoDia = await crear({ hireDate: "2026-06-01", exitDate: "2026-06-01" }, `${base.fullName} igual`);
    expect(mismoDia.statusCode).toBe(201);

    for (const hireDate of ["2026-02-30", "01/06/2026", "ayer"]) {
      const res = await crear({ hireDate }, `${base.fullName} fecha`);
      expect(res.statusCode, hireDate).toBe(400);
    }
    expect(await prisma.consultant.count({ where: { fullName: `${base.fullName} mal` } })).toBe(0);
  });

  it("PUT conserva lo no enviado, limpia con null y valida contra la fecha ya guardada", async () => {
    const creado = await crear({ city: "Quito", hireDate: "2026-03-02", exitDate: "2026-09-30" }, `${base.fullName} put`);
    const id = creado.json().data.id as string;
    const put = (extra: Record<string, unknown>) =>
      app.inject({
        method: "PUT",
        url: `/api/consultants/${id}`,
        headers: comoRol(AppRole.ADMIN),
        payload: { ...base, fullName: `${base.fullName} put`, ...extra },
      });

    const intacto = await put({});
    expect(intacto.statusCode).toBe(200);
    expect(intacto.json().data).toMatchObject({ city: "Quito", hireDate: "2026-03-02", exitDate: "2026-09-30" });

    // Solo hireDate posterior a la exitDate guardada: 400.
    const choque = await put({ hireDate: "2026-10-01" });
    expect(choque.statusCode).toBe(400);

    const limpiar = await put({ city: "", exitDate: null });
    expect(limpiar.statusCode).toBe(200);
    expect(limpiar.json().data).toMatchObject({ city: null, hireDate: "2026-03-02", exitDate: null });
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * Cliente HTTP de los listados paginados.
 *
 * `listTimeEntries` y `listExtraHours` devuelven **una página** con su `meta`,
 * para las tablas que tienen paginador. `listAllTimeEntries` y
 * `listAllExtraHours` recorren todas las páginas a propósito, y son las que
 * usan las pantallas que necesitan el conjunto completo para calcular algo
 * (la rejilla semanal, el informe, el tablero, los buzones de aprobación y la
 * exportación a CSV).
 *
 * Lo que se vigila aquí es justo el riesgo del cambio: que una pantalla que
 * pide "todo" no se quede en silencio con la primera página.
 */

/** Respuesta OK del `fetch` global, con el envoltorio { data, meta }. */
function pagina(data: unknown[], meta: { total: number; page: number; pageSize: number; totalPages: number }) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data, meta }),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** Servidor falso: pagina un array en memoria y anota las URL pedidas. */
function servidorFalso(filas: Array<{ id: string }>) {
  const urls: string[] = [];
  const fetchFalso = vi.fn(async (url: string) => {
    urls.push(url);
    const params = new URLSearchParams(url.split("?")[1] ?? "");
    const page = Number(params.get("page") ?? 1);
    const pageSize = Number(params.get("pageSize") ?? 50);
    const inicio = (page - 1) * pageSize;
    return pagina(filas.slice(inicio, inicio + pageSize), {
      total: filas.length,
      page,
      pageSize,
      totalPages: Math.ceil(filas.length / pageSize),
    });
  });
  vi.stubGlobal("fetch", fetchFalso);
  return { urls, fetchFalso };
}

const filasDe = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `f${i}` }));

describe("listados paginados del cliente", () => {
  it("listTimeEntries devuelve una sola página con su meta", async () => {
    servidorFalso(filasDe(250));
    const { listTimeEntries } = await import("../services/api");

    const resultado = await listTimeEntries({ page: 2, pageSize: 50 });

    expect(resultado.data).toHaveLength(50);
    expect(resultado.meta).toEqual({ total: 250, page: 2, pageSize: 50, totalPages: 5 });
  });

  it("listAllTimeEntries recorre TODAS las páginas, no solo la primera", async () => {
    const { urls } = servidorFalso(filasDe(250));
    const { listAllTimeEntries } = await import("../services/api");

    const todas = await listAllTimeEntries();

    // 250 filas de 100 en 100: tres peticiones y ni una fila perdida.
    expect(todas).toHaveLength(250);
    expect(new Set(todas.map((f) => f.id)).size).toBe(250);
    expect(urls).toHaveLength(3);
    expect(urls[0]).toContain("page=1");
    expect(urls[0]).toContain("pageSize=100");
    expect(urls[2]).toContain("page=3");
  });

  it("listAllTimeEntries conserva los filtros en todas las páginas", async () => {
    const { urls } = servidorFalso(filasDe(150));
    const { listAllTimeEntries } = await import("../services/api");

    await listAllTimeEntries({ from: "2026-05-01", to: "2026-05-07", status: "APPROVED" });

    expect(urls).toHaveLength(2);
    for (const url of urls) {
      expect(url).toContain("from=2026-05-01");
      expect(url).toContain("to=2026-05-07");
      expect(url).toContain("status=APPROVED");
    }
  });

  it("listAllTimeEntries hace una sola petición cuando todo cabe en una página", async () => {
    const { urls } = servidorFalso(filasDe(7));
    const { listAllTimeEntries } = await import("../services/api");

    const todas = await listAllTimeEntries();

    expect(todas).toHaveLength(7);
    expect(urls).toHaveLength(1);
  });

  it("listAllTimeEntries con la lista vacía no pide una segunda página", async () => {
    const { urls } = servidorFalso([]);
    const { listAllTimeEntries } = await import("../services/api");

    expect(await listAllTimeEntries()).toEqual([]);
    expect(urls).toHaveLength(1);
  });

  it("listAllExtraHours recorre todas las páginas del estado pedido", async () => {
    const { urls } = servidorFalso(filasDe(120));
    const { listAllExtraHours } = await import("../services/api");

    const todas = await listAllExtraHours({ status: "PENDING_PM" });

    expect(todas).toHaveLength(120);
    expect(urls).toHaveLength(2);
    for (const url of urls) {
      expect(url).toContain("/api/extra-hours");
      expect(url).toContain("status=PENDING_PM");
    }
  });

  it("un meta incoherente no provoca un bucle infinito", async () => {
    // `totalPages` siempre por encima de la página actual y páginas llenas:
    // sin la cota dura del cliente, esto no terminaría nunca.
    const fetchFalso = vi.fn(async () =>
      pagina(filasDe(100), { total: 999999, page: 1, pageSize: 100, totalPages: 99999 }),
    );
    vi.stubGlobal("fetch", fetchFalso);
    const { listAllTimeEntries } = await import("../services/api");

    const todas = await listAllTimeEntries();

    expect(fetchFalso.mock.calls.length).toBeLessThanOrEqual(500);
    expect(todas.length).toBeLessThanOrEqual(50000);
  });
});

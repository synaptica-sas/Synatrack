import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * El cierre mensual (`POST /api/snapshots/close`) se niega con **422** cuando
 * faltan tasas de cambio, y el cuerpo trae un `message` redactado para el
 * usuario: dice qué par falta y que se carga en Tasas FX.
 *
 * Hoy **ninguna pantalla llama a ese endpoint**, así que ese texto no se ve en
 * ningún sitio. Lo que sí se puede asegurar desde aquí es que el cliente HTTP
 * no lo sustituye por un genérico: el día que se construya la pantalla de
 * cierre, el mensaje accionable llegará intacto a quien lo tenga que leer.
 *
 * Esto cubre el camino de error de `request()`, que es común a los 121
 * endpoints del cliente.
 */

function respuesta(status: number, body: unknown) {
  return {
    ok: false,
    status,
    json: async () => body,
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("mensajes de error del cliente HTTP", () => {
  it("un 422 de cierre mensual conserva su mensaje accionable", async () => {
    const cuerpo = {
      message:
        "No se puede cerrar 2026-05: faltan tasas de cambio (XTS->USD). " +
        "Cargue las tasas en Tasas FX y vuelva a intentarlo.",
      conversion: { incomplete: true, missingPairs: ["XTS->USD"] },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respuesta(422, cuerpo)));

    const { getStatsOverview } = await import("../services/api");
    await expect(getStatsOverview("USD")).rejects.toThrow(
      /Cargue las tasas en Tasas FX y vuelva a intentarlo/,
    );
  });

  it("sin `message` en el cuerpo cae al genérico con el código", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respuesta(500, {})));

    const { getStatsOverview } = await import("../services/api");
    await expect(getStatsOverview("USD")).rejects.toThrow(/500/);
  });

  it("un fallo de red se traduce a español", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const { getStatsOverview } = await import("../services/api");
    await expect(getStatsOverview("USD")).rejects.toThrow(/No se pudo contactar con el servidor/);
  });
});

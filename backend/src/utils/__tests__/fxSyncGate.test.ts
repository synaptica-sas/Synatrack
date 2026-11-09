import { describe, expect, it } from "vitest";
import { REINTENTO_FX_MS, decidirSincronizacionFx } from "../fxSyncGate.js";

const d = (iso: string) => new Date(iso);

describe("decidirSincronizacionFx", () => {
  it("corre si nunca se ha sincronizado", () => {
    const r = decidirSincronizacionFx({ ultimoExito: null, ultimoIntento: null, ahora: d("2026-11-09T10:00:00Z") });
    expect(r.ejecutar).toBe(true);
  });

  it("no corre si ya hubo un éxito hoy (UTC), aunque el ciclo sea cada hora", () => {
    const exito = d("2026-11-09T00:30:00Z");
    for (const hora of ["01", "05", "13", "23"]) {
      const r = decidirSincronizacionFx({
        ultimoExito: exito,
        ultimoIntento: exito,
        ahora: d(`2026-11-09T${hora}:10:00Z`),
      });
      expect(r.ejecutar).toBe(false);
    }
  });

  it("si el cron de Render ya sincronizó hoy, el ciclo no repite", () => {
    const cronRender = d("2026-11-09T13:00:05Z");
    const r = decidirSincronizacionFx({
      ultimoExito: cronRender,
      ultimoIntento: cronRender,
      ahora: d("2026-11-09T14:00:00Z"),
    });
    expect(r.ejecutar).toBe(false);
  });

  it("corre al cambiar el día UTC", () => {
    const r = decidirSincronizacionFx({
      ultimoExito: d("2026-11-08T23:59:00Z"),
      ultimoIntento: d("2026-11-08T23:59:00Z"),
      ahora: d("2026-11-09T00:01:00Z"),
    });
    expect(r.ejecutar).toBe(true);
  });

  it("tras un fallo espera REINTENTO_FX_MS antes de reintentar", () => {
    const fallo = d("2026-11-09T08:00:00Z");
    const base = { ultimoExito: d("2026-11-08T13:00:00Z"), ultimoIntento: fallo };

    expect(
      decidirSincronizacionFx({ ...base, ahora: new Date(fallo.getTime() + REINTENTO_FX_MS - 1) }).ejecutar,
    ).toBe(false);
    expect(
      decidirSincronizacionFx({ ...base, ahora: new Date(fallo.getTime() + REINTENTO_FX_MS) }).ejecutar,
    ).toBe(true);
  });

  it("un fallo sin ningún éxito previo también respeta la espera", () => {
    const fallo = d("2026-11-09T08:00:00Z");
    expect(
      decidirSincronizacionFx({ ultimoExito: null, ultimoIntento: fallo, ahora: d("2026-11-09T09:00:00Z") })
        .ejecutar,
    ).toBe(false);
  });

  it("el último intento igual al último éxito no cuenta como fallo", () => {
    const exito = d("2026-11-08T22:00:00Z");
    const r = decidirSincronizacionFx({ ultimoExito: exito, ultimoIntento: exito, ahora: d("2026-11-09T00:30:00Z") });
    expect(r.ejecutar).toBe(true);
  });
});

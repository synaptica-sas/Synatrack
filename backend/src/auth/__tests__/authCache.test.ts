import { AppRole } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { buildAuthCacheKey, createAuthCache, type AuthResolution } from "../authCache.js";

const user = (email: string, roles: AppRole[] = [AppRole.PM]) => ({
  id: `id-${email}`,
  email,
  displayName: email,
  roles,
  consultantId: null,
});
const ok = (email: string): AuthResolution => ({ ok: true, authUser: user(email) });

function setup(options: { ttlMs?: number; maxEntries?: number } = {}) {
  let t = 1_000_000;
  const cache = createAuthCache({ ...options, now: () => t });
  return { cache, advance: (ms: number) => (t += ms), nowSeconds: () => t / 1000 };
}

describe("buildAuthCacheKey", () => {
  it("normaliza correo y ordena/deduplica roles", () => {
    expect(buildAuthCacheKey(" Ana@X.com ", ["pm", "ADMIN", "PM"])).toBe("ana@x.com|ADMIN,PM");
  });
  it("cambia si cambian los roles del token", () => {
    expect(buildAuthCacheKey("a@x.com", ["PM"])).not.toBe(buildAuthCacheKey("a@x.com", ["PM", "FINANCE"]));
  });
});

describe("createAuthCache", () => {
  it("resuelve una vez y sirve el acierto sin volver a la resolución", async () => {
    const { cache } = setup();
    const resolve = vi.fn(async () => ok("a@x.com"));
    await cache.get("k", "a@x.com", undefined, resolve);
    const second = await cache.get("k", "a@x.com", undefined, resolve);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(second.ok && second.authUser.email).toBe("a@x.com");
  });

  it("expira por TTL", async () => {
    const { cache, advance } = setup({ ttlMs: 60_000 });
    const resolve = vi.fn(async () => ok("a@x.com"));
    await cache.get("k", "a@x.com", undefined, resolve);
    advance(59_000);
    await cache.get("k", "a@x.com", undefined, resolve);
    expect(resolve).toHaveBeenCalledTimes(1);
    advance(2_000);
    await cache.get("k", "a@x.com", undefined, resolve);
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("nunca vive más allá del exp del token", async () => {
    const { cache, advance, nowSeconds } = setup({ ttlMs: 60_000 });
    const resolve = vi.fn(async () => ok("a@x.com"));
    const exp = nowSeconds() + 10;
    await cache.get("k", "a@x.com", exp, resolve);
    advance(11_000);
    await cache.get("k", "a@x.com", exp, resolve);
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("no guarda nada si el token ya expiró", async () => {
    const { cache, nowSeconds } = setup();
    await cache.get("k", "a@x.com", nowSeconds() - 1, async () => ok("a@x.com"));
    expect(cache.size()).toBe(0);
  });

  it("desaloja las entradas más antiguas al pasar el tope", async () => {
    const { cache } = setup({ maxEntries: 2 });
    for (const e of ["a", "b", "c"]) {
      await cache.get(e, e, undefined, async () => ok(e));
    }
    expect(cache.size()).toBe(2);
    const resolve = vi.fn(async () => ok("a"));
    await cache.get("a", "a", undefined, resolve); // "a" fue desalojada
    expect(resolve).toHaveBeenCalledTimes(1);
    const resolveC = vi.fn(async () => ok("c"));
    await cache.get("c", "c", undefined, resolveC); // "c" sigue
    expect(resolveC).not.toHaveBeenCalled();
  });

  it("single-flight: peticiones simultáneas comparten una resolución", async () => {
    const { cache } = setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const resolve = vi.fn(async () => {
      await gate;
      return ok("a@x.com");
    });
    const all = Promise.all([1, 2, 3, 4].map(() => cache.get("k", "a@x.com", undefined, resolve)));
    release();
    const results = await all;
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it("si la resolución falla, el fallo no se cachea y el siguiente intento reintenta", async () => {
    const { cache } = setup();
    const failing = vi.fn(async (): Promise<AuthResolution> => {
      throw new Error("BD caída");
    });
    await expect(cache.get("k", "a@x.com", undefined, failing)).rejects.toThrow("BD caída");
    const good = vi.fn(async () => ok("a@x.com"));
    const r = await cache.get("k", "a@x.com", undefined, good);
    expect(r.ok).toBe(true);
    expect(good).toHaveBeenCalledTimes(1);
  });

  it("un fallo síncrono del resolvedor tampoco deja el vuelo atascado", async () => {
    const { cache } = setup();
    const bad = () => {
      throw new Error("boom");
    };
    await expect(cache.get("k", "a@x.com", undefined, bad)).rejects.toThrow("boom");
    const good = vi.fn(async () => ok("a@x.com"));
    await cache.get("k", "a@x.com", undefined, good);
    expect(good).toHaveBeenCalledTimes(1);
  });

  it("no cachea rechazos", async () => {
    const { cache } = setup();
    const reject = vi.fn(async (): Promise<AuthResolution> => ({ ok: false, status: 403, message: "inactivo" }));
    const a = await cache.get("k", "a@x.com", undefined, reject);
    const b = await cache.get("k", "a@x.com", undefined, reject);
    expect(a).toEqual({ ok: false, status: 403, message: "inactivo" });
    expect(b.ok).toBe(false);
    expect(reject).toHaveBeenCalledTimes(2);
  });

  it("invalidate(email) borra solo las entradas de ese usuario", async () => {
    const { cache } = setup();
    await cache.get("a|PM", "a@x.com", undefined, async () => ok("a@x.com"));
    await cache.get("a|ADMIN", "a@x.com", undefined, async () => ok("a@x.com"));
    await cache.get("b|PM", "b@x.com", undefined, async () => ok("b@x.com"));
    cache.invalidate("A@x.com");
    expect(cache.size()).toBe(1);
  });

  it("invalidate() sin correo vacía todo", async () => {
    const { cache } = setup();
    await cache.get("a", "a@x.com", undefined, async () => ok("a@x.com"));
    await cache.get("b", "b@x.com", undefined, async () => ok("b@x.com"));
    cache.invalidate();
    expect(cache.size()).toBe(0);
  });

  it("una resolución en vuelo durante una invalidación no se guarda", async () => {
    const { cache } = setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const pending = cache.get("k", "a@x.com", undefined, async () => {
      await gate;
      return ok("a@x.com");
    });
    cache.invalidate("a@x.com");
    release();
    await pending;
    expect(cache.size()).toBe(0);
    const again = vi.fn(async () => ok("a@x.com"));
    await cache.get("k", "a@x.com", undefined, again);
    expect(again).toHaveBeenCalledTimes(1);
  });
});

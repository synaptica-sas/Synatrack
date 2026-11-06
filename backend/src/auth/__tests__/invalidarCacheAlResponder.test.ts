import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { authCache, invalidarCacheAlResponder } from "../authCache.js";

async function sembrar() {
  await authCache.get("k", "a@x.com", undefined, async () => ({
    ok: true,
    authUser: { id: "1", email: "a@x.com", displayName: "A", roles: [], consultantId: null },
  }));
  expect(authCache.size()).toBe(1);
}

describe("invalidarCacheAlResponder", () => {
  it("invalida cuando el handler responde bien", async () => {
    const app = Fastify();
    app.patch("/", { onSend: invalidarCacheAlResponder }, async () => ({ data: 1 }));
    await sembrar();
    expect((await app.inject({ method: "PATCH", url: "/" })).statusCode).toBe(200);
    expect(authCache.size()).toBe(0);
  });

  it("invalida también cuando el handler lanza tras escribir (500)", async () => {
    const app = Fastify();
    app.patch("/", { onSend: invalidarCacheAlResponder }, async () => {
      throw new Error("falló writeAudit");
    });
    await sembrar();
    expect((await app.inject({ method: "PATCH", url: "/" })).statusCode).toBe(500);
    expect(authCache.size()).toBe(0);
  });
});

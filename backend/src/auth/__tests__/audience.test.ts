import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, jwtVerify } from "jose";
import { describe, expect, it } from "vitest";
import { parseAudiences } from "../audience.js";

describe("parseAudiences", () => {
  it("un solo valor sigue siendo una lista de un elemento (Render)", () => {
    expect(parseAudiences("api://app-gestion-backend")).toEqual(["api://app-gestion-backend"]);
  });

  it("acepta una lista separada por comas, con espacios y sin duplicados", () => {
    expect(parseAudiences(" api://abc , abc,abc ,")).toEqual(["api://abc", "abc"]);
  });

  it("vacío da lista vacía (env.ts aplica entonces el valor por defecto)", () => {
    expect(parseAudiences(undefined)).toEqual([]);
    expect(parseAudiences(" , ")).toEqual([]);
  });
});

describe("jwtVerify con varias audiencias", () => {
  const CLIENT_ID = "11111111-2222-3333-4444-555555555555";
  const audiencias = parseAudiences(`api://${CLIENT_ID},${CLIENT_ID}`);

  async function firmar(aud: string) {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    return { token, jwks: createLocalJWKSet({ keys: [jwk] }) };
  }

  it("acepta un token v1 (aud = App ID URI) y uno v2 (aud = client id)", async () => {
    for (const aud of [`api://${CLIENT_ID}`, CLIENT_ID]) {
      const { token, jwks } = await firmar(aud);
      const { payload } = await jwtVerify(token, jwks, { audience: audiencias });
      expect(payload.aud).toBe(aud);
    }
  });

  it("rechaza un token con otra audiencia", async () => {
    const { token, jwks } = await firmar("api://otra-api");
    await expect(jwtVerify(token, jwks, { audience: audiencias })).rejects.toThrow();
  });
});

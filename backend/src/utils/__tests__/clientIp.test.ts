import { describe, expect, it } from "vitest";
import { ipDelCliente, normalizarIp, parseTrustProxy } from "../clientIp.js";

describe("parseTrustProxy", () => {
  it("sin valor o en false no confía en ningún proxy", () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy("")).toBe(false);
    expect(parseTrustProxy("  ")).toBe(false);
    expect(parseTrustProxy("false")).toBe(false);
    expect(parseTrustProxy("0")).toBe(false);
  });

  it("acepta true y número de saltos", () => {
    expect(parseTrustProxy("true")).toBe(true);
    expect(parseTrustProxy("TRUE")).toBe(true);
    expect(parseTrustProxy("1")).toBe(1);
    expect(parseTrustProxy("2")).toBe(2);
  });

  it("acepta una lista de IPs o rangos CIDR", () => {
    expect(parseTrustProxy("10.0.0.0/8, 172.16.0.1")).toEqual(["10.0.0.0/8", "172.16.0.1"]);
  });
});

describe("normalizarIp", () => {
  it("quita el puerto de una IPv4 (formato de Azure App Service)", () => {
    expect(normalizarIp("203.0.113.5:54321")).toBe("203.0.113.5");
  });

  it("deja intacta una IPv4 sin puerto", () => {
    expect(normalizarIp("203.0.113.5")).toBe("203.0.113.5");
  });

  it("quita corchetes y puerto de una IPv6", () => {
    expect(normalizarIp("[2001:db8::1]:443")).toBe("2001:db8::1");
    expect(normalizarIp("[2001:db8::1]")).toBe("2001:db8::1");
  });

  it("deja intacta una IPv6 sin corchetes", () => {
    expect(normalizarIp("2001:db8::1")).toBe("2001:db8::1");
    expect(normalizarIp("::ffff:127.0.0.1")).toBe("::ffff:127.0.0.1");
  });
});

describe("ipDelCliente", () => {
  it("devuelve null sin petición o sin IP", () => {
    expect(ipDelCliente(undefined)).toBeNull();
    expect(ipDelCliente({})).toBeNull();
  });

  it("normaliza la IP de la petición", () => {
    expect(ipDelCliente({ ip: "198.51.100.7:1234" })).toBe("198.51.100.7");
  });
});

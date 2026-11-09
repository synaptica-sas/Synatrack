/**
 * IP real del cliente detrás de un proxy inverso (Render, Azure App Service).
 *
 * Fastify calcula `request.ip` a partir de `X-Forwarded-For` según la opción
 * `trustProxy` (ver `TRUST_PROXY` en `config/env.ts`). Dos detalles que este
 * módulo resuelve:
 *
 *  1. `TRUST_PROXY` llega como cadena y Fastify espera booleano, número de
 *     saltos o lista de IPs/CIDR: `parseTrustProxy` hace la conversión.
 *  2. El front end de Azure App Service escribe la entrada de
 *     `X-Forwarded-For` con puerto (`203.0.113.5:54321`). Sin quitarlo, cada
 *     conexión nueva tendría una "IP" distinta y el límite de peticiones por IP
 *     no limitaría nada. `normalizarIp` lo quita.
 */

export type TrustProxyValue = boolean | number | string[];

/**
 * Convierte el valor de `TRUST_PROXY` a lo que acepta la opción `trustProxy`
 * de Fastify:
 *  - vacío / `false` / `0`  -> `false` (no se confía en ningún proxy).
 *  - `true`                 -> `true` (se confía en toda la cadena; la IP es la
 *                              primera de `X-Forwarded-For`, que el cliente
 *                              puede falsificar: evitar en producción).
 *  - entero positivo `n`    -> número de saltos de proxy de confianza. Con `1`
 *                              la IP es la que añadió el proxy más cercano.
 *  - lista separada por coma -> IPs o rangos CIDR de los proxies de confianza.
 */
export function parseTrustProxy(raw: string | undefined): TrustProxyValue {
  const valor = (raw ?? "").trim();
  if (valor === "" || valor.toLowerCase() === "false") return false;
  if (valor.toLowerCase() === "true") return true;
  if (/^\d+$/.test(valor)) {
    const saltos = Number(valor);
    return saltos === 0 ? false : saltos;
  }
  const lista = valor
    .split(",")
    .map((parte) => parte.trim())
    .filter((parte) => parte !== "");
  return lista.length > 0 ? lista : false;
}

/**
 * Quita el puerto de una dirección IP si lo trae:
 *  - `203.0.113.5:54321`   -> `203.0.113.5`
 *  - `[2001:db8::1]:443`   -> `2001:db8::1`
 *  - `2001:db8::1`         -> sin cambios (IPv6 sin corchetes no lleva puerto)
 */
export function normalizarIp(ip: string): string {
  const valor = ip.trim();
  const ipv6ConPuerto = /^\[([^\]]+)\](?::\d+)?$/.exec(valor);
  if (ipv6ConPuerto) return ipv6ConPuerto[1];
  const ipv4ConPuerto = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(valor);
  if (ipv4ConPuerto) return ipv4ConPuerto[1];
  return valor;
}

/** IP del cliente de una petición, ya normalizada. `null` si Fastify no la conoce. */
export function ipDelCliente(request: { ip?: string } | undefined): string | null {
  const ip = request?.ip;
  return ip ? normalizarIp(ip) : null;
}

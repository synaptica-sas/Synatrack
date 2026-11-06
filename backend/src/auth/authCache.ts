import type { AppRole } from "@prisma/client";

/**
 * Caché en memoria de la resolución de identidad de `authenticate`.
 *
 * Lo que se cachea NO es el token (siempre se verifica con `jwtVerify`), sino lo
 * que cuesta consultas a la base: alta JIT, sincronización de roles y enlace del
 * Consultant. El resultado es el `authUser` de la petición.
 *
 * - Clave: correo normalizado + roles del token ordenados. Si Entra ID cambia los
 *   roles, la clave cambia y se vuelve a resolver.
 * - TTL corto, y nunca más allá del `exp` del token.
 * - Single-flight: peticiones simultáneas con la misma clave comparten una sola
 *   resolución (esto además evita las carreras del JIT).
 * - Solo se cachean los resultados `ok`; los rechazos (403) y los fallos se
 *   recalculan siempre.
 * - Tope de entradas con desalojo de las más antiguas.
 *
 * Multi-instancia: la caché es por proceso. `invalidateAuthCache` solo vacía la
 * instancia que atendió al administrador; en las demás, el desfase máximo antes
 * de ver el cambio es el TTL (60 s por defecto).
 */

export type CachedAuthUser = {
  id: string;
  email: string;
  displayName: string;
  roles: AppRole[];
  consultantId: string | null;
};

export type AuthResolution =
  | { ok: true; authUser: CachedAuthUser }
  | { ok: false; status: number; message: string };

export type AuthCacheOptions = {
  ttlMs?: number;
  maxEntries?: number;
  /** Reloj inyectable para pruebas (milisegundos). */
  now?: () => number;
};

type Entry = { email: string; authUser: CachedAuthUser; expiresAt: number };
type Flight = { email: string; promise: Promise<AuthResolution> };

export const AUTH_CACHE_TTL_MS = 60_000;
export const AUTH_CACHE_MAX_ENTRIES = 1000;

export function buildAuthCacheKey(email: string, tokenRoles: readonly string[]): string {
  const roles = Array.from(new Set(tokenRoles.map((role) => String(role).toUpperCase()))).sort();
  return `${email.trim().toLowerCase()}|${roles.join(",")}`;
}

export function createAuthCache(options: AuthCacheOptions = {}) {
  const ttlMs = options.ttlMs ?? AUTH_CACHE_TTL_MS;
  const maxEntries = options.maxEntries ?? AUTH_CACHE_MAX_ENTRIES;
  const now = options.now ?? Date.now;

  // Map conserva el orden de inserción: la primera clave es la más antigua.
  const entries = new Map<string, Entry>();
  const flights = new Map<string, Flight>();
  // Sube con cada invalidación; una resolución iniciada antes no se guarda,
  // porque pudo leer datos que el administrador acaba de cambiar.
  let epoch = 0;

  function store(key: string, email: string, authUser: CachedAuthUser, tokenExpMs: number | null) {
    const t = now();
    const expiresAt = Math.min(t + ttlMs, tokenExpMs ?? Infinity);
    if (expiresAt <= t) return;

    entries.delete(key);
    entries.set(key, { email, authUser, expiresAt });
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  }

  /**
   * Devuelve la identidad cacheada o ejecuta `resolve` (una sola vez por clave
   * en vuelo). `tokenExpSeconds` es el claim `exp` del JWT.
   */
  async function get(
    key: string,
    email: string,
    tokenExpSeconds: number | undefined,
    resolve: () => Promise<AuthResolution>,
  ): Promise<AuthResolution> {
    const hit = entries.get(key);
    if (hit) {
      if (hit.expiresAt > now()) {
        return { ok: true, authUser: hit.authUser };
      }
      entries.delete(key);
    }

    const inFlight = flights.get(key);
    if (inFlight) return inFlight.promise;

    const startedAtEpoch = epoch;
    const tokenExpMs = typeof tokenExpSeconds === "number" ? tokenExpSeconds * 1000 : null;

    const flight: { promise?: Promise<AuthResolution> } = {};
    const self = (async () => {
      try {
        const result = await Promise.resolve().then(resolve);
        if (result.ok && startedAtEpoch === epoch) {
          store(key, email, result.authUser, tokenExpMs);
        }
        return result;
      } finally {
        // Solo se retira si sigue siendo este vuelo (una invalidación pudo reemplazarlo).
        if (flights.get(key)?.promise === flight.promise) flights.delete(key);
      }
    })();

    flight.promise = self;
    flights.set(key, { email, promise: self });
    return self;
  }

  /** Sin correo vacía todo; con correo, solo las entradas de ese usuario. */
  function invalidate(email?: string) {
    epoch++;
    if (email === undefined) {
      entries.clear();
      flights.clear();
      return;
    }
    const target = email.trim().toLowerCase();
    for (const [key, entry] of entries) {
      if (entry.email === target) entries.delete(key);
    }
    for (const [key, flight] of flights) {
      if (flight.email === target) flights.delete(key);
    }
  }

  return { get, invalidate, size: () => entries.size };
}

/** Instancia única del proceso. */
export const authCache = createAuthCache();

/** Llamar cuando un cambio administrativo afecte la resolución de identidad. */
export function invalidateAuthCache(email?: string) {
  authCache.invalidate(email);
}

/**
 * Hook `onSend` para rutas de escritura que cambian la identidad (roles,
 * activo, enlace de Consultant). Corre después del handler en TODOS los
 * desenlaces, también cuando una escritura posterior lanza y se responde 500:
 * si la BD llegó a cambiar, la caché no puede quedar con la identidad vieja.
 * Vacía todo el caché (son operaciones administrativas poco frecuentes).
 */
export async function invalidarCacheAlResponder(_request: unknown, _reply: unknown, payload: unknown) {
  invalidateAuthCache();
  return payload;
}

/**
 * Audiencias aceptadas en el token de Entra ID (`AZURE_AD_AUDIENCE`).
 *
 * Con tokens v1 la claim `aud` es el App ID URI (`api://...`); con tokens v2 es
 * el client id (GUID) del API registrado. Para aceptar ambos, la variable admite
 * una lista separada por comas, p. ej. `api://<client-id>,<client-id>`. Con un
 * solo valor el comportamiento es el de siempre.
 */
export const AUDIENCIA_POR_DEFECTO = "api://app-gestion-backend";

/** Parte la lista, recorta espacios y quita vacíos y duplicados. */
export function parseAudiences(raw: string | undefined): string[] {
  const valores = (raw ?? "")
    .split(",")
    .map((valor) => valor.trim())
    .filter((valor) => valor !== "");
  return [...new Set(valores)];
}

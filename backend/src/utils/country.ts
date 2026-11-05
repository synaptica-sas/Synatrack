export const SUPPORTED_COUNTRIES = ["Colombia", "Peru", "Chile", "Mexico", "Ecuador", "Argentina", "España", "Default"];

export function normalizeCountry(countryName: string): string {
  const normalized = countryName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

  if (normalized === "colombia") return "Colombia";
  if (normalized === "peru") return "Peru";
  if (normalized === "chile") return "Chile";
  if (normalized === "mexico") return "Mexico";
  if (normalized === "ecuador") return "Ecuador";
  if (normalized === "argentina") return "Argentina";
  if (normalized === "espana" || normalized === "espanna" || normalized === "spain") return "España";
  
  if (
    normalized === "default" ||
    normalized === "usa" ||
    normalized === "estados unidos" ||
    normalized === "united states" ||
    normalized === "us"
  ) {
    return "Default";
  }

  throw new Error(`País no soportado: ${countryName}`);
}

export function isSupportedCountry(countryName: string): boolean {
  try {
    normalizeCountry(countryName);
    return true;
  } catch {
    return false;
  }
}

/**
 * Zona horaria IANA por país canónico (salida de `normalizeCountry`).
 *
 * Es la misma tabla que `extra-hours.routes.ts` usa en línea para decidir "hoy" del
 * consultor al crear una solicitud; vive aquí para que la nómina sobre lo real (R14 §2.3.5)
 * convierta la franja con exactamente las mismas zonas. `Default` cae en Bogotá, igual
 * que la ruta. (Fase 3: la ruta debería importar esta tabla en vez de su copia.)
 */
export const COUNTRY_TIMEZONES: Readonly<Record<string, string>> = {
  Colombia: "America/Bogota",
  Peru: "America/Lima",
  Chile: "America/Santiago",
  Mexico: "America/Mexico_City",
  Ecuador: "America/Guayaquil",
  Argentina: "America/Argentina/Buenos_Aires",
  España: "Europe/Madrid",
  Default: "America/Bogota",
};

/**
 * Resuelve país canónico + zona horaria. Si el país viene vacío o no está soportado se usa
 * `Default` (Bogotá) y se devuelve la advertencia: no se adivina en silencio.
 */
export function resolveCountryTimezone(countryName: string | null | undefined): {
  country: string;
  timeZone: string;
  warning: string | null;
} {
  if (!countryName || !countryName.trim()) {
    return {
      country: "Default",
      timeZone: COUNTRY_TIMEZONES.Default,
      warning: "El consultor no tiene país: se usó la zona horaria por defecto (America/Bogota).",
    };
  }
  try {
    const country = normalizeCountry(countryName);
    return { country, timeZone: COUNTRY_TIMEZONES[country] ?? COUNTRY_TIMEZONES.Default, warning: null };
  } catch {
    return {
      country: "Default",
      timeZone: COUNTRY_TIMEZONES.Default,
      warning: `País no soportado "${countryName}": se usó la zona horaria por defecto (America/Bogota).`,
    };
  }
}

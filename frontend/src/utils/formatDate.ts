/**
 * Helpers de formato de fechas para toda la aplicación.
 * Estandariza el display de fechas en español (es-CO).
 */

const DATE_FORMAT = new Intl.DateTimeFormat("es-CO", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const DATE_FORMAT_SHORT = new Intl.DateTimeFormat("es-CO", {
  day: "2-digit",
  month: "short",
  timeZone: "UTC",
});

const DATE_FORMAT_LONG = new Intl.DateTimeFormat("es-CO", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** "12 abr 2026" — formato estándar de tabla */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return DATE_FORMAT.format(new Date(iso));
  } catch {
    return iso;
  }
}

/** "12 abr" — sin año, para periodos en mismo año */
export function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return DATE_FORMAT_SHORT.format(new Date(iso));
  } catch {
    return iso;
  }
}

/** "12 de abril de 2026" — para headings y tooltips */
export function formatDateLong(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return DATE_FORMAT_LONG.format(new Date(iso));
  } catch {
    return iso;
  }
}

/**
 * "27 ago 2026, 7:24 p.m." — para marcas de tiempo reales (createdAt/updatedAt),
 * a diferencia de formatDate() esta SÍ usa la zona horaria local del navegador
 * en vez de forzar UTC, porque aquí importa el instante real, no una fecha
 * de calendario que deba verse igual sin importar el huso horario.
 */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("es-CO", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** Días entre dos fechas ISO (inclusivo) */
export function calcDias(inicio: string, fin: string): number {
  return (
    Math.ceil((new Date(fin + "T00:00:00Z").getTime() - new Date(inicio + "T00:00:00Z").getTime()) / 86400000) + 1
  );
}

/** Rango "12 abr → 30 jun 2026" */
export function formatDateRange(from: string | null | undefined, to: string | null | undefined): string {
  if (!from && !to) return "—";
  if (!from) return `hasta ${formatDate(to)}`;
  if (!to) return `desde ${formatDate(from)}`;
  // If same year, omit year from the first date
  const fyear = from.slice(0, 4);
  const tyear = to.slice(0, 4);
  if (fyear === tyear) {
    return `${formatDateShort(from)} → ${formatDate(to)}`;
  }
  return `${formatDate(from)} → ${formatDate(to)}`;
}

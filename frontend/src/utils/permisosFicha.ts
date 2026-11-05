/** Mensajes en español de los 403 del backend sobre PM de proyecto y correo de consultor. */
const MENSAJES_403: Record<string, string> = {
  NOT_PROJECT_MANAGER: "Solo puedes editar los proyectos que diriges.",
  PM_CHANGE_FORBIDDEN: "Solo un administrador puede asignar o cambiar el PM del proyecto.",
  EMAIL_CHANGE_FORBIDDEN: "Solo un administrador puede cambiar el correo de un consultor.",
};

/** Traduce el error de la API: usa el mensaje por código conocido y, si no, el del error. */
export function mensajeErrorPermiso(err: unknown, porDefecto: string): string {
  const codigo = (err as { code?: unknown } | null)?.code;
  if (typeof codigo === "string" && MENSAJES_403[codigo]) return MENSAJES_403[codigo];
  return err instanceof Error ? err.message : porDefecto;
}

/** Normaliza un correo para compararlo (la validación real la hace el backend). */
export function mismoCorreo(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

/**
 * Un no-ADMIN solo edita proyectos que dirige. Solo controla qué se muestra:
 * quien autoriza de verdad es el backend.
 */
export function puedeEditarProyecto(
  esAdmin: boolean,
  correoPropio: string | undefined,
  pmDelProyecto: string | null | undefined,
): boolean {
  return esAdmin || (!!correoPropio && mismoCorreo(correoPropio, pmDelProyecto));
}

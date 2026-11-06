/**
 * Error ocurrido al procesar el regreso del login de Microsoft (consentimiento
 * denegado, error de Entra). `main.tsx` lo guarda antes de pintar la app y la
 * pantalla de login lo muestra. No guarda detalles técnicos del token.
 */
let redirectError: string | null = null;

export const REDIRECT_ERROR_MESSAGE =
  "No se pudo completar el inicio de sesión con Microsoft. Inténtalo de nuevo; si el problema continúa, contacta al administrador.";

export function setRedirectError(message: string | null): void {
  redirectError = message;
}

export function getRedirectError(): string | null {
  return redirectError;
}

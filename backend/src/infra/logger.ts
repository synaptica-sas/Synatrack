/**
 * Logger compartido de la aplicación (DEP-29 / DEP-30).
 *
 * Los módulos que no reciben un `request` (utilidades de notificación, motores de
 * alertas, jobs) escribían con `console.log` en paralelo al logger estructurado de
 * Fastify, lo que rompe el parseo de logs en Render. Aquí se registra la instancia
 * de logger de Fastify al construir la app y esos módulos la consumen.
 *
 * Fuera del proceso del servidor (seeds, scripts sueltos) no hay instancia de Fastify:
 * en ese caso se cae a `console`, que es el comportamiento que ya tenían.
 */

export interface AppLogger {
  debug(obj: unknown, msg?: string): void;
  debug(msg: string): void;
  info(obj: unknown, msg?: string): void;
  info(msg: string): void;
  warn(obj: unknown, msg?: string): void;
  warn(msg: string): void;
  error(obj: unknown, msg?: string): void;
  error(msg: string): void;
}

function consoleLog(
  write: (...args: unknown[]) => void,
  objOrMsg: unknown,
  msg?: string,
) {
  if (typeof objOrMsg === "string") {
    write(objOrMsg);
    return;
  }
  write(msg ?? "", objOrMsg);
}

const fallbackLogger: AppLogger = {
  debug: (objOrMsg: unknown, msg?: string) => consoleLog(console.debug, objOrMsg, msg),
  info: (objOrMsg: unknown, msg?: string) => consoleLog(console.info, objOrMsg, msg),
  warn: (objOrMsg: unknown, msg?: string) => consoleLog(console.warn, objOrMsg, msg),
  error: (objOrMsg: unknown, msg?: string) => consoleLog(console.error, objOrMsg, msg),
};

let appLogger: AppLogger | null = null;

/** Registra el logger de Fastify como logger de la aplicación. */
export function setAppLogger(logger: AppLogger) {
  appLogger = logger;
}

/** Devuelve el logger de la app, o `console` si aún no hay instancia de Fastify. */
export function getLogger(): AppLogger {
  return appLogger ?? fallbackLogger;
}

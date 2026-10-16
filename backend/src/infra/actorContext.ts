import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Contexto del "actor": el correo de quien origina una escritura (o
 * `sistema:<nombre>` si no hay usuario). Lo consume la extensión de Prisma
 * (`infra/prisma.ts`) para llenar `createdBy` / `updatedBy` sin que cada
 * endpoint tenga que acordarse.
 *
 * El almacén es un objeto MUTABLE: el hook global de Fastify lo crea vacío al
 * empezar el `preHandler` y `authenticate` rellena `actor` cuando ya validó el
 * token. Como todos comparten la misma referencia, lo que se escribe en el
 * almacén es visible desde el handler y desde cualquier `await` posterior.
 */
export interface ActorStore {
  actor: string | null;
}

const als = new AsyncLocalStorage<ActorStore>();

/** Actor vigente, o `null` si no hay contexto (scripts, seed, pruebas directas). */
export function getActor(): string | null {
  return als.getStore()?.actor ?? null;
}

/**
 * Ejecuta `fn` con un actor propio y aislado. Para trabajos periódicos y
 * arranque: `runWithActor("sistema:alert-engine", () => ...)`.
 */
export function runWithActor<T>(actor: string | null, fn: () => T): T {
  return als.run({ actor }, fn);
}

/**
 * Abre un almacén nuevo (actor aún desconocido) y continúa con `next` dentro de
 * él. Lo usa el hook global de Fastify.
 */
export function abrirContextoDeActor(next: () => void): void {
  als.run({ actor: null }, next);
}

/**
 * Fija el actor del contexto actual. Lo llama `authenticate` tras validar la
 * identidad. Si no hay almacén (guard invocado fuera del hook global) NO se abre
 * uno con `enterWith`: ese contexto podría filtrarse a peticiones posteriores y
 * atribuirles autoría ajena. Se falla cerrado: sin actor la extensión de Prisma
 * no estampa nada, y se deja un aviso.
 */
export function setActor(actor: string): void {
  const store = als.getStore();
  if (store) {
    store.actor = actor;
  } else {
    console.warn(
      "setActor llamado sin contexto de actor: no se fija autoría (¿authenticate fuera del hook global?)",
    );
  }
}

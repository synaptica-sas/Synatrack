import { Prisma, PrismaClient } from "@prisma/client";
import { getActor } from "./actorContext.js";
import { estamparActor } from "./actorStamp.js";

/**
 * Columnas de trazabilidad (`createdBy` / `updatedBy`) que tiene cada modelo,
 * derivadas del esquema: si mañana se agregan a otro modelo, la extensión lo
 * cubre sin tocar nada aquí.
 */
const COLUMNAS_TRAZABILIDAD = ["createdBy", "updatedBy"] as const;

export const camposDeTrazabilidadPorModelo: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  Prisma.dmmf.datamodel.models
    .map((modelo) => {
      const campos = modelo.fields
        .map((campo) => campo.name)
        .filter((nombre) => (COLUMNAS_TRAZABILIDAD as readonly string[]).includes(nombre));
      return [modelo.name, new Set(campos)] as const;
    })
    .filter(([, campos]) => campos.size > 0),
);

/**
 * Cliente de base de datos de toda la app. Extiende `PrismaClient` para que
 * cada escritura complete `createdBy` / `updatedBy` con el actor del contexto
 * (`infra/actorContext.ts`): el usuario del token en una petición, o
 * `sistema:<trabajo>` en un job. No pisa valores explícitos y, sin actor
 * (scripts, seed), no toca nada.
 */
export const prisma = new PrismaClient().$extends({
  name: "trazabilidad-actor",
  query: {
    $allModels: {
      $allOperations({ model, operation, args, query }) {
        const campos = camposDeTrazabilidadPorModelo.get(model);
        if (!campos) return query(args);
        return query(estamparActor(operation, args as Record<string, unknown>, getActor(), campos) as typeof args);
      },
    },
  },
});

/**
 * Tipo del cliente de la app (con la extensión). Úsalo en los helpers que
 * reciben `prisma` en vez de `PrismaClient`, que no es el mismo tipo.
 */
export type DbClient = typeof prisma;

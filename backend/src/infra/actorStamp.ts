/**
 * Lógica pura (sin Prisma ni base de datos) que decide qué columnas de
 * trazabilidad se completan en cada operación. Vive aparte para poder probarla
 * sin BD; la extensión de `infra/prisma.ts` solo la invoca.
 *
 * Reglas: nunca se pisa un valor explícito (`!== undefined`); sin actor no se
 * toca nada; las escrituras anidadas (relaciones dentro de `data`) NO se
 * recorren -- ver documentacion/cambios/R9-auditoria.md.
 */

type Datos = Record<string, unknown>;
type Args = Record<string, unknown> | undefined;

function conCreacion(data: Datos, actor: string, campos: ReadonlySet<string>): Datos {
  const salida: Datos = { ...data };
  if (campos.has("createdBy") && salida.createdBy === undefined) salida.createdBy = actor;
  if (campos.has("updatedBy") && salida.updatedBy === undefined) salida.updatedBy = actor;
  return salida;
}

function conEdicion(data: Datos, actor: string, campos: ReadonlySet<string>): Datos {
  // Un update vacío (`update: {}` de un upsert que solo busca-o-crea) es un no-op:
  // estamparlo lo convertiría en UPDATE real, pisaría `updatedBy` y dispararía
  // `@updatedAt`. Sin cambios no hay autoría que registrar.
  if (!data || Object.keys(data).length === 0) return data;
  const salida: Datos = { ...data };
  if (campos.has("updatedBy") && salida.updatedBy === undefined) salida.updatedBy = actor;
  return salida;
}

/**
 * Devuelve los `args` con las columnas de trazabilidad completadas. No muta los
 * originales. Si no hay nada que hacer devuelve los mismos `args`.
 *
 * @param campos columnas de trazabilidad que existen en el modelo.
 */
export function estamparActor(
  operation: string,
  args: Args,
  actor: string | null,
  campos: ReadonlySet<string>,
): Args {
  if (!actor || campos.size === 0 || !args) return args;

  switch (operation) {
    case "create":
      return { ...args, data: conCreacion(args.data as Datos, actor, campos) };

    case "createMany":
    case "createManyAndReturn": {
      const data = args.data as Datos | Datos[];
      return {
        ...args,
        data: Array.isArray(data)
          ? data.map((fila) => conCreacion(fila, actor, campos))
          : conCreacion(data, actor, campos),
      };
    }

    case "update":
    case "updateMany":
    case "updateManyAndReturn":
      return { ...args, data: conEdicion(args.data as Datos, actor, campos) };

    case "upsert":
      return {
        ...args,
        create: conCreacion(args.create as Datos, actor, campos),
        update: conEdicion(args.update as Datos, actor, campos),
      };

    default:
      return args;
  }
}

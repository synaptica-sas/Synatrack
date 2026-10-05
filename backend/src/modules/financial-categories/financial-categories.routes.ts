import { AppRole, FinancialEntryType } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, authorize } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";
import { AUDIT_ENTITIES, writeAudit } from "../../utils/audit.js";

/**
 * Catálogo de categorías financieras (decisión de negocio D-4).
 *
 * Dirección pidió categorizar los ingresos «con posibilidad de luego editarlos».
 * Eso último es lo que obliga a que el catálogo viva en la base: una lista fija
 * en el frontend —como la que tenían los gastos— no se puede editar sin tocar
 * código y volver a desplegar. Es la misma trampa que cerró D-5 con la jornada.
 *
 * Quién puede tocarlo: **solo ADMIN** para escribir, igual que la jornada
 * laboral o los recargos de horas extra. Leerlo lo puede hacer cualquier rol
 * autenticado, porque el desplegable del formulario de gastos e ingresos lo
 * necesita y un nombre de categoría no expone ningún dato sensible.
 *
 * El movimiento guarda el **nombre** de la categoría, no su id (ver el
 * comentario de `FinancialEntry.category`). Por eso renombrar propaga el nombre
 * nuevo a los movimientos que la usaban, dentro de una transacción.
 */

const listQuerySchema = z.object({
  type: z.nativeEnum(FinancialEntryType).optional(),
  // El desplegable de un formulario solo quiere las activas; la pantalla de
  // administración las quiere todas para poder reactivar una.
  includeInactive: z
    .enum(["true", "false"])
    .optional()
    .transform((valor) => valor === "true"),
});

const createSchema = z.object({
  type: z.nativeEnum(FinancialEntryType),
  name: z.string().trim().min(1).max(60),
  active: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(999).optional(),
});

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    active: z.boolean().optional(),
    sortOrder: z.coerce.number().int().min(0).max(999).optional(),
  })
  .refine((valor) => Object.keys(valor).length > 0, {
    message: "No hay nada que cambiar",
  });

const idParamsSchema = z.object({ id: z.string().min(1) });

type FilaCategoria = {
  id: string;
  type: FinancialEntryType;
  name: string;
  active: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

function serializar(fila: FilaCategoria) {
  return {
    id: fila.id,
    type: fila.type,
    name: fila.name,
    active: fila.active,
    sortOrder: fila.sortOrder,
    createdAt: fila.createdAt,
    updatedAt: fila.updatedAt,
  };
}

/**
 * Comprueba que `category` es una categoría **activa** del tipo indicado.
 *
 * La usan las rutas de ingresos. Devuelve el nombre tal y como está guardado en
 * el catálogo (para que "otros ingresos" no entre como variante de "Otros
 * ingresos"), o `null` si no existe o está desactivada.
 */
export async function resolverCategoriaActiva(
  type: FinancialEntryType,
  category: string,
): Promise<string | null> {
  const fila = await prisma.financialCategory.findFirst({
    where: {
      type,
      active: true,
      name: { equals: category.trim(), mode: "insensitive" },
    },
    select: { name: true },
  });
  return fila?.name ?? null;
}

export async function financialCategoriesRoutes(app: FastifyInstance) {
  // GET /api/financial-categories?type=REVENUE
  app.get(
    "/",
    {
      preHandler: [
        authenticate,
        authorize([
          AppRole.ADMIN,
          AppRole.PM,
          AppRole.FINANCE,
          AppRole.CONSULTANT,
          AppRole.VIEWER,
        ]),
      ],
    },
    async (request) => {
      const { type, includeInactive } = listQuerySchema.parse(request.query);

      const categorias = await prisma.financialCategory.findMany({
        where: { type, active: includeInactive ? undefined : true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      });

      return { data: categorias.map(serializar) };
    },
  );

  // POST /api/financial-categories
  app.post(
    "/",
    { preHandler: [authenticate, authorize([AppRole.ADMIN])] },
    async (request, reply) => {
      const payload = createSchema.parse(request.body);

      const yaExiste = await prisma.financialCategory.findFirst({
        where: { type: payload.type, name: { equals: payload.name, mode: "insensitive" } },
      });
      if (yaExiste) {
        return reply
          .status(409)
          .send({ message: `Ya existe una categoría llamada "${yaExiste.name}"` });
      }

      const fila = await prisma.financialCategory.create({
        data: {
          type: payload.type,
          name: payload.name,
          active: payload.active ?? true,
          sortOrder: payload.sortOrder ?? 50,
        },
      });

      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.financialCategory,
        entityId: fila.id,
        action: "CREATE",
        changedBy: request.authUser!.email,
        after: serializar(fila),
        request,
      });

      return reply.status(201).send({ data: serializar(fila) });
    },
  );

  // PUT /api/financial-categories/:id
  app.put(
    "/:id",
    { preHandler: [authenticate, authorize([AppRole.ADMIN])] },
    async (request, reply) => {
      const { id } = idParamsSchema.parse(request.params);
      const payload = updateSchema.parse(request.body);

      const antes = await prisma.financialCategory.findUnique({ where: { id } });
      if (!antes) return reply.status(404).send({ message: "Categoría no encontrada" });

      const nombreNuevo = payload.name ?? antes.name;

      if (nombreNuevo.toLowerCase() !== antes.name.toLowerCase()) {
        const choque = await prisma.financialCategory.findFirst({
          where: {
            type: antes.type,
            name: { equals: nombreNuevo, mode: "insensitive" },
            id: { not: id },
          },
        });
        if (choque) {
          return reply
            .status(409)
            .send({ message: `Ya existe una categoría llamada "${choque.name}"` });
        }
      }

      // Renombrar arrastra los movimientos ya registrados. Sin esto, cambiar
      // "Viajes" por "Viajes y dietas" dejaría huérfanos todos los gastos
      // anteriores: seguirían diciendo "Viajes", que ya no sería una categoría.
      const [fila, arrastrados] = await prisma.$transaction(async (tx) => {
        const actualizada = await tx.financialCategory.update({
          where: { id },
          data: {
            name: nombreNuevo,
            active: payload.active ?? antes.active,
            sortOrder: payload.sortOrder ?? antes.sortOrder,
          },
        });

        let movidos = 0;
        if (nombreNuevo !== antes.name) {
          const resultado = await tx.financialEntry.updateMany({
            where: { type: antes.type, category: antes.name },
            data: { category: nombreNuevo },
          });
          movidos = resultado.count;
        }

        return [actualizada, movidos] as const;
      });

      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.financialCategory,
        entityId: fila.id,
        action: "UPDATE",
        changedBy: request.authUser!.email,
        before: serializar(antes),
        after: { ...serializar(fila), movimientosRenombrados: arrastrados },
        request,
      });

      return { data: { ...serializar(fila), movimientosRenombrados: arrastrados } };
    },
  );

  // DELETE /api/financial-categories/:id
  app.delete(
    "/:id",
    { preHandler: [authenticate, authorize([AppRole.ADMIN])] },
    async (request, reply) => {
      const { id } = idParamsSchema.parse(request.params);

      const fila = await prisma.financialCategory.findUnique({ where: { id } });
      if (!fila) return reply.status(404).send({ message: "Categoría no encontrada" });

      // Borrar una categoría en uso reescribiría la historia contable: los
      // movimientos se quedarían con un nombre que ya no está en ningún sitio.
      // Para eso está desactivarla, que la retira de los formularios y la deja
      // visible en lo ya registrado.
      const enUso = await prisma.financialEntry.count({
        where: { type: fila.type, category: fila.name },
      });
      if (enUso > 0) {
        return reply.status(409).send({
          message: `No se puede eliminar "${fila.name}": ${enUso} movimiento(s) la usan. Desactívala en lugar de borrarla.`,
        });
      }

      await prisma.financialCategory.delete({ where: { id } });

      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.financialCategory,
        entityId: fila.id,
        action: "DELETE",
        changedBy: request.authUser!.email,
        before: serializar(fila),
        request,
      });

      return reply.status(204).send();
    },
  );
}

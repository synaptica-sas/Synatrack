import { useCallback, useMemo, useState } from "react";
import { PageHeader } from "../../components/PageHeader";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { useFinancialCategories } from "../../hooks/useFinancialCategories";
import {
  createFinancialCategory,
  deleteFinancialCategory,
  updateFinancialCategory,
  type FinancialCategory,
  type FinancialCategoryType,
} from "../../services/api";

/**
 * Categorías de gasto e ingreso (decisión de negocio D-4).
 *
 * Dirección pidió «dos campos de categoría de ingresos genéricos con posibilidad
 * de luego editarlos». Esta pantalla es ese «luego editarlos»: sin ella, las
 * categorías serían otra lista fija en el código, como la que tenían los gastos
 * y como era la jornada laboral antes de D-5.
 *
 * Vive en Administración y solo la ve ADMIN (`finance:categories`), por el mismo
 * criterio que Jornada Laboral y Config. Horas Extra: no es un dato operativo
 * sino un parámetro que cambia los formularios de todo el mundo a la vez.
 */

const TIPOS: { id: FinancialCategoryType; titulo: string; ayuda: string }[] = [
  {
    id: "REVENUE",
    titulo: "Categorías de ingreso",
    ayuda:
      "Las que aparecen al registrar un ingreso. Los ingresos registrados antes de que existiera el catálogo no tienen categoría y se muestran como «Sin categoría»; se les puede asignar una editándolos.",
  },
  {
    id: "EXPENSE",
    titulo: "Categorías de gasto",
    ayuda:
      "Las que aparecen al registrar un gasto. Hasta ahora estaban escritas en el código y nadie podía cambiarlas; se trasladaron aquí con los mismos nombres.",
  },
];

type Borrador = { name: string; sortOrder: string };

export function FinancialCategoriesTab({
  canWrite,
  onError,
  onSuccess,
}: {
  canWrite: boolean;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}) {
  // `includeInactive`: la pantalla de administración necesita ver también las
  // desactivadas para poder reactivarlas.
  const { categories, loading, error, reload } = useFinancialCategories(true, undefined, true);

  const [borradores, setBorradores] = useState<Record<string, Borrador>>({});
  const [nuevas, setNuevas] = useState<Record<FinancialCategoryType, string>>({
    REVENUE: "",
    EXPENSE: "",
  });
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aBorrar, setABorrar] = useState<FinancialCategory | null>(null);

  const porTipo = useMemo(() => {
    const mapa: Record<FinancialCategoryType, FinancialCategory[]> = {
      REVENUE: [],
      EXPENSE: [],
    };
    for (const categoria of categories) mapa[categoria.type].push(categoria);
    return mapa;
  }, [categories]);

  const ejecutar = useCallback(
    async (clave: string, accion: () => Promise<void>, exito: string) => {
      setOcupado(clave);
      try {
        await accion();
        await reload();
        onSuccess(exito);
      } catch (err) {
        onError(err instanceof Error ? err.message : "No se pudo guardar la categoría");
      } finally {
        setOcupado(null);
      }
    },
    [reload, onError, onSuccess],
  );

  function borradorDe(categoria: FinancialCategory): Borrador {
    return (
      borradores[categoria.id] ?? {
        name: categoria.name,
        sortOrder: String(categoria.sortOrder),
      }
    );
  }

  function cambiarBorrador(categoria: FinancialCategory, parcial: Partial<Borrador>) {
    setBorradores((previo) => ({
      ...previo,
      [categoria.id]: { ...borradorDe(categoria), ...parcial },
    }));
  }

  function guardar(categoria: FinancialCategory) {
    const borrador = borradorDe(categoria);
    const nombre = borrador.name.trim();
    const orden = Number(borrador.sortOrder);

    if (!nombre) {
      onError("El nombre de la categoría no puede quedar vacío.");
      return;
    }
    if (!Number.isInteger(orden) || orden < 0 || orden > 999) {
      onError("El orden debe ser un número entero entre 0 y 999.");
      return;
    }

    const renombra = nombre !== categoria.name;

    void ejecutar(
      categoria.id,
      async () => {
        const resultado = await updateFinancialCategory(categoria.id, {
          name: nombre,
          sortOrder: orden,
        });
        setBorradores((previo) => {
          const copia = { ...previo };
          delete copia[categoria.id];
          return copia;
        });
        if (renombra && resultado.movimientosRenombrados) {
          onSuccess(
            `"${categoria.name}" pasa a llamarse "${nombre}" en ${resultado.movimientosRenombrados} movimiento(s) ya registrados.`,
          );
        }
      },
      renombra ? `Categoría renombrada a "${nombre}".` : `"${nombre}" guardada.`,
    );
  }

  function alternarActiva(categoria: FinancialCategory) {
    void ejecutar(
      categoria.id,
      async () => {
        await updateFinancialCategory(categoria.id, { active: !categoria.active });
      },
      categoria.active
        ? `"${categoria.name}" ya no aparecerá en los formularios.`
        : `"${categoria.name}" vuelve a estar disponible.`,
    );
  }

  function crear(type: FinancialCategoryType) {
    const nombre = nuevas[type].trim();
    if (!nombre) {
      onError("Escribe un nombre para la categoría nueva.");
      return;
    }

    void ejecutar(
      `nueva:${type}`,
      async () => {
        await createFinancialCategory({ type, name: nombre, sortOrder: 50 });
        setNuevas((previo) => ({ ...previo, [type]: "" }));
      },
      `Categoría "${nombre}" creada.`,
    );
  }

  function borrar() {
    if (!aBorrar) return;
    const categoria = aBorrar;
    setABorrar(null);
    void ejecutar(
      categoria.id,
      () => deleteFinancialCategory(categoria.id),
      `Categoría "${categoria.name}" eliminada.`,
    );
  }

  if (loading && categories.length === 0) {
    return <p className="loading">Cargando el catálogo de categorías…</p>;
  }

  if (error && categories.length === 0) {
    return (
      <div className="notice notice--danger" role="alert">
        <div className="notice__title">No se pudo cargar el catálogo</div>
        <p className="notice__text">{error}</p>
        <button type="button" className="ghost btn-sm" onClick={() => void reload()}>
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="section-stack">
      <PageHeader
        icon="⊞"
        title="Categorías Financieras"
        description="Las categorías que aparecen al registrar un gasto o un ingreso. Se editan aquí, sin tocar código."
      />

      <div className="notice notice--info" role="note">
        <div className="notice__title">Renombrar y desactivar</div>
        <p className="notice__text">
          Cambiar el nombre de una categoría también lo cambia en los movimientos que ya la usaban,
          para que ninguno se quede con un nombre que ya no existe. Una categoría en uso no se puede
          eliminar: desactívala y dejará de ofrecerse en los formularios sin borrar nada de lo ya
          registrado.
        </p>
      </div>

      {TIPOS.map((tipo) => (
        <div className="card" key={tipo.id}>
          <div className="card-head">
            <h3 className="card-title-tight">{tipo.titulo}</h3>
          </div>
          <p className="field-help">{tipo.ayuda}</p>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Orden</th>
                  <th>Estado</th>
                  {canWrite && <th>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {porTipo[tipo.id].length === 0 && (
                  <tr>
                    <td colSpan={canWrite ? 4 : 3} className="empty-note">
                      Todavía no hay categorías de este tipo.
                    </td>
                  </tr>
                )}
                {porTipo[tipo.id].map((categoria) => {
                  const borrador = borradorDe(categoria);
                  const trabajando = ocupado === categoria.id;
                  return (
                    <tr key={categoria.id}>
                      <td>
                        {canWrite ? (
                          <input
                            aria-label={`Nombre de ${categoria.name}`}
                            value={borrador.name}
                            onChange={(e) => cambiarBorrador(categoria, { name: e.target.value })}
                            disabled={trabajando}
                          />
                        ) : (
                          <span className="cell-strong">{categoria.name}</span>
                        )}
                      </td>
                      <td className="cell-right">
                        {canWrite ? (
                          <input
                            aria-label={`Orden de ${categoria.name}`}
                            type="number"
                            min={0}
                            max={999}
                            value={borrador.sortOrder}
                            onChange={(e) =>
                              cambiarBorrador(categoria, { sortOrder: e.target.value })
                            }
                            disabled={trabajando}
                          />
                        ) : (
                          categoria.sortOrder
                        )}
                      </td>
                      <td>
                        <span
                          className={
                            categoria.active
                              ? "state-chip state-chip--success"
                              : "state-chip state-chip--neutral"
                          }
                        >
                          {categoria.active ? "Activa" : "Desactivada"}
                        </span>
                      </td>
                      {canWrite && (
                        <td>
                          <div className="inline-actions">
                            <button
                              type="button"
                              className="btn-sm"
                              disabled={trabajando}
                              onClick={() => guardar(categoria)}
                            >
                              Guardar
                            </button>
                            <button
                              type="button"
                              className="ghost btn-sm"
                              disabled={trabajando}
                              onClick={() => alternarActiva(categoria)}
                            >
                              {categoria.active ? "Desactivar" : "Reactivar"}
                            </button>
                            <button
                              type="button"
                              className="ghost btn-sm"
                              disabled={trabajando}
                              onClick={() => setABorrar(categoria)}
                            >
                              Eliminar
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {canWrite && (
            <form
              className="inline-actions"
              onSubmit={(e) => {
                e.preventDefault();
                crear(tipo.id);
              }}
            >
              <input
                aria-label={`Nueva categoría de ${tipo.id === "REVENUE" ? "ingreso" : "gasto"}`}
                placeholder="Nombre de la categoría nueva"
                value={nuevas[tipo.id]}
                onChange={(e) => setNuevas((previo) => ({ ...previo, [tipo.id]: e.target.value }))}
                disabled={ocupado === `nueva:${tipo.id}`}
              />
              <button type="submit" className="btn-sm" disabled={ocupado === `nueva:${tipo.id}`}>
                Añadir
              </button>
            </form>
          )}
        </div>
      ))}

      <ConfirmDialog
        open={!!aBorrar}
        title="Eliminar categoría"
        message={`¿Eliminar "${aBorrar?.name}"? Si algún movimiento la usa, no se podrá: tendrás que desactivarla.`}
        confirmLabel="Eliminar"
        danger
        onConfirm={borrar}
        onCancel={() => setABorrar(null)}
      />
    </div>
  );
}

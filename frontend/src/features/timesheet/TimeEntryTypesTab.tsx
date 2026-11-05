import { useCallback, useState } from "react";
import { PageHeader } from "../../components/PageHeader";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { useTimeEntryTypes } from "../../hooks/useTimeEntryTypes";
import {
  createTimeEntryType,
  deleteTimeEntryType,
  updateTimeEntryType,
  type TimeEntryType,
  type TimeEntryTypeCategory,
} from "../../services/api";

/**
 * Catálogo de tipos de hora (R14): qué se puede elegir en la columna "Tipo" del
 * timesheet. La categoría es lo que el sistema interpreta (cuenta contra la
 * jornada, exige solicitud de horas extra, o es una ausencia); el nombre es
 * libre. Solo lo administra ADMIN (`time:types`).
 */

const CATEGORIA: Record<TimeEntryTypeCategory, string> = {
  REGULAR: "Regular",
  EXTRA: "Extra",
  ABSENCE: "Ausencia",
};

const CATEGORIA_AYUDA: Record<TimeEntryTypeCategory, string> = {
  REGULAR: "Cuenta contra la jornada del día.",
  EXTRA: "Solo con solicitud de horas extra aprobada; no cuenta contra la jornada.",
  ABSENCE: "Cuenta contra la jornada; solo en el proyecto Ausencias.",
};

/** Bloqueo de capacidad que genera una ausencia que cubre la jornada completa. */
const BLOQUEOS: { id: string; label: string }[] = [
  { id: "VACATION", label: "Vacaciones" },
  { id: "SICK_LEAVE", label: "Incapacidad" },
  { id: "TRAINING", label: "Capacitación" },
  { id: "INTERNAL_BENCH", label: "Banca interna" },
  { id: "OTHER", label: "Otro" },
];

const etiquetaBloqueo = (id: string | null) => BLOQUEOS.find((b) => b.id === id)?.label ?? id ?? "—";

type Borrador = { name: string; sortOrder: string };

export function TimeEntryTypesTab({
  canWrite,
  onError,
  onSuccess,
}: {
  canWrite: boolean;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}) {
  const { types, loading, error, reload } = useTimeEntryTypes(true, true);

  const [borradores, setBorradores] = useState<Record<string, Borrador>>({});
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [nuevaCategoria, setNuevaCategoria] = useState<TimeEntryTypeCategory>("REGULAR");
  const [nuevoBloqueo, setNuevoBloqueo] = useState("OTHER");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aBorrar, setABorrar] = useState<TimeEntryType | null>(null);

  const ejecutar = useCallback(
    async (clave: string, accion: () => Promise<void>, exito: string) => {
      setOcupado(clave);
      try {
        await accion();
        await reload();
        onSuccess(exito);
      } catch (err) {
        // Los 409 del servidor ya vienen en español ("Desactívalo en vez de borrarlo", ...).
        onError(err instanceof Error ? err.message : "No se pudo guardar el tipo de hora");
      } finally {
        setOcupado(null);
      }
    },
    [reload, onError, onSuccess],
  );

  function borradorDe(t: TimeEntryType): Borrador {
    return borradores[t.id] ?? { name: t.name, sortOrder: String(t.sortOrder) };
  }

  function cambiarBorrador(t: TimeEntryType, parcial: Partial<Borrador>) {
    setBorradores((previo) => ({ ...previo, [t.id]: { ...borradorDe(t), ...parcial } }));
  }

  function guardar(t: TimeEntryType) {
    const b = borradorDe(t);
    const nombre = b.name.trim();
    const orden = Number(b.sortOrder);
    if (!nombre) {
      onError("El nombre del tipo de hora no puede quedar vacío.");
      return;
    }
    if (!Number.isInteger(orden) || orden < 0 || orden > 999) {
      onError("El orden debe ser un número entero entre 0 y 999.");
      return;
    }
    void ejecutar(
      t.id,
      async () => {
        await updateTimeEntryType(t.id, { name: nombre, sortOrder: orden });
        setBorradores((previo) => {
          const copia = { ...previo };
          delete copia[t.id];
          return copia;
        });
      },
      `"${nombre}" guardado.`,
    );
  }

  function alternarActivo(t: TimeEntryType) {
    void ejecutar(
      t.id,
      async () => {
        await updateTimeEntryType(t.id, { active: !t.active });
      },
      t.active
        ? `"${t.name}" ya no se ofrece en el timesheet.`
        : `"${t.name}" vuelve a estar disponible.`,
    );
  }

  function crear() {
    const nombre = nuevoNombre.trim();
    if (!nombre) {
      onError("Escribe un nombre para el tipo de hora nuevo.");
      return;
    }
    void ejecutar(
      "nuevo",
      async () => {
        await createTimeEntryType({
          name: nombre,
          category: nuevaCategoria,
          ...(nuevaCategoria === "ABSENCE" ? { blockType: nuevoBloqueo } : {}),
          sortOrder: 50,
        });
        setNuevoNombre("");
      },
      `Tipo de hora "${nombre}" creado.`,
    );
  }

  function borrar() {
    if (!aBorrar) return;
    const t = aBorrar;
    setABorrar(null);
    void ejecutar(t.id, () => deleteTimeEntryType(t.id), `Tipo de hora "${t.name}" eliminado.`);
  }

  if (loading && types.length === 0) {
    return <p className="loading">Cargando el catálogo de tipos de hora…</p>;
  }

  if (error && types.length === 0) {
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
        icon="⌚"
        title="Tipos de Hora"
        description="Los tipos que se eligen al registrar tiempo en el timesheet. Se editan aquí, sin tocar código."
      />

      <div className="notice notice--info" role="note">
        <div className="notice__title">Cómo funciona</div>
        <p className="notice__text">
          La categoría es lo que el sistema interpreta y no se puede cambiar en los tipos base: Regular
          cuenta contra la jornada, Extra exige una solicitud de horas extra aprobada y Ausencia solo
          se usa en el proyecto Ausencias. Los tipos base se pueden renombrar y reordenar, pero no
          borrar. Un tipo con registros no se elimina: desactívalo y dejará de ofrecerse sin tocar lo ya
          registrado.
        </p>
      </div>

      <div className="card">
        <div className="card-head">
          <h3 className="card-title-tight">Catálogo</h3>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Categoría</th>
                <th>Orden</th>
                <th>Registros</th>
                <th>Estado</th>
                {canWrite && <th>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {types.length === 0 && (
                <tr>
                  <td colSpan={canWrite ? 6 : 5} className="empty-note">
                    Todavía no hay tipos de hora.
                  </td>
                </tr>
              )}
              {types.map((t) => {
                const b = borradorDe(t);
                const trabajando = ocupado === t.id;
                const esBase = t.code !== null;
                const esRegular = t.category === "REGULAR" && esBase;
                return (
                  <tr key={t.id}>
                    <td>
                      {canWrite ? (
                        <input
                          aria-label={`Nombre de ${t.name}`}
                          value={b.name}
                          onChange={(e) => cambiarBorrador(t, { name: e.target.value })}
                          disabled={trabajando}
                        />
                      ) : (
                        <span className="cell-strong">{t.name}</span>
                      )}
                      {esBase && <span className="cell-meta">Tipo base</span>}
                    </td>
                    <td title={CATEGORIA_AYUDA[t.category]}>
                      {CATEGORIA[t.category]}
                      {t.category === "ABSENCE" && (
                        <span className="cell-meta">Bloqueo: {etiquetaBloqueo(t.blockType)}</span>
                      )}
                    </td>
                    <td className="cell-right">
                      {canWrite ? (
                        <input
                          aria-label={`Orden de ${t.name}`}
                          type="number"
                          min={0}
                          max={999}
                          value={b.sortOrder}
                          onChange={(e) => cambiarBorrador(t, { sortOrder: e.target.value })}
                          disabled={trabajando}
                        />
                      ) : (
                        t.sortOrder
                      )}
                    </td>
                    <td className="cell-right">{t.entriesCount ?? "—"}</td>
                    <td>
                      <span
                        className={t.active ? "state-chip state-chip--success" : "state-chip state-chip--neutral"}
                      >
                        {t.active ? "Activo" : "Desactivado"}
                      </span>
                    </td>
                    {canWrite && (
                      <td>
                        <div className="inline-actions">
                          <button type="button" className="btn-sm" disabled={trabajando} onClick={() => guardar(t)}>
                            Guardar
                          </button>
                          <button
                            type="button"
                            className="ghost btn-sm"
                            disabled={trabajando || esRegular}
                            title={esRegular ? "Horas Regulares no se puede desactivar" : undefined}
                            onClick={() => alternarActivo(t)}
                          >
                            {t.active ? "Desactivar" : "Reactivar"}
                          </button>
                          <button
                            type="button"
                            className="ghost btn-sm"
                            disabled={trabajando || esBase}
                            title={esBase ? "Los tipos base no se pueden borrar" : undefined}
                            onClick={() => setABorrar(t)}
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
              crear();
            }}
          >
            <input
              aria-label="Nombre del tipo de hora nuevo"
              placeholder="Nombre del tipo nuevo"
              value={nuevoNombre}
              onChange={(e) => setNuevoNombre(e.target.value)}
              disabled={ocupado === "nuevo"}
            />
            <select
              aria-label="Categoría del tipo nuevo"
              value={nuevaCategoria}
              onChange={(e) => setNuevaCategoria(e.target.value as TimeEntryTypeCategory)}
              disabled={ocupado === "nuevo"}
            >
              {(Object.keys(CATEGORIA) as TimeEntryTypeCategory[]).map((c) => (
                <option key={c} value={c}>
                  {CATEGORIA[c]}
                </option>
              ))}
            </select>
            {nuevaCategoria === "ABSENCE" && (
              <select
                aria-label="Bloqueo de capacidad"
                value={nuevoBloqueo}
                onChange={(e) => setNuevoBloqueo(e.target.value)}
                disabled={ocupado === "nuevo"}
              >
                {BLOQUEOS.map((b) => (
                  <option key={b.id} value={b.id}>
                    Bloquea como: {b.label}
                  </option>
                ))}
              </select>
            )}
            <button type="submit" className="btn-sm" disabled={ocupado === "nuevo"}>
              Añadir
            </button>
          </form>
        )}
      </div>

      <ConfirmDialog
        open={!!aBorrar}
        title="Eliminar tipo de hora"
        message={`¿Eliminar "${aBorrar?.name}"? Si ya tiene registros no se podrá: tendrás que desactivarlo.`}
        confirmLabel="Eliminar"
        danger
        onConfirm={borrar}
        onCancel={() => setABorrar(null)}
      />
    </div>
  );
}

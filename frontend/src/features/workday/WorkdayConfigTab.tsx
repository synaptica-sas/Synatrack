import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { PageHeader } from "../../components/PageHeader";
import { useWorkdayConfig } from "../../hooks/useWorkdayConfig";
import {
  deleteConsultantWorkday,
  deleteCountryWorkday,
  updateConsultantWorkday,
  updateCountryWorkday,
  type JornadaFila,
} from "../../services/api";
import { formatDate } from "../../utils/formatDate";
import { CapacityThresholdsSection } from "./CapacityThresholdsSection";
import { hoyIso, marcarVigencias, type FilaConEstado } from "./workdayUtils";

/**
 * Parámetros de capacity y jornada laboral (decisión de negocio D-5).
 *
 * Vive en Administración y no dentro de Capacidad a propósito: Capacidad es una
 * matriz de lectura, mientras que esto mueve de golpe las ocupaciones de todo el
 * portafolio y solo toca ADMIN (`capacity:config`).
 *
 * La jornada tiene vigencia: cada país o consultor puede tener varias filas con
 * "Vigente desde", y a un día le aplica la de mayor fecha que no sea posterior.
 * La precedencia es consultor, luego su país y luego la fila general `Default`.
 */

/** Países que admite el backend (`utils/country.ts`), con el general al final. */
const PAISES = ["Colombia", "Peru", "Chile", "Mexico", "Ecuador", "Argentina", "España", "Default"];

/** 8.5 → "8,5". El producto usa coma decimal. */
function formatHoras(horas: number): string {
  return horas.toLocaleString("es-CO", { maximumFractionDigits: 2 });
}

const ETIQUETA_ORIGEN: Record<string, { texto: string; chip: string }> = {
  consultor: { texto: "Propia", chip: "state-chip--info" },
  pais: { texto: "De su país", chip: "state-chip--success" },
  general: { texto: "General", chip: "state-chip--neutral" },
};

const ETIQUETA_ESTADO: Record<FilaConEstado["estado"], { texto: string; chip: string }> = {
  vigente: { texto: "Vigente hoy", chip: "state-chip--success" },
  futura: { texto: "Futura", chip: "state-chip--info" },
  anterior: { texto: "Anterior", chip: "state-chip--neutral" },
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type Borrador = {
  tipo: "pais" | "consultor";
  objetivo: string;
  hoursPerDay: string;
  workDaysPerWeek: string;
  validFrom: string;
};

const BORRADOR_INICIAL: Borrador = {
  tipo: "pais",
  objetivo: "Colombia",
  hoursPerDay: "8",
  workDaysPerWeek: "5",
  validFrom: "",
};

function validar(b: Borrador): string | null {
  const horas = Number(b.hoursPerDay.replace(",", "."));
  const dias = Number(b.workDaysPerWeek);
  if (!Number.isFinite(horas) || horas <= 0 || horas > 24) {
    return "Las horas al día deben estar entre 0 y 24.";
  }
  if (!Number.isInteger(dias) || dias < 1 || dias > 7) {
    return "Los días a la semana deben ser un número entero entre 1 y 7.";
  }
  if (!ISO_DATE.test(b.validFrom)) return "Indica desde qué fecha rige la jornada.";
  if (!b.objetivo) return "Elige el país o el consultor.";
  return null;
}

export function WorkdayConfigTab({
  canWrite,
  onError,
  onSuccess,
}: {
  canWrite: boolean;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}) {
  const { config, loading, error, reload } = useWorkdayConfig(true);
  const [borrador, setBorrador] = useState<Borrador>(BORRADOR_INICIAL);
  const [guardando, setGuardando] = useState(false);
  const [aBorrar, setABorrar] = useState<FilaConEstado | null>(null);

  const hoy = hoyIso();

  const nombreConsultor = useMemo(
    () => new Map((config?.consultants ?? []).map((c) => [c.consultantId, c.fullName])),
    [config],
  );

  // Todas las filas (países + historial de cada consultor), con su estado de vigencia.
  const historial = useMemo(() => {
    if (!config) return [];
    const filasConsultor: JornadaFila[] = config.consultants.flatMap((c) =>
      c.filas ?? (c.propia ? [c.propia] : []),
    );
    return marcarVigencias([...config.countries, ...filasConsultor], hoy);
  }, [config, hoy]);

  async function agregar(e: FormEvent) {
    e.preventDefault();
    const problema = validar(borrador);
    if (problema) {
      onError(problema);
      return;
    }
    const payload = {
      hoursPerDay: Number(borrador.hoursPerDay.replace(",", ".")),
      workDaysPerWeek: Number(borrador.workDaysPerWeek),
      validFrom: borrador.validFrom,
    };
    setGuardando(true);
    try {
      if (borrador.tipo === "pais") await updateCountryWorkday(borrador.objetivo, payload);
      else await updateConsultantWorkday(borrador.objetivo, payload);
      await reload();
      onSuccess(`Vigencia guardada desde ${formatDate(borrador.validFrom)}.`);
      setBorrador((p) => ({ ...p, validFrom: "" }));
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo guardar la jornada");
    } finally {
      setGuardando(false);
    }
  }

  async function borrar() {
    if (!aBorrar) return;
    const fila = aBorrar;
    setABorrar(null);
    try {
      if (fila.consultantId) await deleteConsultantWorkday(fila.consultantId, fila.validFrom);
      else if (fila.country) await deleteCountryWorkday(fila.country, fila.validFrom);
      await reload();
      onSuccess("Vigencia eliminada.");
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo eliminar la vigencia");
    }
  }

  if (loading && !config) {
    return <p className="loading">Cargando la jornada configurada…</p>;
  }

  if (error && !config) {
    return (
      <div className="notice notice--danger" role="alert">
        <div className="notice__title">No se pudo cargar la jornada</div>
        <p className="notice__text">{error}</p>
        <button type="button" className="ghost btn-sm" onClick={() => void reload()}>
          Reintentar
        </button>
      </div>
    );
  }

  if (!config) return null;

  return (
    <div className="section-stack">
      <PageHeader
        icon="⌛"
        title="Parámetros y jornada"
        description="Umbrales del capacity mensual y jornada laboral (horas al día y días a la semana) por país o consultor, con vigencia."
      />

      {!canWrite && (
        <div className="notice notice--warning" role="note">
          <div className="notice__title">Solo lectura</div>
          <p className="notice__text">
            No tiene permiso para cambiar estos parámetros. Puede consultarlos, pero no guardarlos.
          </p>
        </div>
      )}

      <CapacityThresholdsSection canWrite={canWrite} onError={onError} onSuccess={onSuccess} />

      <div className="notice notice--info" role="note">
        <div className="notice__title">Cómo se decide la jornada de cada persona</div>
        <p className="notice__text">
          Manda lo que tenga el consultor; si no, la de su país; si su país no está configurado, la
          jornada general ({config.paisGeneral}). Cuando cambie la ley (p. ej. Colombia 42 → 40 h),
          agrega una nueva vigencia; los meses anteriores no cambian.
        </p>
      </div>

      {/* ── Agregar vigencia ─────────────────────────────────────────────── */}
      {canWrite && (
        <article className="card">
          <div className="card-head">
            <h3>Agregar vigencia</h3>
          </div>
          <form onSubmit={(e) => void agregar(e)} className="field-grid field-grid--compact">
            <div>
              <label className="field-label" htmlFor="jornada-tipo">Aplica a</label>
              <select
                id="jornada-tipo"
                className="select-control"
                value={borrador.tipo}
                onChange={(e) => {
                  const tipo = e.target.value as Borrador["tipo"];
                  setBorrador((p) => ({
                    ...p,
                    tipo,
                    objetivo: tipo === "pais" ? PAISES[0] : (config.consultants[0]?.consultantId ?? ""),
                  }));
                }}
              >
                <option value="pais">País</option>
                <option value="consultor">Consultor</option>
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="jornada-objetivo">
                {borrador.tipo === "pais" ? "País" : "Consultor"}
              </label>
              <select
                id="jornada-objetivo"
                className="select-control"
                value={borrador.objetivo}
                onChange={(e) => setBorrador((p) => ({ ...p, objetivo: e.target.value }))}
              >
                {borrador.tipo === "pais"
                  ? PAISES.map((p) => (
                      <option key={p} value={p}>
                        {p === config.paisGeneral ? `${p} (jornada general)` : p}
                      </option>
                    ))
                  : config.consultants.map((c) => (
                      <option key={c.consultantId} value={c.consultantId}>{c.fullName}</option>
                    ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="jornada-horas">Horas al día</label>
              <input
                id="jornada-horas"
                type="number"
                min={0.5}
                max={24}
                step={0.05}
                value={borrador.hoursPerDay}
                onChange={(e) => setBorrador((p) => ({ ...p, hoursPerDay: e.target.value }))}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="jornada-dias">Días a la semana</label>
              <input
                id="jornada-dias"
                type="number"
                min={1}
                max={7}
                step={1}
                value={borrador.workDaysPerWeek}
                onChange={(e) => setBorrador((p) => ({ ...p, workDaysPerWeek: e.target.value }))}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="jornada-desde">Vigente desde</label>
              <input
                id="jornada-desde"
                type="date"
                value={borrador.validFrom}
                onChange={(e) => setBorrador((p) => ({ ...p, validFrom: e.target.value }))}
                required
              />
            </div>
            <div className="inline-actions">
              <button type="submit" disabled={guardando}>
                {guardando ? "Guardando…" : "Guardar vigencia"}
              </button>
            </div>
          </form>
          <p className="field-help">
            Si ya existe una fila con la misma fecha para ese país o consultor, se reemplaza.
          </p>
        </article>
      )}

      {/* ── Historial ────────────────────────────────────────────────────── */}
      <article className="card">
        <div className="card-head">
          <h3>Historial de vigencias</h3>
        </div>
        {historial.length === 0 ? (
          <p className="empty-note">No hay jornadas configuradas; se usa la general del sistema.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Aplica a</th>
                  <th>Vigente desde</th>
                  <th className="cell-right">Horas al día</th>
                  <th className="cell-right">Días a la semana</th>
                  <th>Estado</th>
                  {canWrite && <th>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {historial.map((f) => {
                  const estado = ETIQUETA_ESTADO[f.estado];
                  const nombre = f.consultantId
                    ? `Consultor: ${nombreConsultor.get(f.consultantId) ?? f.consultantId}`
                    : f.country === config.paisGeneral
                      ? `${f.country} (jornada general)`
                      : `País: ${f.country}`;
                  return (
                    <tr key={f.id} className={f.estado === "vigente" ? "row-current" : undefined}>
                      <td className="cell-strong">{nombre}</td>
                      <td>{formatDate(f.validFrom)}</td>
                      <td className="cell-right">{formatHoras(f.hoursPerDay)}</td>
                      <td className="cell-right">{f.workDaysPerWeek}</td>
                      <td><span className={`state-chip ${estado.chip}`}>{estado.texto}</span></td>
                      {canWrite && (
                        <td>
                          <button type="button" className="ghost btn-sm" onClick={() => setABorrar(f)}>
                            Eliminar
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="field-help">
          La jornada general vigente no se puede eliminar: es la que hereda cualquier país sin
          configuración propia.
        </p>
      </article>

      {/* ── Resumen por consultor ────────────────────────────────────────── */}
      <article className="card">
        <div className="card-head">
          <h3>Jornada vigente por consultor</h3>
        </div>
        {config.consultants.length === 0 ? (
          <p className="empty-note">No hay consultores activos.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Consultor</th>
                  <th>País</th>
                  <th className="cell-right">Jornada vigente</th>
                  <th>Origen</th>
                </tr>
              </thead>
              <tbody>
                {config.consultants.map((c) => {
                  const origen = ETIQUETA_ORIGEN[c.efectiva.origen] ?? ETIQUETA_ORIGEN.general;
                  return (
                    <tr key={c.consultantId}>
                      <td className="cell-strong">{c.fullName}</td>
                      <td>{c.country ?? "—"}</td>
                      <td className="cell-right">
                        {formatHoras(c.efectiva.hoursPerDay)} h × {c.efectiva.workDaysPerWeek} d
                      </td>
                      <td><span className={`state-chip ${origen.chip}`}>{origen.texto}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </article>

      <ConfirmDialog
        open={!!aBorrar}
        title="Eliminar vigencia"
        message={`¿Eliminar la jornada vigente desde ${formatDate(aBorrar?.validFrom)}? Los meses afectados se recalcularán con la vigencia anterior.`}
        confirmLabel="Eliminar"
        danger
        onConfirm={() => void borrar()}
        onCancel={() => setABorrar(null)}
      />
    </div>
  );
}

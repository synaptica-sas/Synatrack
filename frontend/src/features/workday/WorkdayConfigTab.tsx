import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "../../components/PageHeader";
import { useWorkdayConfig } from "../../hooks/useWorkdayConfig";
import {
  deleteConsultantWorkday,
  deleteCountryWorkday,
  updateConsultantWorkday,
  updateCountryWorkday,
  type JornadaDeConsultor,
  type JornadaFila,
} from "../../services/api";

/**
 * Jornada laboral, por país y por consultor (decisión de negocio D-5).
 *
 * Vive en Administración y no dentro de Capacidad a propósito: Capacidad es una
 * matriz de lectura que ven PM, Finanzas y VIEWER, mientras que esto es un
 * parámetro que mueve de golpe las ocupaciones de todo el portafolio y solo
 * toca ADMIN (`capacity:config`). Es el mismo sitio y el mismo criterio que
 * "Config. Horas Extra".
 *
 * La precedencia que aplica el backend es consultor → su país → la fila general
 * `Default`. La pantalla la muestra tal cual: cada consultor lleva una insignia
 * que dice de dónde salió su jornada.
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

type Borrador = { hoursPerDay: string; workDaysPerWeek: string };

function aBorrador(fila: { hoursPerDay: number; workDaysPerWeek: number }): Borrador {
  return {
    hoursPerDay: String(fila.hoursPerDay),
    workDaysPerWeek: String(fila.workDaysPerWeek),
  };
}

function validar(borrador: Borrador): string | null {
  const horas = Number(borrador.hoursPerDay.replace(",", "."));
  const dias = Number(borrador.workDaysPerWeek);
  if (!Number.isFinite(horas) || horas <= 0 || horas > 24) {
    return "Las horas al día deben estar entre 0 y 24.";
  }
  if (!Number.isInteger(dias) || dias < 1 || dias > 7) {
    return "Los días a la semana deben ser un número entero entre 1 y 7.";
  }
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

  const [paises, setPaises] = useState<Record<string, Borrador>>({});
  const [consultores, setConsultores] = useState<Record<string, Borrador>>({});
  const [guardando, setGuardando] = useState<string | null>(null);

  // Al llegar la configuración, los campos arrancan con lo que hay guardado.
  useEffect(() => {
    if (!config) return;
    const porPais: Record<string, Borrador> = {};
    for (const country of PAISES) {
      const fila = config.countries.find((c: JornadaFila) => c.country === country);
      porPais[country] = fila
        ? aBorrador(fila)
        : aBorrador(config.general);
    }
    setPaises(porPais);

    const porConsultor: Record<string, Borrador> = {};
    for (const c of config.consultants) {
      porConsultor[c.consultantId] = aBorrador(c.propia ?? c.efectiva);
    }
    setConsultores(porConsultor);
  }, [config]);

  const ejecutar = useCallback(
    async (clave: string, accion: () => Promise<void>, exito: string) => {
      setGuardando(clave);
      try {
        await accion();
        await reload();
        onSuccess(exito);
      } catch (err) {
        onError(err instanceof Error ? err.message : "No se pudo guardar la jornada");
      } finally {
        setGuardando(null);
      }
    },
    [reload, onError, onSuccess],
  );

  function guardarPais(country: string) {
    const borrador = paises[country];
    const problema = validar(borrador);
    if (problema) {
      onError(problema);
      return;
    }
    void ejecutar(
      `pais:${country}`,
      async () => {
        await updateCountryWorkday(country, {
          hoursPerDay: Number(borrador.hoursPerDay.replace(",", ".")),
          workDaysPerWeek: Number(borrador.workDaysPerWeek),
        });
      },
      `Jornada de ${country} guardada.`,
    );
  }

  function quitarPais(country: string) {
    void ejecutar(
      `pais:${country}`,
      () => deleteCountryWorkday(country),
      `${country} vuelve a la jornada general.`,
    );
  }

  function guardarConsultor(consultor: JornadaDeConsultor) {
    const borrador = consultores[consultor.consultantId];
    const problema = validar(borrador);
    if (problema) {
      onError(problema);
      return;
    }
    void ejecutar(
      `consultor:${consultor.consultantId}`,
      async () => {
        await updateConsultantWorkday(consultor.consultantId, {
          hoursPerDay: Number(borrador.hoursPerDay.replace(",", ".")),
          workDaysPerWeek: Number(borrador.workDaysPerWeek),
        });
      },
      `Jornada propia de ${consultor.fullName} guardada.`,
    );
  }

  function quitarConsultor(consultor: JornadaDeConsultor) {
    void ejecutar(
      `consultor:${consultor.consultantId}`,
      () => deleteConsultantWorkday(consultor.consultantId),
      `${consultor.fullName} vuelve a heredar la jornada de su país.`,
    );
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

  const general = config.countries.find((c) => c.country === config.paisGeneral);

  return (
    <div className="section-stack">
      <PageHeader
        icon="⏱"
        title="Jornada Laboral"
        description="Horas al día y días a la semana con que se calcula la capacidad y las horas extra del informe. Se configura por país, y un consultor puede tener la suya propia."
      />

      <div className="notice notice--info" role="note">
        <div className="notice__title">Cómo se decide la jornada de cada persona</div>
        <p className="notice__text">
          Manda lo que tenga el consultor. Si no tiene nada propio, se usa la de su país. Y si su
          país no está configurado, se usa la jornada general ({config.paisGeneral}), hoy en{" "}
          {general ? formatHoras(general.hoursPerDay) : formatHoras(config.general.hoursPerDay)} h
          al día. Cambiar cualquiera de estos valores cambia de inmediato la matriz de capacidad y
          lo que el informe semanal pinta como horas extra.
        </p>
      </div>

      {!canWrite && (
        <div className="notice notice--warning" role="note">
          <div className="notice__title">Solo lectura</div>
          <p className="notice__text">
            No tiene permiso para cambiar la jornada laboral. Puede consultarla, pero no guardarla.
          </p>
        </div>
      )}

      {/* ── Por país ─────────────────────────────────────────────────────── */}
      <article className="card">
        <div className="card-head">
          <h3>Jornada por país</h3>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>País</th>
                <th className="cell-right">Horas al día</th>
                <th className="cell-right">Días a la semana</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {PAISES.map((country) => {
                const fila = config.countries.find((c) => c.country === country) ?? null;
                const borrador = paises[country] ?? aBorrador(config.general);
                const esGeneral = country === config.paisGeneral;
                const ocupado = guardando === `pais:${country}`;

                return (
                  <tr key={country}>
                    <td className="cell-strong">
                      {esGeneral ? `${country} (jornada general)` : country}
                    </td>
                    <td className="cell-right">
                      <input
                        type="number"
                        min={0.5}
                        max={24}
                        step={0.25}
                        value={borrador.hoursPerDay}
                        disabled={!canWrite || ocupado}
                        aria-label={`Horas al día en ${country}`}
                        onChange={(e) =>
                          setPaises((prev) => ({
                            ...prev,
                            [country]: { ...borrador, hoursPerDay: e.target.value },
                          }))
                        }
                      />
                    </td>
                    <td className="cell-right">
                      <input
                        type="number"
                        min={1}
                        max={7}
                        step={1}
                        value={borrador.workDaysPerWeek}
                        disabled={!canWrite || ocupado}
                        aria-label={`Días a la semana en ${country}`}
                        onChange={(e) =>
                          setPaises((prev) => ({
                            ...prev,
                            [country]: { ...borrador, workDaysPerWeek: e.target.value },
                          }))
                        }
                      />
                    </td>
                    <td>
                      {fila ? (
                        <span className="state-chip state-chip--success">Configurado</span>
                      ) : (
                        <span className="state-chip state-chip--neutral">Hereda la general</span>
                      )}
                    </td>
                    <td>
                      <div className="inline-actions">
                        <button
                          type="button"
                          className="btn-sm"
                          disabled={!canWrite || ocupado}
                          onClick={() => guardarPais(country)}
                        >
                          {ocupado ? "Guardando…" : "Guardar"}
                        </button>
                        {fila && !esGeneral && (
                          <button
                            type="button"
                            className="ghost btn-sm"
                            disabled={!canWrite || ocupado}
                            onClick={() => quitarPais(country)}
                          >
                            Quitar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="field-help">
          La jornada general no se puede quitar: es la que hereda cualquier país sin configuración
          propia.
        </p>
      </article>

      {/* ── Por consultor ────────────────────────────────────────────────── */}
      <article className="card">
        <div className="card-head">
          <h3>Excepciones por consultor</h3>
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
                  <th className="cell-right">Horas al día</th>
                  <th className="cell-right">Días a la semana</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {config.consultants.map((c) => {
                  const borrador = consultores[c.consultantId] ?? aBorrador(c.efectiva);
                  const ocupado = guardando === `consultor:${c.consultantId}`;
                  const origen = ETIQUETA_ORIGEN[c.efectiva.origen] ?? ETIQUETA_ORIGEN.general;

                  return (
                    <tr key={c.consultantId}>
                      <td className="cell-strong">{c.fullName}</td>
                      <td>{c.country ?? "—"}</td>
                      <td className="cell-right">
                        {formatHoras(c.efectiva.hoursPerDay)} h × {c.efectiva.workDaysPerWeek} d
                      </td>
                      <td>
                        <span className={`state-chip ${origen.chip}`}>{origen.texto}</span>
                      </td>
                      <td className="cell-right">
                        <input
                          type="number"
                          min={0.5}
                          max={24}
                          step={0.25}
                          value={borrador.hoursPerDay}
                          disabled={!canWrite || ocupado}
                          aria-label={`Horas al día de ${c.fullName}`}
                          onChange={(e) =>
                            setConsultores((prev) => ({
                              ...prev,
                              [c.consultantId]: { ...borrador, hoursPerDay: e.target.value },
                            }))
                          }
                        />
                      </td>
                      <td className="cell-right">
                        <input
                          type="number"
                          min={1}
                          max={7}
                          step={1}
                          value={borrador.workDaysPerWeek}
                          disabled={!canWrite || ocupado}
                          aria-label={`Días a la semana de ${c.fullName}`}
                          onChange={(e) =>
                            setConsultores((prev) => ({
                              ...prev,
                              [c.consultantId]: { ...borrador, workDaysPerWeek: e.target.value },
                            }))
                          }
                        />
                      </td>
                      <td>
                        <div className="inline-actions">
                          <button
                            type="button"
                            className="btn-sm"
                            disabled={!canWrite || ocupado}
                            onClick={() => guardarConsultor(c)}
                          >
                            {ocupado ? "Guardando…" : "Guardar"}
                          </button>
                          {c.propia && (
                            <button
                              type="button"
                              className="ghost btn-sm"
                              disabled={!canWrite || ocupado}
                              onClick={() => quitarConsultor(c)}
                            >
                              Heredar
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="field-help">
          "Heredar" borra la jornada propia del consultor y lo devuelve a la de su país.
        </p>
      </article>
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "../../components/PageHeader";
import { useApprovalDigestConfig } from "../../hooks/useApprovalDigestConfig";
import { updateApprovalDigestConfig, type ConfigResumenAprobaciones } from "../../services/api";

/**
 * Resumen semanal de aprobaciones (R-020 + R-022).
 *
 * El PM recibía un correo por CADA solicitud de horas extra —y ninguno por las
 * horas regulares—, así que acababa ignorándolos. Ahora recibe un solo mensaje a
 * la semana con todo lo que tiene esperando en sus proyectos.
 *
 * Esta pantalla existe por una razón explícita: el día y la hora de ese correo,
 * y la decisión de conservar o no el aviso inmediato, son criterios de negocio
 * que van a cambiar. Dejarlos como constantes en el código habría sido la novena
 * vez que este proyecto esconde un dato configurable dentro de un despliegue.
 *
 * Vive en Administración y solo la toca ADMIN (`notifications:digest`), igual que
 * Jornada Laboral y Umbrales de Salud: afecta al correo de TODOS los PM a la vez.
 */

const DIAS = [
  { valor: 1, etiqueta: "Lunes" },
  { valor: 2, etiqueta: "Martes" },
  { valor: 3, etiqueta: "Miércoles" },
  { valor: 4, etiqueta: "Jueves" },
  { valor: 5, etiqueta: "Viernes" },
  { valor: 6, etiqueta: "Sábado" },
  { valor: 7, etiqueta: "Domingo" },
];

/**
 * Colombia es UTC-5 todo el año (no tiene horario de verano), así que la
 * equivalencia es exacta y se puede mostrar sin advertencias.
 */
const DESFASE_COLOMBIA = -5;

/** "13 UTC" → "08:00 en Colombia", avisando si el día se corre. */
function enHoraColombiana(horaUtc: number, dia: number): string {
  const total = horaUtc + DESFASE_COLOMBIA;
  const hora = ((total % 24) + 24) % 24;
  const texto = `${String(hora).padStart(2, "0")}:00`;
  if (total < 0) {
    const diaAnterior = DIAS[(dia + 5) % 7].etiqueta.toLowerCase();
    return `${texto} del ${diaAnterior} anterior`;
  }
  return texto;
}

type Props = {
  onError: (mensaje: string) => void;
  onSuccess: (mensaje: string) => void;
};

export function ApprovalDigestTab({ onError, onSuccess }: Props) {
  const { config, loading, error, reload } = useApprovalDigestConfig(true);
  const [borrador, setBorrador] = useState<ConfigResumenAprobaciones | null>(null);
  const [guardando, setGuardando] = useState(false);

  // Resincroniza el formulario cuando llegan los valores del servidor: sin esto
  // se editaría sobre un estado inicial que no es el guardado.
  useEffect(() => {
    if (config) {
      setBorrador({
        enabled: config.enabled,
        sendWeekday: config.sendWeekday,
        sendHourUtc: config.sendHourUtc,
        immediateExtraHour: config.immediateExtraHour,
      });
    }
  }, [config]);

  const guardarValores = useCallback(
    async (valores: ConfigResumenAprobaciones, mensaje: string) => {
      setGuardando(true);
      try {
        await updateApprovalDigestConfig(valores);
        onSuccess(mensaje);
        await reload();
      } catch (err) {
        onError(
          err instanceof Error ? err.message : "No se pudo guardar la configuración del resumen",
        );
      } finally {
        setGuardando(false);
      }
    },
    [onError, onSuccess, reload],
  );

  const guardar = useCallback(() => {
    if (!borrador) return;
    void guardarValores(
      borrador,
      borrador.enabled
        ? "Configuración guardada. El próximo resumen saldrá el día y la hora indicados."
        : "Configuración guardada. El resumen semanal queda desactivado.",
    );
  }, [borrador, guardarValores]);

  /**
   * "Restaurar" es un PUT de los valores iniciales, no un borrado. La fila
   * guarda además la marca del último envío, y borrarla permitiría que el
   * resumen de esta semana saliera por segunda vez.
   */
  const restaurar = useCallback(() => {
    if (!config) return;
    void guardarValores(config.porDefecto, "Se restauraron los valores iniciales.");
  }, [config, guardarValores]);

  const deshabilitado = guardando || !borrador;

  return (
    <div className="page-stack page-stack--padded">
      <PageHeader
        icon="✉"
        title="Resumen de aprobaciones"
        description="Cuándo recibe cada PM el correo con lo que tiene pendiente de aprobar"
      />

      {error && (
        <div className="notice notice--danger" role="status">
          <strong>No se pudo cargar la configuración.</strong> {error}{" "}
          <button type="button" className="btn-sm ghost" onClick={() => void reload()}>
            Reintentar
          </button>
        </div>
      )}

      <div className="notice notice--info" role="note">
        Una vez por semana, cada Project Manager recibe un correo con las{" "}
        <strong>horas y horas extra pendientes de su aprobación</strong>, solo de los proyectos que
        gestiona. <strong>A quien no tenga nada pendiente no se le escribe</strong>: el silencio
        significa que no hay nada esperando.
        {config?.origen === "codigo" && (
          <> Ahora mismo no hay nada guardado: se están aplicando los valores iniciales.</>
        )}
      </div>

      <section className="card card--roomy section-stack">
        <div className="card-head">
          <h3 className="card-title">Cuándo se envía</h3>
        </div>

        <div className="field-stack">
          <label className="check no-select" htmlFor="resumen-activo">
            <input
              id="resumen-activo"
              type="checkbox"
              checked={borrador?.enabled ?? false}
              disabled={deshabilitado}
              onChange={(e) =>
                setBorrador((prev) => (prev ? { ...prev, enabled: e.target.checked } : prev))
              }
            />{" "}
            Enviar el resumen semanal
          </label>
          <span className="field-help">
            Al desactivarlo nadie recibe el correo. Las aprobaciones siguen funcionando igual: esto
            solo gobierna el aviso.
          </span>
        </div>

        <div className="form-grid--tight">
          <div className="field-stack">
            <label className="field-label" htmlFor="resumen-dia">
              Día de envío
            </label>
            <select
              id="resumen-dia"
              className="est-control"
              value={borrador?.sendWeekday ?? 1}
              disabled={deshabilitado || !borrador?.enabled}
              onChange={(e) =>
                setBorrador((prev) =>
                  prev ? { ...prev, sendWeekday: Number(e.target.value) } : prev,
                )
              }
            >
              {DIAS.map((dia) => (
                <option key={dia.valor} value={dia.valor}>
                  {dia.etiqueta}
                </option>
              ))}
            </select>
            <span className="field-help">Por defecto, lunes.</span>
          </div>

          <div className="field-stack">
            <label className="field-label" htmlFor="resumen-hora">
              Hora de envío (UTC)
            </label>
            <select
              id="resumen-hora"
              className="est-control"
              value={borrador?.sendHourUtc ?? 13}
              disabled={deshabilitado || !borrador?.enabled}
              onChange={(e) =>
                setBorrador((prev) =>
                  prev ? { ...prev, sendHourUtc: Number(e.target.value) } : prev,
                )
              }
            >
              {Array.from({ length: 24 }, (_, hora) => (
                <option key={hora} value={hora}>
                  {String(hora).padStart(2, "0")}:00 UTC
                </option>
              ))}
            </select>
            <span className="field-help">
              {borrador
                ? `Equivale a las ${enHoraColombiana(borrador.sendHourUtc, borrador.sendWeekday)} en Colombia.`
                : "Se guarda en UTC."}{" "}
              Por defecto, 13:00 UTC (08:00 en Colombia).
            </span>
          </div>
        </div>

        <p className="field-help">
          El envío lo dispara el ciclo de trabajos, que corre cada hora. Si el servicio estuviera
          caído el día previsto, el resumen sale en cuanto vuelva, no se pierde — y nunca sale dos
          veces en la misma semana.
        </p>
      </section>

      <section className="card card--roomy section-stack">
        <div className="card-head">
          <h3 className="card-title">Aviso inmediato de horas extra</h3>
        </div>

        <div className="field-stack">
          <label className="check no-select" htmlFor="resumen-inmediato">
            <input
              id="resumen-inmediato"
              type="checkbox"
              checked={borrador?.immediateExtraHour ?? false}
              disabled={deshabilitado}
              onChange={(e) =>
                setBorrador((prev) =>
                  prev ? { ...prev, immediateExtraHour: e.target.checked } : prev,
                )
              }
            />{" "}
            Avisar al PM por cada solicitud de horas extra
          </label>
          <span className="field-help">
            Es el comportamiento anterior, <strong>desactivado</strong> desde que existe el resumen
            semanal. Actívalo solo si las horas extra necesitan una respuesta más rápida que la de
            una vez por semana; ten en cuenta que vuelve a generar un correo por solicitud.
          </span>
        </div>
      </section>

      <div className="inline-actions">
        <button type="button" onClick={guardar} disabled={deshabilitado || loading}>
          {guardando ? "Guardando…" : "Guardar configuración"}
        </button>
        <button type="button" className="btn-sm ghost" onClick={restaurar} disabled={deshabilitado}>
          Restaurar los valores iniciales
        </button>
      </div>

      {config?.lastSentAt && (
        <p className="empty-note">
          Último resumen enviado: {new Date(config.lastSentAt).toLocaleString("es-CO")}
        </p>
      )}
      {config?.updatedAt && (
        <p className="empty-note">
          Última modificación: {new Date(config.updatedAt).toLocaleString("es-CO")}
        </p>
      )}
    </div>
  );
}

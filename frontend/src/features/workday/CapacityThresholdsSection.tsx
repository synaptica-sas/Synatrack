import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  getCapacitySettings,
  updateCapacitySettings,
  type CapacitySettingsData,
  type CapacitySettingsPayload,
} from "../../services/api";
import { formatDateTime } from "../capacity/export/exportModel";
import { WEEKDAY_LABELS, formatHour, localToUtc, utcToLocal, validarAlertas } from "./digestSchedule";
import { validarUmbrales } from "./workdayUtils";

/** Valores de fábrica si el backend aún no devuelve los campos de alertas (CONTRATO §5.1). */
const DEFAULTS = { alertsEnabled: true, alertHorizonMonths: 3, digestEnabled: true, digestWeekday: 1, digestHourUtc: 13 };

/** Todo lo que acepta el PUT: las dos tarjetas guardan por separado pero el servidor pide el conjunto. */
function fullPayload(s: CapacitySettingsData): CapacitySettingsPayload {
  return {
    underThresholdPct: s.underThresholdPct,
    overThresholdPct: s.overThresholdPct,
    includeProbablesDefault: s.includeProbablesDefault,
    alertsEnabled: s.alertsEnabled ?? DEFAULTS.alertsEnabled,
    alertHorizonMonths: s.alertHorizonMonths ?? DEFAULTS.alertHorizonMonths,
    digestEnabled: s.digestEnabled ?? DEFAULTS.digestEnabled,
    digestWeekday: s.digestWeekday ?? DEFAULTS.digestWeekday,
    digestHourUtc: s.digestHourUtc ?? DEFAULTS.digestHourUtc,
  };
}

/**
 * Umbrales de capacity: por debajo de "subutilizado" una persona figura en ámbar,
 * por encima de "sobreasignado" en rojo. También decide si el informe mensual
 * incluye por defecto las asignaciones probables.
 */
export function CapacityThresholdsSection({
  canWrite,
  onError,
  onSuccess,
}: {
  canWrite: boolean;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}) {
  const [settings, setSettings] = useState<CapacitySettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [under, setUnder] = useState("");
  const [over, setOver] = useState("");
  const [probables, setProbables] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);

  // Alertas y resumen semanal: el día y la hora se editan en hora local (Bogotá/Quito).
  const [alertsEnabled, setAlertsEnabled] = useState(DEFAULTS.alertsEnabled);
  const [horizon, setHorizon] = useState(String(DEFAULTS.alertHorizonMonths));
  const [digestEnabled, setDigestEnabled] = useState(DEFAULTS.digestEnabled);
  const [weekdayLocal, setWeekdayLocal] = useState(1);
  const [hourLocal, setHourLocal] = useState(8);
  const [savingAlerts, setSavingAlerts] = useState(false);
  const [alertsValidation, setAlertsValidation] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await getCapacitySettings();
      setSettings(data);
      setUnder(String(data.underThresholdPct));
      setOver(String(data.overThresholdPct));
      setProbables(data.includeProbablesDefault);
      setAlertsEnabled(data.alertsEnabled ?? DEFAULTS.alertsEnabled);
      setHorizon(String(data.alertHorizonMonths ?? DEFAULTS.alertHorizonMonths));
      setDigestEnabled(data.digestEnabled ?? DEFAULTS.digestEnabled);
      const local = utcToLocal({
        weekday: data.digestWeekday ?? DEFAULTS.digestWeekday,
        hour: data.digestHourUtc ?? DEFAULTS.digestHourUtc,
      });
      setWeekdayLocal(local.weekday);
      setHourLocal(local.hour);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "No se pudieron cargar los umbrales");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!settings) return;
    const problema = validarUmbrales({ under, over });
    setValidation(problema);
    if (problema) return;
    setSaving(true);
    try {
      const data = await updateCapacitySettings({
        ...fullPayload(settings),
        underThresholdPct: Number(under.replace(",", ".")),
        overThresholdPct: Number(over.replace(",", ".")),
        includeProbablesDefault: probables,
      });
      setSettings(data);
      onSuccess("Umbrales de capacity guardados.");
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudieron guardar los umbrales");
    } finally {
      setSaving(false);
    }
  }

  async function saveAlerts(e: FormEvent) {
    e.preventDefault();
    if (!settings) return;
    const problema = validarAlertas({ horizon, weekday: weekdayLocal, hour: hourLocal });
    setAlertsValidation(problema);
    if (problema) return;
    const utc = localToUtc({ weekday: weekdayLocal, hour: hourLocal });
    setSavingAlerts(true);
    try {
      const data = await updateCapacitySettings({
        ...fullPayload(settings),
        alertsEnabled,
        alertHorizonMonths: Number(horizon),
        digestEnabled,
        digestWeekday: utc.weekday,
        digestHourUtc: utc.hour,
      });
      setSettings(data);
      onSuccess("Alertas y resumen semanal guardados.");
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudieron guardar las alertas");
    } finally {
      setSavingAlerts(false);
    }
  }

  const utcPreview = localToUtc({ weekday: weekdayLocal, hour: hourLocal });
  const lastSent = settings?.digestLastSentAt ?? null;

  return (
    <>
    <article className="card">
      <div className="card-head">
        <h3>Umbrales de capacity</h3>
      </div>

      {loading && !settings ? (
        <p className="loading">Cargando umbrales…</p>
      ) : loadError ? (
        <div className="notice notice--danger" role="alert">
          <div className="notice__title">No se pudieron cargar los umbrales</div>
          <p className="notice__text">{loadError}</p>
          <button type="button" className="ghost btn-sm" onClick={() => void load()}>Reintentar</button>
        </div>
      ) : (
        <form onSubmit={(e) => void save(e)} noValidate>
          <div className="field-grid field-grid--compact">
            <div>
              <label className="field-label" htmlFor="umbral-under">Subutilizado por debajo de (%)</label>
              <input
                id="umbral-under"
                type="number"
                min={0}
                max={300}
                step={1}
                value={under}
                disabled={!canWrite || saving}
                onChange={(e) => setUnder(e.target.value)}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="umbral-over">Sobreasignado por encima de (%)</label>
              <input
                id="umbral-over"
                type="number"
                min={0}
                max={300}
                step={1}
                value={over}
                disabled={!canWrite || saving}
                onChange={(e) => setOver(e.target.value)}
              />
            </div>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={probables}
              disabled={!canWrite || saving}
              onChange={(e) => setProbables(e.target.checked)}
            />
            Incluir asignaciones probables por defecto
          </label>
          {validation && (
            <div className="notice notice--danger" role="alert">
              <p className="notice__text">{validation}</p>
            </div>
          )}
          <p className="field-help">
            Una persona con menos del umbral de subutilizado figura como libre; con más del de
            sobreasignado, como sobrecargada.
          </p>
          {canWrite && (
            <div className="inline-actions">
              <button type="submit" disabled={saving}>{saving ? "Guardando…" : "Guardar umbrales"}</button>
            </div>
          )}
        </form>
      )}
    </article>

    <article className="card">
      <div className="card-head">
        <h3>Alertas y resumen semanal</h3>
      </div>
      {loading && !settings ? (
        <p className="loading">Cargando alertas…</p>
      ) : loadError || !settings ? (
        <p className="field-help">Se mostrarán cuando carguen los parámetros de capacity.</p>
      ) : (
        <form onSubmit={(e) => void saveAlerts(e)} noValidate>
          <label className="check">
            <input
              type="checkbox"
              checked={alertsEnabled}
              disabled={!canWrite || savingAlerts}
              onChange={(e) => setAlertsEnabled(e.target.checked)}
            />
            Activar alertas de sobreasignación y subutilización
          </label>
          <div className="field-grid field-grid--compact">
            <div>
              <label className="field-label" htmlFor="alertas-horizonte">Horizonte de alertas (meses)</label>
              <input
                id="alertas-horizonte"
                type="number"
                min={1}
                max={12}
                step={1}
                value={horizon}
                disabled={!canWrite || savingAlerts || !alertsEnabled}
                onChange={(e) => setHorizon(e.target.value)}
              />
            </div>
          </div>
          <p className="field-help">
            Se revisa el mes en curso y los siguientes hasta completar el horizonte (de 1 a 12 meses), solo con asignaciones confirmadas.
          </p>

          <label className="check">
            <input
              type="checkbox"
              checked={digestEnabled}
              disabled={!canWrite || savingAlerts}
              onChange={(e) => setDigestEnabled(e.target.checked)}
            />
            Enviar resumen semanal por correo (administradores y comercial)
          </label>
          <div className="field-grid field-grid--compact">
            <div>
              <label className="field-label" htmlFor="resumen-dia">Día de envío</label>
              <select
                id="resumen-dia"
                value={weekdayLocal}
                disabled={!canWrite || savingAlerts || !digestEnabled}
                onChange={(e) => setWeekdayLocal(Number(e.target.value))}
              >
                {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                  <option key={d} value={d}>{WEEKDAY_LABELS[d]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="resumen-hora">Hora de envío (Bogotá/Quito)</label>
              <select
                id="resumen-hora"
                value={hourLocal}
                disabled={!canWrite || savingAlerts || !digestEnabled}
                onChange={(e) => setHourLocal(Number(e.target.value))}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>{formatHour(h)}</option>
                ))}
              </select>
            </div>
          </div>
          <p className="field-help">
            La hora se muestra en Bogotá/Quito (UTC−5). El servidor trabaja en UTC, así que se guarda sumando 5 horas
            (hora local + 5, módulo 24; si pasa de medianoche, también cambia el día). Con tu elección se guarda{" "}
            {WEEKDAY_LABELS[utcPreview.weekday].toLowerCase()} a las {formatHour(utcPreview.hour)} UTC.
          </p>
          <p className="field-help">
            Último envío: {lastSent ? formatDateTime(lastSent) : "todavía no se ha enviado ninguno"}.
          </p>

          {alertsValidation && (
            <div className="notice notice--danger" role="alert">
              <p className="notice__text">{alertsValidation}</p>
            </div>
          )}
          {canWrite && (
            <div className="inline-actions">
              <button type="submit" disabled={savingAlerts}>{savingAlerts ? "Guardando…" : "Guardar alertas"}</button>
            </div>
          )}
        </form>
      )}
    </article>
    </>
  );
}

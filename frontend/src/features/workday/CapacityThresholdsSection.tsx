import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  getCapacitySettings,
  updateCapacitySettings,
  type CapacitySettingsData,
} from "../../services/api";
import { validarUmbrales } from "./workdayUtils";

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

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await getCapacitySettings();
      setSettings(data);
      setUnder(String(data.underThresholdPct));
      setOver(String(data.overThresholdPct));
      setProbables(data.includeProbablesDefault);
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
    const problema = validarUmbrales({ under, over });
    setValidation(problema);
    if (problema) return;
    setSaving(true);
    try {
      const data = await updateCapacitySettings({
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

  return (
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
  );
}

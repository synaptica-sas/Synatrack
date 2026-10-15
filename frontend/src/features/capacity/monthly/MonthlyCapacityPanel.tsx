import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "../../../components/EmptyState";
import { useCapacityMonthly } from "../../../hooks/useCapacityMonthly";
import {
  getCapacitySettings,
  type CapacitySettingsData,
  type MonthlyCapacity,
} from "../../../services/api";
import { CapacityHeatmap } from "./CapacityHeatmap";
import { ConsultantCapacityDrawer } from "./ConsultantCapacityDrawer";
import { KpiRow } from "./KpiRow";
import { PeriodSelector, type CapacityFilters } from "./PeriodSelector";
import { UtilizationChart } from "./UtilizationChart";
import {
  buildParams,
  loadStoredFilters,
  presetRange,
  saveStoredFilters,
  validateRange,
  warningMessages,
} from "./monthlyUtils";

function SkeletonBlock() {
  return (
    <div className="cap-skeleton" role="status" aria-label="Cargando capacidad mensual">
      <div className="cap-skeleton__kpis">
        {[0, 1, 2, 3, 4].map((i) => <div key={i} className="cap-skeleton__box" />)}
      </div>
      <div className="cap-skeleton__table" />
    </div>
  );
}

export function MonthlyCapacityPanel({ enabled = true }: { enabled?: boolean }) {
  const [filters, setFilters] = useState<CapacityFilters>(
    () =>
      loadStoredFilters() ?? {
        ...presetRange("currentYear"),
        includeProbables: null,
        excludeInternal: false,
        country: "",
        city: "",
      },
  );
  // El periodo y los filtros sobreviven a un cambio de pantalla (solo en esta pestaña del navegador).
  useEffect(() => {
    saveStoredFilters(filters);
  }, [filters]);
  const [settings, setSettings] = useState<CapacitySettingsData | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Opciones de país y ciudad: se acumulan de las respuestas para que no desaparezcan al filtrar.
  const [known, setKnown] = useState<{ countries: string[]; cities: string[] }>({ countries: [], cities: [] });
  const [seen, setSeen] = useState<MonthlyCapacity | null>(null);

  const rangeError = validateRange(filters.from, filters.to);
  const params = useMemo(() => buildParams(filters), [filters]);
  const { data, loading, error, reload } = useCapacityMonthly(params, enabled && rangeError === null);

  if (data !== seen) {
    setSeen(data);
    if (data) {
      const countries = new Set(known.countries);
      const cities = new Set(known.cities);
      for (const c of data.consultants) {
        if (c.country) countries.add(c.country);
        if (c.city) cities.add(c.city);
      }
      setKnown({
        countries: [...countries].sort((a, b) => a.localeCompare(b, "es")),
        cities: [...cities].sort((a, b) => a.localeCompare(b, "es")),
      });
    }
  }

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    getCapacitySettings()
      .then((s) => {
        if (!cancelled) setSettings(s);
      })
      .catch(() => {
        // Sin la configuración se usan los umbrales que trae la respuesta mensual.
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const includeProbables = filters.includeProbables ?? data?.includeProbables ?? settings?.includeProbablesDefault ?? false;
  const messages = data ? warningMessages(data.warnings, data) : [];
  const showResults = rangeError === null && data !== null;

  return (
    <div className="section-stack">
      <PeriodSelector
        filters={filters}
        includeProbables={includeProbables}
        countries={known.countries}
        cities={known.cities}
        onChange={setFilters}
      />

      {rangeError === null && loading && !data && <SkeletonBlock />}

      {rangeError === null && error && !loading && (
        <div className="notice notice--danger" role="alert">
          <p className="notice__title">No se pudo cargar la capacidad mensual</p>
          <p className="notice__text">{error}</p>
          <button type="button" className="btn-sm" onClick={() => void reload()}>
            Reintentar
          </button>
        </div>
      )}

      {showResults && data && (
        <div className={loading ? "section-stack cap-busy" : "section-stack"} aria-busy={loading}>
          {messages.length > 0 && (
            <div className="notice notice--warning" role="status">
              <p className="notice__title">Revisa estos avisos</p>
              {messages.map((m) => (
                <p key={m} className="notice__text">{m}</p>
              ))}
            </div>
          )}

          {data.consultants.length === 0 ? (
            <EmptyState
              icon="◉"
              title="No hay consultores para mostrar"
              description="Ningún consultor activo cumple los filtros del periodo elegido. Prueba con otro país, ciudad o rango de meses."
            />
          ) : (
            <>
              <KpiRow kpis={data.kpis} settings={data.settings} />
              <UtilizationChart months={data.team.months} settings={data.settings} />
              <CapacityHeatmap data={data} onSelect={setSelectedId} />
            </>
          )}
        </div>
      )}

      {selectedId && (
        <ConsultantCapacityDrawer consultantId={selectedId} params={params} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}

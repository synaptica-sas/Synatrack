import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "../../../components/EmptyState";
import { useCapacityMonthly } from "../../../hooks/useCapacityMonthly";
import { useToast } from "../../../hooks/useToast";
import {
  getCapacityMonthly,
  getCapacitySettings,
  type CapacityReport,
  type CapacitySettingsData,
  type MonthlyCapacity,
} from "../../../services/api";
import { ExportMenu, type ExportKind } from "../export/ExportMenu";
import { exportCapacityExcel, exportCapacityPdf } from "../export/exportRenderers";
import { PublishReportDialog, type PublishRequest } from "../reports/PublishReportDialog";
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

export function MonthlyCapacityPanel({
  enabled = true,
  canPublish = false,
  onOpenReport,
}: {
  enabled?: boolean;
  /** `capacity:publish` (solo ADMIN). Ocultar el botón no protege nada: el servidor decide. */
  canPublish?: boolean;
  /** Abre un reporte oficial en la sub-pestaña "Reportes oficiales". */
  onOpenReport?: (reportId: string) => void;
}) {
  const { showToast } = useToast();
  const [exporting, setExporting] = useState<ExportKind | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<CapacityReport | null>(null);
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

  /** Exporta la vista actual: pide aparte las asignaciones (la pantalla no las trae). */
  async function handleExport(kind: ExportKind) {
    if (!data) return;
    setExporting(kind);
    try {
      const full = await getCapacityMonthly({ ...params, includeProbables: data.includeProbables, includeAssignments: true });
      const meta = {
        generatedAt: new Date().toISOString(),
        filters: { country: filters.country || undefined, city: filters.city || undefined },
      };
      const fileName = kind === "excel" ? await exportCapacityExcel(full, meta) : await exportCapacityPdf(full, meta);
      showToast(`Archivo generado: ${fileName}`, "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "No se pudo generar el archivo", "error");
    } finally {
      setExporting(null);
    }
  }

  /** Lo que se publica es exactamente la vista actual; el servidor calcula el contenido. */
  const publishRequest: PublishRequest | null = data
    ? {
        from: data.from,
        to: data.to,
        includeProbables: data.includeProbables,
        internal: data.internal,
        ...(filters.country ? { country: filters.country } : {}),
        ...(filters.city ? { city: filters.city } : {}),
      }
    : null;

  return (
    <div className="section-stack">
      <PeriodSelector
        filters={filters}
        includeProbables={includeProbables}
        countries={known.countries}
        cities={known.cities}
        onChange={setFilters}
      />

      {showResults && data && data.consultants.length > 0 && (
        <div className="cap-toolbar">
          <ExportMenu busy={exporting} onExport={(k) => void handleExport(k)} />
          {canPublish && (
            <button type="button" className="toolbar-btn" onClick={() => setPublishing(true)}>
              Publicar reporte oficial
            </button>
          )}
        </div>
      )}

      {published && (
        <div className="notice notice--info" role="status">
          <p className="notice__title">Reporte oficial publicado</p>
          <p className="notice__text">«{published.title}» ya está disponible para quienes consultan capacity.</p>
          {onOpenReport && (
            <button type="button" className="btn-sm" onClick={() => onOpenReport(published.id)}>
              Ver reporte
            </button>
          )}
        </div>
      )}

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

      {publishing && publishRequest && (
        <PublishReportDialog
          request={publishRequest}
          onClose={() => setPublishing(false)}
          onPublished={(report) => {
            setPublishing(false);
            setPublished(report);
            showToast(`Reporte oficial «${report.title}» publicado.`, "success");
          }}
        />
      )}

      {selectedId && (
        <ConsultantCapacityDrawer consultantId={selectedId} params={params} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}

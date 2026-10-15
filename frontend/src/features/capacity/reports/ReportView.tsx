import { useState } from "react";
import { EmptyState } from "../../../components/EmptyState";
import { useCapacityReport } from "../../../hooks/useCapacityReports";
import { useToast } from "../../../hooks/useToast";
import { CapacityHeatmap } from "../monthly/CapacityHeatmap";
import { ConsultantCapacityDrawer } from "../monthly/ConsultantCapacityDrawer";
import { KpiRow } from "../monthly/KpiRow";
import { UtilizationChart } from "../monthly/UtilizationChart";
import { warningMessages } from "../monthly/monthlyUtils";
import { ExportMenu, type ExportKind } from "../export/ExportMenu";
import { formatDateTime } from "../export/exportModel";
import { exportCapacityExcel, exportCapacityPdf } from "../export/exportRenderers";
import { RevokeReportDialog } from "./RevokeReportDialog";
import { frozenConsultantDetail, isRevoked, monthYearLabel, reportFiltersText } from "./reportUtils";

/**
 * Un reporte oficial abierto, en SOLO LECTURA: reutiliza los componentes del mensual con los
 * datos congelados del payload. No hay selector de periodo y no se llama a `/monthly`.
 */
export function ReportView({
  reportId,
  canPublish,
  onBack,
  onChanged,
}: {
  reportId: string;
  /** `capacity:publish`: muestra "Anular". El servidor valida el permiso de todos modos. */
  canPublish: boolean;
  onBack: () => void;
  /** Avisa a la lista de que el reporte cambió (se anuló). */
  onChanged?: () => void;
}) {
  const { showToast } = useToast();
  const { data, setData, loading, error, reload } = useCapacityReport(reportId, true);
  const [exporting, setExporting] = useState<ExportKind | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const report = data && data.id === reportId ? data : null;

  async function handleExport(kind: ExportKind) {
    if (!report) return;
    setExporting(kind);
    try {
      const meta = { generatedAt: new Date().toISOString(), filters: report.filters, report };
      const fileName =
        kind === "excel" ? await exportCapacityExcel(report.payload, meta) : await exportCapacityPdf(report.payload, meta);
      showToast(`Archivo generado: ${fileName}`, "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "No se pudo generar el archivo", "error");
    } finally {
      setExporting(null);
    }
  }

  const frozen = report && selectedId ? frozenConsultantDetail(report.payload, selectedId) : undefined;

  return (
    <div className="section-stack">
      <div className="cap-toolbar cap-toolbar--between">
        <button type="button" className="ghost toolbar-btn" onClick={onBack}>
          ← Volver a la lista
        </button>
        {report && (
          <div className="cap-toolbar">
            <ExportMenu busy={exporting} onExport={(k) => void handleExport(k)} />
            {canPublish && !isRevoked(report) && (
              <button type="button" className="btn-danger toolbar-btn" onClick={() => setRevoking(true)}>
                Anular
              </button>
            )}
          </div>
        )}
      </div>

      {loading && !report && (
        <div className="kpi-loading" role="status">Cargando reporte oficial…</div>
      )}

      {error && !loading && (
        <div className="notice notice--danger" role="alert">
          <p className="notice__title">No se pudo cargar el reporte oficial</p>
          <p className="notice__text">{error}</p>
          <button type="button" className="btn-sm" onClick={() => void reload()}>Reintentar</button>
        </div>
      )}

      {report && (
        <>
          <div className="panel">
            <div className="panel__head">
              <h3 className="panel__title">{report.title}</h3>
              {isRevoked(report) ? (
                <span className="status-badge status-badge--danger">ANULADO</span>
              ) : (
                <span className="status-badge status-badge--success">Vigente</span>
              )}
            </div>
            <p className="field-help">
              Publicado por {report.publishedBy} el {formatDateTime(report.publishedAt)} · Periodo:{" "}
              {monthYearLabel(report.fromMonth)} a {monthYearLabel(report.toMonth)} ·{" "}
              {report.includeProbables ? "Incluye probables" : "Solo confirmados"} ·{" "}
              {report.internal === "exclude" ? "Sin proyectos internos" : "Con proyectos internos"} ·{" "}
              {reportFiltersText(report.filters)}
            </p>
            {report.note && <p className="notice__text">Nota: {report.note}</p>}
            {isRevoked(report) && (
              <div className="notice notice--danger" role="status">
                <p className="notice__title">Este reporte fue anulado</p>
                <p className="notice__text">
                  Anulado por {report.revokedBy ?? "—"}
                  {report.revokedAt ? ` el ${formatDateTime(report.revokedAt)}` : ""} · Motivo: {report.revokeReason ?? "—"}
                </p>
              </div>
            )}
            <p className="field-help">Los datos están congelados al momento de la publicación y no cambian.</p>
          </div>

          {(() => {
            const messages = warningMessages(report.payload.warnings, report.payload);
            return messages.length > 0 ? (
              <div className="notice notice--warning" role="status">
                <p className="notice__title">Avisos al momento de publicar</p>
                {messages.map((m) => <p key={m} className="notice__text">{m}</p>)}
              </div>
            ) : null;
          })()}

          {report.payload.consultants.length === 0 ? (
            <EmptyState
              icon="◉"
              title="El reporte no tiene consultores"
              description="Al publicarlo, ningún consultor cumplía los filtros del periodo."
            />
          ) : (
            <>
              <KpiRow kpis={report.payload.kpis} settings={report.payload.settings} />
              <UtilizationChart months={report.payload.team.months} settings={report.payload.settings} />
              <CapacityHeatmap data={report.payload} onSelect={setSelectedId} />
            </>
          )}
        </>
      )}

      {frozen && selectedId && (
        <ConsultantCapacityDrawer
          key={selectedId}
          consultantId={selectedId}
          frozenDetail={frozen}
          onClose={() => setSelectedId(null)}
        />
      )}

      {revoking && report && (
        <RevokeReportDialog
          reportId={report.id}
          title={report.title}
          onClose={() => setRevoking(false)}
          onRevoked={(updated) => {
            setRevoking(false);
            setData({ ...report, ...updated });
            showToast("Reporte anulado.", "success");
            onChanged?.();
          }}
        />
      )}
    </div>
  );
}

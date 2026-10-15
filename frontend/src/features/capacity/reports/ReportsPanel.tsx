import { useState } from "react";
import { EmptyState } from "../../../components/EmptyState";
import { useCapacityReports } from "../../../hooks/useCapacityReports";
import { formatDateTime } from "../export/exportModel";
import { ReportView } from "./ReportView";
import { isRevoked, monthYearLabel, reportFiltersText } from "./reportUtils";

/**
 * Sub-pestaña "Reportes oficiales": lista paginada y, al abrir uno, su vista de solo lectura.
 * `selectedId` vive en `CapacityTab` para que "Ver reporte" (tras publicar) pueda abrirlo.
 */
export function ReportsPanel({
  canPublish,
  selectedId,
  onSelect,
}: {
  canPublish: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useCapacityReports(page, selectedId === null);

  if (selectedId) {
    return (
      <ReportView
        reportId={selectedId}
        canPublish={canPublish}
        onBack={() => onSelect(null)}
        onChanged={() => void reload()}
      />
    );
  }

  return (
    <div className="section-stack">
      {loading && !data && (
        <div className="kpi-loading" role="status">Cargando reportes oficiales…</div>
      )}

      {error && !loading && (
        <div className="notice notice--danger" role="alert">
          <p className="notice__title">No se pudieron cargar los reportes oficiales</p>
          <p className="notice__text">{error}</p>
          <button type="button" className="btn-sm" onClick={() => void reload()}>Reintentar</button>
        </div>
      )}

      {data && data.data.length === 0 && (
        <EmptyState
          icon="▤"
          title="Aún no hay reportes oficiales"
          description={
            canPublish
              ? "Publica uno desde la pestaña Mensual con el botón «Publicar reporte oficial»."
              : "Cuando un administrador publique un reporte oficial aparecerá aquí."
          }
        />
      )}

      {data && data.data.length > 0 && (
        <div className={loading ? "panel cap-busy" : "panel"} aria-busy={loading}>
          <div className="panel__head">
            <h3 className="panel__title">Reportes oficiales</h3>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Título</th>
                  <th>Periodo</th>
                  <th>Filtros</th>
                  <th>Publicado</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <button type="button" className="cap-link" onClick={() => onSelect(r.id)} aria-label={`Abrir reporte ${r.title}`}>
                        {r.title}
                      </button>
                    </td>
                    <td className="cell-small">
                      {monthYearLabel(r.fromMonth)} a {monthYearLabel(r.toMonth)}
                      <span className="cell-meta"> · {r.includeProbables ? "con probables" : "confirmados"}</span>
                    </td>
                    <td className="cell-small">{reportFiltersText(r.filters)}</td>
                    <td className="cell-small">
                      {r.publishedBy}
                      <span className="cell-meta"> · {formatDateTime(r.publishedAt)}</span>
                    </td>
                    <td>
                      {isRevoked(r) ? (
                        <span className="status-badge status-badge--danger" title={r.revokeReason ?? undefined}>Anulado</span>
                      ) : (
                        <span className="status-badge status-badge--success">Vigente</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="cap-pager">
            <button type="button" className="ghost btn-sm" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
              Anterior
            </button>
            <span className="field-help">
              Página {data.meta.page} de {Math.max(1, data.meta.totalPages)} · {data.meta.total} reportes
            </span>
            <button
              type="button"
              className="ghost btn-sm"
              disabled={page >= data.meta.totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Siguiente
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

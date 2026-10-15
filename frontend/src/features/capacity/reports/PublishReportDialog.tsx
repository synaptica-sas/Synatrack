import { useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import {
  publishCapacityReport,
  type CapacityReport,
  type PublishCapacityReportBody,
} from "../../../services/api";
import { REPORT_TITLE_MAX, defaultReportTitle, monthYearLabel, reportFiltersText, validateReportTitle } from "./reportUtils";

/** Lo que el servidor necesita para calcular el reporte: la vista actual, sin título ni nota. */
export type PublishRequest = Omit<PublishCapacityReportBody, "title" | "note">;

/**
 * Diálogo "Publicar reporte oficial" (solo ADMIN). El cliente NO envía el contenido: manda el
 * periodo y los filtros y el servidor calcula y congela el payload (CONTRATO §5.2).
 */
export function PublishReportDialog({
  request,
  onClose,
  onPublished,
}: {
  request: PublishRequest;
  onClose: () => void;
  onPublished: (report: CapacityReport) => void;
}) {
  const [title, setTitle] = useState(() => defaultReportTitle(request.from, request.to));
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const titleError = validateReportTitle(title);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (titleError) return;
    setSaving(true);
    setError(null);
    try {
      const body: PublishCapacityReportBody = { ...request, title: title.trim() };
      if (note.trim()) body.note = note.trim();
      const report = await publishCapacityReport(body);
      onPublished(report);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo publicar el reporte");
      setSaving(false);
    }
  }

  return createPortal(
    <div className="modal-overlay" onClick={saving ? undefined : onClose}>
      <form
        className="modal-card modal-card--sm"
        role="dialog"
        aria-modal="true"
        aria-label="Publicar reporte oficial"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => void submit(e)}
        noValidate
      >
        <div className="modal-header">
          <h3 className="modal-title">Publicar reporte oficial</h3>
        </div>
        <p className="field-help">
          Se congela una copia de lo que ves ahora. Un reporte publicado no se edita ni se borra: solo se puede anular.
        </p>
        <dl className="cap-publish-summary">
          <dt>Periodo</dt>
          <dd>{monthYearLabel(request.from)} a {monthYearLabel(request.to)}</dd>
          <dt>Asignaciones probables</dt>
          <dd>{request.includeProbables ? "Incluidas" : "Solo confirmadas"}</dd>
          <dt>Proyectos internos</dt>
          <dd>{request.internal === "exclude" ? "Excluidos" : "Incluidos"}</dd>
          <dt>Filtros</dt>
          <dd>{reportFiltersText(request)}</dd>
        </dl>

        <label className="field-label" htmlFor="publicar-titulo">Título</label>
        <input
          id="publicar-titulo"
          value={title}
          maxLength={REPORT_TITLE_MAX}
          disabled={saving}
          aria-invalid={touched && titleError ? true : undefined}
          onChange={(e) => setTitle(e.target.value)}
        />
        {touched && titleError && (
          <p className="field-error" role="alert">{titleError}</p>
        )}

        <label className="field-label" htmlFor="publicar-nota">Nota (opcional)</label>
        <textarea
          id="publicar-nota"
          value={note}
          disabled={saving}
          onChange={(e) => setNote(e.target.value)}
        />

        {error && (
          <div className="notice notice--danger" role="alert">
            <p className="notice__text">{error}</p>
          </div>
        )}

        <div className="modal-actions">
          <button type="submit" disabled={saving}>{saving ? "Publicando…" : "Publicar reporte"}</button>
          <button type="button" className="ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

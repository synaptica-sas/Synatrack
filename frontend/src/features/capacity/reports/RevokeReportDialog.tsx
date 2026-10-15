import { useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { revokeCapacityReport, type CapacityReportSummary } from "../../../services/api";
import { REVOKE_REASON_MIN, validateRevokeReason } from "./reportUtils";

/** Diálogo "Anular reporte" (solo ADMIN): el motivo es obligatorio (mínimo 5 caracteres). */
export function RevokeReportDialog({
  reportId,
  title,
  onClose,
  onRevoked,
}: {
  reportId: string;
  title: string;
  onClose: () => void;
  onRevoked: (report: CapacityReportSummary) => void;
}) {
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reasonError = validateRevokeReason(reason);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (reasonError) return;
    setSaving(true);
    setError(null);
    try {
      onRevoked(await revokeCapacityReport(reportId, reason.trim()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo anular el reporte");
      setSaving(false);
    }
  }

  return createPortal(
    <div className="modal-overlay" onClick={saving ? undefined : onClose}>
      <form
        className="modal-card modal-card--sm"
        role="dialog"
        aria-modal="true"
        aria-label="Anular reporte oficial"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => void submit(e)}
        noValidate
      >
        <div className="modal-header">
          <h3 className="modal-title modal-title--danger">Anular reporte oficial</h3>
        </div>
        <p className="field-help">
          «{title}» quedará marcado como ANULADO. No se borra: sigue visible, con el motivo de la anulación. Esta acción no se puede deshacer.
        </p>
        <label className="field-label" htmlFor="anular-motivo">Motivo de la anulación</label>
        <textarea
          id="anular-motivo"
          value={reason}
          disabled={saving}
          aria-invalid={touched && reasonError ? true : undefined}
          onChange={(e) => setReason(e.target.value)}
        />
        <p className="field-help">Mínimo {REVOKE_REASON_MIN} caracteres.</p>
        {touched && reasonError && <p className="field-error" role="alert">{reasonError}</p>}
        {error && (
          <div className="notice notice--danger" role="alert">
            <p className="notice__text">{error}</p>
          </div>
        )}
        <div className="modal-actions">
          <button type="submit" className="btn-danger" disabled={saving}>{saving ? "Anulando…" : "Anular reporte"}</button>
          <button type="button" className="ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

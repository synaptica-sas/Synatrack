import type { ReactNode } from "react";
import { createPortal } from "react-dom";

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  danger = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** Para diálogos que piden elegir algo antes de poder confirmar. */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;

  return createPortal(
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="modal-card modal-card--sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3 className={danger ? "modal-title modal-title--danger" : "modal-title"}>{title}</h3>
        </div>
        <div className="confirm-dialog__body">{message}</div>
        <div className="modal-actions">
          <button
            type="button"
            className={danger ? "btn-danger" : undefined}
            onClick={onConfirm}
            disabled={confirmDisabled}
          >
            {confirmLabel}
          </button>
          <button type="button" className="ghost" onClick={onCancel}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

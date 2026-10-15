import { useState } from "react";

export type ExportKind = "excel" | "pdf";

/**
 * Botón "Exportar" con menú Excel / PDF. Mientras se genera un archivo muestra "Generando…"
 * y se bloquea para que un doble clic no dispare dos descargas.
 */
export function ExportMenu({
  busy,
  disabled = false,
  onExport,
}: {
  busy: ExportKind | null;
  disabled?: boolean;
  onExport: (kind: ExportKind) => void;
}) {
  const [open, setOpen] = useState(false);

  function pick(kind: ExportKind) {
    setOpen(false);
    onExport(kind);
  }

  return (
    <div className="menu-anchor">
      <button
        type="button"
        className="ghost toolbar-btn"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={disabled || busy !== null}
      >
        {busy ? "Generando…" : "📥 Exportar"}
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          <button type="button" role="menuitem" className="ghost menu-pop__item" onClick={() => pick("excel")}>
            Excel (.xlsx)
          </button>
          <button type="button" role="menuitem" className="ghost menu-pop__item" onClick={() => pick("pdf")}>
            PDF (.pdf)
          </button>
        </div>
      )}
    </div>
  );
}

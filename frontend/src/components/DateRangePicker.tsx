import { useState, useEffect, useRef } from "react";
import {
  getPresetRange,
  persistRange,
  presetLabel,
  rangeToPreset,
  type DateRange,
  type Preset,
} from "./dateRangeUtils";

// ── Component ────────────────────────────────────────────────────────────────

const PRESETS: Preset[] = ["today", "week", "month", "lastMonth", "qtd", "ytd"];

export function DateRangePicker({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const activePreset = rangeToPreset(value);

  // Close on outside click
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function applyPreset(p: Preset) {
    const r = getPresetRange(p);
    onChange(r);
    persistRange(r);
    if (p !== "custom") setOpen(false);
  }

  function applyCustom(field: "from" | "to", val: string) {
    const next = { ...value, [field]: val };
    onChange(next);
    persistRange(next);
  }

  function clear() {
    const empty = { from: "", to: "" };
    onChange(empty);
    persistRange(empty);
    setOpen(false);
  }

  const displayLabel = (() => {
    if (!value.from && !value.to) return "Rango de fechas";
    if (activePreset && activePreset !== "custom") return presetLabel(activePreset);
    if (value.from && value.to) return `${value.from} → ${value.to}`;
    return value.from || value.to;
  })();

  return (
    <div ref={ref} style={{ position: "relative", minWidth: "12rem" }}>
      <button
        type="button"
        className="ghost"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%", textAlign: "left", display: "flex", justifyContent: "space-between",
          alignItems: "center", gap: "0.4rem", fontSize: "0.875rem",
          borderColor: activePreset ? "#f97316" : undefined,
          color: activePreset ? "#ea580c" : undefined,
        }}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span>📅 {displayLabel}</span>
        <span style={{ fontSize: "0.65rem" }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div
          role="listbox"
          style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 200,
            background: "#fff", border: "1px solid var(--border-color)", borderRadius: "12px",
            boxShadow: "0 8px 24px rgba(15,23,42,0.12)", minWidth: "16rem",
            padding: "0.5rem",
          }}
        >
          {/* Presets */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.3rem", marginBottom: "0.5rem" }}>
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                role="option"
                aria-selected={activePreset === p}
                onClick={() => applyPreset(p)}
                style={{
                  background: activePreset === p ? "linear-gradient(135deg,#ff8b3d,#ea580c)" : "#fff6ef",
                  color: activePreset === p ? "#fff" : "#9a3412",
                  border: "1px solid #f8c39b",
                  borderRadius: "8px",
                  padding: "0.35rem 0.5rem",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  textAlign: "center",
                }}
              >
                {presetLabel(p)}
              </button>
            ))}
          </div>

          {/* Custom */}
          <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: "0.5rem" }}>
            <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--color-accent)", marginBottom: "0.35rem" }}>
              Personalizado
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.35rem" }}>
              <div>
                <label style={{ fontSize: "0.65rem", color: "#6b7280", display: "block", marginBottom: "0.15rem" }}>Desde</label>
                <input
                  type="date"
                  value={value.from}
                  onChange={(e) => applyCustom("from", e.target.value)}
                  style={{ fontSize: "0.8rem", padding: "0.35rem 0.5rem" }}
                />
              </div>
              <div>
                <label style={{ fontSize: "0.65rem", color: "#6b7280", display: "block", marginBottom: "0.15rem" }}>Hasta</label>
                <input
                  type="date"
                  value={value.to}
                  onChange={(e) => applyCustom("to", e.target.value)}
                  style={{ fontSize: "0.8rem", padding: "0.35rem 0.5rem" }}
                />
              </div>
            </div>
          </div>

          {/* Clear */}
          {(value.from || value.to) && (
            <button
              type="button"
              onClick={clear}
              style={{
                marginTop: "0.4rem", width: "100%", background: "none",
                border: "1px solid var(--border-color)", color: "#9a3412",
                fontSize: "0.75rem", padding: "0.3rem",
              }}
            >
              Limpiar fechas
            </button>
          )}
        </div>
      )}
    </div>
  );
}
export type { DateRange };

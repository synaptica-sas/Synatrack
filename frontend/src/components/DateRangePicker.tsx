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
    <div ref={ref} className="date-range-picker">
      <button
        type="button"
        className={`ghost date-range-picker__trigger${activePreset ? " is-active" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span>📅 {displayLabel}</span>
        <span className="date-range-picker__chevron">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div role="listbox" className="date-range-picker__panel">
          {/* Presets */}
          <div className="date-range-picker__presets">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                role="option"
                aria-selected={activePreset === p}
                onClick={() => applyPreset(p)}
                className={`date-range-picker__preset${activePreset === p ? " is-active" : ""}`}
              >
                {presetLabel(p)}
              </button>
            ))}
          </div>

          {/* Custom */}
          <div className="date-range-picker__custom">
            <div className="date-range-picker__section-label">Personalizado</div>
            <div className="date-range-picker__custom-grid">
              <div>
                <label className="date-range-picker__field-label">Desde</label>
                <input
                  type="date"
                  value={value.from}
                  onChange={(e) => applyCustom("from", e.target.value)}
                  className="date-range-picker__date-input"
                />
              </div>
              <div>
                <label className="date-range-picker__field-label">Hasta</label>
                <input
                  type="date"
                  value={value.to}
                  onChange={(e) => applyCustom("to", e.target.value)}
                  className="date-range-picker__date-input"
                />
              </div>
            </div>
          </div>

          {/* Clear */}
          {(value.from || value.to) && (
            <button type="button" onClick={clear} className="date-range-picker__clear">
              Limpiar fechas
            </button>
          )}
        </div>
      )}
    </div>
  );
}
export type { DateRange };

import { MonthYearPicker } from "../../../components/MonthYearPicker";
import {
  MAX_MONTHS,
  PERIOD_PRESET_LABELS,
  parseMonthKey,
  presetRange,
  shiftRange,
  toMonthKey,
  validateRange,
  type MonthKey,
  type PeriodPreset,
} from "./monthlyUtils";

/** Filtros de la vista mensual. `includeProbables = null` significa "el valor por defecto de la configuración". */
export type CapacityFilters = {
  from: MonthKey;
  to: MonthKey;
  includeProbables: boolean | null;
  excludeInternal: boolean;
  country: string;
  city: string;
};

const PRESETS: PeriodPreset[] = ["currentYear", "next6", "next12"];

export function PeriodSelector({
  filters,
  includeProbables,
  countries,
  cities,
  onChange,
}: {
  filters: CapacityFilters;
  /** Valor efectivo del interruptor (resuelto contra la configuración). */
  includeProbables: boolean;
  countries: string[];
  cities: string[];
  onChange: (next: CapacityFilters) => void;
}) {
  const error = validateRange(filters.from, filters.to);
  const fromYM = parseMonthKey(filters.from);
  const toYM = parseMonthKey(filters.to);

  // Un rango inválido se deja a la vista con su error; el panel no lo consulta.
  function setFrom(v: { month: number; year: number }) {
    onChange({ ...filters, from: toMonthKey(v.year, v.month) });
  }
  function setTo(v: { month: number; year: number }) {
    onChange({ ...filters, to: toMonthKey(v.year, v.month) });
  }
  function shift(delta: number) {
    onChange({ ...filters, ...shiftRange(filters.from, filters.to, delta) });
  }

  return (
    <div className="panel cap-period">
      <div className="cap-period__row">
        <div className="cap-period__nav" role="group" aria-label="Desplazar el periodo">
          <button type="button" className="toolbar-btn" onClick={() => shift(-1)} aria-label="Retroceder un mes">
            ◀
          </button>
          <button type="button" className="toolbar-btn" onClick={() => shift(1)} aria-label="Avanzar un mes">
            ▶
          </button>
        </div>
        <MonthYearPicker id="cap-from" label="Desde" value={fromYM} onChange={setFrom} yearsBack={3} />
        <MonthYearPicker id="cap-to" label="Hasta" value={toYM} onChange={setTo} yearsBack={3} />
        <div className="chip-row" role="group" aria-label="Atajos de periodo">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              className="chip-button"
              onClick={() => onChange({ ...filters, ...presetRange(p) })}
            >
              {PERIOD_PRESET_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      <div className="cap-period__row">
        <label className="cap-check no-select">
          <input
            type="checkbox"
            checked={includeProbables}
            onChange={(e) => onChange({ ...filters, includeProbables: e.target.checked })}
          />
          Incluir probables
        </label>
        <label className="cap-check no-select">
          <input
            type="checkbox"
            checked={filters.excludeInternal}
            onChange={(e) => onChange({ ...filters, excludeInternal: e.target.checked })}
          />
          Excluir internos
        </label>
        <div className="field-stack">
          <label className="field-label" htmlFor="cap-country">País</label>
          <select
            id="cap-country"
            className="control-sm"
            value={filters.country}
            onChange={(e) => onChange({ ...filters, country: e.target.value, city: "" })}
          >
            <option value="">Todos</option>
            {countries.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="field-stack">
          <label className="field-label" htmlFor="cap-city">Ciudad</label>
          <select
            id="cap-city"
            className="control-sm"
            value={filters.city}
            onChange={(e) => onChange({ ...filters, city: e.target.value })}
          >
            <option value="">Todas</option>
            {cities.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <span className="field-help">Máximo {MAX_MONTHS} meses por consulta.</span>
      </div>
    </div>
  );
}

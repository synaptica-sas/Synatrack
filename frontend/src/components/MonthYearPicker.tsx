import type { MonthYear } from "../utils/periodUtils";
import { MONTHS_LONG_ES } from "../utils/periodUtils";

const CURRENT_YEAR = new Date().getFullYear();

export function MonthYearPicker({
  label,
  value,
  onChange,
  min,
  id,
  yearsBack = 0,
}: {
  label: string;
  value: MonthYear;
  onChange: (v: MonthYear) => void;
  min?: MonthYear;
  id?: string;
  /** Años anteriores al actual que se ofrecen (por defecto 0: solo desde el año en curso). */
  yearsBack?: number;
}) {
  function handleMonthChange(month: number) {
    onChange({ month, year: value.year });
  }

  function handleYearChange(year: number) {
    // If new year == min.year and current month < min.month, clamp month
    const newMonth =
      min && year === min.year && value.month < min.month ? min.month : value.month;
    onChange({ month: newMonth, year });
  }

  const yearOptions = Array.from({ length: 6 + yearsBack }, (_, i) => CURRENT_YEAR - yearsBack + i);
  const minYear = min?.year ?? CURRENT_YEAR - yearsBack;
  const availableYears = yearOptions.filter((y) => y >= minYear);

  return (
    <div className="field-stack month-year-picker">
      <label className="field-label" htmlFor={`${id ?? label}-month`}>
        {label}
      </label>
      <div className="month-year-picker__row">
        <select
          id={`${id ?? label}-month`}
          value={value.month}
          onChange={(e) => handleMonthChange(Number(e.target.value))}
          className="control-sm month-year-picker__month"
          aria-label={`${label} — mes`}
        >
          {MONTHS_LONG_ES.map((name, idx) => {
            const m = idx + 1;
            const disabled = min !== undefined &&
              value.year === min.year &&
              m < min.month;
            return (
              <option key={m} value={m} disabled={disabled}>
                {name}
              </option>
            );
          })}
        </select>

        <select
          value={value.year}
          onChange={(e) => handleYearChange(Number(e.target.value))}
          className="control-sm month-year-picker__year"
          aria-label={`${label} — año`}
        >
          {availableYears.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

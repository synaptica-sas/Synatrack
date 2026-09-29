import type { GroupBy } from "./useGastosGrouped";
import { DateRangePicker, type DateRange } from "../../components/DateRangePicker";

const CURRENCY_OPTIONS = ["COP", "USD", "EUR", "MXN", "PEN", "CLP"];
const BASE_CURRENCY_OPTIONS = ["USD", "COP", "EUR", "MXN"];
const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: "project",  label: "Proyecto" },
  { value: "category", label: "Categoría" },
  { value: "month",    label: "Mes" },
];

export function GastosFilters({
  search,
  onSearchChange,
  groupBy,
  onGroupByChange,
  dateRange,
  onDateRangeChange,
  selectedCategories,
  onCategoriesChange,
  selectedCurrency,
  onCurrencyChange,
  baseCurrency,
  onBaseCurrencyChange,
  availableCategories,
  onExport,
  onNew,
  canWrite,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  groupBy: GroupBy;
  onGroupByChange: (v: GroupBy) => void;
  dateRange: DateRange;
  onDateRangeChange: (r: DateRange) => void;
  selectedCategories: string[];
  onCategoriesChange: (cats: string[]) => void;
  selectedCurrency: string;
  onCurrencyChange: (v: string) => void;
  baseCurrency: string;
  onBaseCurrencyChange: (v: string) => void;
  availableCategories: string[];
  onExport: () => void;
  onNew: () => void;
  canWrite: boolean;
}) {
  function toggleCategory(cat: string) {
    onCategoriesChange(
      selectedCategories.includes(cat)
        ? selectedCategories.filter((c) => c !== cat)
        : [...selectedCategories, cat],
    );
  }

  return (
    <div className="gastos-filters">
      {/* Row 1: search + group-by + actions */}
      <div className="gastos-filters__row">
        <input
          type="search"
          placeholder="Buscar proyecto, categoría…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="gastos-search control-sm"
        />

        <div className="inline-filter gastos-inline-filter">
          <label className="inline-filter__label" htmlFor="gastos-group-by">
            Agrupar por
          </label>
          <select
            id="gastos-group-by"
            value={groupBy}
            onChange={(e) => onGroupByChange(e.target.value as GroupBy)}
            className="control-sm"
          >
            {GROUP_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div className="inline-filter gastos-inline-filter">
          <label className="inline-filter__label" htmlFor="gastos-base-currency">
            Moneda base
          </label>
          <select
            id="gastos-base-currency"
            value={baseCurrency}
            onChange={(e) => onBaseCurrencyChange(e.target.value)}
            className="control-sm"
          >
            {BASE_CURRENCY_OPTIONS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        <div className="gastos-filters__actions">
          <button
            type="button"
            className="ghost btn-sm"
            onClick={onExport}
          >
            Exportar CSV
          </button>
          {canWrite && (
            <button type="button" className="btn-sm gastos-btn-new" onClick={onNew}>
              + Nuevo gasto
            </button>
          )}
        </div>
      </div>

      {/* Row 2: date range + currency + category chips */}
      <div className="gastos-filters__row gastos-filters__row--top">
        <div className="gastos-daterange">
          <DateRangePicker value={dateRange} onChange={onDateRangeChange} />
        </div>

        <select
          value={selectedCurrency}
          onChange={(e) => onCurrencyChange(e.target.value)}
          className="control-sm gastos-currency-select"
          aria-label="Filtrar por moneda"
        >
          <option value="">Todas las monedas</option>
          {CURRENCY_OPTIONS.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        {/* Category chips */}
        {availableCategories.length > 0 && (
          <div className="chip-row gastos-chip-row">
            {availableCategories.map((cat) => {
              const active = selectedCategories.includes(cat);
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => toggleCategory(cat)}
                  className={active ? "gastos-chip is-active" : "gastos-chip"}
                  aria-pressed={active}
                >
                  {cat}
                </button>
              );
            })}
            {selectedCategories.length > 0 && (
              <button
                type="button"
                className="ghost btn-sm"
                onClick={() => onCategoriesChange([])}
              >
                Limpiar
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

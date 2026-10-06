import type { GroupBy } from "./useGastosGrouped";
import { DateRangePicker, type DateRange } from "../../components/DateRangePicker";
import { SearchableSelect, type SearchableSelectOption } from "../../components/SearchableSelect";

const CURRENCY_OPTIONS = ["COP", "USD", "EUR", "MXN", "PEN", "CLP"];
const BASE_CURRENCY_OPTIONS = ["USD", "COP", "EUR", "MXN"];
const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: "project",  label: "Proyecto" },
  { value: "category", label: "Categoría" },
  { value: "month",    label: "Mes" },
];

export function GastosFilters({
  projectFilter,
  onProjectFilterChange,
  projectOptions,
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
  projectFilter: string;
  onProjectFilterChange: (v: string) => void;
  projectOptions: SearchableSelectOption[];
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
  // La moneda por defecto sale del proyecto (R-026) y puede ser una que no esté
  // en la lista fija —un proyecto en PEN o CLP—. Si falta, se añade al principio
  // para que el selector nunca aparezca en blanco.
  const opcionesMonedaBase = BASE_CURRENCY_OPTIONS.includes(baseCurrency)
    ? BASE_CURRENCY_OPTIONS
    : [baseCurrency, ...BASE_CURRENCY_OPTIONS];

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
        {/* R-027: el proyecto se elige de una lista, igual que en Portafolio.
            `allowFreeText` conserva la posibilidad de escribirlo a mano. */}
        <div className="field-stack gastos-search">
          <span className="field-label">Proyecto</span>
          <SearchableSelect
            options={projectOptions}
            value={projectFilter}
            onChange={onProjectFilterChange}
            placeholder="Buscar o escribir proyecto..."
            emptyLabel="Todos los proyectos"
            allowFreeText={true}
          />
        </div>

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
            {opcionesMonedaBase.map((c) => (
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

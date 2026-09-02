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
    <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", marginBottom: "0.75rem" }}>
      {/* Row 1: search + group-by + actions */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
        <input
          type="search"
          placeholder="Buscar proyecto, categoría…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          style={{ flex: "1 1 10rem", minWidth: "10rem", fontSize: "0.82rem", padding: "0.35rem 0.6rem" }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
          <label style={{ fontSize: "0.72rem", color: "var(--color-accent)", fontWeight: 600, whiteSpace: "nowrap" }}>
            Agrupar por
          </label>
          <select
            value={groupBy}
            onChange={(e) => onGroupByChange(e.target.value as GroupBy)}
            style={{ fontSize: "0.78rem", padding: "0.3rem 0.5rem" }}
          >
            {GROUP_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
          <label style={{ fontSize: "0.72rem", color: "var(--color-accent)", fontWeight: 600, whiteSpace: "nowrap" }}>
            Moneda base
          </label>
          <select
            value={baseCurrency}
            onChange={(e) => onBaseCurrencyChange(e.target.value)}
            style={{ fontSize: "0.78rem", padding: "0.3rem 0.5rem" }}
          >
            {BASE_CURRENCY_OPTIONS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: "0.4rem" }}>
          <button
            type="button"
            className="ghost"
            onClick={onExport}
            style={{ fontSize: "0.75rem", padding: "0.3rem 0.65rem" }}
          >
            Exportar CSV
          </button>
          {canWrite && (
            <button
              type="button"
              onClick={onNew}
              style={{
                fontSize: "0.75rem",
                padding: "0.3rem 0.65rem",
                background: "linear-gradient(135deg,#ff8b3d,#ea580c)",
                color: "#fff",
                border: "none",
                borderRadius: "8px",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              + Nuevo gasto
            </button>
          )}
        </div>
      </div>

      {/* Row 2: date range + currency + category chips */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", flexWrap: "wrap" }}>
        <div style={{ minWidth: "13rem" }}>
          <DateRangePicker value={dateRange} onChange={onDateRangeChange} />
        </div>

        <select
          value={selectedCurrency}
          onChange={(e) => onCurrencyChange(e.target.value)}
          style={{ fontSize: "0.78rem", padding: "0.3rem 0.5rem", minWidth: "7rem" }}
        >
          <option value="">Todas las monedas</option>
          {CURRENCY_OPTIONS.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        {/* Category chips */}
        {availableCategories.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", alignItems: "center" }}>
            {availableCategories.map((cat) => {
              const active = selectedCategories.includes(cat);
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => toggleCategory(cat)}
                  style={{
                    fontSize: "0.68rem",
                    padding: "0.2rem 0.55rem",
                    borderRadius: "9999px",
                    border: "1px solid",
                    borderColor: active ? "#ea580c" : "var(--border-color)",
                    background: active ? "#ea580c" : "var(--card-bg)",
                    color: active ? "#fff" : "var(--tint-orange-text)",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                  aria-pressed={active}
                >
                  {cat}
                </button>
              );
            })}
            {selectedCategories.length > 0 && (
              <button
                type="button"
                className="ghost"
                onClick={() => onCategoriesChange([])}
                style={{ fontSize: "0.65rem", padding: "0.15rem 0.4rem" }}
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

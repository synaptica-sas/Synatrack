import { useEffect } from "react";
import { ExpensesTab } from "../expenses/ExpensesTab";
import { RevenueTab } from "../revenue/RevenueTab";
import type { Expense, Forecast, FxConfig, Project, RevenueEntry } from "../../services/api";
import type { FinancialPanel } from "../../types";

/**
 * Wrapper que unifica Gastos e Ingresos bajo un solo tab del menú ("Financiero"),
 * con dos botones para alternar entre paneles. ExpensesTab y RevenueTab se
 * renderizan sin modificaciones: mismo comportamiento, mismas props.
 */
export function FinancialTab({
  panel,
  onPanelChange,
  canExpenses,
  canRevenue,
  expenses,
  revenueEntries,
  projects,
  forecasts = [],
  fxConfigs = [],
  baseCurrency = "USD",
  expensesLoading,
  revenueLoading,
  canWriteExpenses,
  canWriteRevenue,
  onReloadExpenses,
  onReloadRevenue,
  onError,
}: {
  panel: FinancialPanel;
  onPanelChange: (panel: FinancialPanel) => void;
  canExpenses: boolean;
  canRevenue: boolean;
  expenses: Expense[];
  revenueEntries: RevenueEntry[];
  projects: Project[];
  forecasts?: Forecast[];
  fxConfigs?: FxConfig[];
  baseCurrency?: string;
  expensesLoading: boolean;
  revenueLoading: boolean;
  canWriteExpenses: boolean;
  canWriteRevenue: boolean;
  onReloadExpenses: () => Promise<void>;
  onReloadRevenue: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  // Si el usuario solo tiene permiso para uno de los dos paneles, forzarlo.
  useEffect(() => {
    if (panel === "expenses" && !canExpenses && canRevenue) {
      onPanelChange("revenue");
    } else if (panel === "revenue" && !canRevenue && canExpenses) {
      onPanelChange("expenses");
    }
  }, [panel, canExpenses, canRevenue, onPanelChange]);

  const showToggle = canExpenses && canRevenue;

  return (
    <div>
      {showToggle && (
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "1.25rem" }}>
          <button
            type="button"
            className={panel === "expenses" ? "" : "ghost"}
            onClick={() => onPanelChange("expenses")}
            style={{ fontSize: "0.85rem", padding: "0.4rem 0.8rem", borderRadius: "8px" }}
          >
            ⊟ Panel Gastos
          </button>
          <button
            type="button"
            className={panel === "revenue" ? "" : "ghost"}
            onClick={() => onPanelChange("revenue")}
            style={{ fontSize: "0.85rem", padding: "0.4rem 0.8rem", borderRadius: "8px" }}
          >
            ⊕ Panel Ingresos
          </button>
        </div>
      )}

      {panel === "expenses" && canExpenses && (
        <ExpensesTab
          expenses={expenses}
          projects={projects}
          forecasts={forecasts}
          loading={expensesLoading}
          canWrite={canWriteExpenses}
          onReload={onReloadExpenses}
          onError={onError}
          fxConfigs={fxConfigs}
          baseCurrency={baseCurrency}
        />
      )}

      {panel === "revenue" && canRevenue && (
        <RevenueTab
          revenueEntries={revenueEntries}
          projects={projects}
          loading={revenueLoading}
          canWrite={canWriteRevenue}
          onReload={onReloadRevenue}
          onError={onError}
        />
      )}
    </div>
  );
}

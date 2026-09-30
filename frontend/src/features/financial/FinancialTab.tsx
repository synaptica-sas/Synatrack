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
        <div className="fin-panel-toggle" role="group" aria-label="Panel financiero">
          <button
            type="button"
            className={panel === "expenses" ? "btn-compact" : "ghost btn-compact"}
            aria-pressed={panel === "expenses"}
            onClick={() => onPanelChange("expenses")}
          >
            ⊟ Panel Gastos
          </button>
          <button
            type="button"
            className={panel === "revenue" ? "btn-compact" : "ghost btn-compact"}
            aria-pressed={panel === "revenue"}
            onClick={() => onPanelChange("revenue")}
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

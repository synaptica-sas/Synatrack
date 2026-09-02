import type { Expense, FxConfig, Project } from "../../services/api";
import { convertToBase, numberish, fmtMoney, prevPeriod } from "./gastosUtils";

function pct(a: number, b: number): number {
  return b > 0 ? (a / b) * 100 : 0;
}

function deltaPct(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function KPI({
  label,
  value,
  sub,
  delta,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: number | null;
  accent?: string;
}) {
  return (
    <div style={{
      flex: "1 1 0",
      minWidth: "9rem",
      background: "var(--card-bg)",
      border: "1px solid var(--border-color)",
      borderRadius: "10px",
      padding: "0.65rem 0.9rem",
    }}>
      <div style={{ fontSize: "0.68rem", color: "var(--color-accent)", fontWeight: 600, marginBottom: "0.15rem" }}>
        {label}
      </div>
      <div style={{ fontSize: "1.05rem", fontWeight: 800, color: accent ?? "var(--text-strong)" }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: "0.68rem", color: "var(--color-accent)", marginTop: "0.1rem" }}>{sub}</div>
      )}
      {delta != null && (
        <div style={{
          fontSize: "0.68rem",
          fontWeight: 700,
          marginTop: "0.1rem",
          color: delta > 0 ? "var(--state-danger-text)" : "var(--state-success-text)",
        }}>
          {delta > 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}% vs período anterior
        </div>
      )}
    </div>
  );
}

export function GastosKPIStrip({
  filteredExpenses,
  allExpenses,
  dateRange,
  baseCurrency,
  fxConfigs,
  projects,
}: {
  filteredExpenses: Expense[];
  allExpenses: Expense[];
  dateRange: { from: string; to: string };
  baseCurrency: string;
  fxConfigs: FxConfig[];
  projects: Project[];
}) {
  function sumExpenses(list: Expense[]): number {
    return list.reduce(
      (s, e) => s + convertToBase(numberish(e.amount), e.currency, baseCurrency, fxConfigs).value,
      0,
    );
  }

  const currentTotal = sumExpenses(filteredExpenses);

  // Total presupuesto de proyectos que aparecen en los gastos filtrados
  const projectIds = new Set(filteredExpenses.map((e) => e.projectId));
  const totalBudget = projects
    .filter((p) => projectIds.has(p.id))
    .reduce((s, p) => s + numberish(p.budget), 0);

  // Período anterior
  let delta: number | null = null;
  if (dateRange.from && dateRange.to) {
    const prev = prevPeriod(dateRange.from, dateRange.to);
    const prevExpenses = allExpenses.filter(
      (e) => e.expenseDate >= prev.from && e.expenseDate <= prev.to,
    );
    const prevTotal = sumExpenses(prevExpenses);
    delta = deltaPct(currentTotal, prevTotal);
  }

  const execPct = pct(currentTotal, totalBudget);
  const execColor =
    execPct >= 100 ? "var(--state-danger-text)" :
    execPct >= 85  ? "var(--state-warning-text)" :
    "var(--state-success-text)";

  return (
    <div style={{
      display: "flex",
      gap: "0.75rem",
      flexWrap: "wrap",
      marginBottom: "1rem",
    }}>
      <KPI
        label="Total gastado"
        value={fmtMoney(currentTotal, baseCurrency)}
        delta={delta}
      />
      <KPI
        label="Presupuesto (proyectos filtrados)"
        value={totalBudget > 0 ? fmtMoney(totalBudget, baseCurrency) : "—"}
      />
      <KPI
        label="% Ejecución presupuestal"
        value={totalBudget > 0 ? `${execPct.toFixed(1)}%` : "—"}
        accent={totalBudget > 0 ? execColor : undefined}
        sub={totalBudget > 0
          ? (execPct >= 100 ? "⚠ Superado" : execPct >= 85 ? "⚡ Cerca del límite" : "✅ En rango")
          : "Sin presupuesto disponible"}
      />
      <KPI
        label="Nº gastos en período"
        value={String(filteredExpenses.length)}
        sub={`${projectIds.size} proyecto${projectIds.size !== 1 ? "s" : ""}`}
      />
    </div>
  );
}

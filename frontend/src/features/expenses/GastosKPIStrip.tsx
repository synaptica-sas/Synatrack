import type { Expense, FxConfig, Project } from "../../services/api";
import { convertToBase, numberish, fmtMoney, prevPeriod } from "./gastosUtils";

/** Tono de estado de un dato. `undefined` = sin estado, color de texto normal. */
type Tone = "success" | "warning" | "danger";

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
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: number | null;
  tone?: Tone;
}) {
  return (
    <div className="kpi-card">
      <span className="kpi-card__label">{label}</span>
      <span className={tone ? `kpi-card__value tone-${tone}` : "kpi-card__value"}>
        {value}
      </span>
      {sub && <span className="kpi-card__sub">{sub}</span>}
      {delta != null && (
        <span className={`gastos-kpi-delta tone-${delta > 0 ? "danger" : "success"}`}>
          {delta > 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}% vs período anterior
        </span>
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
  const execTone: Tone =
    execPct >= 100 ? "danger" :
    execPct >= 85  ? "warning" :
    "success";

  return (
    <div className="kpi-grid gastos-kpi-strip">
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
        tone={totalBudget > 0 ? execTone : undefined}
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

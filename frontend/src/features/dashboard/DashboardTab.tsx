import { useEffect, useMemo, useState } from "react";
import {
  getStatsOverview,
  listExtraHours,
  type Expense, type FxConfig, type Forecast,
  type Project, type StatsOverview, type TimeEntry, type ExtraHourEntry,
} from "../../services/api";
import { DateRangePicker } from "../../components/DateRangePicker";
import { readPersistedRange, type DateRange } from "../../components/dateRangeUtils";
import { SearchableSelect } from "../../components/SearchableSelect";
import type { TabId } from "../../types";
import { formatISODateRange } from "../../utils/periodUtils";
import { backendHealthToResult, HEALTH_CRITERIA_TOOLTIP } from "../../utils/projectHealth";
import { AlertBadge } from "./AlertBadge";
import {
  calcDelta,
  calcEVM,
  fmt,
  sortProjectRows,
  type DeltaResult,
  type ProjectSortField,
} from "./dashboardUtils";
import { PageHeader } from "../../components/PageHeader";

// ── Formatting helpers ───────────────────────────────────────────────────────

function numberish(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isWithinDateRange(dateText: string, from?: string, to?: string) {
  if (!dateText) return false;
  if (from && dateText < from) return false;
  if (to && dateText > to) return false;
  return true;
}


function overlapsRange(start: string, end: string, from?: string, to?: string) {
  const min = from || "0000-01-01";
  const max = to || "9999-12-31";
  return !(end < min || start > max);
}

/** Calculate previous period equivalent to current range */
function prevPeriod(from: string, to: string): { from: string; to: string } {
  if (!from || !to) {
    // Default: previous month
    const now = new Date();
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return {
      from: prevMonthStart.toISOString().slice(0, 10),
      to: prevMonthEnd.toISOString().slice(0, 10),
    };
  }
  const fromMs = new Date(from).getTime();
  const toMs = new Date(to).getTime();
  const duration = toMs - fromMs;
  const prevTo = new Date(fromMs - 86_400_000);
  const prevFrom = new Date(prevTo.getTime() - duration);
  return {
    from: prevFrom.toISOString().slice(0, 10),
    to: prevTo.toISOString().slice(0, 10),
  };
}

// ── Delta calculation ────────────────────────────────────────────────────────

// ── Budget Chart ─────────────────────────────────────────────────────────────

type BudgetChartRow = {
  projectName: string;
  budget: number;
  spent: number;
  projectedTotal: number;
  alertLevel: "ok" | "warning" | "exceeded";
};

function BudgetChart({ rows }: { rows: BudgetChartRow[] }) {
  const BAR_HEIGHT = 26, BAR_GAP = 7, LABEL_WIDTH = 140, CHART_WIDTH = 380, PAD_R = 60;
  const W = LABEL_WIDTH + CHART_WIDTH + PAD_R;
  const maxVal = Math.max(...rows.map((r) => Math.max(r.budget, r.projectedTotal)), 1);
  const scale = (v: number) => (v / maxVal) * CHART_WIDTH;
  const svgH = rows.length * (BAR_HEIGHT + BAR_GAP) + BAR_GAP + 20;
  const color = (level: BudgetChartRow["alertLevel"]) =>
    level === "exceeded" ? "#ef4444" : level === "warning" ? "#f59e0b" : "#16a34a";

  return (
    <div style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${svgH}`} style={{ width: "100%", height: "auto", maxWidth: W, display: "block", fontFamily: "inherit" }}>
        {rows.map((row, i) => {
          const y = BAR_GAP + i * (BAR_HEIGHT + BAR_GAP);
          const c = color(row.alertLevel);
          const label = row.projectName.length > 18 ? row.projectName.slice(0, 17) + "…" : row.projectName;
          return (
            <g key={row.projectName}>
              <text x={LABEL_WIDTH - 6} y={y + BAR_HEIGHT / 2 + 4} textAnchor="end" fontSize={11} fill="#374151">{label}</text>
              <rect x={LABEL_WIDTH} y={y} width={scale(row.budget)} height={BAR_HEIGHT} rx={3} fill="#e5e7eb" />
              <rect x={LABEL_WIDTH} y={y + 4} width={scale(row.spent)} height={BAR_HEIGHT - 8} rx={2} fill={c} opacity={0.85} />
              {scale(row.projectedTotal) !== scale(row.spent) && (
                <line x1={LABEL_WIDTH + scale(row.projectedTotal)} y1={y + 2}
                  x2={LABEL_WIDTH + scale(row.projectedTotal)} y2={y + BAR_HEIGHT - 2}
                  stroke={c} strokeWidth={2} strokeDasharray="3,2" />
              )}
              <text x={LABEL_WIDTH + Math.max(scale(row.budget), scale(row.projectedTotal)) + 6}
                y={y + BAR_HEIGHT / 2 + 4} fontSize={10} fill="#6b7280">
                {row.budget > 0 ? `${((row.projectedTotal / row.budget) * 100).toFixed(0)}%` : "—"}
              </text>
            </g>
          );
        })}
        <g transform={`translate(${LABEL_WIDTH},${svgH - 14})`}>
          <rect width={10} height={8} rx={2} fill="#e5e7eb" />
          <text x={13} y={8} fontSize={9} fill="#6b7280">Presupuesto</text>
          <rect x={78} width={10} height={8} rx={2} fill="#16a34a" opacity={0.85} />
          <text x={91} y={8} fontSize={9} fill="#6b7280">Gasto real</text>
          <line x1={158} y1={0} x2={158} y2={9} stroke="#6b7280" strokeWidth={2} strokeDasharray="3,2" />
          <text x={162} y={8} fontSize={9} fill="#6b7280">Proyectado</text>
        </g>
      </svg>
    </div>
  );
}

function ExtraHoursTrendChart({ data }: { data: { month: string; hours: number }[] }) {
  const W = 500;
  const H = 200;
  const PAD_L = 40;
  const PAD_R = 20;
  const PAD_T = 20;
  const PAD_B = 30;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;

  const maxVal = Math.max(...data.map(d => d.hours), 10);
  const getX = (i: number) => PAD_L + (i / 11) * chartW;
  const getY = (v: number) => PAD_T + chartH - (v / maxVal) * chartH;

  const points = data.map((d, i) => `${getX(i)},${getY(d.hours)}`).join(" ");
  const areaPoints = `${getX(0)},${PAD_T + chartH} ${points} ${getX(11)},${PAD_T + chartH}`;

  return (
    <div style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: W, height: "auto", display: "block" }}>
        <defs>
          <linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ff9c2c" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#ff9c2c" stopOpacity="0.0" />
          </linearGradient>
        </defs>
        
        {/* Grid Lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((p, i) => {
          const val = p * maxVal;
          const y = getY(val);
          return (
            <g key={i}>
              <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="#e2e8f0" strokeDasharray="3 3" />
              <text x={PAD_L - 8} y={y + 4} textAnchor="end" fontSize={9} fill="#64748b">{val.toFixed(0)}h</text>
            </g>
          );
        })}

        {/* Area under the line */}
        <polygon points={areaPoints} fill="url(#lineGrad)" />

        {/* Trend line */}
        <polyline points={points} fill="none" stroke="#9a4f0f" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />

        {/* Dots and tooltips */}
        {data.map((d, i) => (
          <g key={i}>
            <circle cx={getX(i)} cy={getY(d.hours)} r={4} fill="#ff9c2c" stroke="#9a4f0f" strokeWidth={2} />
            {d.hours > 0 && (
              <text x={getX(i)} y={getY(d.hours) - 8} textAnchor="middle" fontSize={8} fontWeight={700} fill="#5f2f00">
                {d.hours.toFixed(0)}
              </text>
            )}
          </g>
        ))}

        {/* X Labels */}
        {data.map((d, i) => (
          <text key={i} x={getX(i)} y={H - PAD_B + 16} textAnchor="middle" fontSize={9} fill="#64748b">
            {d.month}
          </text>
        ))}
      </svg>
    </div>
  );
}

function ExpensesDonutChart({ data }: { data: { category: string; amount: number; pct: number }[] }) {
  const colors = ["#ff9c2c", "#9a4f0f", "#3b82f6", "#10b981", "#8b5cf6", "#f43f5e", "#6b7280"];
  
  if (data.length === 0) {
    return <p style={{ color: "#9ca3af", fontSize: "0.85rem", textAlign: "center", padding: "2rem" }}>Sin gastos registrados</p>;
  }

  let cumulativePercent = 0;

  const getCoordinatesForPercent = (percent: number) => {
    const x = Math.cos(2 * Math.PI * percent);
    const y = Math.sin(2 * Math.PI * percent);
    return [x, y];
  };

  const slices = [];
  for (let i = 0; i < data.length; i++) {
    const d = data[i];
    const startPercent = cumulativePercent;
    cumulativePercent += d.pct / 100;
    const endPercent = cumulativePercent;

    const [startX, startY] = getCoordinatesForPercent(startPercent);
    const [endX, endY] = getCoordinatesForPercent(endPercent);

    const largeArcFlag = d.pct > 50 ? 1 : 0;
    const R = 50;
    const cx = 80;
    const cy = 100;

    const x1 = cx + startX * R;
    const y1 = cy + startY * R;
    const x2 = cx + endX * R;
    const y2 = cy + endY * R;

    const pathData = d.pct >= 99.9
      ? `M ${cx} ${cy - R} A ${R} ${R} 0 1 1 ${cx - 0.01} ${cy - R}`
      : `M ${cx} ${cy} L ${x1} ${y1} A ${R} ${R} 0 ${largeArcFlag} 1 ${x2} ${y2} Z`;

    slices.push({
      pathData,
      color: colors[i % colors.length],
      category: d.category,
      pct: d.pct,
      amount: d.amount
    });
  }

  return (
    <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
      <svg width={160} height={200} style={{ display: "block" }}>
        {slices.map((slice, i) => (
          <path key={i} d={slice.pathData} fill={slice.color} stroke="#fff" strokeWidth={1.5} />
        ))}
        <circle cx={80} cy={100} r={25} fill="#fff" />
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", fontSize: "0.75rem", flex: 1, minWidth: "120px" }}>
        {slices.slice(0, 5).map((slice, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: slice.color, flexShrink: 0 }} />
            <span style={{ fontWeight: 600, color: "var(--text-strong)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{slice.category}:</span>
            <span style={{ color: "var(--text-soft)" }}>${slice.amount.toLocaleString()} ({slice.pct.toFixed(0)}%)</span>
          </div>
        ))}
        {slices.length > 5 && (
          <div style={{ fontSize: "0.7rem", color: "var(--text-soft)", fontStyle: "italic" }}>
            + {slices.length - 5} más categorías
          </div>
        )}
      </div>
    </div>
  );
}

function ExtraHoursByConsultantChart({ data }: { data: { name: string; hours: number }[] }) {
  const BAR_HEIGHT = 20;
  const BAR_GAP = 8;
  const LABEL_W = 100;
  const CHART_W = 200;
  const PAD_R = 40;
  const W = LABEL_W + CHART_W + PAD_R;
  const H = data.length * (BAR_HEIGHT + BAR_GAP) + BAR_GAP;

  const maxVal = Math.max(...data.map(d => d.hours), 5);
  const scale = (v: number) => (v / maxVal) * CHART_W;

  if (data.length === 0) {
    return <p style={{ color: "#9ca3af", fontSize: "0.85rem", textAlign: "center", padding: "2rem" }}>Sin horas extras aprobadas</p>;
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <svg width={W} height={H} style={{ display: "block" }}>
        {data.map((d, i) => {
          const y = BAR_GAP + i * (BAR_HEIGHT + BAR_GAP);
          return (
            <g key={i}>
              <text x={LABEL_W - 6} y={y + BAR_HEIGHT / 2 + 4} textAnchor="end" fontSize={10} fill="var(--text-strong)">
                {d.name.length > 12 ? d.name.slice(0, 11) + "…" : d.name}
              </text>
              <rect x={LABEL_W} y={y} width={scale(d.hours)} height={BAR_HEIGHT} rx={4} fill="#ff9c2c" />
              <text x={LABEL_W + scale(d.hours) + 6} y={y + BAR_HEIGHT / 2 + 4} fontSize={10} fontWeight={700} fill="#9a4f0f">
                {d.hours.toFixed(1)}h
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── KPI Card component ───────────────────────────────────────────────────────

function DashboardKpi({
  label, value, delta, tooltip, onClick, accent, sub,
}: {
  label: string;
  value: string;
  delta?: DeltaResult;
  tooltip?: string;
  onClick?: () => void;
  accent?: string;
  sub?: string;
}) {
  return (
    <article
      className={`card kpi${onClick ? " clickable" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") onClick(); } : undefined}
      aria-label={onClick ? `${label}: ${value}. Click para ver detalle.` : undefined}
    >
      <div className="kpi-header">
        <span className="kpi-label">{label}</span>
        {tooltip && (
          <span className="kpi-tooltip-btn" title={tooltip} aria-label={`Información sobre ${label}`}>?</span>
        )}
      </div>
      <p style={{ color: accent ?? "inherit" }}>{value}</p>
      {sub && <p style={{ fontSize: "0.72rem", color: "#9ca3af", marginTop: "0.15rem", fontWeight: 600 }}>{sub}</p>}
      {delta && (
        <div className={`kpi-delta ${delta.dir}`}>
          {delta.dir === "up" ? "▲" : delta.dir === "down" ? "▼" : "—"}
          {" "}{delta.pct.toFixed(1)}% vs período anterior
        </div>
      )}
      {!delta && onClick && (
        <div style={{ fontSize: "0.65rem", color: "#d1b08c", marginTop: "0.3rem" }}>
          Click para ver detalle →
        </div>
      )}
    </article>
  );
}

// ── Saved Views ──────────────────────────────────────────────────────────────

const VIEWS_KEY = "dashboardSavedViews";

type SavedView = { name: string; company: string; projectId: string; from: string; to: string };

function loadViews(): SavedView[] {
  try { return JSON.parse(localStorage.getItem(VIEWS_KEY) ?? "[]") as SavedView[]; } catch { return []; }
}
function saveViews(views: SavedView[]) {
  try { localStorage.setItem(VIEWS_KEY, JSON.stringify(views)); } catch { /**/ }
}

// ── Main component ───────────────────────────────────────────────────────────

/** La definición vive en `dashboardUtils` junto a la función de orden. */
type SortField = ProjectSortField;

const PAGE_SIZE = 15;

function DashboardSortTh({
  field,
  label,
  sticky,
  sortField,
  sortDir,
  onSort,
}: {
  field: SortField;
  label: string;
  sticky?: string;
  sortField: SortField;
  sortDir: "asc" | "desc";
  onSort: (field: SortField) => void;
}) {
  const active = sortField === field;
  return (
    <th
      className={`sortable${sticky ? ` ${sticky}` : ""}`}
      onClick={() => onSort(field)}
      aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
    >
      {label} <span aria-hidden="true">{active ? (sortDir === "asc" ? "↑" : "↓") : "⇅"}</span>
    </th>
  );
}

export function DashboardTab({
  projects,
  timeEntries,
  expenses,
  forecasts,
  fxConfigs,
  initialStats,
  initialBaseCurrency,
  onError,
  onDrillTo,
}: {
  projects: Project[];
  timeEntries: TimeEntry[];
  expenses: Expense[];
  forecasts: Forecast[];
  fxConfigs: FxConfig[];
  initialStats: StatsOverview | null;
  initialBaseCurrency: string;
  onError: (msg: string) => void;
  onDrillTo?: (tab: TabId) => void;
}) {
  const [stats, setStats] = useState<StatsOverview | null>(initialStats);
  const [baseCurrency, setBaseCurrency] = useState(initialBaseCurrency);

  // `initialStats` llega null en el primer render, porque la petición de App todavía no
  // resolvió. Como `useState` solo mira su argumento la primera vez, sin este efecto el
  // componente se quedaba en null para siempre y caía al cálculo local de `dashboardTotals`,
  // que suma importes de monedas distintas sin convertir. Se sincroniza solo cuando la
  // moneda del dato coincide con la seleccionada, para no pisar la elección del usuario
  // cuando cambió la moneda base a mano (ver `changeBaseCurrency`).
  useEffect(() => {
    if (initialStats && initialStats.baseCurrency === baseCurrency) {
      setStats(initialStats);
    }
  }, [initialStats, baseCurrency]);

  // Restore persisted date range on mount
  const initial = readPersistedRange();
  const [dateRange, setDateRange] = useState<DateRange>(initial);
  const [company, setCompany] = useState("");
  const [projectId, setProjectId] = useState("");
  const [projectStatus, setProjectStatus] = useState("");
  const [projectType, setProjectType] = useState("");

  const statsFilters = { company, projectId, from: dateRange.from, to: dateRange.to };

  // Table state
  const [tableSearch, setTableSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("projectedPct");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [tablePage, setTablePage] = useState(1);

  // --- Extra Hours state & loader for Trend and Consultant metrics ---
  const [extraHours, setExtraHours] = useState<ExtraHourEntry[]>([]);
  useEffect(() => {
    let active = true;
    listExtraHours().then((data) => {
      if (active) setExtraHours(data);
    }).catch(() => {});
    return () => {
      active = false;
    };
  }, []);



  // Saved views
  const [savedViews, setSavedViews] = useState<SavedView[]>(loadViews);
  const [viewName, setViewName] = useState("");
  const [viewMenuOpen, setViewMenuOpen] = useState(false);

  async function changeBaseCurrency(newBase: string) {
    setBaseCurrency(newBase);
    try {
      const newStats = await getStatsOverview(newBase);
      setStats(newStats);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Error al cambiar moneda base");
    }
  }

  const companies = useMemo(() => {
    const unique = new Set(projects.map((p) => p.company).filter(Boolean));
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [projects]);

  const companyOptions = useMemo(() => companies.map((c) => ({ value: c, label: c })), [companies]);

  const projectOptions = useMemo(() => {
    return projects.map((p) => ({ value: p.id, label: p.name }));
  }, [projects]);

  const dashboardProjects = useMemo(() =>
    projects.filter((p) => {
      if (company && !p.company.toLowerCase().includes(company.toLowerCase())) return false;
      if (projectId && p.id !== projectId && !p.name.toLowerCase().includes(projectId.toLowerCase())) return false;
      if (projectStatus && p.status !== projectStatus) return false;
      if (projectType && p.projectType !== projectType) return false;
      return true;
    }),
  [projects, company, projectId, projectStatus, projectType]);

  const dashboardProjectIds = useMemo(() => new Set(dashboardProjects.map((p) => p.id)), [dashboardProjects]);

  const dashboardTimeEntries = useMemo(() =>
    timeEntries.filter((e) =>
      dashboardProjectIds.has(e.projectId) &&
      isWithinDateRange(e.workDate.slice(0, 10), statsFilters.from, statsFilters.to)),
  [timeEntries, dashboardProjectIds, statsFilters.from, statsFilters.to]);

  const dashboardApprovedTimeEntries = useMemo(() =>
    dashboardTimeEntries.filter((e) => e.status === "APPROVED"),
  [dashboardTimeEntries]);

  const dashboardExpenses = useMemo(() =>
    expenses.filter((e) =>
      dashboardProjectIds.has(e.projectId) &&
      isWithinDateRange(e.expenseDate.slice(0, 10), statsFilters.from, statsFilters.to)),
  [expenses, dashboardProjectIds, statsFilters.from, statsFilters.to]);

  const dashboardForecasts = useMemo(() =>
    forecasts.filter((f) => {
      if (!dashboardProjectIds.has(f.projectId)) return false;
      if (!f.startDate || !f.endDate) return true;
      return overlapsRange(f.startDate, f.endDate, statsFilters.from, statsFilters.to);
    }),
  [forecasts, dashboardProjectIds, statsFilters.from, statsFilters.to]);

  const dashboardTotals = useMemo(() => ({
    budget:        dashboardProjects.reduce((acc, p) => acc + numberish(p.budget), 0),
    spent:         dashboardExpenses.reduce((acc, e) => acc + numberish(e.amount), 0),
    totalHours:    dashboardTimeEntries.reduce((acc, e) => acc + numberish(e.hours), 0),
    approvedHours: dashboardApprovedTimeEntries.reduce((acc, e) => acc + numberish(e.hours), 0),
    projectedCost: dashboardForecasts.reduce((acc, f) => acc + numberish(String(f.projectedCost || 0)), 0),
  }), [dashboardProjects, dashboardExpenses, dashboardTimeEntries, dashboardApprovedTimeEntries, dashboardForecasts]);

  // Previous period totals for delta computation
  const { from: prevFrom, to: prevTo } = prevPeriod(statsFilters.from, statsFilters.to);

  const prevTotals = useMemo(() => {
    const prevEntries = timeEntries.filter((e) =>
      dashboardProjectIds.has(e.projectId) && isWithinDateRange(e.workDate.slice(0, 10), prevFrom, prevTo));
    const prevApproved = prevEntries.filter((e) => e.status === "APPROVED");
    const prevExpenses = expenses.filter((e) =>
      dashboardProjectIds.has(e.projectId) && isWithinDateRange(e.expenseDate.slice(0, 10), prevFrom, prevTo));
    return {
      spent:         prevExpenses.reduce((acc, e) => acc + numberish(e.amount), 0),
      approvedHours: prevApproved.reduce((acc, e) => acc + numberish(e.hours), 0),
    };
  }, [timeEntries, expenses, dashboardProjectIds, prevFrom, prevTo]);

  // Per-project summary (for fallback when no stats)
  const dashboardProjectSummary = useMemo(() => {
    return dashboardProjects.map((project) => {
      const spent = dashboardExpenses.filter((e) => e.projectId === project.id).reduce((acc, e) => acc + numberish(e.amount), 0);
      const approvedHours = dashboardApprovedTimeEntries.filter((e) => e.projectId === project.id).reduce((acc, e) => acc + numberish(e.hours), 0);
      const projectedCost = dashboardForecasts.filter((f) => f.projectId === project.id).reduce((acc, f) => acc + numberish(String(f.projectedCost || 0)), 0);
      const budget = numberish(project.budget);
      const projectedTotal = spent + projectedCost;
      const projectedPct = budget > 0 ? (projectedTotal / budget) * 100 : 0;
      return { project, spent, approvedHours, remaining: budget - spent, projectedCost, projectedTotal, projectedPct };
    }).sort((a, b) => b.projectedPct - a.projectedPct);
  }, [dashboardProjects, dashboardExpenses, dashboardApprovedTimeEntries, dashboardForecasts]);

  // Hours by consultant
  const dashboardHoursByConsultant = useMemo(() => {
    const grouped = new Map<string, { total: number; byProject: Map<string, number> }>();
    for (const entry of dashboardApprovedTimeEntries) {
      const key = entry.consultant.fullName || "Sin nombre";
      if (!grouped.has(key)) grouped.set(key, { total: 0, byProject: new Map() });
      const node = grouped.get(key)!;
      const hours = numberish(entry.hours);
      node.total += hours;
      node.byProject.set(entry.projectId, (node.byProject.get(entry.projectId) || 0) + hours);
    }
    return Array.from(grouped.entries())
      .map(([consultant, value]) => ({ consultant, total: value.total, byProject: value.byProject }))
      .sort((a, b) => b.total - a.total);
  }, [dashboardApprovedTimeEntries]);

  // Forecast by consultant
  const dashboardForecastByConsultant = useMemo(() => {
    const grouped = new Map<string, { totalHours: number; items: Forecast[] }>();
    for (const forecast of dashboardForecasts) {
      const key = forecast.consultant.fullName || "Sin nombre";
      if (!grouped.has(key)) grouped.set(key, { totalHours: 0, items: [] });
      const node = grouped.get(key)!;
      node.totalHours += numberish(forecast.hoursProjected);
      node.items.push(forecast);
    }
    return Array.from(grouped.entries())
      .map(([consultant, value]) => ({
        consultant, totalHours: value.totalHours,
        items: value.items.sort((a, b) => (a.startDate || "").localeCompare(b.startDate || "")),
      }))
      .sort((a, b) => b.totalHours - a.totalHours);
  }, [dashboardForecasts]);

  const monthlyExtraHoursData = useMemo(() => {
    const months = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    const currentYear = new Date().getFullYear();
    const dataMap = new Map<number, number>();
    for (let i = 0; i < 12; i++) {
      dataMap.set(i, 0);
    }
    const approvedEH = extraHours.filter(eh => eh.status === "APPROVED");
    for (const eh of approvedEH) {
      const ehDate = new Date(eh.date);
      if (ehDate.getFullYear() === currentYear) {
        const m = ehDate.getMonth();
        dataMap.set(m, (dataMap.get(m) || 0) + Number(eh.totalHours));
      }
    }
    return Array.from(dataMap.entries()).map(([mIdx, hours]) => ({
      month: months[mIdx],
      hours
    }));
  }, [extraHours]);

  const expensesCategoryData = useMemo(() => {
    const grouped = new Map<string, number>();
    for (const exp of dashboardExpenses) {
      const cat = exp.category || "Otros";
      const amt = Number(exp.amount) || 0;
      grouped.set(cat, (grouped.get(cat) || 0) + amt);
    }
    const total = Array.from(grouped.values()).reduce((sum, v) => sum + v, 0);
    return Array.from(grouped.entries()).map(([category, amount]) => ({
      category,
      amount,
      pct: total > 0 ? (amount / total) * 100 : 0
    })).sort((a, b) => b.amount - a.amount);
  }, [dashboardExpenses]);

  const extraHoursByConsultantData = useMemo(() => {
    const grouped = new Map<string, number>();
    const approvedEH = extraHours.filter(eh => eh.status === "APPROVED");
    for (const eh of approvedEH) {
      const name = eh.consultant?.fullName || "Consultor";
      grouped.set(name, (grouped.get(name) || 0) + Number(eh.totalHours));
    }
    return Array.from(grouped.entries())
      .map(([name, hours]) => ({ name, hours }))
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 5);
  }, [extraHours]);

  // Merge stats or local computation
  const displayProjects = stats?.projects ?? dashboardProjectSummary.map((row) => ({
    projectId: row.project.id,
    projectName: row.project.name,
    company: row.project.company,
    currency: row.project.currency,
    projectType: row.project.projectType ?? "TIME_AND_MATERIAL" as const,
    status: row.project.status ?? "ACTIVE" as const,
    phase: null,
    completionPct: 0,
    healthStatus: "GREEN" as const,
    displayCurrency: baseCurrency,
    budget: numberish(row.project.budget),
    spent: row.spent,
    remainingBudget: row.remaining,
    usedBudgetPercent: 0,
    totalHours: 0,
    approvedHours: row.approvedHours,
    projectedCost: row.projectedCost,
    projectedTotal: row.projectedTotal,
    projectedPct: row.projectedPct,
    estimateAtCompletion: row.projectedTotal,
    budgetVariance: numberish(row.project.budget) - row.projectedTotal,
    contractValue: 0,
    revenueRecognized: 0,
    grossMarginActual: 0,
    grossMarginActualPct: null as number | null,
    grossMarginProjected: 0,
    grossMarginProjectedPct: null as number | null,
    alertLevel: (row.projectedPct > 100 ? "exceeded" : row.projectedPct > 90 ? "warning" : "ok") as "ok" | "warning" | "exceeded",
    evm: null,
    openHighRisks: 0,
    openIssues: 0,
    pendingChanges: 0,
  }));

  // Aggregated totals
  const totals = {
    budget:           stats?.totals.budget        ?? dashboardTotals.budget,
    spent:            stats?.totals.spent         ?? dashboardTotals.spent,
    laborCostActual:  stats?.totals.laborCostActual ?? null,
    expensesActual:   stats?.totals.expensesActual  ?? null,
    revenue:          stats?.totals.revenueRecognized ?? 0,
    grossMargin:      stats?.totals.grossMarginActual ?? 0,
    projectedCost:    stats?.totals.projectedCost ?? dashboardTotals.projectedCost,
    approvedHours:    stats?.totals.approvedHours ?? dashboardTotals.approvedHours,
    alertCount:       stats?.totals.alertCount    ?? 0,
    avgCpi:           stats?.totals.avgCpi        ?? null,
    avgSpi:           stats?.totals.avgSpi        ?? null,
  };

  // EVM aggregated — EV = sum(completionPct × BAC) per project (PMBOK)
  const portfolioEV = displayProjects.reduce(
    (sum, p) => sum + (p.completionPct / 100) * p.budget,
    0,
  );
  const evm = calcEVM(totals.budget, portfolioEV, totals.spent, totals.avgCpi);

  // Portfolio health
  const healthCounts = useMemo(() => {
    const green  = displayProjects.filter((p) => p.healthStatus === "GREEN").length;
    const yellow = displayProjects.filter((p) => p.healthStatus === "YELLOW").length;
    const red    = displayProjects.filter((p) => p.healthStatus === "RED").length;
    return { green, yellow, red, total: displayProjects.length };
  }, [displayProjects]);

  // Risks / issues / changes (from portfolio if available)
  const risksSummary = useMemo(() => {
    const openHighRisks = displayProjects.reduce((s, p) => s + (p.openHighRisks ?? 0), 0);
    const openIssues    = displayProjects.reduce((s, p) => s + (p.openIssues ?? 0), 0);
    const pendingChgs   = displayProjects.reduce((s, p) => s + (p.pendingChanges ?? 0), 0);
    return { openHighRisks, openIssues, pendingChgs };
  }, [displayProjects]);

  // ── Project table: filter + sort + paginate ──────────────────────────────


  const filteredProjects = useMemo(() => {
    const q = tableSearch.trim().toLowerCase();
    return displayProjects.filter((p) =>
      !q || p.projectName.toLowerCase().includes(q) || p.company.toLowerCase().includes(q),
    );
  }, [displayProjects, tableSearch]);

  const sortedProjects = useMemo(
    () => sortProjectRows(filteredProjects, sortField, sortDir),
    [filteredProjects, sortField, sortDir],
  );

  const totalPages = Math.max(1, Math.ceil(sortedProjects.length / PAGE_SIZE));
  const pagedProjects = sortedProjects.slice((tablePage - 1) * PAGE_SIZE, tablePage * PAGE_SIZE);

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("desc"); }
    setTablePage(1);
  }

  // ── Saved views ──────────────────────────────────────────────────────────

  function saveCurrentView() {
    if (!viewName.trim()) return;
    const view: SavedView = { name: viewName.trim(), company, projectId, from: dateRange.from, to: dateRange.to };
    const next = [view, ...savedViews.filter((v) => v.name !== view.name)].slice(0, 10);
    setSavedViews(next);
    saveViews(next);
    setViewName("");
    setViewMenuOpen(false);
  }

  function applyView(v: SavedView) {
    setCompany(v.company);
    setProjectId(v.projectId);
    setDateRange({ from: v.from, to: v.to });
    setViewMenuOpen(false);
  }

  function deleteView(name: string) {
    const next = savedViews.filter((v) => v.name !== name);
    setSavedViews(next);
    saveViews(next);
  }

  // ── Export ───────────────────────────────────────────────────────────────

  async function exportExcel() {
    try {
      const { utils, writeFile } = await import("xlsx");
      const rows = sortedProjects.map((p) => ({
        Empresa: p.company,
        Proyecto: p.projectName,
        Tipo: p.projectType,
        Estado: p.status,
        Salud: p.healthStatus,
        Presupuesto: p.budget,
        "Gasto real": p.spent,
        Disponible: p.remainingBudget,
        Ingresos: p.revenueRecognized,
        "Margen bruto": p.grossMarginActual,
        "Total proyectado": p.projectedTotal,
        "Uso %": p.projectedPct.toFixed(1),
        Alerta: p.alertLevel,
      }));
      const ws = utils.json_to_sheet(rows);
      const wb = utils.book_new();
      utils.book_append_sheet(wb, ws, "Resumen");
      writeFile(wb, `portafolio-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Error al exportar Excel");
    }
  }

  async function exportPdf() {
    try {
      const { default: jsPDF } = await import("jspdf");
      const { default: autoTable } = await import("jspdf-autotable");
      const doc = new jsPDF({ orientation: "landscape" });
      doc.setFontSize(14);
      doc.text("Informe Ejecutivo de Portafolio", 14, 16);
      doc.setFontSize(9);
      doc.text(`Generado: ${new Date().toLocaleString("es-CO")}`, 14, 22);
      doc.text(`Moneda base: ${baseCurrency}  |  Proyectos: ${sortedProjects.length}`, 14, 27);

      autoTable(doc, {
        startY: 32,
        head: [["Empresa", "Proyecto", "Presupuesto", "Gasto", "Ingresos", "Margen %", "Uso %", "Alerta", "Salud"]],
        body: sortedProjects.map((p) => [
          p.company, p.projectName,
          fmt(p.budget, baseCurrency),
          fmt(p.spent, baseCurrency),
          fmt(p.revenueRecognized, baseCurrency),
          p.grossMarginActualPct != null ? `${p.grossMarginActualPct.toFixed(1)}%` : "—",
          `${p.projectedPct.toFixed(1)}%`,
          p.alertLevel,
          p.healthStatus,
        ]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [234, 88, 12] },
      });
      doc.save(`informe-portafolio-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Error al exportar PDF");
    }
  }

  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <PageHeader
        icon="▦"
        title="Tablero de Control"
        description="Monitorea el estado financiero, la salud del portafolio, el rendimiento y las alertas en tiempo real."
        actions={
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <div style={{ position: "relative" }}>
              <button
                type="button"
                className="ghost"
                onClick={() => setExportMenuOpen((o) => !o)}
                style={{ fontSize: "0.85rem", padding: "0.5rem 1rem", borderRadius: "8px" }}
              >
                📥 Exportar
              </button>
              {exportMenuOpen && (
                <div style={{
                  position: "absolute",
                  top: "100%",
                  right: 0,
                  background: "#fff",
                  border: "1px solid var(--border-color)",
                  borderRadius: "8px",
                  boxShadow: "0 4px 12px rgba(154,79,15,0.08)",
                  zIndex: 50,
                  display: "flex",
                  flexDirection: "column",
                  minWidth: "120px",
                  marginTop: "0.25rem"
                }}>
                  <button type="button" className="ghost" onClick={() => { void exportExcel(); setExportMenuOpen(false); }} style={{ padding: "0.5rem 1rem", textAlign: "left", fontSize: "0.8rem", width: "100%", border: "none" }}>Excel (.xlsx)</button>
                  <button type="button" className="ghost" onClick={() => { void exportPdf(); setExportMenuOpen(false); }} style={{ padding: "0.5rem 1rem", textAlign: "left", fontSize: "0.8rem", width: "100%", border: "none" }}>PDF (.pdf)</button>
                </div>
              )}
            </div>
          </div>
        }
      />
      <section className="grid">

      {/* Tarea 3: Portfolio Health — arriba del todo */}
      <article className="card">
        <h3 style={{ marginBottom: "0.6rem" }}>Salud del portafolio</h3>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center", marginBottom: "0.6rem" }}>
          {[
            { label: "Verde",    count: healthCounts.green,  color: "#22c55e", bg: "var(--state-success-bg)", pct: healthCounts.total > 0 ? healthCounts.green / healthCounts.total * 100 : 0 },
            { label: "Amarillo", count: healthCounts.yellow, color: "#f59e0b", bg: "var(--state-warning-bg)", pct: healthCounts.total > 0 ? healthCounts.yellow / healthCounts.total * 100 : 0 },
            { label: "Rojo",     count: healthCounts.red,    color: "#ef4444", bg: "var(--state-danger-bg)", pct: healthCounts.total > 0 ? healthCounts.red / healthCounts.total * 100 : 0 },
          ].map(({ label, count, color, bg, pct }) => (
            <div key={label} style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              padding: "0.5rem 1rem", borderRadius: "0.5rem", background: bg, minWidth: "5.5rem",
            }}>
              <span style={{ fontSize: "1.6rem", fontWeight: 800, color, lineHeight: 1 }}>{count}</span>
              <span style={{ fontSize: "0.68rem", color, fontWeight: 700 }}>{label}</span>
              <span style={{ fontSize: "0.62rem", color: "var(--text-soft)", marginTop: "0.1rem" }}>{pct.toFixed(0)}%</span>
            </div>
          ))}
          {healthCounts.total > 0 && (
            <div style={{ flex: "1 1 14rem", height: "1.1rem", display: "flex", borderRadius: "9999px", overflow: "hidden", minWidth: "10rem" }}>
              {healthCounts.green  > 0 && <div style={{ flex: healthCounts.green,  background: "#22c55e", transition: "flex 0.4s" }} />}
              {healthCounts.yellow > 0 && <div style={{ flex: healthCounts.yellow, background: "#f59e0b", transition: "flex 0.4s" }} />}
              {healthCounts.red    > 0 && <div style={{ flex: healthCounts.red,    background: "#ef4444", transition: "flex 0.4s" }} />}
            </div>
          )}
        </div>
        {/* Critical projects */}
        {displayProjects.filter((p) => p.healthStatus === "RED").length > 0 && (
          <div style={{ background: "var(--state-danger-bg)", border: "1px solid var(--state-danger-border)", borderRadius: "0.4rem", padding: "0.5rem 0.75rem", fontSize: "0.8rem" }}>
            <span style={{ fontWeight: 700, color: "var(--state-danger-text)" }}>🔴 Proyectos críticos: </span>
            {displayProjects.filter((p) => p.healthStatus === "RED").map((p) => (
              <span key={p.projectId} style={{ color: "var(--state-danger-text)", marginRight: "0.75rem" }}>
                {p.projectName} {p.evm?.cpi != null ? `(CPI ${p.evm.cpi.toFixed(2)})` : ""}
              </span>
            ))}
          </div>
        )}
      </article>

      {/* Tareas 9 + 14: Mini-cards riesgos/issues/cambios + EVM */}
      <div className="grid three-col">
        <article className="card" style={{ textAlign: "center", background: risksSummary.openHighRisks > 0 ? "var(--state-danger-bg)" : "var(--state-success-bg)", border: `1px solid ${risksSummary.openHighRisks > 0 ? "var(--state-danger-border)" : "var(--state-success-border)"}` }}>
          <h3 style={{ fontSize: "0.78rem", marginBottom: "0.35rem" }}>⚠️ Riesgos altos abiertos</h3>
          <p style={{ fontSize: "1.6rem", fontWeight: 800, color: risksSummary.openHighRisks > 0 ? "var(--state-danger-text)" : "var(--state-success-text)", margin: 0 }}>
            {risksSummary.openHighRisks}
          </p>
          <p style={{ fontSize: "0.68rem", color: "var(--state-neutral-text)", marginTop: "0.1rem" }}>Score ≥ 6</p>
        </article>
        <article className="card" style={{ textAlign: "center", background: risksSummary.openIssues > 0 ? "var(--state-warning-bg)" : "var(--state-success-bg)", border: `1px solid ${risksSummary.openIssues > 0 ? "var(--state-warning-border)" : "var(--state-success-border)"}` }}>
          <h3 style={{ fontSize: "0.78rem", marginBottom: "0.35rem" }}>🐛 Incidentes abiertos</h3>
          <p style={{ fontSize: "1.6rem", fontWeight: 800, color: risksSummary.openIssues > 0 ? "var(--state-warning-text)" : "var(--state-success-text)", margin: 0 }}>
            {risksSummary.openIssues}
          </p>
          <p style={{ fontSize: "0.68rem", color: "var(--state-neutral-text)", marginTop: "0.1rem" }}>En curso o sin resolver</p>
        </article>
        <article className="card" style={{ textAlign: "center", background: risksSummary.pendingChgs > 0 ? "var(--state-info-bg)" : "var(--state-neutral-bg)", border: `1px solid ${risksSummary.pendingChgs > 0 ? "var(--state-info-border)" : "var(--state-neutral-border)"}` }}>
          <h3 style={{ fontSize: "0.78rem", marginBottom: "0.35rem" }}>📋 Cambios pendientes</h3>
          <p style={{ fontSize: "1.6rem", fontWeight: 800, color: risksSummary.pendingChgs > 0 ? "var(--state-info-text)" : "var(--state-neutral-text)", margin: 0 }}>
            {risksSummary.pendingChgs}
          </p>
          <p style={{ fontSize: "0.68rem", color: "var(--state-neutral-text)", marginTop: "0.1rem" }}>Solicitudes por aprobar</p>
        </article>
      </div>

      {/* ── Filtros (Tarea 4 DateRangePicker + Tarea 11 Vistas) ── */}
      <article className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.75rem" }}>
          <h3 style={{ margin: 0 }}>Filtros del tablero</h3>

          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            {/* Botón Limpiar */}
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setCompany("");
                setProjectId("");
                setProjectStatus("");
                setProjectType("");
                setDateRange({ from: "", to: "" });
                setTablePage(1);
              }}
              style={{ fontSize: "0.8rem", padding: "0.4rem 0.8rem", borderRadius: "8px", display: "flex", alignItems: "center", gap: "0.3rem", height: "34px" }}
            >
              🧹 Limpiar
            </button>

            {/* Saved views */}
            <div style={{ position: "relative" }}>
              <button type="button" className="ghost"
                onClick={() => setViewMenuOpen((o) => !o)}
                style={{ fontSize: "0.8rem" }}>
                📑 Mis vistas {savedViews.length > 0 ? `(${savedViews.length})` : ""}
              </button>
              {viewMenuOpen && (
                <div style={{
                  position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 100,
                  background: "#fff", border: "1px solid var(--border-color)", borderRadius: "10px",
                  boxShadow: "0 6px 20px rgba(15,23,42,0.1)", minWidth: "15rem",
                  padding: "0.75rem",
                }}>
                  {savedViews.length === 0 ? (
                    <p style={{ fontSize: "0.8rem", color: "#9ca3af", margin: 0 }}>Sin vistas guardadas</p>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", marginBottom: "0.5rem" }}>
                      {savedViews.map((v) => (
                        <div key={v.name} style={{ display: "flex", gap: "0.3rem", alignItems: "center" }}>
                          <button type="button" className="ghost"
                            onClick={() => applyView(v)}
                            style={{ flex: 1, textAlign: "left", fontSize: "0.78rem" }}>
                            {v.name}
                          </button>
                          <button type="button" className="ghost"
                            onClick={() => deleteView(v.name)}
                            style={{ fontSize: "0.7rem", padding: "0.15rem 0.4rem", color: "#dc2626" }}>
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: "0.5rem", display: "flex", gap: "0.3rem" }}>
                    <input
                      placeholder="Nombre de la vista"
                      value={viewName}
                      onChange={(e) => setViewName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveCurrentView(); }}
                      style={{ fontSize: "0.78rem", padding: "0.35rem 0.5rem" }}
                    />
                    <button type="button" onClick={saveCurrentView}
                      style={{ fontSize: "0.78rem", padding: "0.35rem 0.6rem", whiteSpace: "nowrap" }}>
                      Guardar
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.75rem", alignItems: "flex-end" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "var(--color-accent)", marginBottom: "0.25rem" }}>Empresa</label>
            <SearchableSelect
              options={companyOptions}
              value={company}
              onChange={(val) => { setCompany(val); setProjectId(""); setTablePage(1); }}
              placeholder="Buscar o escribir empresa..."
              emptyLabel="Todas las empresas"
              allowFreeText={true}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "var(--color-accent)", marginBottom: "0.25rem" }}>Proyecto</label>
            <SearchableSelect
              options={projectOptions}
              value={projectId}
              onChange={(val) => { setProjectId(val); setTablePage(1); }}
              placeholder="Buscar o escribir proyecto..."
              emptyLabel="Todos los proyectos"
              allowFreeText={true}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "var(--color-accent)", marginBottom: "0.25rem" }}>Estado del Proyecto</label>
            <select
              value={projectStatus}
              onChange={(e) => { setProjectStatus(e.target.value); setTablePage(1); }}
              style={{ width: "100%", padding: "0.6rem 0.75rem", borderRadius: "10px", border: "1px solid var(--border-color)", background: "var(--card-bg)", color: "var(--text)" }}
            >
              <option value="">Todos los estados</option>
              <option value="ACTIVE">Activos</option>
              <option value="PAUSED">En Pausa</option>
              <option value="CLOSED">Cerrados</option>
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "var(--color-accent)", marginBottom: "0.25rem" }}>Tipo de Proyecto</label>
            <select
              value={projectType}
              onChange={(e) => { setProjectType(e.target.value); setTablePage(1); }}
              style={{ width: "100%", padding: "0.6rem 0.75rem", borderRadius: "10px", border: "1px solid var(--border-color)", background: "var(--card-bg)", color: "var(--text)" }}
            >
              <option value="">Todos los tipos</option>
              <option value="FIXED_PRICE">Precio Fijo (Fixed Price)</option>
              <option value="TIME_AND_MATERIAL">Tiempo y Materiales (T&M)</option>
              <option value="STAFFING">Staffing / Augmentation</option>
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "var(--color-accent)", marginBottom: "0.25rem" }}>Rango de Fechas</label>
            <DateRangePicker
              value={dateRange}
              onChange={(r) => { setDateRange(r); setTablePage(1); }}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "var(--color-accent)", marginBottom: "0.25rem" }}>Moneda Base</label>
            <select
              value={baseCurrency}
              onChange={(e) => void changeBaseCurrency(e.target.value)}
              style={{ width: "100%", height: "42px", padding: "0.6rem 0.75rem", borderRadius: "10px", border: "1px solid var(--border-color)", background: "var(--card-bg)", color: "var(--text)" }}
            >
              {["COP","USD","EUR","MXN","PEN","CLP"].map((c) => <option key={c} value={c}>Ver en {c}</option>)}
            </select>
          </div>
        </div>

        {stats && (
          <p className="fx-note" style={{ marginTop: "0.5rem" }}>
            Montos en {stats.baseCurrency}.
            {fxConfigs.length === 0 && " Sin tasas configuradas — valores en moneda original."}
          </p>
        )}
      </article>

      {/* Alert banner */}
      {totals.alertCount > 0 && (
        <article className="card" style={{ background: "var(--state-warning-bg)", border: "1px solid var(--state-warning-border)" }}>
          <h3 style={{ color: "var(--state-warning-text)", marginBottom: "0.4rem" }}>
            ⚠️ Proyectos en riesgo ({totals.alertCount})
          </h3>
          <div className="tag-list">
            {displayProjects.filter((p) => p.alertLevel !== "ok").map((p) => (
              <span key={p.projectId} className={`pill ${p.alertLevel === "exceeded" ? "error" : "warn"}`}>
                {`${p.projectName}: ${p.projectedPct.toFixed(1)}%`}
              </span>
            ))}
          </div>
        </article>
      )}

      {/* ── KPI grid (Tareas 5, 7, 8, 9, 15) ── */}
      <section className="grid dashboard-grid-wide">
        <DashboardKpi
          label={`Presupuesto total (${baseCurrency})`}
          value={fmt(totals.budget, baseCurrency)}
          tooltip={totals.budget === 0 ? "Sin proyectos activos o sin presupuesto asignado" : "Suma de presupuestos de todos los proyectos filtrados"}
          onClick={() => onDrillTo?.("projects")}
        />
        <DashboardKpi
          label={`Gasto real (${baseCurrency})`}
          value={fmt(totals.spent, baseCurrency)}
          delta={calcDelta(totals.spent, prevTotals.spent)}
          tooltip={
            totals.spent === 0
              ? "Sin gastos registrados en el período seleccionado"
              : totals.laborCostActual != null
              ? `Costo laboral: ${fmt(totals.laborCostActual, baseCurrency)} | Gastos directos: ${fmt(totals.expensesActual ?? 0, baseCurrency)} | Total: ${fmt(totals.spent, baseCurrency)}`
              : "Total de gastos aprobados en el período (costo laboral + gastos directos)"
          }
          onClick={() => onDrillTo?.("expenses")}
        />
        <DashboardKpi
          label={`Ingresos reconocidos (${baseCurrency})`}
          value={fmt(totals.revenue, baseCurrency)}
          tooltip={totals.revenue === 0 ? "Sin ingresos reconocidos. Revisar hitos de facturación o entradas de ingreso." : "Ingresos formalmente reconocidos en el período"}
          onClick={() => onDrillTo?.("revenue")}
        />
        <DashboardKpi
          label={`Margen bruto (${baseCurrency})`}
          value={fmt(totals.grossMargin, baseCurrency)}
          accent={totals.grossMargin >= 0 ? "#16a34a" : "#dc2626"}
          tooltip="Ingresos reconocidos − Gasto real"
          onClick={() => onDrillTo?.("revenue")}
        />
        <DashboardKpi
          label={`Costo proyectado (${baseCurrency})`}
          value={fmt(totals.projectedCost, baseCurrency)}
          tooltip="Suma de costos proyectados en forecasts del período"
          onClick={() => onDrillTo?.("forecasts")}
        />
        <DashboardKpi
          label="Horas aprobadas"
          value={totals.approvedHours.toFixed(1)}
          delta={calcDelta(totals.approvedHours, prevTotals.approvedHours)}
          tooltip={totals.approvedHours === 0 ? "Sin horas aprobadas en el período. Revisar registros de tiempo pendientes." : "Horas aprobadas por responsables en el período"}
          onClick={() => onDrillTo?.("timeEntries")}
        />
        {/* EVM KPIs (PMBOK) */}
        {portfolioEV > 0 && (
          <DashboardKpi
            label={`EV — Valor ganado (${baseCurrency})`}
            value={fmt(portfolioEV, baseCurrency)}
            tooltip="Earned Value = Σ(% completado × BAC) por proyecto. Trabajo realmente completado a valor presupuestado."
            onClick={() => onDrillTo?.("portfolio")}
          />
        )}
        {totals.avgCpi != null && (
          <DashboardKpi
            label="CPI promedio"
            value={totals.avgCpi.toFixed(2)}
            accent={totals.avgCpi >= 1 ? "#16a34a" : totals.avgCpi >= 0.85 ? "#b45309" : "#dc2626"}
            tooltip="Cost Performance Index = EV / AC. ≥1: bajo presupuesto. <0.85: alerta de sobrecosto."
            onClick={() => onDrillTo?.("portfolio")}
          />
        )}
        {totals.avgSpi != null && (
          <DashboardKpi
            label="SPI promedio"
            value={totals.avgSpi.toFixed(2)}
            accent={totals.avgSpi >= 1 ? "#16a34a" : totals.avgSpi >= 0.85 ? "#b45309" : "#dc2626"}
            tooltip="Schedule Performance Index = EV / PV. ≥1: adelantado. <0.85: retrasado."
            onClick={() => onDrillTo?.("portfolio")}
          />
        )}
        {portfolioEV > 0 && (
          <DashboardKpi
            label={`CV — Variación costo (${baseCurrency})`}
            value={fmt(evm.cv, baseCurrency)}
            accent={evm.cv >= 0 ? "#16a34a" : "#dc2626"}
            tooltip="Cost Variance = EV − AC. Positivo: bajo presupuesto. Negativo: sobrecosto actual."
            onClick={() => onDrillTo?.("portfolio")}
          />
        )}
        {evm.eac != null && (
          <DashboardKpi
            label={`EAC (${baseCurrency})`}
            value={fmt(evm.eac, baseCurrency)}
            accent={evm.eac > totals.budget ? "#dc2626" : "#16a34a"}
            tooltip="Estimate At Completion = BAC / CPI. Estimación del costo total del portafolio al ritmo actual."
            onClick={() => onDrillTo?.("portfolio")}
          />
        )}
        {evm.vac != null && (
          <DashboardKpi
            label={`VAC (${baseCurrency})`}
            value={fmt(evm.vac, baseCurrency)}
            accent={evm.vac >= 0 ? "#16a34a" : "#dc2626"}
            tooltip="Variance At Completion = BAC − EAC. Positivo: ahorro esperado. Negativo: sobrecosto proyectado."
            onClick={() => onDrillTo?.("portfolio")}
          />
        )}
        {evm.tcpi != null && portfolioEV > 0 && (
          <DashboardKpi
            label="TCPI"
            value={evm.tcpi.toFixed(2)}
            accent={evm.tcpi <= 1 ? "#16a34a" : evm.tcpi <= 1.1 ? "#b45309" : "#dc2626"}
            tooltip="To Complete Performance Index = (BAC−EV)/(BAC−AC). Eficiencia requerida para terminar en presupuesto. ≤1: alcanzable."
            onClick={() => onDrillTo?.("portfolio")}
          />
        )}
      </section>

      {/* ── Tabla de proyectos (Tarea 6) ── */}
      <article className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.75rem" }}>
          <h3 style={{ margin: 0 }}>Resumen por proyecto</h3>

          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
            {/* Search */}
            <input
              placeholder="Buscar proyecto o empresa…"
              value={tableSearch}
              onChange={(e) => { setTableSearch(e.target.value); setTablePage(1); }}
              style={{ width: "16rem", padding: "0.4rem 0.65rem", fontSize: "0.82rem" }}
              aria-label="Buscar en tabla de proyectos"
            />

            {/* Export button (Tarea 10) */}
            <div style={{ position: "relative" }}>
              <button type="button" className="ghost"
                onClick={() => setExportMenuOpen((o) => !o)}
                style={{ fontSize: "0.8rem" }}>
                ↓ Exportar ▾
              </button>
              {exportMenuOpen && (
                <div style={{
                  position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 100,
                  background: "#fff", border: "1px solid var(--border-color)", borderRadius: "8px",
                  boxShadow: "0 4px 14px rgba(15,23,42,0.1)", overflow: "hidden",
                }}>
                  <button type="button" className="ghost"
                    onClick={() => { void exportExcel(); setExportMenuOpen(false); }}
                    style={{ display: "block", width: "100%", borderRadius: 0, textAlign: "left", fontSize: "0.82rem" }}>
                    📊 Excel (.xlsx)
                  </button>
                  <button type="button" className="ghost"
                    onClick={() => { void exportPdf(); setExportMenuOpen(false); }}
                    style={{ display: "block", width: "100%", borderRadius: 0, textAlign: "left", fontSize: "0.82rem", borderTop: "1px solid var(--border-color)" }}>
                    📄 PDF ejecutivo
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="table-wrap">
          <table className="project-table">
            <thead>
              <tr>
                <th className="sticky-0" style={{ width: "42px" }}>Salud</th>
                <th className="sticky-1" style={{ width: "112px" }}>Empresa</th>
                <th className="sticky-2" style={{ minWidth: "130px" }}>Proyecto</th>
                <DashboardSortTh field="budget" label="Presupuesto" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                <DashboardSortTh field="spent" label="Gasto real" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                <DashboardSortTh field="remainingBudget" label="Disponible" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                <DashboardSortTh field="revenueRecognized" label="Ingresos" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                <DashboardSortTh field="grossMarginActual" label="Margen bruto" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                <DashboardSortTh field="projectedTotal" label="Total proyectado" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                <DashboardSortTh field="alertLevel" label="Alerta" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {pagedProjects.length === 0 && (
                <tr><td colSpan={10} style={{ textAlign: "center", color: "#9ca3af", padding: "1.5rem" }}>
                  Sin proyectos{tableSearch ? ` para "${tableSearch}"` : ""}
                </td></tr>
              )}
              {pagedProjects.map((row) => {
                const dc = row.displayCurrency || baseCurrency;
                const healthResult = backendHealthToResult(row.healthStatus as "GREEN" | "YELLOW" | "RED");
                return (
                  <tr key={row.projectId}>
                    <td className="sticky-0" style={{ textAlign: "center" }} data-label="Salud">
                      <span
                        style={{
                          display: "inline-block", width: "0.7rem", height: "0.7rem",
                          borderRadius: "50%", background: healthResult.color,
                        }}
                        title={`${healthResult.label} — ${HEALTH_CRITERIA_TOOLTIP}`}
                        aria-label={`Salud: ${healthResult.label}`}
                      />
                    </td>
                    <td className="sticky-1" style={{ fontWeight: 600, fontSize: "0.82rem" }} data-label="Empresa">{row.company}</td>
                    <td className="sticky-2" style={{ fontWeight: 600 }} data-label="Proyecto">{row.projectName}</td>
                    <td data-label="Presupuesto">{fmt(row.budget, dc)}</td>
                    <td data-label="Gasto real">{fmt(row.spent, dc)}</td>
                    <td style={{ color: row.remainingBudget < 0 ? "#dc2626" : "inherit" }} data-label="Disponible">{fmt(row.remainingBudget, dc)}</td>
                    <td data-label="Ingresos">{fmt(row.revenueRecognized, dc)}</td>
                    <td style={{ color: row.grossMarginActual >= 0 ? undefined : "#dc2626" }} data-label="Margen bruto">
                      {`${fmt(row.grossMarginActual, dc)}${row.grossMarginActualPct != null ? ` (${row.grossMarginActualPct.toFixed(1)}%)` : ""}`}
                    </td>
                    <td data-label="Total proyectado">{`${fmt(row.projectedTotal, dc)} (${row.projectedPct.toFixed(1)}%)`}</td>
                    <td data-label="Alerta"><AlertBadge level={row.alertLevel} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Paginación */}
        {totalPages > 1 && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.75rem", flexWrap: "wrap", gap: "0.5rem" }}>
            <span style={{ fontSize: "0.78rem", color: "var(--color-accent)" }}>
              Página {tablePage} de {totalPages} · {filteredProjects.length} proyectos
            </span>
            <div style={{ display: "flex", gap: "0.3rem" }}>
              <button type="button" className="ghost"
                disabled={tablePage === 1}
                onClick={() => setTablePage(1)}
                style={{ fontSize: "0.75rem", padding: "0.3rem 0.5rem" }}>
                «
              </button>
              <button type="button" className="ghost"
                disabled={tablePage === 1}
                onClick={() => setTablePage((p) => p - 1)}
                style={{ fontSize: "0.75rem", padding: "0.3rem 0.6rem" }}>
                Anterior
              </button>
              <button type="button" className="ghost"
                disabled={tablePage === totalPages}
                onClick={() => setTablePage((p) => p + 1)}
                style={{ fontSize: "0.75rem", padding: "0.3rem 0.6rem" }}>
                Siguiente
              </button>
              <button type="button" className="ghost"
                disabled={tablePage === totalPages}
                onClick={() => setTablePage(totalPages)}
                style={{ fontSize: "0.75rem", padding: "0.3rem 0.5rem" }}>
                »
              </button>
            </div>
          </div>
        )}
        {totalPages <= 1 && filteredProjects.length > 0 && (
          <p style={{ marginTop: "0.4rem", fontSize: "0.75rem", color: "var(--color-accent)" }}>
            {filteredProjects.length} proyectos
          </p>
        )}
      </article>

      {/* ── Horas y Proyección ── */}
      <section className="grid two-col">
        <article className="card">
          <h3>Horas aprobadas por consultor</h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Consultor</th><th>Total horas</th><th>Detalle por proyecto</th></tr></thead>
              <tbody>
                {dashboardHoursByConsultant.length === 0 && (
                  <tr><td colSpan={3} style={{ textAlign: "center", color: "#9ca3af" }}>Sin horas en el período</td></tr>
                )}
                {dashboardHoursByConsultant.map((row) => (
                  <tr key={row.consultant}>
                    <td>{row.consultant}</td>
                    <td>{row.total.toFixed(2)}</td>
                    <td>
                      <div className="tag-list">
                        {Array.from(row.byProject.entries()).map(([pid, hours]) => {
                          const pName = projects.find((p) => p.id === pid)?.name ?? "Proyecto";
                          return <span key={pid} className="pill neutral">{`${pName}: ${hours.toFixed(2)}h`}</span>;
                        })}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="card">
          <h3>Proyección por consultor</h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Consultor</th><th>Horas proyectadas</th><th>Detalle</th></tr></thead>
              <tbody>
                {dashboardForecastByConsultant.length === 0 && (
                  <tr><td colSpan={3} style={{ textAlign: "center", color: "#9ca3af" }}>Sin proyecciones en el período</td></tr>
                )}
                {dashboardForecastByConsultant.map((row) => (
                  <tr key={row.consultant}>
                    <td>{row.consultant}</td>
                    <td>{row.totalHours.toFixed(2)}</td>
                    <td>
                      <div className="tag-list">
                        {row.items.map((item) => (
                          <span key={item.id} className="pill neutral">
                            {`${item.startDate && item.endDate ? formatISODateRange(item.startDate, item.endDate) : "—"}: ${numberish(item.hoursProjected).toFixed(2)}h`}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      {/* ── Gráficos Principales (Presupuesto vs Gasto + Horas Extras Aprobadas) ── */}
      <section className="grid two-col">
        {displayProjects.length > 0 ? (
          <article className="card">
            <h3>Presupuesto vs Gasto real por proyecto</h3>
            <div style={{ marginTop: "0.5rem" }}>
              <BudgetChart
                rows={displayProjects.map((r) => ({
                  projectName: r.projectName,
                  budget: r.budget,
                  spent: r.spent,
                  projectedTotal: r.projectedTotal,
                  alertLevel: r.alertLevel,
                }))}
              />
            </div>
          </article>
        ) : (
          <article className="card">
            <h3>Presupuesto vs Gasto real por proyecto</h3>
            <p style={{ color: "#9ca3af", fontSize: "0.85rem", textAlign: "center", padding: "2rem" }}>Sin datos para mostrar</p>
          </article>
        )}

        <article className="card">
          <h3>📊 Horas Extras Aprobadas por Consultor (Top 5)</h3>
          <p style={{ fontSize: "0.78rem", color: "var(--text-soft)", marginBottom: "1rem" }}>
            Comparativa de consultores con mayor volumen de horas extras aprobadas.
          </p>
          <ExtraHoursByConsultantChart data={extraHoursByConsultantData} />
        </article>
      </section>

      {/* ── Métricas y Análisis Visual ── */}
      <section className="grid two-col" style={{ marginTop: "1rem" }}>
        <article className="card">
          <h3>📈 Tendencia Mensual de Horas Extras (Año en Curso)</h3>
          <p style={{ fontSize: "0.78rem", color: "var(--text-soft)", marginBottom: "1rem" }}>
            Muestra el consolidado de horas extras aprobadas mes a mes durante el presente año.
          </p>
          <ExtraHoursTrendChart data={monthlyExtraHoursData} />
        </article>
        
        <article className="card">
          <h3>🍩 Distribución de Gastos por Categoría</h3>
          <p style={{ fontSize: "0.78rem", color: "var(--text-soft)", marginBottom: "1rem" }}>
            Desglose de gastos registrados en el período seleccionado.
          </p>
          <ExpensesDonutChart data={expensesCategoryData} />
        </article>
      </section>
    </section>
    </div>
  );
}

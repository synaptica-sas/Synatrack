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
import type { TabId, FinancialPanel } from "../../types";
import { formatISODateRange } from "../../utils/periodUtils";
import { textoCriteriosSalud, PRESENTACION_SALUD } from "../../utils/projectHealth";
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
  /**
   * El nivel de alerta se traduce a MODIFICADOR DE CLASE, no a un color: antes
   * devolvía tres literales de la paleta por defecto de Tailwind incrustados en
   * el atributo `fill`, invisibles para el modo oscuro.
   */
  const tono = (level: BudgetChartRow["alertLevel"]) =>
    level === "exceeded" ? "danger" : level === "warning" ? "warning" : "success";

  return (
    <div className="chart-scroll">
      <svg viewBox={`0 0 ${W} ${svgH}`} className="chart-svg" style={{ maxWidth: W }}>
        {rows.map((row, i) => {
          const y = BAR_GAP + i * (BAR_HEIGHT + BAR_GAP);
          const t = tono(row.alertLevel);
          const label = row.projectName.length > 18 ? row.projectName.slice(0, 17) + "…" : row.projectName;
          return (
            <g key={row.projectName}>
              <text x={LABEL_WIDTH - 6} y={y + BAR_HEIGHT / 2 + 4} textAnchor="end" fontSize={11} className="chart-label">{label}</text>
              <rect x={LABEL_WIDTH} y={y} width={scale(row.budget)} height={BAR_HEIGHT} rx={3} className="chart-track" />
              <rect x={LABEL_WIDTH} y={y + 4} width={scale(row.spent)} height={BAR_HEIGHT - 8} rx={2} className={`chart-fill--${t}`} />
              {scale(row.projectedTotal) !== scale(row.spent) && (
                <line x1={LABEL_WIDTH + scale(row.projectedTotal)} y1={y + 2}
                  x2={LABEL_WIDTH + scale(row.projectedTotal)} y2={y + BAR_HEIGHT - 2}
                  className={`chart-stroke--${t}`} strokeWidth={2} strokeDasharray="3,2" />
              )}
              <text x={LABEL_WIDTH + Math.max(scale(row.budget), scale(row.projectedTotal)) + 6}
                y={y + BAR_HEIGHT / 2 + 4} fontSize={10} className="chart-axis">
                {row.budget > 0 ? `${((row.projectedTotal / row.budget) * 100).toFixed(0)}%` : "—"}
              </text>
            </g>
          );
        })}
        {/* Leyenda: cada trazo lleva su etiqueta en texto, no solo su color. */}
        <g transform={`translate(${LABEL_WIDTH},${svgH - 14})`}>
          <rect width={10} height={8} rx={2} className="chart-track" />
          <text x={13} y={8} fontSize={9} className="chart-axis">Presupuesto</text>
          <rect x={78} width={10} height={8} rx={2} className="chart-fill--success" />
          <text x={91} y={8} fontSize={9} className="chart-axis">Gasto real</text>
          <line x1={158} y1={0} x2={158} y2={9} className="chart-grid" strokeWidth={2} strokeDasharray="3,2" />
          <text x={162} y={8} fontSize={9} className="chart-axis">Proyectado</text>
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
    <div className="chart-scroll">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" style={{ maxWidth: W }}>
        <defs>
          <linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" className="chart-grad-from" />
            <stop offset="100%" className="chart-grad-to" />
          </linearGradient>
        </defs>

        {/* Rejilla */}
        {[0, 0.25, 0.5, 0.75, 1].map((p, i) => {
          const val = p * maxVal;
          const y = getY(val);
          return (
            <g key={i}>
              <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} className="chart-grid" strokeDasharray="3 3" />
              <text x={PAD_L - 8} y={y + 4} textAnchor="end" fontSize={9} className="chart-axis">{val.toFixed(0)}h</text>
            </g>
          );
        })}

        {/* Área bajo la línea */}
        <polygon points={areaPoints} fill="url(#lineGrad)" />

        {/* Línea de tendencia */}
        <polyline points={points} fill="none" className="chart-stroke--1" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />

        {/* Puntos y valor */}
        {data.map((d, i) => (
          <g key={i}>
            <circle cx={getX(i)} cy={getY(d.hours)} r={4} className="chart-fill--1 chart-gap" strokeWidth={2} />
            {d.hours > 0 && (
              <text x={getX(i)} y={getY(d.hours) - 8} textAnchor="middle" fontSize={8} fontWeight={700} className="chart-value--1">
                {d.hours.toFixed(0)}
              </text>
            )}
          </g>
        ))}

        {/* Etiquetas del eje X */}
        {data.map((d, i) => (
          <text key={i} x={getX(i)} y={H - PAD_B + 16} textAnchor="middle" fontSize={9} className="chart-axis">
            {d.month}
          </text>
        ))}
      </svg>
    </div>
  );
}

function ExpensesDonutChart({ data }: { data: { category: string; amount: number; pct: number }[] }) {
  /**
   * Serie categórica del sistema de diseño (`--chart-1..7` en `index.css`), no
   * una lista de literales propia de esta pantalla. Cada porción lleva además
   * su etiqueta en la leyenda: el color no es el único portador.
   */
  const SERIES = 7;

  if (data.length === 0) {
    return <p className="chart-empty">Sin gastos registrados</p>;
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
      serie: (i % SERIES) + 1,
      category: d.category,
      pct: d.pct,
      amount: d.amount
    });
  }

  return (
    <div className="chart-legend-row">
      <svg width={160} height={200} className="chart-svg chart-svg--fixed" role="img"
        aria-label={slices.map((s) => `${s.category}: ${s.pct.toFixed(0)}%`).join(", ")}>
        {slices.map((slice, i) => (
          <path key={i} d={slice.pathData} className={`chart-fill--${slice.serie} chart-gap`} strokeWidth={1.5} />
        ))}
        <circle cx={80} cy={100} r={25} className="chart-hole" />
      </svg>
      <div className="chart-legend">
        {slices.slice(0, 5).map((slice, i) => (
          <div key={i} className="chart-legend__item">
            <span className={`chart-swatch chart-swatch--${slice.serie}`} aria-hidden="true" />
            <span className="chart-legend__name">{slice.category}:</span>
            <span className="chart-legend__value">${slice.amount.toLocaleString()} ({slice.pct.toFixed(0)}%)</span>
          </div>
        ))}
        {slices.length > 5 && (
          <div className="chart-legend__more">
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
    return <p className="chart-empty">Sin horas extras aprobadas</p>;
  }

  return (
    <div className="chart-scroll">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" style={{ maxWidth: W }}>
        {data.map((d, i) => {
          const y = BAR_GAP + i * (BAR_HEIGHT + BAR_GAP);
          return (
            <g key={i}>
              <text x={LABEL_W - 6} y={y + BAR_HEIGHT / 2 + 4} textAnchor="end" fontSize={10} className="chart-label">
                {d.name.length > 12 ? d.name.slice(0, 11) + "…" : d.name}
              </text>
              <rect x={LABEL_W} y={y} width={scale(d.hours)} height={BAR_HEIGHT} rx={4} className="chart-fill--1" />
              <text x={LABEL_W + scale(d.hours) + 6} y={y + BAR_HEIGHT / 2 + 4} fontSize={10} fontWeight={700} className="chart-value--1">
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

/** Tono del dato según su estado; se traduce a clase `tone-*`, nunca a color. */
type KpiTone = "success" | "warning" | "danger";

function DashboardKpi({
  label, value, delta, tooltip, onClick, tone, sub, error, loading,
}: {
  label: string;
  value: string;
  delta?: DeltaResult;
  tooltip?: string;
  onClick?: () => void;
  /**
   * Sustituye al antiguo `accent`, que recibía un color literal y lo metía en
   * un `style` en línea: ignoraba el modo oscuro y repetía la paleta por
   * defecto de Tailwind en siete puntos del archivo.
   */
  tone?: KpiTone;
  sub?: string;
  /** DEP-36: mensaje del fallo. Si viene, el indicador no muestra ninguna cifra. */
  error?: string | null;
  /** Carga en curso: tampoco se muestra cifra, pero no es un error. */
  loading?: boolean;
}) {
  if (error) {
    return (
      <article className="card kpi" aria-label={`${label}: sin dato por error`}>
        <div className="kpi-header">
          <span className="kpi-label">{label}</span>
          <span className="kpi-tooltip-btn" title={error} aria-label={`Detalle del error de ${label}`}>!</span>
        </div>
        <p className="tone-danger">Sin dato</p>
        <p className="kpi-sub kpi-sub--danger">Error al cargar</p>
      </article>
    );
  }
  if (loading) {
    return (
      <article className="card kpi" aria-label={`${label}: cargando`}>
        <div className="kpi-header">
          <span className="kpi-label">{label}</span>
        </div>
        <p className="kpi-loading">…</p>
      </article>
    );
  }
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
      <p className={tone ? `tone-${tone}` : undefined}>{value}</p>
      {sub && <p className="kpi-sub">{sub}</p>}
      {delta && (
        <div className={`kpi-delta ${delta.dir}`}>
          {delta.dir === "up" ? "▲" : delta.dir === "down" ? "▼" : "—"}
          {" "}{delta.pct.toFixed(1)}% vs período anterior
        </div>
      )}
      {!delta && onClick && (
        <div className="kpi-hint">Click para ver detalle →</div>
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
  statsError,
  statsLoading,
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
  /** DEP-36: error de la petición de estadísticas, tal como lo expone `useStats`. */
  statsError: string | null;
  /** Petición de estadísticas en curso. Sirve para no confundir "cargando" con "falló". */
  statsLoading: boolean;
  onError: (msg: string) => void;
  onDrillTo?: (tab: TabId, financialPanel?: FinancialPanel) => void;
}) {
  const [stats, setStats] = useState<StatsOverview | null>(initialStats);
  const [baseCurrency, setBaseCurrency] = useState(initialBaseCurrency);
  /**
   * DEP-36. Error propio del tablero (cambio de moneda base). Se combina con el
   * que llega de `useStats` para decidir si los indicadores se pintan en error.
   */
  const [localStatsError, setLocalStatsError] = useState<string | null>(null);

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
      setLocalStatsError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error al cambiar moneda base";
      // Se descarta el dato de la moneda anterior: seguir mostrándolo bajo la
      // etiqueta de la moneda nueva sería peor que no mostrar nada.
      setStats(null);
      setLocalStatsError(msg);
      onError(msg);
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

  // DEP-36: aquí vivía `dashboardTotals`, un cálculo local de respaldo que sumaba
  // `p.budget`, `e.amount` y `f.projectedCost` **sin convertir de moneda**. Solo se
  // activaba cuando fallaba `/api/stats/overview`, así que el efecto neto era
  // presentar una cifra sin sentido en lugar de un error. Eliminado: si no hay
  // estadísticas, los indicadores muestran el fallo (ver `totalsFailed`).

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

  // DEP-36: aquí vivía `dashboardProjectSummary`, el respaldo por proyecto del
  // mismo cálculo sin conversión. Eliminado por el mismo motivo.

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

  /**
   * DEP-36. Sin estadísticas no hay nada que mostrar: el único origen válido de
   * estos números es `/api/stats/overview`, que es quien convierte de moneda.
   */
  const displayProjects = useMemo(() => stats?.projects ?? [], [stats]);

  /** Mensaje de fallo de las estadísticas: el del hook o el del cambio de moneda. */
  const statsErrorMessage = localStatsError ?? statsError;
  /** Hay fallo y no hay dato: los indicadores se pintan en error. */
  const totalsFailed = !stats && statsErrorMessage != null;
  /** No hay dato todavía y tampoco fallo: petición en curso. */
  const totalsPending = !stats && statsErrorMessage == null;

  // Aggregated totals. Los ceros son de relleno para los cálculos derivados;
  // nunca se pintan cuando `totalsFailed` o `totalsPending` están activos.
  const totals = {
    budget:           stats?.totals.budget           ?? 0,
    spent:            stats?.totals.spent            ?? 0,
    laborCostActual:  stats?.totals.laborCostActual  ?? null,
    expensesActual:   stats?.totals.expensesActual   ?? null,
    revenue:          stats?.totals.revenueRecognized ?? 0,
    grossMargin:      stats?.totals.grossMarginActual ?? 0,
    projectedCost:    stats?.totals.projectedCost    ?? 0,
    approvedHours:    stats?.totals.approvedHours    ?? 0,
    alertCount:       stats?.totals.alertCount       ?? 0,
    avgCpi:           stats?.totals.avgCpi           ?? null,
    avgSpi:           stats?.totals.avgSpi           ?? null,
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
    <div className="page-stack">
      <PageHeader
        icon="▦"
        title="Tablero de Control"
        description="Monitorea el estado financiero, la salud del portafolio, el rendimiento y las alertas en tiempo real."
        actions={
          <div className="menu-anchor">
            <button
              type="button"
              className="ghost toolbar-btn"
              onClick={() => setExportMenuOpen((o) => !o)}
              aria-expanded={exportMenuOpen}
              aria-haspopup="menu"
            >
              📥 Exportar
            </button>
            {exportMenuOpen && (
              <div className="menu-pop" role="menu">
                <button type="button" role="menuitem" className="ghost menu-pop__item" onClick={() => { void exportExcel(); setExportMenuOpen(false); }}>Excel (.xlsx)</button>
                <button type="button" role="menuitem" className="ghost menu-pop__item" onClick={() => { void exportPdf(); setExportMenuOpen(false); }}>PDF (.pdf)</button>
              </div>
            )}
          </div>
        }
      />
      <section className="grid">

      {/* Tarea 3: Portfolio Health — arriba del todo */}
      <article className="card">
        <h3 className="card-title-tight">Salud del portafolio</h3>
        <div className="health-tiles">
          {([
            { mod: "success", label: PRESENTACION_SALUD.GREEN.etiqueta,  count: healthCounts.green },
            { mod: "warning", label: PRESENTACION_SALUD.YELLOW.etiqueta, count: healthCounts.yellow },
            { mod: "danger",  label: PRESENTACION_SALUD.RED.etiqueta,    count: healthCounts.red },
          ] as const).map(({ mod, label, count }) => {
            const pct = healthCounts.total > 0 ? (count / healthCounts.total) * 100 : 0;
            return (
              <div key={label} className={`health-tile health-tile--${mod}`}>
                <span className="health-tile__count">{count}</span>
                <span className="health-tile__label">{label}</span>
                <span className="health-tile__pct">{pct.toFixed(0)}%</span>
              </div>
            );
          })}
          {healthCounts.total > 0 && (
            // Misma barra apilada que Portafolio. El `flexGrow` es un valor
            // calculado, que es el único uso legítimo de un estilo en línea.
            <div
              className="stack-bar"
              role="img"
              aria-label={`${PRESENTACION_SALUD.GREEN.etiqueta}: ${healthCounts.green}, ${PRESENTACION_SALUD.YELLOW.etiqueta}: ${healthCounts.yellow}, ${PRESENTACION_SALUD.RED.etiqueta}: ${healthCounts.red}`}
            >
              {healthCounts.green  > 0 && <div className="stack-bar__seg stack-bar__seg--success" style={{ flexGrow: healthCounts.green }} title={`${PRESENTACION_SALUD.GREEN.etiqueta}: ${healthCounts.green}`} />}
              {healthCounts.yellow > 0 && <div className="stack-bar__seg stack-bar__seg--warning" style={{ flexGrow: healthCounts.yellow }} title={`${PRESENTACION_SALUD.YELLOW.etiqueta}: ${healthCounts.yellow}`} />}
              {healthCounts.red    > 0 && <div className="stack-bar__seg stack-bar__seg--danger"  style={{ flexGrow: healthCounts.red }}    title={`${PRESENTACION_SALUD.RED.etiqueta}: ${healthCounts.red}`} />}
            </div>
          )}
        </div>
        {/* Proyectos en estado crítico */}
        {displayProjects.filter((p) => p.healthStatus === "RED").length > 0 && (
          <div className="notice notice--danger">
            <div className="notice__title">
              <span aria-hidden="true">{PRESENTACION_SALUD.RED.icono}</span>
              Proyectos en estado crítico
            </div>
            <div className="inline-list tone-danger">
              {displayProjects.filter((p) => p.healthStatus === "RED").map((p) => (
                <span key={p.projectId}>
                  {p.projectName} {p.evm?.cpi != null ? `(CPI ${p.evm.cpi.toFixed(2)})` : ""}
                </span>
              ))}
            </div>
          </div>
        )}
      </article>

      {/* Tareas 9 + 14: Mini-cards riesgos/issues/cambios + EVM */}
      <div className="grid three-col">
        <article className={`card stat-tile stat-tile--${risksSummary.openHighRisks > 0 ? "danger" : "success"}`}>
          <h3>⚠️ Riesgos altos abiertos</h3>
          <p className="stat-tile__value">{risksSummary.openHighRisks}</p>
          <p className="stat-tile__sub">Score ≥ 6</p>
        </article>
        <article className={`card stat-tile stat-tile--${risksSummary.openIssues > 0 ? "warning" : "success"}`}>
          <h3>🐛 Incidentes abiertos</h3>
          <p className="stat-tile__value">{risksSummary.openIssues}</p>
          <p className="stat-tile__sub">En curso o sin resolver</p>
        </article>
        <article className={`card stat-tile stat-tile--${risksSummary.pendingChgs > 0 ? "info" : "neutral"}`}>
          <h3>📋 Cambios pendientes</h3>
          <p className="stat-tile__value">{risksSummary.pendingChgs}</p>
          <p className="stat-tile__sub">Solicitudes por aprobar</p>
        </article>
      </div>

      {/* ── Filtros (Tarea 4 DateRangePicker + Tarea 11 Vistas) ── */}
      <article className="card">
        <div className="card-head">
          <h3>Filtros del tablero</h3>

          <div className="card-head__actions">
            {/* Botón Limpiar */}
            <button
              type="button"
              className="ghost toolbar-btn"
              onClick={() => {
                setCompany("");
                setProjectId("");
                setProjectStatus("");
                setProjectType("");
                setDateRange({ from: "", to: "" });
                setTablePage(1);
              }}
            >
              🧹 Limpiar
            </button>

            {/* Vistas guardadas */}
            <div className="menu-anchor">
              <button type="button" className="ghost toolbar-btn"
                onClick={() => setViewMenuOpen((o) => !o)}
                aria-expanded={viewMenuOpen}
                aria-haspopup="true">
                📑 Mis vistas {savedViews.length > 0 ? `(${savedViews.length})` : ""}
              </button>
              {viewMenuOpen && (
                <div className="menu-pop menu-pop--pad">
                  {savedViews.length === 0 ? (
                    <p className="menu-pop__empty">Sin vistas guardadas</p>
                  ) : (
                    <div className="menu-pop__list">
                      {savedViews.map((v) => (
                        <div key={v.name} className="menu-pop__row">
                          <button type="button" className="ghost" onClick={() => applyView(v)}>
                            {v.name}
                          </button>
                          <button type="button" className="ghost menu-pop__delete"
                            onClick={() => deleteView(v.name)}
                            aria-label={`Eliminar la vista ${v.name}`}>
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="menu-pop__foot">
                    <label className="sr-only" htmlFor="tablero-nombre-vista">Nombre de la vista</label>
                    <input
                      id="tablero-nombre-vista"
                      placeholder="Nombre de la vista"
                      value={viewName}
                      onChange={(e) => setViewName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveCurrentView(); }}
                    />
                    <button type="button" onClick={saveCurrentView}>
                      Guardar
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="field-grid field-grid--compact">
          <div>
            <span className="field-label">Empresa</span>
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
            <span className="field-label">Proyecto</span>
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
            <label className="field-label" htmlFor="tablero-estado">Estado del Proyecto</label>
            <select
              id="tablero-estado"
              className="select-control"
              value={projectStatus}
              onChange={(e) => { setProjectStatus(e.target.value); setTablePage(1); }}
            >
              <option value="">Todos los estados</option>
              <option value="ACTIVE">Activos</option>
              <option value="PAUSED">En Pausa</option>
              <option value="CLOSED">Cerrados</option>
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="tablero-tipo">Tipo de Proyecto</label>
            <select
              id="tablero-tipo"
              className="select-control"
              value={projectType}
              onChange={(e) => { setProjectType(e.target.value); setTablePage(1); }}
            >
              <option value="">Todos los tipos</option>
              <option value="FIXED_PRICE">Precio Fijo (Fixed Price)</option>
              <option value="TIME_AND_MATERIAL">Tiempo y Materiales (T&M)</option>
              <option value="STAFFING">Staffing / Augmentation</option>
            </select>
          </div>
          <div>
            <span className="field-label">Rango de Fechas</span>
            <DateRangePicker
              value={dateRange}
              onChange={(r) => { setDateRange(r); setTablePage(1); }}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="tablero-moneda">Moneda Base</label>
            <select
              id="tablero-moneda"
              className="select-control"
              value={baseCurrency}
              onChange={(e) => void changeBaseCurrency(e.target.value)}
            >
              {["COP","USD","EUR","MXN","PEN","CLP"].map((c) => <option key={c} value={c}>Ver en {c}</option>)}
            </select>
          </div>
        </div>

        {stats && (
          <p className="fx-note fx-note--spaced">
            Montos en {stats.baseCurrency}.
            {fxConfigs.length === 0 && " Sin tasas configuradas — valores en moneda original."}
          </p>
        )}
      </article>

      {/* Alert banner */}
      {totals.alertCount > 0 && (
        <article className="card notice--warning">
          <h3 className="notice__title">
            <span aria-hidden="true">{PRESENTACION_SALUD.YELLOW.icono}</span>
            Proyectos en riesgo ({totals.alertCount})
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

      {/* DEP-36: el fallo de las estadísticas se dice, no se disimula con un total local. */}
      {totalsFailed && (
        <article className="card notice--danger" role="alert">
          <h3 className="notice__title">
            <span aria-hidden="true">{PRESENTACION_SALUD.RED.icono}</span>
            No se pudieron cargar las estadísticas
          </h3>
          <p className="notice__text">
            Los indicadores no muestran cifras porque no hay dato del servidor. Detalle: {statsErrorMessage}
          </p>
        </article>
      )}

      {/* ── KPI grid (Tareas 5, 7, 8, 9, 15) ── */}
      <section className="grid dashboard-grid-wide">
        <DashboardKpi
          label={`Presupuesto total (${baseCurrency})`}
          value={fmt(totals.budget, baseCurrency)}
          tooltip={totals.budget === 0 ? "Sin proyectos activos o sin presupuesto asignado" : "Suma de presupuestos de todos los proyectos filtrados"}
          error={totalsFailed ? statsErrorMessage : null}
          loading={totalsPending || statsLoading}
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
          onClick={() => onDrillTo?.("financial", "expenses")}
          error={totalsFailed ? statsErrorMessage : null}
          loading={totalsPending || statsLoading}
        />
        <DashboardKpi
          label={`Ingresos reconocidos (${baseCurrency})`}
          value={fmt(totals.revenue, baseCurrency)}
          tooltip={totals.revenue === 0 ? "Sin ingresos reconocidos. Revisar hitos de facturación o entradas de ingreso." : "Ingresos formalmente reconocidos en el período"}
          onClick={() => onDrillTo?.("financial", "revenue")}
          error={totalsFailed ? statsErrorMessage : null}
          loading={totalsPending || statsLoading}
        />
        <DashboardKpi
          label={`Margen bruto (${baseCurrency})`}
          value={fmt(totals.grossMargin, baseCurrency)}
          tone={totals.grossMargin >= 0 ? "success" : "danger"}
          tooltip="Ingresos reconocidos − Gasto real"
          onClick={() => onDrillTo?.("financial", "revenue")}
          error={totalsFailed ? statsErrorMessage : null}
          loading={totalsPending || statsLoading}
        />
        <DashboardKpi
          label={`Costo proyectado (${baseCurrency})`}
          value={fmt(totals.projectedCost, baseCurrency)}
          tooltip="Suma de costos proyectados en forecasts del período"
          error={totalsFailed ? statsErrorMessage : null}
          loading={totalsPending || statsLoading}
          onClick={() => onDrillTo?.("forecasts")}
        />
        <DashboardKpi
          label="Horas aprobadas"
          value={totals.approvedHours.toFixed(1)}
          delta={calcDelta(totals.approvedHours, prevTotals.approvedHours)}
          tooltip={totals.approvedHours === 0 ? "Sin horas aprobadas en el período. Revisar registros de tiempo pendientes." : "Horas aprobadas por responsables en el período"}
          error={totalsFailed ? statsErrorMessage : null}
          loading={totalsPending || statsLoading}
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
            tone={totals.avgCpi >= 1 ? "success" : totals.avgCpi >= 0.85 ? "warning" : "danger"}
            tooltip="Cost Performance Index = EV / AC. ≥1: bajo presupuesto. <0.85: alerta de sobrecosto."
            onClick={() => onDrillTo?.("portfolio")}
          />
        )}
        {totals.avgSpi != null && (
          <DashboardKpi
            label="SPI promedio"
            value={totals.avgSpi.toFixed(2)}
            tone={totals.avgSpi >= 1 ? "success" : totals.avgSpi >= 0.85 ? "warning" : "danger"}
            tooltip="Schedule Performance Index = EV / PV. ≥1: adelantado. <0.85: retrasado."
            onClick={() => onDrillTo?.("portfolio")}
          />
        )}
        {portfolioEV > 0 && (
          <DashboardKpi
            label={`CV — Variación costo (${baseCurrency})`}
            value={fmt(evm.cv, baseCurrency)}
            tone={evm.cv >= 0 ? "success" : "danger"}
            tooltip="Cost Variance = EV − AC. Positivo: bajo presupuesto. Negativo: sobrecosto actual."
            onClick={() => onDrillTo?.("portfolio")}
          />
        )}
        {evm.eac != null && (
          <DashboardKpi
            label={`EAC (${baseCurrency})`}
            value={fmt(evm.eac, baseCurrency)}
            tone={evm.eac > totals.budget ? "danger" : "success"}
            tooltip="Estimate At Completion = BAC / CPI. Estimación del costo total del portafolio al ritmo actual."
            onClick={() => onDrillTo?.("portfolio")}
          />
        )}
        {evm.vac != null && (
          <DashboardKpi
            label={`VAC (${baseCurrency})`}
            value={fmt(evm.vac, baseCurrency)}
            tone={evm.vac >= 0 ? "success" : "danger"}
            tooltip="Variance At Completion = BAC − EAC. Positivo: ahorro esperado. Negativo: sobrecosto proyectado."
            onClick={() => onDrillTo?.("portfolio")}
          />
        )}
        {evm.tcpi != null && portfolioEV > 0 && (
          <DashboardKpi
            label="TCPI"
            value={evm.tcpi.toFixed(2)}
            tone={evm.tcpi <= 1 ? "success" : evm.tcpi <= 1.1 ? "warning" : "danger"}
            tooltip="To Complete Performance Index = (BAC−EV)/(BAC−AC). Eficiencia requerida para terminar en presupuesto. ≤1: alcanzable."
            onClick={() => onDrillTo?.("portfolio")}
          />
        )}
      </section>

      {/* ── Tabla de proyectos (Tarea 6) ── */}
      <article className="card">
        <div className="card-head">
          <h3>Resumen por proyecto</h3>

          <div className="card-head__actions">
            {/* Búsqueda */}
            <input
              className="table-search"
              placeholder="Buscar proyecto o empresa…"
              value={tableSearch}
              onChange={(e) => { setTableSearch(e.target.value); setTablePage(1); }}
              aria-label="Buscar en tabla de proyectos"
            />

            {/* Exportación */}
            <div className="menu-anchor">
              <button type="button" className="ghost toolbar-btn"
                onClick={() => setExportMenuOpen((o) => !o)}
                aria-expanded={exportMenuOpen}
                aria-haspopup="menu">
                ↓ Exportar ▾
              </button>
              {exportMenuOpen && (
                <div className="menu-pop" role="menu">
                  <button type="button" role="menuitem" className="ghost menu-pop__item"
                    onClick={() => { void exportExcel(); setExportMenuOpen(false); }}>
                    📊 Excel (.xlsx)
                  </button>
                  <button type="button" role="menuitem" className="ghost menu-pop__item"
                    onClick={() => { void exportPdf(); setExportMenuOpen(false); }}>
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
                <th className="sticky-0 col-health">Salud</th>
                <th className="sticky-1 col-company">Empresa</th>
                <th className="sticky-2 col-project">Proyecto</th>
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
                <tr><td colSpan={10} className="cell-empty cell-empty--roomy">
                  Sin proyectos{tableSearch ? ` para "${tableSearch}"` : ""}
                </td></tr>
              )}
              {pagedProjects.map((row) => {
                const dc = row.displayCurrency || baseCurrency;
                // La columna de salud mide 42px: no cabe la etiqueta, así que el
                // punto lleva dentro el icono de forma distinta (● ▲ ■) y el
                // estado completo va en el `title` y en el `aria-label`.
                const salud = PRESENTACION_SALUD[row.healthStatus as "GREEN" | "YELLOW" | "RED"] ?? PRESENTACION_SALUD.GREEN;
                return (
                  <tr key={row.projectId}>
                    <td className="sticky-0 cell-center" data-label="Salud">
                      <span
                        className={`health-dot health-dot--${salud.modificador}`}
                        title={`${salud.etiqueta} — ${textoCriteriosSalud(row.marginThreshold)}`}
                        aria-label={`Salud: ${salud.etiqueta}`}
                      >
                        <span aria-hidden="true">{salud.icono}</span>
                      </span>
                    </td>
                    <td className="sticky-1 cell-strong cell-small" data-label="Empresa">{row.company}</td>
                    <td className="sticky-2 cell-strong" data-label="Proyecto">{row.projectName}</td>
                    <td data-label="Presupuesto">{fmt(row.budget, dc)}</td>
                    <td data-label="Gasto real">{fmt(row.spent, dc)}</td>
                    <td className={row.remainingBudget < 0 ? "tone-danger" : undefined} data-label="Disponible">{fmt(row.remainingBudget, dc)}</td>
                    <td data-label="Ingresos">{fmt(row.revenueRecognized, dc)}</td>
                    <td className={row.grossMarginActual >= 0 ? undefined : "tone-danger"} data-label="Margen bruto">
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
          <div className="table-pager">
            <span className="table-pager__status">
              Página {tablePage} de {totalPages} · {filteredProjects.length} proyectos
            </span>
            <div className="table-pager__nav">
              <button type="button" className="ghost"
                disabled={tablePage === 1}
                onClick={() => setTablePage(1)}
                aria-label="Primera página">
                «
              </button>
              <button type="button" className="ghost"
                disabled={tablePage === 1}
                onClick={() => setTablePage((p) => p - 1)}>
                Anterior
              </button>
              <button type="button" className="ghost"
                disabled={tablePage === totalPages}
                onClick={() => setTablePage((p) => p + 1)}>
                Siguiente
              </button>
              <button type="button" className="ghost"
                disabled={tablePage === totalPages}
                onClick={() => setTablePage(totalPages)}
                aria-label="Última página">
                »
              </button>
            </div>
          </div>
        )}
        {totalPages <= 1 && filteredProjects.length > 0 && (
          <p className="table-foot table-foot--tight">
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
                  <tr><td colSpan={3} className="cell-empty">Sin horas en el período</td></tr>
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
                  <tr><td colSpan={3} className="cell-empty">Sin proyecciones en el período</td></tr>
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
            <div className="chart-block">
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
            <p className="chart-empty">Sin datos para mostrar</p>
          </article>
        )}

        <article className="card">
          <h3>📊 Horas Extras Aprobadas por Consultor (Top 5)</h3>
          <p className="chart-caption">
            Comparativa de consultores con mayor volumen de horas extras aprobadas.
          </p>
          <ExtraHoursByConsultantChart data={extraHoursByConsultantData} />
        </article>
      </section>

      {/* ── Métricas y Análisis Visual ── */}
      <section className="grid two-col">
        <article className="card">
          <h3>📈 Tendencia Mensual de Horas Extras (Año en Curso)</h3>
          <p className="chart-caption">
            Muestra el consolidado de horas extras aprobadas mes a mes durante el presente año.
          </p>
          <ExtraHoursTrendChart data={monthlyExtraHoursData} />
        </article>
        
        <article className="card">
          <h3>🍩 Distribución de Gastos por Categoría</h3>
          <p className="chart-caption">
            Desglose de gastos registrados en el período seleccionado.
          </p>
          <ExpensesDonutChart data={expensesCategoryData} />
        </article>
      </section>
    </section>
    </div>
  );
}

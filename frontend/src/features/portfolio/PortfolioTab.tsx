import { useState, useMemo } from "react";
import { type HealthStatus } from "../../services/api";
import { usePortfolio } from "../../hooks/usePortfolio";
import { backendHealthToResult, HEALTH_CRITERIA_TOOLTIP } from "../../utils/projectHealth";
import { PROJECT_STATUS_LABELS, label } from "../../utils/statusLabels";
import { PageHeader } from "../../components/PageHeader";
import { SearchableSelect } from "../../components/SearchableSelect";

function fmt(n: number, currency = "USD") {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
}

function RagBadge({ status }: { status: HealthStatus }) {
  const result = backendHealthToResult(status);
  return (
    <span
      style={{
        display: "inline-block", padding: "0.15rem 0.55rem", borderRadius: "9999px",
        background: result.color, color: "#fff", fontWeight: 700, fontSize: "0.7rem",
      }}
      title={HEALTH_CRITERIA_TOOLTIP}
    >
      {result.label}
    </span>
  );
}

function KpiCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <div style={{
      background: "var(--card-bg, #fff)", border: "1px solid var(--border-color, #e5e7eb)", borderRadius: "0.5rem",
      padding: "1rem 1.25rem", minWidth: "10rem", flex: "1 1 10rem",
    }}>
      <div style={{ fontSize: "0.68rem", color: "var(--text-soft, #6b7280)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.3rem" }}>{label}</div>
      <div style={{ fontSize: "1.5rem", fontWeight: 800, color: accent ?? "inherit" }}>{value}</div>
      {sub && <div style={{ fontSize: "0.7rem", color: "var(--text-soft, #9ca3af)", marginTop: "0.15rem" }}>{sub}</div>}
    </div>
  );
}

function HealthSummaryBar({ green, yellow, red, total }: { green: number; yellow: number; red: number; total: number }) {
  if (total === 0) return null;
  return (
    <div style={{ display: "flex", height: "1.2rem", borderRadius: "0.35rem", overflow: "hidden", width: "100%" }}>
      {green > 0 && (
        <div style={{ flex: green, background: "#22c55e", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.65rem", color: "#fff", fontWeight: 700 }}>
          {green}
        </div>
      )}
      {yellow > 0 && (
        <div style={{ flex: yellow, background: "#f59e0b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.65rem", color: "#fff", fontWeight: 700 }}>
          {yellow}
        </div>
      )}
      {red > 0 && (
        <div style={{ flex: red, background: "#ef4444", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.65rem", color: "#fff", fontWeight: 700 }}>
          {red}
        </div>
      )}
    </div>
  );
}

function BudgetBar({ pct }: { pct: number }) {
  const capped = Math.min(pct, 100);
  const color = pct > 100 ? "#ef4444" : pct > 90 ? "#f59e0b" : "#22c55e";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", minWidth: "8rem" }}>
      <div style={{ flex: 1, height: "0.45rem", background: "var(--border-color, #e5e7eb)", borderRadius: "9999px", overflow: "hidden" }}>
        <div style={{ width: `${capped}%`, height: "100%", background: color }} />
      </div>
      <span style={{ fontSize: "0.65rem", color: "#6b7280", whiteSpace: "nowrap" }}>{pct.toFixed(0)}%</span>
    </div>
  );
}

type SortField = "healthStatus" | "usedBudgetPercent" | "completionPct" | "grossMarginActualPct" | "openHighRisks";
type SortDir = "asc" | "desc";

function PortfolioSortTh({
  field,
  label,
  sortField,
  sortDir,
  onSort,
}: {
  field: SortField;
  label: string;
  sortField: SortField;
  sortDir: SortDir;
  onSort: (field: SortField) => void;
}) {
  const active = sortField === field;
  return (
    <th
      style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
      onClick={() => onSort(field)}
      aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
    >
      {label} {active ? (sortDir === "asc" ? "↑" : "↓") : "⇅"}
    </th>
  );
}

export function PortfolioTab({
  onOpenProject,
}: {
  canWrite?: boolean;
  onOpenProject?: (id: string) => void;
}) {
  const { portfolio, loading, error, reload } = usePortfolio(true);
  const [healthFilter, setHealthFilter] = useState<HealthStatus | "">("");
  const [statusFilter, setStatusFilter] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [sortField, setSortField] = useState<SortField>("healthStatus");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const projects = useMemo(() => portfolio?.projects ?? [], [portfolio]);

  const companies = useMemo(() => {
    const unique = new Set(projects.map((p) => p.company).filter(Boolean));
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [projects]);

  const companyOptions = useMemo(() => companies.map((c) => ({ value: c, label: c })), [companies]);

  const projectOptions = useMemo(() => {
    return projects.map((p) => ({ value: p.projectId, label: p.projectName }));
  }, [projects]);

  if (loading) return <div className="loading" style={{ padding: "2rem" }}>Cargando portafolio…</div>;
  if (error) return <div style={{ padding: "2rem", color: "#ef4444" }}>{error}</div>;
  if (!portfolio) return null;

  const { summary, baseCurrency } = portfolio;

  // Filter & sort
  const filtered = projects.filter((p) => {
    const matchCompany = !companyFilter ||
      p.company.toLowerCase().includes(companyFilter.toLowerCase());
    const matchProject = !projectFilter ||
      p.projectId === projectFilter ||
      p.projectName.toLowerCase().includes(projectFilter.toLowerCase());
    const matchHealth = !healthFilter || p.healthStatus === healthFilter;
    const matchStatus = !statusFilter || p.status === statusFilter;
    return matchCompany && matchProject && matchHealth && matchStatus;
  });

  const healthOrder: Record<HealthStatus, number> = { RED: 0, YELLOW: 1, GREEN: 2 };

  const sorted = [...filtered].sort((a, b) => {
    let av: number, bv: number;
    if (sortField === "healthStatus") {
      av = healthOrder[a.healthStatus];
      bv = healthOrder[b.healthStatus];
    } else if (sortField === "grossMarginActualPct") {
      av = a.grossMarginActualPct ?? -999;
      bv = b.grossMarginActualPct ?? -999;
    } else {
      av = a[sortField] as number;
      bv = b[sortField] as number;
    }
    return sortDir === "asc" ? av - bv : bv - av;
  });

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("desc"); }
  }

  function exportCsv() {
    const header = ["Proyecto", "Empresa", "Tipo", "Estado", "Salud", "Uso%", "Avance%", "CPI", "SPI", "Margen%", "Riesgos altos", "Incidentes abiertos"];
    const rows = sorted.map((p) => [
      p.projectName,
      p.company,
      p.projectType,
      p.status,
      p.healthStatus,
      p.usedBudgetPercent.toFixed(1),
      p.completionPct.toFixed(1),
      p.evm?.cpi != null ? p.evm.cpi.toFixed(2) : "",
      p.evm?.spi != null ? p.evm.spi.toFixed(2) : "",
      p.grossMarginActualPct != null ? p.grossMarginActualPct.toFixed(1) : "",
      String(p.openHighRisks),
      String(p.openIssues),
    ]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `portafolio-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Critical projects
  const critical = projects.filter((p) => p.healthStatus === "RED").slice(0, 5);

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <PageHeader
        icon="◈"
        title="Portafolio PMO"
        description="Supervisa el rendimiento consolidado del portafolio, indicadores EVM, salud de proyectos y análisis de riesgos."
        actions={
          <>
            <button type="button" className="ghost" onClick={() => void reload()} style={{ fontSize: "0.85rem", padding: "0.5rem 1rem", borderRadius: "8px" }}>
              ↺ Actualizar
            </button>
            <button type="button" onClick={exportCsv} style={{ fontSize: "0.85rem", padding: "0.5rem 1rem", borderRadius: "8px" }}>
              ↓ Exportar CSV
            </button>
          </>
        }
      />

      {/* Summary KPI cards */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
        <KpiCard label="Total proyectos" value={summary.totalProjects} />
        <KpiCard label="Presupuesto total" value={fmt(summary.totalBudget, baseCurrency)} sub={baseCurrency} />
        <KpiCard label="Ejecutado total" value={fmt(summary.totalSpent, baseCurrency)} />
        <KpiCard label="Ingresos totales" value={fmt(summary.totalRevenue, baseCurrency)} />
        <KpiCard label="Margen bruto" value={fmt(summary.totalGrossMargin, baseCurrency)} accent={summary.totalGrossMargin < 0 ? "#ef4444" : "#16a34a"} />
        <KpiCard label="Proyectos críticos" value={summary.criticalCount} accent={summary.criticalCount > 0 ? "#ef4444" : undefined} sub="Salud = Crítico" />
        <KpiCard label="Alertas activas" value={summary.alertCount} accent={summary.alertCount > 0 ? "#f59e0b" : undefined} />
      </div>

      {/* Health breakdown bar */}
      <div style={{ background: "var(--card-bg, #fff)", border: "1px solid var(--border-color, #e5e7eb)", borderRadius: "0.5rem", padding: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem", fontSize: "0.75rem" }}>
          <span style={{ fontWeight: 600 }}>Distribución de salud</span>
          <span style={{ color: "var(--text-soft, #6b7280)" }}>
            🟢 {summary.byHealth.GREEN} &nbsp; 🟡 {summary.byHealth.YELLOW} &nbsp; 🔴 {summary.byHealth.RED}
          </span>
        </div>
        <HealthSummaryBar green={summary.byHealth.GREEN} yellow={summary.byHealth.YELLOW} red={summary.byHealth.RED} total={summary.totalProjects} />
      </div>

      {/* Critical projects alert box */}
      {critical.length > 0 && (
        <div style={{ background: "var(--state-danger-bg)", border: "1px solid var(--state-danger-border)", borderRadius: "0.5rem", padding: "0.75rem 1rem" }}>
          <div style={{ fontWeight: 700, color: "var(--state-danger-text)", marginBottom: "0.4rem", fontSize: "0.85rem" }}>
            Proyectos en estado crítico (Salud Crítico)
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
            {critical.map((p) => (
              <button
                key={p.projectId}
                type="button"
                style={{ background: "var(--state-danger-bg)", border: "1px solid var(--state-danger-border)", borderRadius: "0.35rem", padding: "0.2rem 0.6rem", cursor: "pointer", fontSize: "0.75rem", color: "var(--state-danger-text)", fontWeight: 600 }}
                onClick={() => onOpenProject?.(p.projectId)}
              >
                {p.projectName}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", background: "var(--card-bg, #fff)", border: "1px solid var(--border-color, #e5e7eb)", borderRadius: "0.5rem", padding: "1rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "var(--color-accent)", marginBottom: "0.25rem" }}>Empresa</label>
            <SearchableSelect
              options={companyOptions}
              value={companyFilter}
              onChange={setCompanyFilter}
              placeholder="Buscar o escribir empresa..."
              emptyLabel="Todas las empresas"
              allowFreeText={true}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "var(--color-accent)", marginBottom: "0.25rem" }}>Proyecto</label>
            <SearchableSelect
              options={projectOptions}
              value={projectFilter}
              onChange={setProjectFilter}
              placeholder="Buscar o escribir proyecto..."
              emptyLabel="Todos los proyectos"
              allowFreeText={true}
            />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "var(--color-accent)", marginBottom: "0.25rem" }}>Salud</label>
            <select value={healthFilter} onChange={(e) => setHealthFilter(e.target.value as HealthStatus | "")} style={{ width: "100%", height: "42px", padding: "0.6rem 0.75rem", borderRadius: "10px", border: "1px solid var(--border-color)", background: "var(--card-bg)", color: "var(--text)" }}>
              <option value="">Todas</option>
              <option value="GREEN">Saludable</option>
              <option value="YELLOW">Advertencia</option>
              <option value="RED">Crítico</option>
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "var(--color-accent)", marginBottom: "0.25rem" }}>Estado</label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: "100%", height: "42px", padding: "0.6rem 0.75rem", borderRadius: "10px", border: "1px solid var(--border-color)", background: "var(--card-bg)", color: "var(--text)" }}>
              <option value="">Todos</option>
              <option value="ACTIVE">Activo</option>
              <option value="PAUSED">Pausado</option>
              <option value="CLOSED">Cerrado</option>
            </select>
          </div>
        </div>
      </div>

      {/* Heatmap table */}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <PortfolioSortTh field="healthStatus" label="Salud" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
              <th>Proyecto</th>
              <th>Empresa</th>
              <th>Tipo</th>
              <th>Estado</th>
              <PortfolioSortTh field="usedBudgetPercent" label="Uso presupuesto" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
              <PortfolioSortTh field="completionPct" label="Avance" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
              <th>CPI</th>
              <th>SPI</th>
              <PortfolioSortTh field="grossMarginActualPct" label="Margen %" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
              <PortfolioSortTh field="openHighRisks" label="Riesgos altos" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
              <th>Incidentes abiertos</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={13} style={{ textAlign: "center", color: "var(--text-soft)" }}>Sin proyectos</td>
              </tr>
            )}
            {sorted.map((p) => (
              <tr key={p.projectId} style={{ background: p.healthStatus === "RED" ? "var(--state-danger-bg)" : p.healthStatus === "YELLOW" ? "var(--state-warning-bg)" : "inherit" }}>
                <td><RagBadge status={p.healthStatus} /></td>
                <td style={{ fontWeight: 600 }}>{p.projectName}</td>
                <td>{p.company}</td>
                <td style={{ fontSize: "0.75rem" }}>
                  {p.projectType === "TIME_AND_MATERIAL" ? "T&M" : p.projectType === "FIXED_PRICE" ? "FP" : "Staff"}
                </td>
                <td>
                  <span className={`pill ${p.status === "ACTIVE" ? "ok" : p.status === "PAUSED" ? "warn" : "neutral"}`} style={{ fontSize: "0.7rem" }}>
                    {label(PROJECT_STATUS_LABELS, p.status)}
                  </span>
                </td>
                <td><BudgetBar pct={p.usedBudgetPercent} /></td>
                <td><BudgetBar pct={p.completionPct} /></td>
                <td style={{ fontWeight: 600, color: p.evm?.cpi != null ? (p.evm.cpi < 0.85 ? "#ef4444" : p.evm.cpi < 1 ? "#f59e0b" : "#22c55e") : "#9ca3af" }}>
                  {p.evm?.cpi != null ? p.evm.cpi.toFixed(2) : "—"}
                </td>
                <td style={{ fontWeight: 600, color: p.evm?.spi != null ? (p.evm.spi < 0.85 ? "#ef4444" : p.evm.spi < 1 ? "#f59e0b" : "#22c55e") : "#9ca3af" }}>
                  {p.evm?.spi != null ? p.evm.spi.toFixed(2) : "—"}
                </td>
                <td style={{ color: p.grossMarginActualPct != null ? (p.grossMarginActualPct < 0 ? "#ef4444" : p.grossMarginActualPct < 15 ? "#f59e0b" : "#22c55e") : "#9ca3af", fontWeight: 600 }}>
                  {p.grossMarginActualPct != null ? `${p.grossMarginActualPct.toFixed(1)}%` : "—"}
                </td>
                <td style={{ textAlign: "center", color: p.openHighRisks > 0 ? "#ef4444" : "#22c55e", fontWeight: 600 }}>
                  {p.openHighRisks}
                </td>
                <td style={{ textAlign: "center", color: p.openIssues > 0 ? "#f59e0b" : "#22c55e" }}>
                  {p.openIssues}
                </td>
                <td>
                  {onOpenProject && (
                    <button type="button" style={{ fontSize: "0.75rem" }} onClick={() => onOpenProject(p.projectId)}>
                      Ver
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
        <span style={{ fontSize: "0.7rem", color: "#9ca3af" }}>
          {sorted.length} de {projects.length} proyectos · Moneda base: {baseCurrency}
        </span>
        {sorted.length > 0 && (
          <button type="button" className="ghost" onClick={exportCsv} style={{ fontSize: "0.7rem" }}>
            Exportar {sorted.length} filas como CSV
          </button>
        )}
      </div>
    </section>
  );
}

import { useState, useMemo } from "react";
import { type HealthStatus } from "../../services/api";
import { usePortfolio } from "../../hooks/usePortfolio";
import { textoCriteriosSalud, claseMargen, PRESENTACION_SALUD } from "../../utils/projectHealth";
import { PROJECT_STATUS_LABELS, label } from "../../utils/statusLabels";
import { PageHeader } from "../../components/PageHeader";
import { SearchableSelect } from "../../components/SearchableSelect";

/**
 * Pantalla de referencia del sistema de diseño.
 *
 * Reglas que cumple y que el resto de pantallas debe adoptar (ver
 * `documentacion/DISENO.md`):
 *  - Cero colores literales: todo color sale de un token de `index.css`.
 *  - Nada de `style={{ }}` para lo que se repite: los patrones viven como
 *    clases en `App.css` (`.panel`, `.kpi-card`, `.meter`, `.status-badge`…).
 *  - Espaciado y radios de la escala (`--space-*`, `--radius-*`).
 *  - El color nunca viaja solo: cada indicador lleva icono y/o etiqueta.
 */

function fmt(n: number, currency = "USD") {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
}

/** Tono del texto de un dato según su estado; se traduce a clase, no a color. */
type Tone = "success" | "warning" | "danger" | "muted" | undefined;

function RagBadge({ status, marginThreshold }: { status: HealthStatus; marginThreshold?: number | null }) {
  const p = PRESENTACION_SALUD[status] ?? PRESENTACION_SALUD.GREEN;
  return (
    <span className={`status-badge status-badge--${p.modificador}`} title={textoCriteriosSalud(marginThreshold)}>
      <span className="status-badge__icon" aria-hidden="true">{p.icono}</span>
      {p.etiqueta}
    </span>
  );
}

function KpiCard({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: Tone }) {
  return (
    <div className="kpi-card">
      <div className="kpi-card__label">{label}</div>
      <div className={`kpi-card__value${tone ? ` tone-${tone}` : ""}`}>{value}</div>
      {sub && <div className="kpi-card__sub">{sub}</div>}
    </div>
  );
}

/** Distribución de salud: barra apilada + leyenda con etiqueta de texto. */
function HealthSummaryBar({ green, yellow, red, total }: { green: number; yellow: number; red: number; total: number }) {
  if (total === 0) return null;
  const segmentos = [
    { n: green, mod: "success", etiqueta: PRESENTACION_SALUD.GREEN.etiqueta },
    { n: yellow, mod: "warning", etiqueta: PRESENTACION_SALUD.YELLOW.etiqueta },
    { n: red, mod: "danger", etiqueta: PRESENTACION_SALUD.RED.etiqueta },
  ];
  return (
    <div className="stack-bar" role="img" aria-label={segmentos.map((s) => `${s.etiqueta}: ${s.n}`).join(", ")}>
      {segmentos
        .filter((s) => s.n > 0)
        .map((s) => (
          <div
            key={s.mod}
            className={`stack-bar__seg stack-bar__seg--${s.mod}`}
            style={{ flexGrow: s.n }}
            title={`${s.etiqueta}: ${s.n}`}
          >
            {s.n}
          </div>
        ))}
    </div>
  );
}

/** Medidor de porcentaje. El número siempre visible: el color solo refuerza. */
function BudgetBar({ pct, etiqueta }: { pct: number; etiqueta: string }) {
  const capped = Math.min(pct, 100);
  const mod = pct > 100 ? "danger" : pct > 90 ? "warning" : "success";
  return (
    <div className="meter">
      <div className="meter__track">
        <div className={`meter__fill meter__fill--${mod}`} style={{ width: `${capped}%` }} />
      </div>
      <span className="meter__value">{pct.toFixed(0)}%</span>
      <span className="sr-only">{`${etiqueta}: ${pct.toFixed(0)}%`}</span>
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
      className="is-sortable"
      onClick={() => onSort(field)}
      aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
    >
      {label} {active ? (sortDir === "asc" ? "↑" : "↓") : "⇅"}
    </th>
  );
}

/** Tono de CPI/SPI con los mismos cortes que tenía la pantalla. */
function toneIndiceEvm(valor: number | null | undefined): Tone {
  if (valor == null) return "muted";
  if (valor < 0.85) return "danger";
  if (valor < 1) return "warning";
  return "success";
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

  if (loading) return <div className="panel">Cargando portafolio…</div>;
  if (error) {
    return (
      <div className="notice notice--danger" role="alert">
        <div className="notice__title">
          <span aria-hidden="true">■</span> No se pudo cargar el portafolio
        </div>
        {error}
      </div>
    );
  }
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
    <section className="page-stack">
      <PageHeader
        icon="◈"
        title="Portafolio PMO"
        description="Supervisa el rendimiento consolidado del portafolio, indicadores EVM, salud de proyectos y análisis de riesgos."
        actions={
          <>
            <button type="button" className="ghost toolbar-btn" onClick={() => void reload()}>
              ↺ Actualizar
            </button>
            <button type="button" className="toolbar-btn" onClick={exportCsv}>
              ↓ Exportar CSV
            </button>
          </>
        }
      />

      {/* Resumen del portafolio */}
      <div className="kpi-grid">
        <KpiCard label="Total proyectos" value={summary.totalProjects} />
        <KpiCard label="Presupuesto total" value={fmt(summary.totalBudget, baseCurrency)} sub={baseCurrency} />
        <KpiCard label="Ejecutado total" value={fmt(summary.totalSpent, baseCurrency)} />
        <KpiCard label="Ingresos totales" value={fmt(summary.totalRevenue, baseCurrency)} />
        <KpiCard
          label="Margen bruto"
          value={fmt(summary.totalGrossMargin, baseCurrency)}
          tone={summary.totalGrossMargin < 0 ? "danger" : "success"}
          sub={summary.totalGrossMargin < 0 ? "En pérdida" : "En positivo"}
        />
        <KpiCard
          label="Proyectos críticos"
          value={summary.criticalCount}
          tone={summary.criticalCount > 0 ? "danger" : undefined}
          sub="Salud = Crítico"
        />
        <KpiCard
          label="Alertas activas"
          value={summary.alertCount}
          tone={summary.alertCount > 0 ? "warning" : undefined}
          sub={summary.alertCount > 0 ? "Requieren revisión" : "Sin pendientes"}
        />
      </div>

      {/* Distribución de salud */}
      <div className="panel">
        <div className="panel__head">
          <span className="panel__title">Distribución de salud</span>
          <span className="legend">
            <span className="legend__item">
              <span className="legend__dot legend__dot--success" aria-hidden="true" />
              {PRESENTACION_SALUD.GREEN.etiqueta}: {summary.byHealth.GREEN}
            </span>
            <span className="legend__item">
              <span className="legend__dot legend__dot--warning" aria-hidden="true" />
              {PRESENTACION_SALUD.YELLOW.etiqueta}: {summary.byHealth.YELLOW}
            </span>
            <span className="legend__item">
              <span className="legend__dot legend__dot--danger" aria-hidden="true" />
              {PRESENTACION_SALUD.RED.etiqueta}: {summary.byHealth.RED}
            </span>
          </span>
        </div>
        <HealthSummaryBar green={summary.byHealth.GREEN} yellow={summary.byHealth.YELLOW} red={summary.byHealth.RED} total={summary.totalProjects} />
      </div>

      {/* Proyectos en estado crítico */}
      {critical.length > 0 && (
        <div className="notice notice--danger">
          <div className="notice__title">
            <span aria-hidden="true">{PRESENTACION_SALUD.RED.icono}</span>
            Proyectos en estado crítico
          </div>
          <div className="chip-row">
            {critical.map((p) => (
              <button
                key={p.projectId}
                type="button"
                className="chip-button"
                onClick={() => onOpenProject?.(p.projectId)}
              >
                {p.projectName}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="panel">
        <div className="panel__body">
          <div className="field-grid">
            <div>
              <span className="field-label">Empresa</span>
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
              <span className="field-label">Proyecto</span>
              <SearchableSelect
                options={projectOptions}
                value={projectFilter}
                onChange={setProjectFilter}
                placeholder="Buscar o escribir proyecto..."
                emptyLabel="Todos los proyectos"
                allowFreeText={true}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="portfolio-salud">Salud</label>
              <select
                id="portfolio-salud"
                className="select-control"
                value={healthFilter}
                onChange={(e) => setHealthFilter(e.target.value as HealthStatus | "")}
              >
                <option value="">Todas</option>
                <option value="GREEN">{PRESENTACION_SALUD.GREEN.etiqueta}</option>
                <option value="YELLOW">{PRESENTACION_SALUD.YELLOW.etiqueta}</option>
                <option value="RED">{PRESENTACION_SALUD.RED.etiqueta}</option>
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="portfolio-estado">Estado</label>
              <select
                id="portfolio-estado"
                className="select-control"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">Todos</option>
                <option value="ACTIVE">Activo</option>
                <option value="PAUSED">Pausado</option>
                <option value="CLOSED">Cerrado</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Tabla de proyectos */}
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
                <td colSpan={13} className="cell-empty">Sin proyectos</td>
              </tr>
            )}
            {sorted.map((p) => (
              <tr
                key={p.projectId}
                className={p.healthStatus === "RED" ? "row-danger" : p.healthStatus === "YELLOW" ? "row-warning" : undefined}
              >
                <td><RagBadge status={p.healthStatus} marginThreshold={p.marginThreshold} /></td>
                <td className="cell-strong">{p.projectName}</td>
                <td>{p.company}</td>
                <td className="cell-small">
                  {p.projectType === "TIME_AND_MATERIAL" ? "T&M" : p.projectType === "FIXED_PRICE" ? "FP" : "Staff"}
                </td>
                <td>
                  <span className={`pill ${p.status === "ACTIVE" ? "ok" : p.status === "PAUSED" ? "warn" : "neutral"}`}>
                    {label(PROJECT_STATUS_LABELS, p.status)}
                  </span>
                </td>
                <td><BudgetBar pct={p.usedBudgetPercent} etiqueta="Uso de presupuesto" /></td>
                <td><BudgetBar pct={p.completionPct} etiqueta="Avance" /></td>
                <td className={`cell-num tone-${toneIndiceEvm(p.evm?.cpi)}`}>
                  {p.evm?.cpi != null ? p.evm.cpi.toFixed(2) : "—"}
                </td>
                <td className={`cell-num tone-${toneIndiceEvm(p.evm?.spi)}`}>
                  {p.evm?.spi != null ? p.evm.spi.toFixed(2) : "—"}
                </td>
                <td
                  className={`cell-num ${claseMargen(p.grossMarginActualPct, p.marginThreshold)}`}
                  title={`Umbral de margen del proyecto: ${p.marginThreshold}%`}
                >
                  {p.grossMarginActualPct != null ? `${p.grossMarginActualPct.toFixed(1)}%` : "—"}
                </td>
                <td className={`cell-num cell-center ${p.openHighRisks > 0 ? "tone-danger" : "tone-success"}`}>
                  {p.openHighRisks}
                </td>
                <td className={`cell-num cell-center ${p.openIssues > 0 ? "tone-warning" : "tone-success"}`}>
                  {p.openIssues}
                </td>
                <td>
                  {onOpenProject && (
                    <button type="button" className="ghost toolbar-btn" onClick={() => onOpenProject(p.projectId)}>
                      Ver
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="table-foot">
        <span>
          {sorted.length} de {projects.length} proyectos · Moneda base: {baseCurrency}
        </span>
        {sorted.length > 0 && (
          <button type="button" className="ghost toolbar-btn" onClick={exportCsv}>
            Exportar {sorted.length} filas como CSV
          </button>
        )}
      </div>
    </section>
  );
}

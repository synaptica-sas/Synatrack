import { useState, useMemo } from "react";
import { PageHeader } from "../../components/PageHeader";
import { resolveAlert, runAlertEngine, type AppAlert } from "../../services/api";

/**
 * Centro de Alertas, migrado al sistema de diseño (ver `documentacion/DISENO.md`).
 *
 * Cero colores literales y cero estilos en línea: los KPIs reutilizan `.kpi-card`
 * de Portafolio, la severidad reutiliza `.status-badge` y los tokens
 * `--state-*`, y lo que era nuevo aquí (fila de filtros, contador de grupo,
 * estado vacío, tarjeta de alerta) se creó como clase reutilizable en
 * `App.css`, no como estilo en línea.
 */

type AlertGroup = {
  key: string;
  label: string;
  icon: string;
  items: AppAlert[];
};

const TYPE_GROUPS: { types: string[]; key: string; label: string; icon: string }[] = [
  { key: "budget",   types: ["BUDGET_EXCEEDED", "BUDGET_WARNING"],     label: "Presupuesto",          icon: "💰" },
  { key: "cpi",      types: ["FORECAST_DEVIATION"],                     label: "CPI / Desviación",     icon: "📉" },
  { key: "margin",   types: ["MARGIN_BELOW_THRESHOLD"],                 label: "Margen bajo umbral",   icon: "⚠️" },
  { key: "assign",   types: ["ASSIGNMENT_ENDING"],                      label: "Asignaciones",         icon: "👤" },
  { key: "capacity", types: ["CONSULTANT_OVERLOADED"],                  label: "Capacidad",            icon: "🔴" },
  { key: "other",    types: [],                                          label: "Otras alertas",        icon: "🔔" },
];

function groupAlerts(alerts: AppAlert[]): AlertGroup[] {
  const buckets: Record<string, AppAlert[]> = {};
  for (const g of TYPE_GROUPS) buckets[g.key] = [];

  for (const alert of alerts) {
    const matched = TYPE_GROUPS.find((g) => g.types.includes(alert.type));
    const key = matched ? matched.key : "other";
    buckets[key].push(alert);
  }

  return TYPE_GROUPS
    .filter((g) => buckets[g.key].length > 0)
    .map((g) => ({ key: g.key, label: g.label, icon: g.icon, items: buckets[g.key] }));
}

/**
 * Presentación de la severidad: etiqueta de texto + modificador de clase.
 * Sustituye al mapa `SEV_COLOR`, que guardaba pares de literales de la paleta
 * por defecto de Tailwind sin contraparte de modo oscuro. La etiqueta es la que
 * cumple la regla de "el color nunca viaja solo"; el color solo refuerza.
 */
const PRESENTACION_SEVERIDAD: Record<string, { etiqueta: string; modificador: string }> = {
  CRITICAL: { etiqueta: "Crítico", modificador: "danger" },
  WARNING: { etiqueta: "Advertencia", modificador: "warning" },
  INFO: { etiqueta: "Info", modificador: "info" },
};

export function AlertsTab({
  alerts,
  unreadCount,
  loading,
  canRun,
  onReload,
  onError,
}: {
  alerts: AppAlert[];
  unreadCount: number;
  loading: boolean;
  canRun: boolean;
  onReload: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [running, setRunning] = useState(false);
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");

  async function handleResolve(id: string) {
    try {
      await resolveAlert(id);
      await onReload();
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo resolver la alerta");
    }
  }

  async function handleRun() {
    setRunning(true);
    try {
      await runAlertEngine();
      await onReload();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Error al ejecutar el motor de alertas");
    } finally {
      setRunning(false);
    }
  }

  // Filter alerts by search query and severity
  const filteredAlerts = useMemo(() => {
    return alerts.filter((alert) => {
      const q = search.trim().toLowerCase();
      const matchesSearch = !q ||
        alert.message.toLowerCase().includes(q) ||
        (alert.project && alert.project.name.toLowerCase().includes(q));

      const matchesSeverity = !severityFilter || alert.severity === severityFilter;

      return matchesSearch && matchesSeverity;
    });
  }, [alerts, search, severityFilter]);

  const groups = groupAlerts(filteredAlerts);
  const criticas = alerts.filter((a) => a.severity === "CRITICAL").length;
  const advertencias = alerts.filter((a) => a.severity === "WARNING").length;

  return (
    <section className="page-stack">
      <PageHeader
        icon="🔔"
        title="Centro de Alertas"
        description="Bandeja de entrada de notificaciones del sistema sobre desvíos presupuestarios y horas extras."
        actions={
          <>
            {canRun && (
              <button
                type="button"
                className="toolbar-btn"
                onClick={() => void handleRun()}
                disabled={running || loading}
              >
                {running ? "Procesando motor…" : "⚡ Ejecutar motor de alertas"}
              </button>
            )}
            <button
              type="button"
              className="ghost toolbar-btn"
              onClick={() => void onReload()}
              disabled={loading}
            >
              {loading ? "Actualizando…" : "↺ Actualizar"}
            </button>
          </>
        }
      />

      {/* Resumen de la bandeja */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-card__label">Alertas activas</div>
          <div className={`kpi-card__value ${unreadCount > 0 ? "tone-danger" : "tone-success"}`}>{unreadCount}</div>
          <div className="kpi-card__sub">Pendientes de resolución</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-card__label">Alertas críticas</div>
          <div className={`kpi-card__value ${criticas > 0 ? "tone-danger" : ""}`}>{criticas}</div>
          <div className="kpi-card__sub">Prioridad alta</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-card__label">Advertencias</div>
          <div className={`kpi-card__value ${advertencias > 0 ? "tone-warning" : ""}`}>{advertencias}</div>
          <div className="kpi-card__sub">Riesgo moderado</div>
        </div>
      </div>

      {/* Filtros */}
      <div className="filter-row">
        <label className="sr-only" htmlFor="alertas-buscar">Buscar alertas</label>
        <input
          id="alertas-buscar"
          className="filter-row__grow"
          placeholder="Buscar por proyecto o mensaje de alerta..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="sr-only" htmlFor="alertas-severidad">Severidad</label>
        <select
          id="alertas-severidad"
          className="filter-row__fixed"
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
        >
          <option value="">Severidad: Todas</option>
          <option value="CRITICAL">Crítico</option>
          <option value="WARNING">Advertencia</option>
          <option value="INFO">Informativo</option>
        </select>
      </div>

      {/* Tablero de alertas */}
      <div className="alert-groups">
        {groups.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__icon" aria-hidden="true">🎉</div>
            <h3 className="empty-state__title">¡Todo al día!</h3>
            <p className="empty-state__text">No hay alertas activas que coincidan con la búsqueda.</p>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.key} className="panel">
              <div className="panel__head">
                <h3 className="panel__title panel__title--heading">
                  <span aria-hidden="true">{group.icon}</span>
                  <span>{group.label}</span>
                  <span className="count-badge">{group.items.length}</span>
                </h3>
              </div>

              <div className="alert-list">
                {group.items.map((alert) => {
                  const sev = PRESENTACION_SEVERIDAD[alert.severity] ?? PRESENTACION_SEVERIDAD.INFO;
                  return (
                    <div key={alert.id} className={`alert-item alert-item--${sev.modificador}`}>
                      <div className="alert-item__body">
                        <div className="alert-item__meta">
                          <span className={`status-badge status-badge--${sev.modificador}`}>{sev.etiqueta}</span>
                          {alert.project && (
                            <span className="alert-item__project">{alert.project.name}</span>
                          )}
                          <span className="alert-item__time">
                            {new Date(alert.createdAt).toLocaleString("es-CO", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                        <p className="alert-item__message">{alert.message}</p>
                      </div>
                      <div className="alert-item__actions">
                        <button
                          type="button"
                          className="ghost alert-item__resolve"
                          onClick={() => void handleResolve(alert.id)}
                        >
                          ✓ Resolver
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

import { useState } from "react";
import { resolveAlert, type AppAlert } from "../services/api";

/**
 * Cajón de alertas (el que abre el botón 🔔 de la cabecera), migrado al
 * sistema de diseño (ver `documentacion/DISENO.md`). Las tarjetas de alerta
 * reusan `.alert-item`/`.status-badge`, las mismas clases que
 * `features/alerts/AlertsTab.tsx`; lo único propio de este componente es el
 * marco del cajón (botón, telón, panel deslizante, grupos plegables).
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

/** Misma presentación de severidad que `AlertsTab.tsx`: etiqueta + modificador de clase. */
const PRESENTACION_SEVERIDAD: Record<string, { etiqueta: string; modificador: string }> = {
  CRITICAL: { etiqueta: "Crítico", modificador: "danger" },
  WARNING: { etiqueta: "Advertencia", modificador: "warning" },
  INFO: { etiqueta: "Info", modificador: "info" },
};

export function AlertsPanel({
  alerts,
  unreadCount,
  canRun,
  onReload,
  onError,
}: {
  alerts: AppAlert[];
  unreadCount: number;
  canRun: boolean;
  onReload: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["budget", "cpi"]));

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
      await onReload();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Error al actualizar alertas");
    } finally {
      setRunning(false);
    }
  }

  function toggleGroup(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const groups = groupAlerts(alerts);

  return (
    <>
      <button
        type="button"
        className="ghost alert-panel__trigger"
        onClick={() => setOpen(true)}
        aria-label={`Alertas, ${unreadCount} activas`}
      >
        🔔 Alertas
        {unreadCount > 0 && (
          <span aria-hidden="true" className="alert-panel__count">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div aria-hidden="true" onClick={() => setOpen(false)} className="alert-panel__backdrop" />
      )}

      <aside
        role="dialog"
        aria-label="Panel de alertas"
        aria-modal="true"
        className={`alert-panel${open ? " open" : ""}`}
      >
        <div className="alert-panel__head">
          <div>
            <h2>🔔 Alertas activas</h2>
            <p>{unreadCount} sin resolver</p>
          </div>
          <div className="alert-panel__head-actions">
            {canRun && (
              <button type="button" className="ghost toolbar-btn" onClick={() => void handleRun()} disabled={running}>
                {running ? "Actualizando…" : "↺ Actualizar"}
              </button>
            )}
            <button type="button" className="ghost toolbar-btn" onClick={() => setOpen(false)} aria-label="Cerrar panel de alertas">
              ✕
            </button>
          </div>
        </div>

        <div className="alert-panel__body">
          {groups.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state__icon" aria-hidden="true">✅</div>
              <p className="empty-state__title">Sin alertas activas</p>
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.key} className="alert-panel__group">
                <button
                  type="button"
                  className="alert-panel__toggle"
                  onClick={() => toggleGroup(group.key)}
                  aria-expanded={expanded.has(group.key)}
                >
                  <span className="alert-panel__toggle-label">
                    <span aria-hidden="true">{group.icon}</span>
                    {group.label}
                    <span className="count-badge">{group.items.length}</span>
                  </span>
                  <span className="alert-panel__toggle-chevron" aria-hidden="true">
                    {expanded.has(group.key) ? "▲" : "▼"}
                  </span>
                </button>

                {expanded.has(group.key) && (
                  <div className="alert-list alert-panel__items">
                    {group.items.map((alert) => {
                      const sev = PRESENTACION_SEVERIDAD[alert.severity] ?? PRESENTACION_SEVERIDAD.INFO;
                      return (
                        <div key={alert.id} className={`alert-item alert-item--${sev.modificador}`}>
                          <div className="alert-item__body">
                            <div className="alert-item__meta">
                              <span className={`status-badge status-badge--${sev.modificador}`}>{sev.etiqueta}</span>
                              {alert.project && <span className="alert-item__project">{alert.project.name}</span>}
                            </div>
                            <p className="alert-item__message">{alert.message}</p>
                          </div>
                          <div className="alert-item__actions">
                            <button type="button" className="ghost alert-item__resolve" onClick={() => void handleResolve(alert.id)}>
                              Resolver
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </aside>
    </>
  );
}

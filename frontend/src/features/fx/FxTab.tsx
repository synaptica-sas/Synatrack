import { useState, useEffect } from "react";
import type { FormEvent } from "react";
import { PageHeader } from "../../components/PageHeader";
import { deleteFxRate, listFxHistory, syncFxRates, upsertFxRate, type FxConfig, type FxRateHistory } from "../../services/api";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { formatDate, formatDateTime } from "../../utils/formatDate";

const currencyOptions = ["COP", "USD", "EUR", "MXN", "PEN", "CLP"];

const emptyForm = { baseCode: "USD", quoteCode: "COP", rate: "" };

async function fetchMarketRate(base: string, quote: string): Promise<number | null> {
  if (base === quote) return 1;
  try {
    const res = await fetch(`https://api.exchangerate-api.com/v4/latest/${base}`);
    if (!res.ok) return null;
    const data = await res.json() as { rates: Record<string, number> };
    return data.rates[quote] ?? null;
  } catch {
    return null;
  }
}

export function FxTab({
  fxConfigs,
  loading,
  canWrite,
  onReload,
  onError,
}: {
  fxConfigs: FxConfig[];
  loading: boolean;
  canWrite: boolean;
  onReload: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [fetchingRate, setFetchingRate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FxConfig | null>(null);
  const [historyFilter, setHistoryFilter] = useState({ baseCode: "", quoteCode: "", from: "", to: "" });
  const [history, setHistory] = useState<FxRateHistory[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  useEffect(() => {
    setFetchingRate(true);
    fetchMarketRate(form.baseCode, form.quoteCode).then((rate: number | null) => {
      if (rate !== null) {
        setForm((p) => ({ ...p, rate: String(rate) }));
      }
      setFetchingRate(false);
    });
  }, [form.baseCode, form.quoteCode]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await upsertFxRate({ baseCode: form.baseCode, quoteCode: form.quoteCode, rate: Number(form.rate) });
      setForm(emptyForm);
      await onReload();
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo guardar la tasa");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setDeleteTarget(null);
    try {
      await deleteFxRate(id);
      await onReload();
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo eliminar la tasa");
    }
  }

  async function handleSync() {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const result = await syncFxRates();
      const parts = [];
      if (result.updated.length > 0) parts.push(`Actualizadas: ${result.updated.join(", ")}`);
      if (result.failed.length > 0) parts.push(`No disponibles: ${result.failed.join(", ")}`);
      setSyncMessage(parts.join(" · ") || "Sin cambios");
      await onReload();
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo sincronizar con el proveedor de tasas");
    } finally {
      setSyncing(false);
    }
  }

  async function loadHistory() {
    setHistoryLoading(true);
    try {
      const data = await listFxHistory({
        baseCode: historyFilter.baseCode || undefined,
        quoteCode: historyFilter.quoteCode || undefined,
        from: historyFilter.from || undefined,
        to: historyFilter.to || undefined,
      });
      setHistory(data);
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo cargar el historial");
    } finally {
      setHistoryLoading(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <PageHeader
        icon="⊗"
        title="Tasas de Cambio (FX)"
        description="Configura y actualiza las tasas de conversión de monedas extranjeras frente a la moneda base."
      />
      <section className="grid two-col">
      <article className="card">
        <h3>Configurar tasa de cambio</h3>
        {canWrite ? (
          <form onSubmit={(e) => void handleSubmit(e)} className="form-grid">
            <select value={form.baseCode} onChange={(e) => setForm((p) => ({ ...p, baseCode: e.target.value }))}>
              {currencyOptions.map((c) => <option key={`fx-base-${c}`} value={c}>{`Base: ${c}`}</option>)}
            </select>
            <select value={form.quoteCode} onChange={(e) => setForm((p) => ({ ...p, quoteCode: e.target.value }))}>
              {currencyOptions.map((c) => <option key={`fx-quote-${c}`} value={c}>{`Destino: ${c}`}</option>)}
            </select>
            <div style={{ position: "relative" }}>
              <input
                type="number"
                step="0.000001"
                min="0.000001"
                placeholder={fetchingRate ? "Consultando tasa…" : `1 ${form.baseCode} = ? ${form.quoteCode}`}
                value={form.rate}
                readOnly
                required
                style={{ width: "100%", cursor: "default", background: "var(--state-neutral-bg)", color: "var(--text)" }}
              />
              {fetchingRate && (
                <span style={{ position: "absolute", right: "0.6rem", top: "50%", transform: "translateY(-50%)", fontSize: "0.75rem", color: "var(--text-soft)" }}>
                  ⟳
                </span>
              )}
            </div>
            <button type="submit" disabled={submitting}>{submitting ? "Guardando…" : "Guardar tasa"}</button>
          </form>
        ) : (
          <p className="fx-note">Solo ADMIN y FINANCE pueden modificar tasas.</p>
        )}
        <p className="fx-note">La tasa se obtiene automáticamente de exchangerate-api.com según las monedas seleccionadas. Ej: 1 USD = 4200 COP</p>
      </article>

      <article className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
          <h3 style={{ margin: 0 }}>Tasas configuradas</h3>
          {canWrite && (
            <button type="button" className="ghost" onClick={() => void handleSync()} disabled={syncing}>
              {syncing ? "Sincronizando…" : "🔄 Actualizar ahora"}
            </button>
          )}
        </div>
        {syncMessage && <p className="fx-note">{syncMessage}</p>}
        {loading ? (
          <p className="loading">Cargando...</p>
        ) : fxConfigs.length === 0 ? (
          <p className="fx-note">No hay tasas configuradas. Agrega la primera para habilitar la consolidación multimoneda.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Par</th>
                  <th>Tasa</th>
                  <th>Inversa</th>
                  <th>Actualizado</th>
                  {canWrite && <th>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {fxConfigs.map((fx) => (
                  <tr key={fx.id}>
                    <td><span className="pill neutral">{fx.baseCode}/{fx.quoteCode}</span></td>
                    <td>{`1 ${fx.baseCode} = ${Number(fx.rate).toLocaleString("es-CO", { maximumFractionDigits: 6 })} ${fx.quoteCode}`}</td>
                    <td>{`1 ${fx.quoteCode} = ${(1 / Number(fx.rate)).toLocaleString("es-CO", { maximumFractionDigits: 6 })} ${fx.baseCode}`}</td>
                    <td>{formatDateTime(fx.updatedAt)}</td>
                    {canWrite && (
                      <td>
                        <button type="button" className="ghost" onClick={() => setDeleteTarget(fx)}>Eliminar</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>

      <article className="card" style={{ gridColumn: "1 / -1" }}>
        <h3>Historial de tasas</h3>
        <div className="form-grid filters-grid" style={{ marginBottom: "0.75rem" }}>
          <select value={historyFilter.baseCode} onChange={(e) => setHistoryFilter((p) => ({ ...p, baseCode: e.target.value }))}>
            <option value="">Todas las bases</option>
            {currencyOptions.map((c) => <option key={`hist-base-${c}`} value={c}>{c}</option>)}
          </select>
          <select value={historyFilter.quoteCode} onChange={(e) => setHistoryFilter((p) => ({ ...p, quoteCode: e.target.value }))}>
            <option value="">Todos los destinos</option>
            {currencyOptions.map((c) => <option key={`hist-quote-${c}`} value={c}>{c}</option>)}
          </select>
          <input type="date" value={historyFilter.from} onChange={(e) => setHistoryFilter((p) => ({ ...p, from: e.target.value }))} />
          <input type="date" value={historyFilter.to} onChange={(e) => setHistoryFilter((p) => ({ ...p, to: e.target.value }))} />
          <button type="button" onClick={() => void loadHistory()}>{historyLoading ? "Cargando…" : "Consultar historial"}</button>
        </div>
        {history.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Par</th>
                  <th>Tasa</th>
                  <th>Fecha efectiva</th>
                  <th>Fuente</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td><span className="pill neutral">{h.baseCode}/{h.quoteCode}</span></td>
                    <td>{Number(h.rate).toLocaleString("es-CO", { maximumFractionDigits: 6 })}</td>
                    <td>{formatDate(h.effectiveDate)}</td>
                    <td>{h.source || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!historyLoading && history.length === 0 && (
          <p className="fx-note">Aplica filtros y presiona "Consultar historial" para ver registros.</p>
        )}
      </article>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Eliminar tasa"
        message={`¿Eliminar la tasa ${deleteTarget?.baseCode}/${deleteTarget?.quoteCode}?`}
        confirmLabel="Eliminar"
        danger
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { useIsAuthenticated, useMsal } from "@azure/msal-react";
import { env } from "./config/env";
import { apiTokenRequest, loginRequest } from "./auth/msal";
import {
  getHealth, getMe, getRolePermissions, setApiAccessToken, sendFeedback,
  type AuthUser, type HealthResponse, type FxConfig, type RolePermissionsMap,
} from "./services/api";
import { findFxRate } from "./utils/fxRate";
import { useProjects } from "./hooks/useProjects";
import { useConsultants } from "./hooks/useConsultants";
import { useTimeEntries } from "./hooks/useTimeEntries";
import { useExpenses } from "./hooks/useExpenses";
import { useForecasts } from "./hooks/useForecasts";
import { useRevenue } from "./hooks/useRevenue";
import { useFxConfigs } from "./hooks/useFxConfigs";
import { useAdminUsers } from "./hooks/useAdminUsers";
import { useStats } from "./hooks/useStats";
import { useAlerts } from "./hooks/useAlerts";
import { useToastController } from "./hooks/useToast";
import { DashboardTab } from "./features/dashboard/DashboardTab";
import { ProjectsTab } from "./features/projects/ProjectsTab";
import { ProjectDetailTab } from "./features/projects/ProjectDetailTab";
import { ConsultantsTab } from "./features/consultants/ConsultantsTab";
import { TimeEntriesTab } from "./features/timeEntries/TimeEntriesTab";
import { ForecastsTab } from "./features/forecasts/ForecastsTab";
import { FxTab } from "./features/fx/FxTab";
import { AdminTab } from "./features/admin/AdminTab";
import { AuditTab } from "./features/audit/AuditTab";
import { CapacityTab } from "./features/capacity/CapacityTab";
import { PortfolioTab } from "./features/portfolio/PortfolioTab";
import { AlertsPanel } from "./components/AlertsPanel";
import { AlertsTab } from "./features/alerts/AlertsTab";
import { ToastContainer } from "./components/Toast";
import { AppFooter } from "./components/AppFooter";
import { ProfileTab } from "./features/profile/ProfileTab";
import { ExtraHoursTab } from "./features/extraHours/ExtraHoursTab";
import { EstimationCalculatorTab } from "./features/estimations/EstimationCalculatorTab";
import { ActivitiesTab } from "./features/activities/ActivitiesTab";
import type { TabId, FinancialPanel } from "./types";
import { FinancialTab } from "./features/financial/FinancialTab";
import { RagChat } from "./components/RagChat";
import "./App.css";
import "./responsive.css";



// ── Sidebar config ──────────────────────────────────────────────────────────

const SIDEBAR_GROUPS: {
  label: string;
  tabs: { id: TabId; label: string; icon: string; permission?: string | string[] }[];
}[] = [
  {
    label: "Gobierno",
    tabs: [
      { id: "dashboard",  label: "Dashboard",   icon: "▦",  permission: "stats:read" },
      { id: "portfolio",  label: "Portafolio",  icon: "◈",  permission: "stats:read" },
      { id: "projects",   label: "Proyectos",   icon: "◻",  permission: "projects:read" },
      { id: "capacity",   label: "Capacidad",   icon: "◉",  permission: "capacity:read" },
    ],
  },
  {
    label: "Operación",
    tabs: [
      { id: "consultants",  label: "Consultores",   icon: "◐", permission: "consultants:read" },
      { id: "timeEntries",  label: "Horas",          icon: "⊙", permission: "time:read" },
      { id: "activities",   label: "Actividades",   icon: "▤", permission: "time:read" },
      { id: "extraHours",   label: "Horas Extra",    icon: "⧗", permission: "extrahours:read" },
    ],
  },
  {
    label: "Financiero",
    tabs: [
      { id: "financial",  label: "Ingresos/Gastos", icon: "⊕", permission: ["expenses:read", "revenue:read"] },
      { id: "forecasts",  label: "Proyecciones",  icon: "◷", permission: "forecasts:read" },
      { id: "estimations", label: "Estimaciones",  icon: "⚖", permission: "estimations:read" },
      { id: "fx",         label: "Tasas FX",      icon: "⊗", permission: "fx:read" },
    ],
  },
  {
    label: "Administración",
    tabs: [
      { id: "admin", label: "Usuarios",  icon: "⧉", permission: "users:manage" },
      { id: "extraHoursConfig", label: "Config. Horas Extra", icon: "⚙", permission: "extrahours:config" },
      { id: "audit", label: "Auditoría", icon: "⊛", permission: "users:manage" },
    ],
  },
];

// ── Auth helpers ────────────────────────────────────────────────────────────

async function getAccessToken(
  instance: ReturnType<typeof useMsal>["instance"],
  account: ReturnType<typeof useMsal>["accounts"][number],
): Promise<string | null> {
  const preferAccessToken = Boolean(env.azureApiScope);
  try {
    const result = await instance.acquireTokenSilent({ ...apiTokenRequest, account });
    return preferAccessToken ? result.accessToken || result.idToken : result.idToken || result.accessToken;
  } catch {
    await instance.acquireTokenRedirect({
      ...apiTokenRequest, account,
      redirectStartPage: `${window.location.origin}/dashboard`,
    });
    return null;
  }
}

// ── FX Converter (drawer content) ──────────────────────────────────────────

const CURRENCY_OPTIONS = ["COP", "USD", "EUR", "MXN", "PEN", "CLP"];

function numberish(v: string | null | undefined) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function FxDrawer({ open, onClose, fxConfigs }: { open: boolean; onClose: () => void; fxConfigs: FxConfig[] }) {
  const [conv, setConv] = useState({ from: "USD", to: "COP", amount: "1" });
  const [useCustomRate, setUseCustomRate] = useState(false);
  const [customRate, setCustomRate] = useState("");

  const autoRate = useMemo(() => findFxRate(fxConfigs, conv.from, conv.to), [fxConfigs, conv.from, conv.to]);
  const effectiveRate = useCustomRate ? numberish(customRate) : autoRate;

  const result = useMemo(() => {
    const a = numberish(conv.amount);
    if (effectiveRate === null || effectiveRate <= 0) return null;
    return a * effectiveRate;
  }, [conv.amount, effectiveRate]);

  return (
    <>
      {open && (
        <div aria-hidden="true" onClick={onClose}
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.25)", zIndex: 300 }} />
      )}
      <div className={`fx-drawer${open ? " open" : ""}`} role="dialog" aria-label="Conversor FX" aria-modal="true">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: "1rem", color: "var(--text-strong)" }}>⊗ Conversor de divisas</h2>
          <button type="button" className="ghost" onClick={onClose} aria-label="Cerrar conversor" style={{ padding: "0.25rem 0.5rem" }}>✕</button>
        </div>

        <div className="form-grid converter-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <select value={conv.from} onChange={(e) => setConv((p) => ({ ...p, from: e.target.value }))}>
            {CURRENCY_OPTIONS.map((c) => <option key={c} value={c}>Desde {c}</option>)}
          </select>
          <select value={conv.to} onChange={(e) => setConv((p) => ({ ...p, to: e.target.value }))}>
            {CURRENCY_OPTIONS.map((c) => <option key={c} value={c}>Hacia {c}</option>)}
          </select>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={{ fontSize: "0.7rem", color: "var(--text-soft)", display: "block", marginBottom: "0.2rem" }}>Cantidad</label>
            <input type="number" min="0" step="0.01" value={conv.amount}
              onChange={(e) => setConv((p) => ({ ...p, amount: e.target.value }))} placeholder="Cantidad" />
          </div>
        </div>

        <label className="check" style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem", color: "var(--text-soft)", userSelect: "none" }}>
          <input
            type="checkbox"
            checked={useCustomRate}
            onChange={(e) => {
              setUseCustomRate(e.target.checked);
              if (e.target.checked && !customRate) {
                setCustomRate(autoRate !== null ? String(autoRate) : "");
              }
            }}
          />
          Usar una tasa personalizada
        </label>

        {useCustomRate ? (
          <div>
            <label style={{ fontSize: "0.7rem", color: "var(--text-soft)", display: "block", marginBottom: "0.2rem" }}>
              Tasa {conv.from}→{conv.to}
            </label>
            <input type="number" min="0" step="0.0001" value={customRate}
              onChange={(e) => setCustomRate(e.target.value)} />
          </div>
        ) : autoRate === null ? (
          <p style={{ fontSize: "0.78rem", color: "var(--state-warning-text)", margin: 0 }}>
            No hay tasa configurada para {conv.from}→{conv.to} en "Tasas FX". Configúrala ahí, o marca "Usar una tasa personalizada" para calcular con un valor puntual.
          </p>
        ) : (
          <p style={{ fontSize: "0.78rem", color: "var(--text-soft)", margin: 0 }}>
            Tasa automática (Tasas FX): 1 {conv.from} = {autoRate.toLocaleString("es-CO", { maximumFractionDigits: 6 })} {conv.to}
          </p>
        )}

        <div style={{ background: "var(--state-warning-bg)", border: "1px solid var(--border-color)", borderRadius: "10px", padding: "0.75rem" }}>
          {result === null
            ? <p style={{ color: "var(--text-soft)", fontSize: "0.85rem", margin: 0 }}>Define una tasa mayor a 0</p>
            : <p style={{ color: "var(--text-strong)", fontWeight: 800, fontSize: "1.1rem", margin: 0 }}>
                {conv.from} {Number(conv.amount).toLocaleString("es-CO")}
                <span style={{ color: "var(--color-accent)", fontSize: "0.85rem", fontWeight: 600, margin: "0 0.4rem" }}>→</span>
                {conv.to} {result.toLocaleString("es-CO", { maximumFractionDigits: 2 })}
              </p>
          }
        </div>

        {fxConfigs.length > 0 && (
          <div>
            <p style={{ fontSize: "0.7rem", color: "var(--color-accent)", fontWeight: 700, marginBottom: "0.4rem" }}>
              Tasas configuradas
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
              {fxConfigs.map((fx) => (
                <div key={fx.id} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", color: "var(--text-strong)" }}>
                  <span>{fx.baseCode} → {fx.quoteCode}</span>
                  <strong>{Number(fx.rate).toLocaleString("es-CO", { maximumFractionDigits: 4 })}</strong>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// Special tabs accessible outside the sidebar (e.g., from dropdown)
const NON_SIDEBAR_TABS: TabId[] = ["profile"];

// ── Tab Path Mapping ────────────────────────────────────────────────────────

const TAB_PATH_MAP: Record<TabId, string> = {
  dashboard: "/dashboard",
  portfolio: "/portfolio",
  projects: "/projects",
  capacity: "/capacity",
  consultants: "/consultants",
  timeEntries: "/time-entries",
  activities: "/activities",
  extraHours: "/extra-hours",
  financial: "/financial",
  forecasts: "/forecasts",
  estimations: "/estimations",
  fx: "/fx",
  admin: "/admin",
  extraHoursConfig: "/extra-hours-config",
  audit: "/audit",
  profile: "/profile",
  alerts: "/alerts",
};

const PATH_TAB_MAP: Record<string, TabId> = {
  ...Object.fromEntries(
    Object.entries(TAB_PATH_MAP).map(([tab, path]) => [path, tab as TabId])
  ),
  // Alias de rutas antiguas: Gastos e Ingresos ahora viven dentro de "Financiero".
  "/expenses": "financial",
  "/revenue": "financial",
};

// ── Landing Page ────────────────────────────────────────────────────────────

function LandingPage({ darkMode, toggleDarkMode, onLoginClick }: { darkMode: boolean; toggleDarkMode: () => void; onLoginClick: () => void }) {
  return (
    <>
      <style>{`
        .landing-container {
          position: relative;
          min-height: 100vh;
          overflow-x: hidden;
          background: ${darkMode ? "#121228" : "radial-gradient(circle at 10% 20%, #ffffff 0%, #f4f6fa 100%)"};
          color: ${darkMode ? "#ffffff" : "#121228"};
          font-family: 'Outfit', 'Inter', sans-serif;
          transition: background-color 0.5s ease;
          display: flex;
          flex-direction: column;
        }

        .landing-blob {
          position: absolute;
          border-radius: 50%;
          filter: blur(80px);
          opacity: ${darkMode ? 0.15 : 0.4};
          z-index: 0;
          pointer-events: none;
          transition: opacity 0.5s ease;
        }

        .blob-1 {
          top: 10%;
          left: 5%;
          width: 350px;
          height: 350px;
          background: var(--color-accent);
          animation: floatBlob1 15s infinite ease-in-out;
        }

        .blob-2 {
          bottom: 10%;
          right: 5%;
          width: 400px;
          height: 400px;
          background: var(--color-sec-blue);
          animation: floatBlob2 18s infinite ease-in-out;
        }

        @keyframes floatBlob1 {
          0% { transform: translate(0px, 0px) scale(1); }
          33% { transform: translate(30px, -50px) scale(1.1); }
          66% { transform: translate(-20px, 20px) scale(0.95); }
          100% { transform: translate(0px, 0px) scale(1); }
        }

        @keyframes floatBlob2 {
          0% { transform: translate(0px, 0px) scale(1); }
          50% { transform: translate(-40px, 40px) scale(1.15); }
          100% { transform: translate(0px, 0px) scale(1); }
        }

        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(30px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes floatWidget {
          0% { transform: translateY(0px); }
          50% { transform: translateY(-8px); }
          100% { transform: translateY(0px); }
        }

        @keyframes drawLine {
          to { stroke-dashoffset: 0; }
        }

        .landing-header {
          position: sticky;
          top: 0;
          display: grid;
          grid-template-columns: auto 1fr auto;
          align-items: center;
          padding: 0.85rem 1.75rem;
          background: ${darkMode ? "rgba(18, 18, 40, 0.75)" : "rgba(255, 255, 255, 0.8)"};
          backdrop-filter: blur(12px);
          border-bottom: 1px solid ${darkMode ? "rgba(107, 180, 45, 0.14)" : "rgba(35, 65, 117, 0.16)"};
          z-index: 10;
        }

        .landing-version {
          justify-self: start;
          display: flex;
          align-items: center;
        }

        .landing-logo {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          justify-self: center;
        }

        .landing-actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 1rem;
          justify-self: end;
        }

        .landing-logo h2 {
          margin: 0;
          font-size: 1.5rem;
          font-weight: 800;
          background: var(--gradient-primary);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .landing-badge {
          font-size: 0.7rem;
          padding: 0.2rem 0.6rem;
          border-radius: 20px;
          font-weight: 700;
          background: ${darkMode ? "rgba(255, 255, 255, 0.06)" : "var(--color-blue-10)"};
          color: ${darkMode ? "#e2e8f0" : "var(--color-sec-blue)"};
          border: 1px solid ${darkMode ? "rgba(255, 255, 255, 0.12)" : "var(--color-sec-blue)"};
        }

        .landing-hero {
          max-width: 1200px;
          margin: 0 auto;
          padding: 5rem 2rem 3rem 2rem;
          display: grid;
          grid-template-columns: 1.1fr 0.9fr;
          gap: 4rem;
          align-items: center;
          z-index: 1;
          position: relative;
        }

        @media (max-width: 900px) {
          .landing-hero {
            grid-template-columns: 1fr;
            text-align: center;
            gap: 3rem;
            padding-top: 2rem;
          }
          .landing-hero-right {
            justify-content: center;
          }
          .landing-header {
            grid-template-columns: 1fr;
            gap: 0.55rem;
            justify-items: center;
            padding: 0.75rem 1rem;
          }
          .landing-version {
            justify-self: center;
          }
          .landing-actions {
            justify-self: center;
          }
        }

        .landing-hero-left {
          animation: fadeInUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) both;
        }

        .landing-title {
          font-size: 3.5rem;
          font-weight: 800;
          line-height: 1.15;
          letter-spacing: -0.04em;
          margin: 0 0 1.5rem 0;
          color: ${darkMode ? "#ffffff" : "#121228"};
        }

        .landing-title span {
          background: ${darkMode
            ? "linear-gradient(135deg, #ffffff 0%, rgba(226, 232, 240, 0.72) 100%)"
            : "var(--gradient-primary)"};
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .landing-description {
          font-size: 1.15rem;
          line-height: 1.6;
          color: ${darkMode ? "rgba(226, 232, 240, 0.9)" : "rgba(35, 65, 117, 0.86)"};
          margin-bottom: 2.5rem;
          max-width: 540px;
        }

        @media (max-width: 900px) {
          .landing-description {
            margin-left: auto;
            margin-right: auto;
          }
        }

        .landing-btn {
          display: inline-flex;
          align-items: center;
          gap: 0.75rem;
          background: ${darkMode ? "var(--gradient-accent)" : "var(--gradient-primary)"};
          color: #fff;
          border: none;
          border-radius: 50px;
          padding: 1.1rem 2.8rem;
          font-size: 1.05rem;
          font-weight: 700;
          cursor: pointer;
          box-shadow: 0 10px 25px ${darkMode ? "rgba(241, 163, 35, 0.4)" : "rgba(35, 65, 117, 0.24)"};
          transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .landing-btn:hover {
          transform: translateY(-3px);
          box-shadow: 0 15px 35px ${darkMode ? "rgba(241, 163, 35, 0.5)" : "rgba(35, 65, 117, 0.34)"};
        }

        .landing-btn:active {
          transform: translateY(-1px);
        }

        .landing-hero-right {
          display: flex;
          justify-content: flex-end;
          animation: fadeInUp 1s cubic-bezier(0.16, 1, 0.3, 1) 0.15s both;
        }

        .glass-mockup {
          background: ${darkMode ? "rgba(18, 18, 40, 0.45)" : "rgba(255, 255, 255, 0.5)"};
          backdrop-filter: blur(20px);
          border: 1px solid ${darkMode ? "rgba(255, 255, 255, 0.08)" : "var(--color-primary-15)"};
          border-radius: 24px;
          width: 100%;
          max-width: 440px;
          padding: 1.75rem;
          box-shadow: 0 25px 50px rgba(0, 0, 0, 0.08);
          position: relative;
        }

        .floating-widget {
          position: absolute;
          background: ${darkMode ? "rgba(18, 18, 40, 0.85)" : "rgba(255, 255, 255, 0.85)"};
          backdrop-filter: blur(15px);
          border: 1px solid ${darkMode ? "rgba(255, 255, 255, 0.1)" : "var(--color-primary-15)"};
          border-radius: 16px;
          padding: 0.75rem 1rem;
          box-shadow: 0 12px 24px rgba(0, 0, 0, 0.08);
          animation: floatWidget 6s infinite ease-in-out;
        }

        .widget-1 {
          top: -20px;
          left: -30px;
          animation-delay: 0s;
        }

        .widget-2 {
          bottom: -20px;
          right: -25px;
          animation-delay: 2s;
        }

        .features-section {
          max-width: 1200px;
          margin: 3rem auto 5rem auto;
          padding: 0 2rem;
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 2rem;
          z-index: 1;
          position: relative;
        }

        @media (max-width: 860px) {
          .features-section {
            grid-template-columns: 1fr;
            gap: 1.5rem;
            margin-top: 2rem;
          }
        }

        .feature-card {
          background: ${darkMode ? "rgba(18, 18, 40, 0.35)" : "rgba(255, 255, 255, 0.55)"};
          backdrop-filter: blur(15px);
          border: 1px solid ${darkMode ? "rgba(255, 255, 255, 0.06)" : "var(--color-primary-15)"};
          border-radius: 20px;
          padding: 2rem;
          box-shadow: 0 10px 30px rgba(0,0,0,0.02);
          transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
          cursor: pointer;
          animation: fadeInUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.3s both;
        }

        .feature-card:hover {
          transform: translateY(-6px);
          background: ${darkMode ? "rgba(18, 18, 40, 0.5)" : "rgba(255, 255, 255, 0.85)"};
          border-color: var(--color-sec-blue);
          box-shadow: 0 15px 35px ${darkMode ? "rgba(35, 65, 117, 0.14)" : "rgba(35, 65, 117, 0.12)"};
        }

        .feature-icon-wrapper {
          width: 48px;
          height: 48px;
          border-radius: 12px;
          display: grid;
          place-items: center;
          background: ${darkMode ? "rgba(35, 65, 117, 0.2)" : "var(--color-blue-10)"};
          color: var(--color-sec-blue);
          margin-bottom: 1.25rem;
          transition: all 0.3s ease;
        }

        .feature-card:hover .feature-icon-wrapper {
          background: var(--gradient-primary);
          color: #fff;
          transform: scale(1.1) rotate(5deg);
        }

        .feature-card h3 {
          margin: 0 0 0.5rem 0;
          font-size: 1.2rem;
          font-weight: 700;
          color: ${darkMode ? "#ffffff" : "var(--color-primary)"};
        }

        .feature-card p {
          margin: 0;
          font-size: 0.9rem;
          line-height: 1.5;
          color: ${darkMode ? "rgba(255, 255, 255, 0.7)" : "rgba(18, 18, 40, 0.7)"};
        }

        .svg-chart-line {
          stroke-dasharray: 400;
          stroke-dashoffset: 400;
          animation: drawLine 2.5s forwards cubic-bezier(0.4, 0, 0.2, 1);
        }

        .landing-footer {
          max-width: 1200px;
          margin: 1rem auto 0;
          padding: 1.25rem 2rem 2rem;
          border-top: 1px solid ${darkMode ? "rgba(255, 255, 255, 0.08)" : "var(--color-primary-10)"};
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1.5rem;
          color: ${darkMode ? "rgba(226, 232, 240, 0.86)" : "var(--color-sec-blue)"};
        }

        .landing-footer__brand {
          display: flex;
          flex-direction: column;
          gap: 0.45rem;
          max-width: 360px;
        }

        .landing-footer__name {
          margin: 0;
          font-family: var(--display);
          font-size: 1rem;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: ${darkMode ? "#ffffff" : "var(--color-primary)"};
        }

        .landing-footer__tagline {
          margin: 0;
          font-size: 0.84rem;
          line-height: 1.5;
          color: ${darkMode ? "rgba(226, 232, 240, 0.72)" : "rgba(35, 65, 117, 0.8)"};
        }

        .landing-footer__links {
          display: flex;
          align-items: center;
          gap: 1rem;
          flex-wrap: wrap;
          justify-content: center;
        }

        .landing-footer__link {
          display: inline-flex;
          align-items: center;
          gap: 0.45rem;
          color: ${darkMode ? "#e2e8f0" : "var(--color-sec-blue)"};
          text-decoration: none;
          font-size: 0.84rem;
          font-weight: 700;
          padding: 0.35rem 0.65rem;
          border-radius: 9999px;
          border: 1px solid ${darkMode ? "rgba(255, 255, 255, 0.08)" : "rgba(35, 65, 117, 0.14)"};
          background: ${darkMode ? "rgba(255, 255, 255, 0.04)" : "rgba(255, 255, 255, 0.72)"};
          transition: all 0.2s ease;
        }

        .landing-footer__link:hover {
          transform: translateY(-1px);
          border-color: ${darkMode ? "rgba(107, 180, 45, 0.4)" : "var(--color-sec-blue)"};
          box-shadow: 0 8px 20px ${darkMode ? "rgba(0, 0, 0, 0.18)" : "rgba(35, 65, 117, 0.08)"};
        }

        .landing-footer__meta {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 0.5rem;
          min-width: 180px;
          text-align: right;
        }

        .landing-footer__badge {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          padding: 0.35rem 0.7rem;
          border-radius: 9999px;
          font-size: 0.78rem;
          font-weight: 700;
          background: ${darkMode ? "rgba(35, 65, 117, 0.22)" : "var(--color-blue-10)"};
          color: ${darkMode ? "#e2e8f0" : "var(--color-sec-blue)"};
          border: 1px solid ${darkMode ? "rgba(255, 255, 255, 0.08)" : "rgba(35, 65, 117, 0.16)"};
        }

        .landing-footer__small {
          margin: 0;
          font-size: 0.78rem;
          color: ${darkMode ? "rgba(226, 232, 240, 0.62)" : "rgba(35, 65, 117, 0.72)"};
        }

        @media (max-width: 900px) {
          .landing-footer {
            flex-direction: column;
            align-items: flex-start;
            padding: 1.25rem 1rem 1.75rem;
          }

          .landing-footer__meta {
            align-items: flex-start;
            text-align: left;
            min-width: 0;
          }

          .landing-footer__links {
            justify-content: flex-start;
          }
        }
      `}</style>

      <div className="landing-container">
        {/* Background Blobs */}
        <div className="landing-blob blob-1" />
        <div className="landing-blob blob-2" />

        {/* Flotante Header */}
        <header className="landing-header">
          <div className="landing-version">
            <span className="landing-badge">v1.1.0 (Demo)</span>
          </div>
          <div className="landing-logo">
            <div className="logo-slot" style={{ height: "clamp(62px, 8vw, 92px)", display: "flex", alignItems: "center" }}>
              <img 
                src={darkMode ? "/Logos/logo_Synaptica-02.png" : "/Logos/logo_Synaptica-01.png"} 
                alt="Synaptica Logo" 
                style={{ height: "100%", width: "auto", objectFit: "contain", transform: "none" }}
              />
            </div>
          </div>

          <div className="landing-actions">
            <button
              type="button"
              onClick={toggleDarkMode}
              style={{
                background: darkMode ? "rgba(255,255,255,0.08)" : "#fff",
                border: "1px solid " + (darkMode ? "rgba(255,255,255,0.15)" : "rgba(35, 65, 117, 0.18)"),
                borderRadius: "30px",
                padding: "0.5rem 1rem",
                color: darkMode ? "#f1f5f9" : "var(--color-sec-blue)",
                fontSize: "0.82rem",
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
                boxShadow: "0 2px 5px rgba(0,0,0,0.05)",
                transition: "all 0.3s ease"
              }}
            >
              {darkMode ? "☀️ Claro" : "🌙 Oscuro"}
            </button>
          </div>
        </header>

        {/* Main Hero grid */}
        <div className="landing-hero">
          <div className="landing-hero-left">
            <h1 className="landing-title">
              SynaTrack<br />
              <span>Gestión Inteligente</span>
            </h1>
            <p className="landing-description">
              La consola ejecutiva premium para la planificación de recursos, control financiero multipaís y flujos de aprobaciones inteligentes de Synaptica.
            </p>
            <button type="button" className="landing-btn" onClick={onLoginClick}>
              <span>Ingresar a la Plataforma</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </button>
          </div>

          <div className="landing-hero-right">
            <div className="glass-mockup">
               {/* Floating Widget 1 */}
              <div className="floating-widget widget-1" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ fontSize: "1.25rem" }}>📈</span>
                <div>
                  <span style={{ display: "block", fontSize: "0.6rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase" }}>Margen Bruto</span>
                  <span style={{ fontSize: "0.9rem", fontWeight: 800, color: "var(--color-sec-green)" }}>+24.8%</span>
                </div>
              </div>

              {/* Floating Widget 2 */}
              <div className="floating-widget widget-2" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ fontSize: "1.25rem" }}>⏰</span>
                <div>
                  <span style={{ display: "block", fontSize: "0.6rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase" }}>Horas Extra</span>
                  <span style={{ fontSize: "0.9rem", fontWeight: 800, color: "var(--color-accent)" }}>Controlado</span>
                </div>
              </div>

              {/* Mockup Content Header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
                <div style={{ display: "flex", gap: "0.3rem" }}>
                  <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--color-sec-red)" }} />
                  <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--color-accent)" }} />
                  <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--color-sec-green)" }} />
                </div>
                <span style={{ fontSize: "0.7rem", color: "#94a3b8", fontWeight: 600 }}>Vista Ejecutiva</span>
              </div>

              {/* Mockup Main Chart */}
              <div style={{ height: "130px", width: "100%", position: "relative", marginBottom: "1rem" }}>
                <svg width="100%" height="100%" viewBox="0 0 300 130" style={{ overflow: "visible" }}>
                  {/* Area background */}
                  <path
                    d="M0 130 Q 50 80, 100 100 T 200 40 T 300 20 L 300 130 Z"
                    fill="url(#area-gradient)"
                    opacity="0.25"
                  />
                  {/* Glowing Line */}
                  <path
                    className="svg-chart-line"
                    d="M0 130 Q 50 80, 100 100 T 200 40 T 300 20"
                    fill="none"
                    stroke="url(#line-gradient)"
                    strokeWidth="4"
                    strokeLinecap="round"
                  />
                  {/* Chart points */}
                  <circle cx="200" cy="40" r="5" fill="var(--color-accent)" stroke={darkMode ? "#1e293b" : "#fff"} strokeWidth="2" style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.2))" }} />
                  <circle cx="300" cy="20" r="6" fill="var(--color-sec-red)" stroke={darkMode ? "#1e293b" : "#fff"} strokeWidth="2.5" style={{ filter: "drop-shadow(0 4px 8px rgba(168, 25, 76, 0.4))" }} />
                  
                  {/* Definitions */}
                  <defs>
                    <linearGradient id="area-gradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-accent)" />
                      <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
                    </linearGradient>
                    <linearGradient id="line-gradient" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="var(--color-accent)" />
                      <stop offset="50%" stopColor="var(--color-accent)" />
                      <stop offset="100%" stopColor="var(--color-sec-red)" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>

              {/* Stats widget inside card */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", borderTop: "1px dashed " + (darkMode ? "var(--color-primary-20)" : "rgba(244, 212, 182, 0.4)"), paddingTop: "1rem" }}>
                <div>
                  <span style={{ display: "block", fontSize: "0.65rem", color: "#94a3b8", fontWeight: 600 }}>Tasa de Rendimiento</span>
                  <span style={{ fontSize: "1.2rem", fontWeight: 800, color: darkMode ? "#f8fafc" : "#1e293b" }}>92.4%</span>
                </div>
                <div>
                  <span style={{ display: "block", fontSize: "0.65rem", color: "#94a3b8", fontWeight: 600 }}>Asignación de Staff</span>
                  <span style={{ fontSize: "1.2rem", fontWeight: 800, color: darkMode ? "#f8fafc" : "#1e293b" }}>98.2%</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Features list */}
        <section className="features-section">
          {/* Card 1: Control Financiero */}
          <div className="feature-card">
            <div className="feature-icon-wrapper">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="20" x2="18" y2="10" />
                <line x1="12" y1="20" x2="12" y2="4" />
                <line x1="6" y1="20" x2="6" y2="14" />
              </svg>
            </div>
            <h3>Control Financiero</h3>
            <p>Monitoreo en tiempo real de presupuestos, márgenes operativos y la rentabilidad unificada de todo tu portafolio.</p>
          </div>

          {/* Card 2: Flujo de Aprobaciones */}
          <div className="feature-card">
            <div className="feature-icon-wrapper">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <polyline points="9 11 11 13 15 9" />
              </svg>
            </div>
            <h3>Aprobación Eficiente</h3>
            <p>Validación de horas extra en dos niveles (PM y Nómina) con recargos adaptados automáticamente a cada legislación local.</p>
          </div>

          {/* Card 3: Planificación de Recursos */}
          <div className="feature-card">
            <div className="feature-icon-wrapper">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <h3>Gestión de Capacidad</h3>
            <p>Control exacto de staff disponible, vacaciones, bench interno y proyecciones automáticas de costos mensuales.</p>
          </div>
        </section>

        <footer className="landing-footer" role="contentinfo">
          <div className="landing-footer__brand">
            <p className="landing-footer__name">Synaptica · SynaTrack</p>
            <p className="landing-footer__tagline">
              Plataforma ejecutiva para control de recursos, operaciones y finanzas con foco en claridad, trazabilidad y toma de decisiones.
            </p>
          </div>

          <div className="landing-footer__links" aria-label="Enlaces corporativos">
            <a className="landing-footer__link" href="https://synaptica.co" target="_blank" rel="noopener noreferrer">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              <span>Sitio web</span>
            </a>
            <a className="landing-footer__link" href="https://co.linkedin.com/company/synaptica-s-a-s" target="_blank" rel="noopener noreferrer">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M6.94 6.5a1.94 1.94 0 1 1-3.88 0 1.94 1.94 0 0 1 3.88 0ZM3.5 8.75H7V20H3.5V8.75Zm6.06 0h3.36v1.55h.05c.47-.9 1.62-1.85 3.34-1.85 3.57 0 4.23 2.35 4.23 5.4V20h-3.5v-5.08c0-1.21-.02-2.77-1.69-2.77-1.69 0-1.95 1.32-1.95 2.68V20H9.56V8.75Z" />
              </svg>
              <span>LinkedIn</span>
            </a>
            <a className="landing-footer__link" href="mailto:soporte@synaptica.co">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="m3 7 9 6 9-6" />
              </svg>
              <span>Soporte</span>
            </a>
          </div>

          <div className="landing-footer__meta">
            <span className="landing-footer__badge">v1.1.0 Demo</span>
            <p className="landing-footer__small">Bogotá, Colombia · Synaptica 2026</p>
          </div>
        </footer>
      </div>
    </>
  );
}

// ── App ─────────────────────────────────────────────────────────────────────

function App() {
  const microsoftConfigured = Boolean(env.azureClientId && env.azureTenantId);
  const authWithMicrosoftEnabled = microsoftConfigured && !env.forceLocalAuth;
  const { instance, accounts } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const [currentPath, setCurrentPath] = useState(() => (window.location.pathname || "/").toLowerCase());
  const [activeTab, setActiveTab] = useState<TabId>(() => {
    const path = (window.location.pathname || "/").toLowerCase();
    return PATH_TAB_MAP[path] || "dashboard";
  });
  const [financialPanel, setFinancialPanel] = useState<FinancialPanel>(() => {
    const path = (window.location.pathname || "/").toLowerCase();
    return path === "/revenue" ? "revenue" : "expenses";
  });
  const [preselectedCapacityConsultantId, setPreselectedCapacityConsultantId] = useState<string | null>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [originalUser, setOriginalUser] = useState<AuthUser | null>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 15);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  /**
   * Matriz de permisos por rol servida por el backend (`GET /api/auth/permissions`,
   * que devuelve `rolePermissions` de `auth/roles.ts`). Se carga una sola vez al
   * arrancar, solo para administradores, que son los únicos que ven el selector
   * de vista. Antes había aquí una copia literal de la matriz (DEP-15).
   */
  const [rolePermissionsMap, setRolePermissionsMap] = useState<RolePermissionsMap | null>(null);

  /**
   * Simulador de rol: cambia ÚNICAMENTE lo que se ve en la interfaz, para que un
   * administrador pueda previsualizar la aplicación como otro rol. No altera los
   * permisos reales: el backend sigue autorizando con los roles del token en el
   * `authorize([AppRole...])` de cada ruta.
   */
  const handleSwitchRole = useCallback((role: "ADMIN" | "PM" | "CONSULTANT" | "FINANCE") => {
    if (!originalUser || !rolePermissionsMap) return;
    setAuthUser({
      ...originalUser,
      roles: [role],
      permissions: rolePermissionsMap[role] ?? []
    });
  }, [originalUser, rolePermissionsMap]);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openProjectId, setOpenProjectId] = useState<string | null>(null);

  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem("theme") === "dark";
  });

  const toggleDarkMode = () => {
    setDarkMode((prev) => {
      const next = !prev;
      localStorage.setItem("theme", next ? "dark" : "light");
      return next;
    });
  };

  useEffect(() => {
    if (darkMode) {
      document.body.classList.add("dark");
    } else {
      document.body.classList.remove("dark");
    }
  }, [darkMode]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => typeof window !== "undefined" && window.innerWidth <= 860);
  const [fxDrawerOpen, setFxDrawerOpen] = useState(false);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const profileDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (profileDropdownRef.current && !profileDropdownRef.current.contains(event.target as Node)) {
        setProfileDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // --- Global Feedback States ---
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackCategory, setFeedbackCategory] = useState("BUG");
  const [feedbackNotes, setFeedbackNotes] = useState("");
  const [sendingFeedback, setSendingFeedback] = useState(false);

  // --- RAG Chatbot State ---
  const [chatOpen, setChatOpen] = useState(false);

  // --- Keyboard Shortcuts Help State ---
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);

  const { toasts, show: showToast, dismiss } = useToastController();

  // --- Feedback Submit Handler ---
  const handleFeedbackSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!feedbackNotes.trim()) return;
    setSendingFeedback(true);
    try {
      await sendFeedback({
        category: feedbackCategory as "BUG" | "SUGGESTION" | "AESTHETIC" | "OTHER",
        notes: feedbackNotes,
      });
      showToast("¡Gracias por tus comentarios! Feedback registrado.", "success");
      setFeedbackNotes("");
      setFeedbackOpen(false);
    } catch (err) {
      handleError(err instanceof Error ? err.message : "Error al enviar el feedback");
    } finally {
      setSendingFeedback(false);
    }
  };

  // --- Global Keyboard Shortcuts Hook ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for Alt modifier
      if (e.altKey) {
        const key = e.key.toLowerCase();
        if (key === "n") {
          e.preventDefault();
          setActiveTab("dashboard");
        } else if (key === "h") {
          e.preventDefault();
          setActiveTab("timeEntries");
        } else if (key === "f") {
          e.preventDefault();
          setActiveTab("forecasts");
        } else if (key === "c") {
          e.preventDefault();
          setActiveTab("consultants");
        }
      }
      // Check for Ctrl+K
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setChatOpen((o) => !o);
      }
      // Check for ESC
      if (e.key === "Escape") {
        setFeedbackOpen(false);
        setShortcutsHelpOpen(false);
        setChatOpen(false);
      }
      // Check for "?"
      if (e.key === "?") {
        const activeElem = document.activeElement;
        const isInput = activeElem && (
          activeElem.tagName === "INPUT" ||
          activeElem.tagName === "TEXTAREA" ||
          activeElem.getAttribute("contenteditable") === "true"
        );
        if (!isInput) {
          e.preventDefault();
          setShortcutsHelpOpen((o) => !o);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const permissions = useMemo(() => authUser?.permissions ?? [], [authUser?.permissions]);
  const can = useCallback((p: string) => permissions.includes(p), [permissions]);

  // Domain hooks
  const projectsHook    = useProjects(!!authUser && (can("projects:read") || can("estimations:read")));
  const consultantsHook = useConsultants(!!authUser && can("consultants:read"));
  const timeEntriesHook = useTimeEntries(!!authUser && can("time:read"));
  const expensesHook    = useExpenses(!!authUser && can("expenses:read"));
  const forecastsHook   = useForecasts(!!authUser && can("forecasts:read"));
  const revenueHook     = useRevenue(!!authUser && can("revenue:read"));
  const fxHook          = useFxConfigs(!!authUser && can("fx:read"));
  const adminHook       = useAdminUsers(!!authUser && can("users:manage"));
  const statsHook       = useStats(!!authUser && can("stats:read"));
  const alertsHook      = useAlerts(!!authUser && (can("stats:read") || can("projects:read")));

  // Visible tabs per permission
  const visibleGroups = useMemo(() =>
    SIDEBAR_GROUPS.map((g) => ({
      ...g,
      tabs: g.tabs.filter((t) =>
        !t.permission ||
        (Array.isArray(t.permission)
          ? t.permission.some((p) => permissions.includes(p))
          : permissions.includes(t.permission)),
      ),
    })).filter((g) => g.tabs.length > 0),
  [permissions]);

  const allVisibleTabs = useMemo(() => visibleGroups.flatMap((g) => g.tabs), [visibleGroups]);

  const goTo = useCallback((path: string, replace = false) => {
    if (replace) window.history.replaceState({}, "", path);
    else window.history.pushState({}, "", path);
    setCurrentPath(path.toLowerCase());
  }, []);

  // Synchronize path and active tab when back/forward button is clicked (popstate)
  useEffect(() => {
    const onPopState = () => {
      const path = (window.location.pathname || "/").toLowerCase();
      setCurrentPath(path);
      const tab = PATH_TAB_MAP[path];
      if (tab) {
        setActiveTab(tab);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Sync browser URL when active tab changes
  useEffect(() => {
    if (authUser) {
      const path = TAB_PATH_MAP[activeTab];
      if (path && window.location.pathname !== path) {
        window.history.pushState({}, "", path);
        setCurrentPath(path);
      }
    }
  }, [activeTab, authUser]);

  // Handle URL routing redirections based on authentication state
  useEffect(() => {
    const isTabPath = currentPath in PATH_TAB_MAP;
    const isPublicPath = ["/", "/landing", "/login"].includes(currentPath);

    if (authUser) {
      if (isPublicPath) {
        const path = TAB_PATH_MAP[activeTab] || "/dashboard";
        goTo(path, true);
      } else if (!isTabPath) {
        goTo("/dashboard", true);
      }
    } else {
      if (isTabPath) {
        goTo("/", true);
      }
    }
  }, [currentPath, authUser, goTo, activeTab]);

  useEffect(() => {
    if (!NON_SIDEBAR_TABS.includes(activeTab) && !allVisibleTabs.some((t) => t.id === activeTab)) {
      setActiveTab(allVisibleTabs[0]?.id ?? "dashboard");
    }
  }, [allVisibleTabs, activeTab]);

  useEffect(() => {
    setError(null);
  }, [activeTab, openProjectId]);

  const bootstrap = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const healthResult = await getHealth();
      setHealth(healthResult);
      if (authWithMicrosoftEnabled) {
        if (!isAuthenticated || !accounts[0]) {
          setAuthUser(null);
          const path = window.location.pathname.toLowerCase();
          const isPublic = ["/", "/landing", "/login"].includes(path);
          if (!isPublic) {
            window.history.replaceState({}, "", "/");
            setCurrentPath("/");
          }
          setLoading(false);
          return;
        }
        const token = await getAccessToken(instance, accounts[0]);
        if (!token) return;
        setApiAccessToken(token);
      } else {
        const path = window.location.pathname.toLowerCase();
        const isPublic = ["/", "/landing", "/login"].includes(path);
        const hasSession = sessionStorage.getItem("bypass_auth") === "true";
        if (isPublic && !hasSession) {
          setAuthUser(null);
          setLoading(false);
          return;
        }
        setApiAccessToken(null);
      }
      const me = await getMe();
      setOriginalUser(me);
      setAuthUser(me);

      // La matriz de permisos solo hace falta para el selector de vista, que es
      // exclusivo de administradores. Si falla, el selector queda deshabilitado
      // pero el arranque continúa: es una ayuda de previsualización, no una
      // dependencia del funcionamiento normal.
      if (me.roles.includes("ADMIN")) {
        try {
          setRolePermissionsMap(await getRolePermissions());
        } catch {
          setRolePermissionsMap(null);
        }
      }
      
      if (!authWithMicrosoftEnabled) {
        sessionStorage.setItem("bypass_auth", "true");
      }

      const path = window.location.pathname.toLowerCase();
      const isPublic = ["/", "/landing", "/login"].includes(path);
      if (isPublic) {
        window.history.replaceState({}, "", "/dashboard");
        setCurrentPath("/dashboard");
      }
    } catch (err) {
      setAuthUser(null);
      setError(err instanceof Error ? err.message : "Error inicializando la aplicación");
    } finally {
      setLoading(false);
    }
  }, [accounts, authWithMicrosoftEnabled, instance, isAuthenticated]);

  useEffect(() => { void bootstrap(); }, [bootstrap, microsoftConfigured]);

  async function logout() {
    setApiAccessToken(null);
    setOriginalUser(null);
    setAuthUser(null);
    sessionStorage.removeItem("bypass_auth");
    goTo("/", true);
    if (authWithMicrosoftEnabled) {
      await instance.logoutRedirect({ postLogoutRedirectUri: `${window.location.origin}/` });
    }
  }

  const handleBypassLogin = async () => {
    try {
      setLoading(true);
      sessionStorage.setItem("bypass_auth", "true");
      await bootstrap();
    } catch (err) {
      handleError(err instanceof Error ? err.message : "Error al iniciar bypass");
    } finally {
      setLoading(false);
    }
  };

  function handleError(msg: string) {
    setError(msg);
    showToast(msg, "error");
  }

  function openProject(id: string) {
    setOpenProjectId(id);
    setActiveTab("projects");
  }

  /** Drill-through: navigate to another tab from a KPI click */
  function drillTo(tab: TabId, financialPanelTarget?: FinancialPanel) {
    if (financialPanelTarget) setFinancialPanel(financialPanelTarget);
    setActiveTab(tab);
  }

  // ── Not authenticated ────────────────────────────────────────────────────
  if (!authUser) {
    if (loading) {
      return (
        <main className="auth-shell">
          <section className="auth-card">
            <div className="logo-slot" style={{ height: "48px", width: "auto", margin: "0 auto 1.5rem", display: "flex", justifyContent: "center" }}>
              <img src={darkMode ? "/Logos/logo_Synaptica-02.png" : "/Logos/logo_Synaptica-01.png"} alt="Synaptica Logo" style={{ height: "100%", width: "auto" }} />
            </div>
            <h1>SynaTrack</h1>
            <p>Inicializando sesión…</p>
          </section>
        </main>
      );
    }

    if (currentPath === "/" || currentPath === "/landing") {
      return (
        <LandingPage
          darkMode={darkMode}
          toggleDarkMode={toggleDarkMode}
          onLoginClick={() => {
            if (authWithMicrosoftEnabled) {
              goTo("/login");
            } else {
              void handleBypassLogin();
            }
          }}
        />
      );
    }

    return (
      <main className="auth-shell">
        <section className="auth-card">
          <div className="logo-slot" style={{ height: "48px", width: "auto", margin: "0 auto 1.5rem", display: "flex", justifyContent: "center" }}>
            <img src={darkMode ? "/Logos/logo_Synaptica-02.png" : "/Logos/logo_Synaptica-01.png"} alt="Synaptica Logo" style={{ height: "100%", width: "auto" }} />
          </div>
          <h1>SynaTrack</h1>
          {error && <p className="error-banner">{error}</p>}
          {authWithMicrosoftEnabled ? (
            isAuthenticated ? (
              <>
                <p>Tu sesión Microsoft está activa, pero no fue posible validar permisos.</p>
                <div className="inline-actions">
                  <button type="button" onClick={() => void bootstrap()}>Reintentar</button>
                  <button type="button" className="ghost" onClick={() => void logout()}>Cerrar sesión</button>
                </div>
              </>
            ) : (
              <>
                <p>Ingresa con Microsoft para continuar.</p>
                <div className="inline-actions" style={{ flexDirection: "column", gap: "0.5rem" }}>
                  <button type="button"
                    onClick={() => void instance.loginRedirect({ ...loginRequest, redirectStartPage: `${window.location.origin}/home` })}>
                    Iniciar sesión con Microsoft
                  </button>
                  <button type="button" className="ghost" onClick={() => goTo("/")}>Volver al Inicio</button>
                </div>
              </>
            )
          ) : (
            <>
              <p>Modo demo activo sin login Microsoft.</p>
              <div className="inline-actions" style={{ flexDirection: "column", gap: "0.5rem" }}>
                <button type="button" onClick={handleBypassLogin}>
                  Ingresar como Administrador (Bypass)
                </button>
                <button type="button" className="ghost" onClick={() => goTo("/")}>Volver al Inicio</button>
              </div>
            </>
          )}
        </section>
      </main>
    );
  }

  // ── Timestamp ────────────────────────────────────────────────────────────
  const lastUpdatedLabel = statsHook.lastUpdated
    ? `Actualizado ${statsHook.lastUpdated.toLocaleString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}`
    : null;

  // ── Authenticated ────────────────────────────────────────────────────────
  return (
    <div className="shell">
            <header className={`hero ${scrolled ? "scrolled" : ""}`}>
        <div className="hero-left">
          <button
            type="button"
            className="mobile-menu-toggle"
            onClick={() => setSidebarCollapsed((c) => !c)}
            aria-label="Menú principal"
            title="Menú principal"
          >
            ☰
          </button>
          <div className="logo-slot">
            <img src={darkMode ? "/Logos/logo_Synaptica-02.png" : "/Logos/logo_Synaptica-01.png"} alt="Synaptica Logo" />
          </div>
          <div>
            <h1>SynaTrack</h1>
            <p>Gestión integral de proyectos, horas, gastos y proyecciones</p>
            {lastUpdatedLabel && (
              <div className="hero-meta">
                <span className={`pill ${health?.ok ? "ok" : "error"}`} style={{ fontSize: "0.65rem", padding: "0.15rem 0.5rem" }}>
                  {health?.ok ? "● Backend activo" : "● Backend no disponible"}
                </span>
                <span>🕐 {lastUpdatedLabel}</span>
              </div>
            )}
            {!lastUpdatedLabel && (
              <div className="hero-meta">
                <span className={`pill ${health?.ok ? "ok" : "error"}`} style={{ fontSize: "0.65rem", padding: "0.15rem 0.5rem" }}>
                  {health?.ok ? "● Backend activo" : "● Backend no disponible"}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="badges">
          {authUser && originalUser?.roles.includes("ADMIN") && (
            <div className="role-switcher" style={{
              display: "flex",
              alignItems: "center",
              background: "var(--color-accent-05)",
              border: "1px solid var(--color-accent-30)",
              borderRadius: "20px",
              padding: "2px",
              marginRight: "0.5rem"
            }}>
              <span style={{ fontSize: "0.65rem", fontWeight: 700, color: "var(--color-accent)", padding: "0 6px 0 10px" }}>VISTA:</span>
              {(["ADMIN", "PM", "CONSULTANT", "FINANCE"] as const).map((r) => {
                const isActive = authUser.roles.includes(r) && authUser.roles.length === 1;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => handleSwitchRole(r)}
                    disabled={!rolePermissionsMap}
                    title={rolePermissionsMap
                      ? "Previsualizar la interfaz como este rol (no cambia tus permisos reales)"
                      : "No se pudo cargar la matriz de permisos"}
                    style={{
                      background: isActive ? "var(--gradient-accent)" : "none",
                      color: isActive ? "#fff" : "var(--color-sec-blue)",
                      border: "none",
                      borderRadius: "16px",
                      padding: "4px 10px",
                      fontSize: "0.68rem",
                      fontWeight: 700,
                      cursor: rolePermissionsMap ? "pointer" : "not-allowed",
                      opacity: rolePermissionsMap ? 1 : 0.5,
                      transition: "all 0.2s ease"
                    }}
                  >
                    {r === "ADMIN" ? "Admin" : r === "PM" ? "PM" : r === "CONSULTANT" ? "Consultor" : "Financiero"}
                  </button>
                );
              })}
            </div>
          )}
          <button
            type="button"
            className="ghost theme-toggle-btn"
            onClick={toggleDarkMode}
            title="Cambiar tema claro/oscuro"
            style={{ fontSize: "0.82rem" }}
          >
            {darkMode ? "☀️ Claro" : "🌙 Oscuro"}
          </button>
          <button type="button" className="ghost fx-toggle-btn" onClick={() => setFxDrawerOpen(true)}
            title="Conversor de divisas" style={{ fontSize: "0.82rem" }}>
            ⊗ FX
          </button>
          <AlertsPanel
            alerts={alertsHook.alerts}
            unreadCount={alertsHook.unreadCount}
            canRun={can("users:manage")}
            onReload={alertsHook.reload}
            onError={handleError}
          />
          
          {/* Avatar interactivo dropdown */}
          <div ref={profileDropdownRef} style={{ position: "relative", display: "inline-block" }}>
            <button
              type="button"
              onClick={() => setProfileDropdownOpen((o) => !o)}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                display: "flex",
                alignItems: "center"
              }}
              aria-expanded={profileDropdownOpen}
              aria-haspopup="menu"
              aria-label="Menú de usuario"
            >
              <div style={{
                width: "38px",
                height: "38px",
                borderRadius: "50%",
                overflow: "hidden",
                background: "var(--gradient-primary)",
                color: "#fff",
                fontWeight: 800,
                display: "grid",
                placeItems: "center",
                fontSize: "0.9rem",
                boxShadow: "0 2px 8px var(--color-primary-20)",
                border: "2px solid #fff"
              }}>
                {authUser.photoUrl ? (
                  <img
                    src={authUser.photoUrl}
                    alt={authUser.displayName}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                ) : null}
                <span>{authUser.displayName.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)}</span>
              </div>
            </button>
 
            {profileDropdownOpen && (
              <div
                  style={{
                    position: "absolute",
                    top: "45px",
                    right: 0,
                    width: "220px",
                    background: "var(--card-bg)",
                    backdropFilter: "blur(12px)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "12px",
                    boxShadow: "0 8px 30px var(--color-primary-15)",
                    padding: "0.75rem",
                    zIndex: 300,
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.4rem"
                  }}
                >
                  <div style={{ padding: "0.25rem 0.5rem 0.5rem 0.5rem", borderBottom: "1px dashed var(--border-color)" }}>
                    <strong style={{ fontSize: "0.85rem", color: "var(--text-strong)", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {authUser.displayName}
                    </strong>
                    <span style={{ fontSize: "0.7rem", color: "var(--text-soft)", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {authUser.email}
                    </span>
                    <span className="pill neutral" style={{ display: "inline-block", fontSize: "0.62rem", marginTop: "0.3rem", padding: "0.1rem 0.35rem" }}>
                      {authUser.roles.join(", ")}
                    </span>
                  </div>
 
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      setActiveTab("profile");
                      setOpenProjectId(null);
                      setProfileDropdownOpen(false);
                    }}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      background: "none",
                      border: "none",
                      padding: "0.4rem 0.5rem",
                      fontSize: "0.82rem",
                      color: "var(--color-sec-blue)",
                      cursor: "pointer",
                      borderRadius: "6px"
                    }}
                  >
                    👤 Ver mi Perfil
                  </button>
 
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      void logout();
                      setProfileDropdownOpen(false);
                    }}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      background: "none",
                      border: "none",
                      padding: "0.4rem 0.5rem",
                      fontSize: "0.82rem",
                      color: "var(--color-sec-red)",
                      cursor: "pointer",
                      borderRadius: "6px"
                    }}
                  >
                    🚪 Cerrar Sesión
                  </button>
                </div>
            )}
          </div>
        </div>
      </header>

      {/* FX Drawer */}
      <FxDrawer open={fxDrawerOpen} onClose={() => setFxDrawerOpen(false)} fxConfigs={fxHook.fxConfigs} />

      {/* Body */}
      <div className="app-body">
        {/* Mobile sidebar backdrop */}
        {!sidebarCollapsed && (
          <div
            className="sidebar-backdrop"
            aria-hidden="true"
            onClick={() => setSidebarCollapsed(true)}
          />
        )}

        {/* Sidebar */}
        <nav className={`sidebar${sidebarCollapsed ? " collapsed" : ""}`} aria-label="Navegación principal">
          <div className="sidebar-header">
            <button
              type="button"
              className="sidebar-toggle"
              onClick={() => setSidebarCollapsed((c) => !c)}
              aria-label={sidebarCollapsed ? "Expandir menú" : "Colapsar menú"}
              title={sidebarCollapsed ? "Expandir" : "Colapsar"}
            >
              {sidebarCollapsed ? "→" : "←"}
            </button>
            <button
              type="button"
              className="sidebar-close-mobile"
              onClick={() => setSidebarCollapsed(true)}
              aria-label="Cerrar menú"
            >
              ✕
            </button>
          </div>

          {visibleGroups.map((group) => (
            <div className="sidebar-group" key={group.label}>
              <span className="sidebar-group-label">{group.label}</span>
              {group.tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`sidebar-tab${activeTab === tab.id ? " active" : ""}`}
                  onClick={() => { setActiveTab(tab.id); setSidebarCollapsed(true); if (tab.id !== "projects") setOpenProjectId(null); }}
                  title={tab.label}
                  aria-current={activeTab === tab.id ? "page" : undefined}
                >
                  <span className="sidebar-icon" aria-hidden="true">{tab.icon}</span>
                  <span className="sidebar-label">{tab.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        {/* Main content */}
        <main className="main-content">
          {error && (
            <div className="error-banner" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
              <span>{error}</span>
              <button
                type="button"
                className="ghost"
                onClick={() => setError(null)}
                style={{
                  padding: "0.15rem 0.45rem",
                  fontSize: "0.75rem",
                  color: "#b91c1c",
                  borderColor: "#fecaca",
                  background: "#fff1f2",
                  borderRadius: "6px",
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            </div>
          )}
          {loading && <p className="loading">Cargando datos…</p>}

          {!loading && (
            <div key={activeTab + (openProjectId || "")} className="fade-in-section">
              {activeTab === "dashboard" && (
                <DashboardTab
                  projects={projectsHook.projects}
                  timeEntries={timeEntriesHook.timeEntries}
                  expenses={expensesHook.expenses}
                  forecasts={forecastsHook.forecasts}
                  fxConfigs={fxHook.fxConfigs}
                  initialStats={statsHook.stats}
                  initialBaseCurrency="USD"
                  onError={handleError}
                  onDrillTo={drillTo}
                />
              )}

              {activeTab === "portfolio" && (
                <PortfolioTab canWrite={can("projects:write")} onOpenProject={openProject} />
              )}

              {activeTab === "projects" && (
                openProjectId ? (
                  <ProjectDetailTab
                    projectId={openProjectId}
                    canWrite={can("projects:write")}
                    onBack={() => setOpenProjectId(null)}
                    onError={handleError}
                  />
                ) : (
                  <ProjectsTab
                    projects={projectsHook.projects}
                    loading={projectsHook.loading}
                    canWrite={can("projects:write")}
                    onReload={projectsHook.reload}
                    onError={handleError}
                    statsProjects={statsHook.stats?.projects}
                    onOpenProject={setOpenProjectId}
                  />
                )
              )}

              {activeTab === "consultants" && (
                <ConsultantsTab
                  consultants={consultantsHook.consultants}
                  loading={consultantsHook.loading}
                  canWrite={can("consultants:write")}
                  canDelete={authUser?.roles.includes("ADMIN")}
                  onReload={consultantsHook.reload}
                  onError={handleError}
                  onAssignConsultant={(id) => {
                    setPreselectedCapacityConsultantId(id);
                    setActiveTab("capacity");
                  }}
                />
              )}

              {activeTab === "timeEntries" && (
                <TimeEntriesTab
                  timeEntries={timeEntriesHook.timeEntries}
                  projects={projectsHook.projects}
                  consultants={consultantsHook.consultants}
                  loading={timeEntriesHook.loading}
                  canWrite={can("time:write")}
                  canReview={can("time:review")}
                  onReload={timeEntriesHook.reload}
                  onError={handleError}
                />
              )}

              {activeTab === "forecasts" && (
                <ForecastsTab
                  forecasts={forecastsHook.forecasts}
                  projects={projectsHook.projects}
                  consultants={consultantsHook.consultants}
                  loading={forecastsHook.loading}
                  canWrite={can("forecasts:write")}
                  onReload={forecastsHook.reload}
                  onError={handleError}
                />
              )}

              {activeTab === "financial" && (
                <FinancialTab
                  panel={financialPanel}
                  onPanelChange={setFinancialPanel}
                  canExpenses={can("expenses:read")}
                  canRevenue={can("revenue:read")}
                  expenses={expensesHook.expenses}
                  revenueEntries={revenueHook.revenueEntries}
                  projects={projectsHook.projects}
                  forecasts={forecastsHook.forecasts}
                  fxConfigs={fxHook.fxConfigs}
                  baseCurrency="USD"
                  expensesLoading={expensesHook.loading}
                  revenueLoading={revenueHook.loading}
                  canWriteExpenses={can("expenses:write")}
                  canWriteRevenue={can("revenue:write")}
                  onReloadExpenses={expensesHook.reload}
                  onReloadRevenue={revenueHook.reload}
                  onError={handleError}
                />
              )}

              {activeTab === "capacity" && (
                <CapacityTab
                  projects={projectsHook.projects}
                  consultants={consultantsHook.consultants}
                  canWrite={can("assignments:write")}
                  onError={handleError}
                  preselectedConsultantId={preselectedCapacityConsultantId}
                  onClearPreselectedConsultant={() => setPreselectedCapacityConsultantId(null)}
                />
              )}

              {activeTab === "fx" && (
                <FxTab
                  fxConfigs={fxHook.fxConfigs}
                  loading={fxHook.loading}
                  canWrite={can("fx:write") || can("users:manage")}
                  onReload={fxHook.reload}
                  onError={handleError}
                />
              )}

              {activeTab === "admin" && (
                <AdminTab
                  adminUsers={adminHook.adminUsers}
                  loading={adminHook.loading}
                  onReload={adminHook.reload}
                  onError={handleError}
                />
              )}

              {activeTab === "audit" && <AuditTab onError={handleError} />}

              {activeTab === "profile" && (
                <ProfileTab
                  authUser={authUser}
                  onRefreshAuth={bootstrap}
                  onError={handleError}
                />
              )}

              {activeTab === "extraHours" && (
                <ExtraHoursTab
                  projects={projectsHook.projects}
                  consultants={consultantsHook.consultants}
                  authUser={authUser}
                  can={can}
                  onError={handleError}
                />
              )}

              {activeTab === "extraHoursConfig" && (
                <ExtraHoursTab
                  projects={projectsHook.projects}
                  consultants={consultantsHook.consultants}
                  authUser={authUser}
                  can={can}
                  onError={handleError}
                  configModeOnly={true}
                />
              )}

              {activeTab === "estimations" && (
                <EstimationCalculatorTab
                  projects={projectsHook.projects}
                  canWrite={can("estimations:write")}
                  onError={handleError}
                />
              )}

              {activeTab === "activities" && (
                <ActivitiesTab
                  projects={projectsHook.projects}
                  consultants={consultantsHook.consultants}
                  authUser={authUser}
                  onError={handleError}
                  onDrillTo={drillTo}
                />
              )}

              {activeTab === "alerts" && (
                <AlertsTab
                  alerts={alertsHook.alerts}
                  unreadCount={alertsHook.unreadCount}
                  loading={alertsHook.loading}
                  canRun={can("users:manage")}
                  onReload={alertsHook.reload}
                  onError={handleError}
                />
              )}
            </div>
          )}
        </main>
      </div>

      <AppFooter
        onNavigate={setActiveTab}
        backendOk={health?.ok === true}
        appVersion="1.0.0"
        environment={import.meta.env.MODE === "production" ? "Producción" : "Demo"}
        onOpenFeedback={() => setFeedbackOpen(true)}
        darkMode={darkMode}
      />

      <RagChat
        projects={projectsHook.projects}
        statsProjects={statsHook.stats?.projects}
        fxConfigs={fxHook.fxConfigs}
        consultants={consultantsHook.consultants}
        isOpen={chatOpen}
        onClose={() => setChatOpen(false)}
      />

      {/* Shortcuts Help Modal */}
      {shortcutsHelpOpen && (
        <div className="modal-overlay" style={{ zIndex: 10001 }}>
          <div className="modal-card" style={{ maxWidth: "450px" }}>
            <div className="modal-header">
              <h3 style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>⌨️ Atajos de Teclado</h3>
              <button type="button" className="ghost" onClick={() => setShortcutsHelpOpen(false)} style={{ padding: "0.2rem 0.5rem" }}>✕</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", fontSize: "0.85rem", padding: "0.5rem 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px dashed #e2e8f0", paddingBottom: "0.3rem" }}>
                <strong>Alt + N</strong> <span>Dashboard</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px dashed #e2e8f0", paddingBottom: "0.3rem" }}>
                <strong>Alt + H</strong> <span>Horas</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px dashed #e2e8f0", paddingBottom: "0.3rem" }}>
                <strong>Alt + F</strong> <span>Proyecciones</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px dashed #e2e8f0", paddingBottom: "0.3rem" }}>
                <strong>Alt + C</strong> <span>Consultores</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px dashed #e2e8f0", paddingBottom: "0.3rem" }}>
                <strong>Ctrl + K</strong> <span>Abrir Asistente RAG</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px dashed #e2e8f0", paddingBottom: "0.3rem" }}>
                <strong>Esc</strong> <span>Cerrar diálogos flotantes</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <strong>?</strong> <span>Mostrar esta ayuda</span>
              </div>
            </div>
            <div className="modal-actions" style={{ marginTop: "1rem" }}>
              <button type="button" onClick={() => setShortcutsHelpOpen(false)} style={{ width: "100%", background: "var(--gradient-accent)", border: "none" }}>Entendido</button>
            </div>
          </div>
        </div>
      )}

      {/* Global RAG Chat FAB */}
      <button
        type="button"
        onClick={() => setChatOpen((o) => !o)}
        className={`rag-chat-fab${chatOpen ? " is-open" : ""}`}
        title="Preguntar al Asistente IA (Ctrl+K)"
        aria-label="Preguntar al Asistente IA"
      >
        <span>🤖</span>
        <strong>Preguntar a la IA</strong>
      </button>

      {/* Feedback Modal */}
      {feedbackOpen && (
        <div className="modal-overlay" style={{ zIndex: 10001 }}>
          <form onSubmit={handleFeedbackSubmit} className="modal-card" style={{ maxWidth: "450px" }}>
            <div className="modal-header">
              <h3>💬 Enviar Feedback del Sistema</h3>
              <button type="button" className="ghost" onClick={() => setFeedbackOpen(false)} style={{ padding: "0.2rem 0.5rem" }}>✕</button>
            </div>
            <div className="form-grid" style={{ gap: "0.8rem" }}>
              <div>
                <label className="form-label" style={{ fontSize: "0.8rem", fontWeight: 700 }}>Categoría *</label>
                <select value={feedbackCategory} onChange={(e) => setFeedbackCategory(e.target.value)}>
                  <option value="BUG">Bug / Error de Sistema</option>
                  <option value="SUGGESTION">Sugerencia de Mejora</option>
                  <option value="AESTHETIC">UI/UX o Aspecto Estético</option>
                  <option value="OTHER">Otro</option>
                </select>
              </div>
              <div>
                <label className="form-label" style={{ fontSize: "0.8rem", fontWeight: 700 }}>Observaciones y Comentarios *</label>
                <textarea
                  required
                  rows={4}
                  placeholder="Describe detalladamente qué problema encontraste o qué mejora sugieres..."
                  value={feedbackNotes}
                  onChange={(e) => setFeedbackNotes(e.target.value)}
                />
              </div>
            </div>
            <div className="modal-actions" style={{ marginTop: "1rem" }}>
              <button type="button" className="ghost" onClick={() => setFeedbackOpen(false)}>Cancelar</button>
              <button type="submit" disabled={sendingFeedback} style={{ background: "var(--gradient-accent)", border: "none" }}>
                {sendingFeedback ? "Enviando..." : "Enviar Comentarios"}
              </button>
            </div>
          </form>
        </div>
      )}

      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

export default App;

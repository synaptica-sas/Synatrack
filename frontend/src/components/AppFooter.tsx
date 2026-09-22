/**
 * AppFooter — Footer corporativo de la plataforma.
 * Incluye: brand + tagline, navegación rápida y barra de estado técnico.
 * Se coloca al fondo del shell, fuera del app-body.
 */

import type { TabId } from "../types";

const NAV_LINKS: { label: string; tab: TabId }[] = [
  { label: "Dashboard",    tab: "dashboard" },
  { label: "Proyectos",    tab: "projects" },
  { label: "Portafolio",   tab: "portfolio" },
  { label: "Consultores",  tab: "consultants" },
  { label: "Ingresos/Gastos", tab: "financial" },
  { label: "Proyecciones", tab: "forecasts" },
  { label: "Capacidad",    tab: "capacity" },
];

export interface AppFooterProps {
  onNavigate: (tab: TabId) => void;
  backendOk?: boolean;
  appVersion?: string;
  environment?: string;
  onOpenFeedback?: () => void;
  darkMode?: boolean;
}

export function AppFooter({
  onNavigate,
  backendOk,
  appVersion = "1.0.0",
  environment = "Demo",
  onOpenFeedback,
  darkMode = false,
}: AppFooterProps) {
  const year = new Date().getFullYear();

  return (
    <footer className="app-footer" role="contentinfo">
      {/* ── Top section ──────────────────────────────────────────────── */}
      <div className="app-footer__top">

        {/* Column 1: Brand & Socials */}
        <div className="app-footer__column app-footer__column--brand">
          <div className="app-footer__logo-section">
            <p className="app-footer__app-name">SynaTrack</p>
          </div>
          <p className="app-footer__tagline">
            Plataforma integral de planificación de recursos, control de horas, gastos y proyecciones financieras.
          </p>
          <div className="app-footer__social">
            <a href="https://co.linkedin.com/company/synaptica-s-a-s" target="_blank" rel="noopener noreferrer" aria-label="LinkedIn" className="app-footer__social-link">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"></path><rect x="2" y="9" width="4" height="12"></rect><circle cx="4" cy="4" r="2"></circle></svg>
            </a>
            <a href="https://synaptica.co" target="_blank" rel="noopener noreferrer" aria-label="Website" className="app-footer__social-link">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
            </a>
          </div>
          <p className="app-footer__copy">
            &copy; {year} Synaptica. Todos los derechos reservados.
          </p>
        </div>

        {/* Column 2: Quick Navigation */}
        <div className="app-footer__column">
          <nav className="app-footer__nav" aria-label="Navegación del pie de página">
            <p className="app-footer__nav-title">Navegación rápida</p>
            <ul className="app-footer__nav-list">
              {NAV_LINKS.map(({ label, tab }) => (
                <li key={tab}>
                  <button
                    type="button"
                    className="app-footer__nav-link"
                    onClick={() => onNavigate(tab)}
                  >
                    {label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        {/* Column 3: Contact & Compliance */}
        <div className="app-footer__column">
          <p className="app-footer__nav-title">Contacto y Seguridad</p>
          <ul className="app-footer__contact-list">
            <li>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="app-footer__contact-icon"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
              <span>soporte@synaptica.co</span>
            </li>
            <li>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="app-footer__contact-icon"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
              <span>Bogotá, Colombia</span>
            </li>
          </ul>
          <div className="app-footer__badges-container">
            <div className="app-footer__compliance-badge">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="app-footer__badge-icon"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
              <span>ISO 27001</span>
            </div>
            <div className="app-footer__compliance-badge">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="app-footer__badge-icon"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>
              <span>SOC 2 Compliance</span>
            </div>
          </div>
        </div>

      </div>

      {/* ── Centered Logo ── */}
      <div className="app-footer__centered-logo">
        <img 
          src={darkMode ? "/Logos/logo_Synaptica-02.png" : "/Logos/logo_Synaptica-02.png"} 
          alt="Synaptica Logo" 
        />
      </div>

      {/* ── Bottom status bar ─────────────────────────────────────────── */}
      <div className="app-footer__bar">
        <div className="app-footer__bar-left">
          <span className="app-footer__badge">
            v{appVersion}
          </span>
          <span className="app-footer__badge app-footer__badge--env">
            {environment}
          </span>
          <span
            className={`app-footer__badge ${
              backendOk === undefined
                ? "app-footer__badge--neutral"
                : backendOk
                ? "app-footer__badge--ok"
                : "app-footer__badge--error"
            }`}
          >
            {backendOk === undefined
              ? "⋯ Verificando backend"
              : backendOk
              ? "✓ Backend activo"
              : "✕ Backend inactivo"}
          </span>
        </div>
        <p className="app-footer__bar-right">
          {onOpenFeedback && (
            <button
              type="button"
              onClick={onOpenFeedback}
              className="app-footer__feedback-btn"
            >
              💬 Enviar Feedback
            </button>
          )}
          <span>Construido con React + TypeScript · Synaptica {year}</span>
        </p>
      </div>
    </footer>
  );
}

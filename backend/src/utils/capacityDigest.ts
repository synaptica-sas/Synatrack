import { escaparHtml } from "./notifications.js";
import { etiquetaMes } from "./capacityAlerts.js";

/**
 * Contenido del resumen semanal de capacity (CONTRATO §5.4). Construcción pura: no envía ni lee la
 * base. Todo texto de usuario (nombres de consultores) pasa por `escaparHtml` dentro del HTML.
 */

export interface DatosResumenCapacity {
  /** Utilización del equipo por mes del horizonte (null = sin capacidad). */
  equipo: { month: string; pct: number | null }[];
  sobreasignados: { nombre: string; month: string; pct: number }[];
  subutilizados: { nombre: string; month: string; billablePct: number }[];
  /** Enlace a la app (puede ir vacío si no hay URL configurada). */
  url: string;
}

const pct0 = (n: number | null) => (n === null ? "—" : `${Math.round(n)} %`);

export function hayNovedades(d: Pick<DatosResumenCapacity, "sobreasignados" | "subutilizados">): boolean {
  return d.sobreasignados.length + d.subutilizados.length > 0;
}

export function construirResumenCapacity(d: DatosResumenCapacity): { subject: string; text: string; html: string } {
  const subject = `[Capacity] Resumen semanal: ${d.sobreasignados.length} sobreasignado(s), ${d.subutilizados.length} subutilizado(s)`;

  const textoEquipo = d.equipo.map((e) => `  - ${etiquetaMes(e.month)}: ${pct0(e.pct)}`).join("\n");
  const textoSobre = d.sobreasignados.length
    ? d.sobreasignados.map((s) => `  - ${s.nombre} · ${etiquetaMes(s.month)} · ${pct0(s.pct)}`).join("\n")
    : "  Ninguno.";
  const textoSub = d.subutilizados.length
    ? d.subutilizados.map((s) => `  - ${s.nombre} · ${etiquetaMes(s.month)} · ${pct0(s.billablePct)} facturable`).join("\n")
    : "  Ninguno.";
  const text =
    `Resumen semanal de capacity\n\n` +
    `UTILIZACIÓN DEL EQUIPO\n${textoEquipo}\n\n` +
    `SOBREASIGNADOS\n${textoSobre}\n\n` +
    `SUBUTILIZADOS\n${textoSub}\n\n` +
    (d.url ? `Ver el detalle: ${d.url}\n\n` : "") +
    `Atentamente,\nApp Gestión Synaptica`;

  const th = (t: string, derecha = false) =>
    `<th style="padding: 6px 8px; border: 1px solid #f4d4b6; background: #fff8f0; text-align: ${derecha ? "right" : "left"};">${escaparHtml(t)}</th>`;
  const td = (t: unknown, derecha = false) =>
    `<td style="padding: 6px 8px; border: 1px solid #f4d4b6;${derecha ? " text-align: right;" : ""}">${escaparHtml(t)}</td>`;
  const tabla = (cabeceras: string, filas: string) =>
    `<table style="border-collapse: collapse; width: 100%; max-width: 640px; margin: 10px 0; font-size: 0.9rem;"><tr>${cabeceras}</tr>${filas}</table>`;

  const htmlEquipo = tabla(
    th("Mes") + th("Utilización", true),
    d.equipo.map((e) => `<tr>${td(etiquetaMes(e.month))}${td(pct0(e.pct), true)}</tr>`).join(""),
  );
  const htmlSobre = d.sobreasignados.length
    ? tabla(
        th("Consultor") + th("Mes") + th("Asignado", true),
        d.sobreasignados.map((s) => `<tr>${td(s.nombre)}${td(etiquetaMes(s.month))}${td(pct0(s.pct), true)}</tr>`).join(""),
      )
    : `<p style="color: #666;">Ninguno.</p>`;
  const htmlSub = d.subutilizados.length
    ? tabla(
        th("Consultor") + th("Mes") + th("Facturable", true),
        d.subutilizados
          .map((s) => `<tr>${td(s.nombre)}${td(etiquetaMes(s.month))}${td(pct0(s.billablePct), true)}</tr>`)
          .join(""),
      )
    : `<p style="color: #666;">Ninguno.</p>`;
  const enlace = d.url
    ? `<p>Ver el detalle: <a href="${escaparHtml(d.url)}">${escaparHtml(d.url)}</a></p>`
    : "";

  const html = `
    <div style="font-family: sans-serif; padding: 20px; color: #2a1e12;">
      <h2 style="color: #9a4f0f;">Resumen semanal de capacity</h2>
      <h3 style="color: #9a4f0f; margin-bottom: 4px;">Utilización del equipo</h3>
      ${htmlEquipo}
      <h3 style="color: #9a4f0f; margin-bottom: 4px;">Sobreasignados</h3>
      ${htmlSobre}
      <h3 style="color: #9a4f0f; margin-bottom: 4px;">Subutilizados</h3>
      ${htmlSub}
      ${enlace}
      <hr style="border: none; border-top: 1px solid #f4d4b6;" />
      <p style="font-size: 0.8rem; color: #888;">Mensaje automático de la Plataforma de Gestión de Proyectos Synaptica. Se envía una vez por semana y solo cuando hay novedades.</p>
    </div>
  `;

  return { subject, text, html };
}

import nodemailer from "nodemailer";
import { env } from "../config/env.js";
import { getLogger } from "../infra/logger.js";

// Leer variables directamente de process.env para notificaciones
const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM = process.env.SMTP_FROM || "App Gestión <noreply@synaptica.cc>";
const PAYROLL_EMAIL = env.PAYROLL_EMAIL || process.env.PAYROLL_EMAIL || env.ADMIN_EMAIL;
const SUPPORT_EMAIL = env.SUPPORT_EMAIL || process.env.SUPPORT_EMAIL || env.ADMIN_EMAIL;
const TEAMS_PAYROLL_WEBHOOK_URL = process.env.TEAMS_PAYROLL_WEBHOOK_URL || "";
const TEAMS_FEEDBACK_WEBHOOK_URL = process.env.TEAMS_FEEDBACK_WEBHOOK_URL || "";

// Configurar el transportador nodemailer si están dadas las credenciales
let transporter: nodemailer.Transporter | null = null;
if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465, // true para 465, false para 587/TLS
    requireTLS: SMTP_PORT === 587, // Forzar STARTTLS en Microsoft 365
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
    tls: {
      ciphers: "SSLv3",          // Compatibilidad con Office 365
      rejectUnauthorized: false, // Previene errores de cert en dev
    },
  });
}

export interface EmailParams {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Envía un correo electrónico. Si SMTP no está configurado, escribe un log detallado.
 */
export async function sendEmail(params: EmailParams) {
  const { to, subject, text, html } = params;

  if (transporter) {
    try {
      await transporter.sendMail({
        from: SMTP_FROM,
        to,
        subject,
        text,
        html,
      });
      getLogger().info({ to, subject }, "[SMTP] Correo enviado con éxito");
    } catch (error) {
      getLogger().error({ err: error, to, subject }, "[SMTP] Falló el envío de correo");
    }
  } else {
    getLogger().info(
      { from: SMTP_FROM, to, subject, text },
      "[SMTP MOCK] Se solicitó el envío de correo (SMTP no configurado)",
    );
  }
}

/**
 * Envía una notificación HTTP POST a un Webhook de Microsoft Teams.
 */
export async function sendTeamsMessage(webhookUrl: string, payload: any) {
  if (!webhookUrl) {
    getLogger().info("[TEAMS MOCK] Mensaje de Teams omitido (Webhook no configurado)");
    return;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      getLogger().error(
        { status: response.status, response: errorText },
        "[TEAMS] El webhook respondió con error",
      );
    } else {
      getLogger().info("[TEAMS] Tarjeta de notificación enviada con éxito al webhook");
    }
  } catch (error) {
    getLogger().error({ err: error }, "[TEAMS] Excepción al llamar al Webhook de Teams");
  }
}

/**
 * Notifica al PM que un consultor ha solicitado aprobación de horas extras.
 */
export async function notifyNewExtraHourRequest(params: {
  consultantName: string;
  date: string;
  hours: number;
  pmEmail: string;
  projectName: string;
}) {
  const { consultantName, date, hours, pmEmail, projectName } = params;
  const to = pmEmail || env.ADMIN_EMAIL;
  const subject = `[Horas Extra] Solicitud pendiente de aprobación - ${consultantName}`;
  
  const text = `Hola,\n\nEl consultor ${consultantName} ha registrado una nueva solicitud de horas extra para el proyecto "${projectName}".\n\nDetalles:\n- Fecha: ${date}\n- Horas registradas: ${hours} horas\n\nPor favor ingresa a la plataforma para revisar y aprobar la solicitud.\n\nAtentamente,\nApp Gestión Synaptica`;
  
  const html = `
    <div style="font-family: sans-serif; padding: 20px; color: #2a1e12;">
      <h2 style="color: #9a4f0f;">Aprobación Operativa Pendiente (Nivel 1)</h2>
      <p>Hola,</p>
      <p>El consultor <strong>${consultantName}</strong> ha registrado una nueva solicitud de horas extra para el proyecto <strong>"${projectName}"</strong>.</p>
      <table style="border-collapse: collapse; width: 100%; max-width: 400px; margin: 15px 0;">
        <tr>
          <td style="padding: 8px; border: 1px solid #f4d4b6; font-weight: bold; background: #fff8f0;">Fecha</td>
          <td style="padding: 8px; border: 1px solid #f4d4b6;">${date}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border: 1px solid #f4d4b6; font-weight: bold; background: #fff8f0;">Total Horas</td>
          <td style="padding: 8px; border: 1px solid #f4d4b6;">${hours} horas</td>
        </tr>
      </table>
      <p>Por favor, ingresa al módulo de <strong>Horas Extra -> Aprobaciones PM</strong> en la plataforma para gestionar esta solicitud.</p>
      <br/>
      <hr style="border: none; border-top: 1px solid #f4d4b6;" />
      <p style="font-size: 0.8rem; color: #888;">Mensaje automático de la Plataforma de Gestión de Proyectos Synaptica.</p>
    </div>
  `;

  await sendEmail({ to, subject, text, html });
}

/**
 * Notifica al departamento de Nómina y/o canal de Teams que el PM ha aprobado las horas extras y requiere aprobación de Nivel 2.
 */
export async function notifyExtraHourApprovedByPM(params: {
  consultantName: string;
  identification: string;
  date: string;
  hours: number;
  totalAmount: number;
  currency: string;
  projectName: string;
  approvedByPM: string;
  observations?: string;
}) {
  const { consultantName, identification, date, hours, totalAmount, currency, projectName, approvedByPM, observations } = params;

  // 1. Enviar notificación por correo a Nómina
  const subject = `[Nómina] Horas Extra aprobadas por PM - ${consultantName}`;
  const text = `Hola Nómina,\n\nEl Project Manager ${approvedByPM} ha otorgado la aprobación operativa de Nivel 1 para las horas extra de ${consultantName}.\n\nDetalles:\n- Consultor: ${consultantName}\n- Identificación: ${identification}\n- Proyecto: ${projectName}\n- Fecha: ${date}\n- Horas aprobadas: ${hours} horas\n- Monto a pagar: ${totalAmount.toLocaleString()} ${currency}\n- Observaciones: ${observations || "Ninguna"}\n\nPor favor, ingresa a la plataforma para otorgar la aprobación final de pago de Nivel 2.\n\nAtentamente,\nApp Gestión Synaptica`;
  
  const html = `
    <div style="font-family: sans-serif; padding: 20px; color: #2a1e12;">
      <h2 style="color: #16a34a;">Validación de Nómina Pendiente (Nivel 2)</h2>
      <p>Hola Nómina,</p>
      <p>El Project Manager <strong>${approvedByPM}</strong> ha otorgado la aprobación operativa de Nivel 1 para las horas extra de <strong>${consultantName}</strong>.</p>
      <table style="border-collapse: collapse; width: 100%; max-width: 500px; margin: 15px 0;">
        <tr>
          <td style="padding: 8px; border: 1px solid #f4d4b6; font-weight: bold; background: #fff8f0; width: 150px;">Consultor</td>
          <td style="padding: 8px; border: 1px solid #f4d4b6;">${consultantName}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border: 1px solid #f4d4b6; font-weight: bold; background: #fff8f0;">Identificación</td>
          <td style="padding: 8px; border: 1px solid #f4d4b6;">${identification}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border: 1px solid #f4d4b6; font-weight: bold; background: #fff8f0;">Proyecto</td>
          <td style="padding: 8px; border: 1px solid #f4d4b6;">${projectName}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border: 1px solid #f4d4b6; font-weight: bold; background: #fff8f0;">Fecha</td>
          <td style="padding: 8px; border: 1px solid #f4d4b6;">${date}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border: 1px solid #f4d4b6; font-weight: bold; background: #fff8f0;">Horas Aprobadas</td>
          <td style="padding: 8px; border: 1px solid #f4d4b6;">${hours} horas</td>
        </tr>
        <tr>
          <td style="padding: 8px; border: 1px solid #f4d4b6; font-weight: bold; background: #fff8f0;">Valor Estimado</td>
          <td style="padding: 8px; border: 1px solid #f4d4b6; font-weight: bold; color: #16a34a;">${totalAmount.toLocaleString()} ${currency}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border: 1px solid #f4d4b6; font-weight: bold; background: #fff8f0;">Observaciones</td>
          <td style="padding: 8px; border: 1px solid #f4d4b6;">${observations || "Ninguna"}</td>
        </tr>
      </table>
      <p>Por favor, ingresa a la sección de <strong>Aprobaciones de Nómina</strong> para otorgar el visto bueno definitivo para el pago.</p>
      <br/>
      <hr style="border: none; border-top: 1px solid #f4d4b6;" />
      <p style="font-size: 0.8rem; color: #888;">Mensaje automático de la Plataforma de Gestión de Proyectos Synaptica.</p>
    </div>
  `;

  await sendEmail({ to: PAYROLL_EMAIL, subject, text, html });

  // 2. Enviar notificación a Teams si el webhook está configurado
  if (TEAMS_PAYROLL_WEBHOOK_URL) {
    const teamsPayload = {
      "@type": "MessageCard",
      "@context": "http://schema.org/extensions",
      "themeColor": "2563eb",
      "summary": `Horas Extra Aprobadas por PM - ${consultantName}`,
      "sections": [{
        "activityTitle": "📝 Aprobación Operativa de Horas Extra (Nivel 1)",
        "activitySubtitle": `Aprobado por: ${approvedByPM}`,
        "facts": [
          { "name": "Consultor:", "value": consultantName },
          { "name": "Cédula/ID:", "value": identification },
          { "name": "Proyecto:", "value": projectName },
          { "name": "Fecha:", "value": date },
          { "name": "Horas:", "value": `${hours} horas` },
          { "name": "Monto Local:", "value": `${totalAmount.toLocaleString("es-CO")} ${currency}` }
        ],
        "markdown": true
      }]
    };
    await sendTeamsMessage(TEAMS_PAYROLL_WEBHOOK_URL, teamsPayload);
  }
}

/**
 * Notifica al Administrador y/o canal de Teams cuando un usuario envía feedback de la aplicación.
 */
export async function notifyFeedbackReceived(params: {
  category: string;
  notes: string;
  userEmail: string;
  userName: string;
}) {
  const { category, notes, userEmail, userName } = params;

  // 1. Notificación por Correo
  const subject = `[Feedback Plataforma] Nuevo reporte - Categoria: ${category}`;
  const text = `Hola Admin,\n\nSe ha recibido un nuevo comentario de feedback en la plataforma.\n\nDetalles:\n- Usuario: ${userName} (${userEmail})\n- Categoría: ${category}\n- Comentarios:\n${notes}\n\nAtentamente,\nSoporte Interno`;
  
  const html = `
    <div style="font-family: sans-serif; padding: 20px; color: #2a1e12;">
      <h2 style="color: #d97706;">💬 Reporte de Feedback Recibido</h2>
      <p>Hola Admin,</p>
      <p>Se ha registrado una nueva entrada de feedback desde la aplicación:</p>
      <table style="border-collapse: collapse; width: 100%; max-width: 500px; margin: 15px 0;">
        <tr>
          <td style="padding: 8px; border: 1px solid #f4d4b6; font-weight: bold; background: #fff8f0; width: 120px;">Usuario</td>
          <td style="padding: 8px; border: 1px solid #f4d4b6;">${userName} (${userEmail})</td>
        </tr>
        <tr>
          <td style="padding: 8px; border: 1px solid #f4d4b6; font-weight: bold; background: #fff8f0;">Categoría</td>
          <td style="padding: 8px; border: 1px solid #f4d4b6;">
            <span style="padding: 2px 8px; border-radius: 4px; font-weight: bold; font-size: 0.8rem; background: ${category === "BUG" ? "#fee2e2; color: #dc2626;" : "#fef3c7; color: #d97706;"}">
              ${category}
            </span>
          </td>
        </tr>
        <tr>
          <td style="padding: 8px; border: 1px solid #f4d4b6; font-weight: bold; background: #fff8f0;">Observaciones</td>
          <td style="padding: 8px; border: 1px solid #f4d4b6; white-space: pre-wrap;">${notes}</td>
        </tr>
      </table>
      <br/>
      <hr style="border: none; border-top: 1px solid #f4d4b6;" />
      <p style="font-size: 0.8rem; color: #888;">Mensaje automático de la Plataforma de Gestión de Proyectos Synaptica.</p>
    </div>
  `;

  await sendEmail({ to: SUPPORT_EMAIL, subject, text, html });

  // 2. Notificación a Teams si el webhook está configurado
  if (TEAMS_FEEDBACK_WEBHOOK_URL) {
    const teamsPayload = {
      "@type": "MessageCard",
      "@context": "http://schema.org/extensions",
      "themeColor": category === "BUG" ? "dc2626" : "d97706",
      "summary": `Nuevo Feedback Plataforma - Categoria: ${category}`,
      "sections": [{
        "activityTitle": "💬 Nuevo Feedback del Sistema Recibido",
        "activitySubtitle": `Enviado por: ${userName} (${userEmail})`,
        "facts": [
          { "name": "Categoría:", "value": category },
          { "name": "Comentarios:", "value": notes }
        ],
        "markdown": true
      }]
    };
    await sendTeamsMessage(TEAMS_FEEDBACK_WEBHOOK_URL, teamsPayload);
  }
}

/**
 * Notifica al consultor que su solicitud de horas extras ha sido aprobada de forma definitiva (Nivel 2).
 */
export async function notifyExtraHourFullyApproved(params: {
  consultantName: string;
  consultantEmail: string;
  date: string;
  hours: number;
  projectName: string;
  approvedBy: string;
}) {
  const { consultantName, consultantEmail, date, hours, projectName, approvedBy } = params;
  if (!consultantEmail) return;

  const subject = `[Horas Extra] Solicitud aprobada - ${projectName}`;
  const text = `Hola ${consultantName},\n\nTu solicitud de horas extra para el proyecto "${projectName}" ha sido aprobada de forma definitiva por ${approvedBy}.\n\nDetalles:\n- Fecha: ${date}\n- Horas aprobadas: ${hours} horas\n\nAtentamente,\nApp Gestión Synaptica`;

  const html = `
    <div style="font-family: sans-serif; padding: 20px; color: #2a1e12;">
      <h2 style="color: #16a34a;">✅ Solicitud de Horas Extra Aprobada</h2>
      <p>Hola <strong>${consultantName}</strong>,</p>
      <p>Tu solicitud de horas extra para el proyecto <strong>"${projectName}"</strong> ha recibido la aprobación final por parte de <strong>${approvedBy}</strong> y se ha registrado para el pago de nómina.</p>
      <table style="border-collapse: collapse; width: 100%; max-width: 400px; margin: 15px 0;">
        <tr>
          <td style="padding: 8px; border: 1px solid #f4d4b6; font-weight: bold; background: #fff8f0; width: 150px;">Fecha</td>
          <td style="padding: 8px; border: 1px solid #f4d4b6;">${date}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border: 1px solid #f4d4b6; font-weight: bold; background: #fff8f0;">Horas Aprobadas</td>
          <td style="padding: 8px; border: 1px solid #f4d4b6;">${hours} horas</td>
        </tr>
      </table>
      <br/>
      <hr style="border: none; border-top: 1px solid #f4d4b6;" />
      <p style="font-size: 0.8rem; color: #888;">Mensaje automático de la Plataforma de Gestión de Proyectos Synaptica.</p>
    </div>
  `;

  await sendEmail({ to: consultantEmail, subject, text, html });
}

/**
 * Notifica al consultor que su solicitud de horas extras ha sido rechazada por el PM o por Nómina.
 */
export async function notifyExtraHourRejected(params: {
  consultantName: string;
  consultantEmail: string;
  date: string;
  hours: number;
  projectName: string;
  rejectedBy: string;
  rejectionNote: string;
}) {
  const { consultantName, consultantEmail, date, hours, projectName, rejectedBy, rejectionNote } = params;
  if (!consultantEmail) return;

  const subject = `[Horas Extra] Solicitud rechazada - ${projectName}`;
  const text = `Hola ${consultantName},\n\nTu solicitud de horas extra para el proyecto "${projectName}" ha sido rechazada por ${rejectedBy}.\n\nDetalles:\n- Fecha: ${date}\n- Horas solicitadas: ${hours} horas\n- Motivo de rechazo: ${rejectionNote}\n\nAtentamente,\nApp Gestión Synaptica`;

  const html = `
    <div style="font-family: sans-serif; padding: 20px; color: #2a1e12;">
      <h2 style="color: #dc2626;">❌ Solicitud de Horas Extra Rechazada</h2>
      <p>Hola <strong>${consultantName}</strong>,</p>
      <p>Tu solicitud de horas extra para el proyecto <strong>"${projectName}"</strong> ha sido rechazada por <strong>${rejectedBy}</strong>.</p>
      <table style="border-collapse: collapse; width: 100%; max-width: 500px; margin: 15px 0;">
        <tr>
          <td style="padding: 8px; border: 1px solid #f4d4b6; font-weight: bold; background: #fff8f0; width: 150px;">Fecha</td>
          <td style="padding: 8px; border: 1px solid #f4d4b6;">${date}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border: 1px solid #f4d4b6; font-weight: bold; background: #fff8f0;">Horas Solicitadas</td>
          <td style="padding: 8px; border: 1px solid #f4d4b6;">${hours} horas</td>
        </tr>
        <tr>
          <td style="padding: 8px; border: 1px solid #f4d4b6; font-weight: bold; background: #fee2e2; color: #dc2626;">Motivo de Rechazo</td>
          <td style="padding: 8px; border: 1px solid #f4d4b6; color: #dc2626;">${rejectionNote}</td>
        </tr>
      </table>
      <p>Por favor revisa la información o ponte en contacto con tu supervisor de ser necesario.</p>
      <br/>
      <hr style="border: none; border-top: 1px solid #f4d4b6;" />
      <p style="font-size: 0.8rem; color: #888;">Mensaje automático de la Plataforma de Gestión de Proyectos Synaptica.</p>
    </div>
  `;

  await sendEmail({ to: consultantEmail, subject, text, html });
}

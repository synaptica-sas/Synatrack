# Documentación de Configuración y Diagnóstico de Correos

Esta guía detalla el funcionamiento del sistema de notificaciones por correo de la plataforma (feedback del sistema, solicitudes de horas extra, aprobaciones y rechazos), explica cómo solucionar los errores de autenticación con Microsoft 365 y propone alternativas transaccionales recomendadas para entornos de producción.

---

## 1. Flujo de Correos en la Aplicación

El backend de la aplicación utiliza **Nodemailer** para enviar correos electrónicos de manera asíncrona ante los siguientes eventos:

*   **Feedback del Sistema:** Cuando un usuario envía comentarios desde la interfaz, se dispara una notificación que se envía a la dirección configurada en `SUPPORT_EMAIL` (por defecto, `atoro@synaptica.co`).
*   **Solicitud de Horas Extra:** Notifica al Gerente de Proyecto (PM) asignado para que revise y apruebe las horas registradas por un consultor.
*   **Aprobaciones y Rechazos:** Notifica al consultor el estado de su solicitud (aprobada por PM, rechazada con observaciones, o consolidada definitivamente por Nómina).

---

## 2. Diagnóstico del Error de SMTP (Microsoft 365 / Office 365)

Durante las pruebas del flujo de correo con los parámetros actuales del archivo `.env`:
```env
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_USER=atoro@synaptica.co
SMTP_PASS=Poderoso#1913*
SMTP_FROM="App Gestion <atoro@synaptica.co>"
```
Se obtuvo el siguiente error crítico en la consola del backend:
> `Error: Invalid login: 535 5.7.139 Authentication unsuccessful, SmtpClientAuthentication is disabled for the Tenant. Visit https://aka.ms/smtp_auth_disabled for more information.`

### ¿Por qué ocurre esto?
Microsoft 365 y Office 365 aplican directivas de seguridad modernas que **deshabilitan por defecto la autenticación básica (SMTP AUTH)** para todo el tenant. Para corregir este bloqueo y permitir que Nodemailer envíe correos con la cuenta `atoro@synaptica.co`, siga uno de los siguientes procedimientos:

### Solución A: Habilitar SMTP AUTH para el buzón en Microsoft 365
Un administrador de TI de la organización debe:
1. Ir al **Centro de administración de Microsoft 365** (https://admin.microsoft.com).
2. Ir a **Usuarios** > **Usuarios activos** y seleccionar a `atoro@synaptica.co`.
3. En el panel lateral, hacer clic en la pestaña **Correo** (Mail).
4. Bajo la sección **Aplicaciones de correo electrónico** (Email apps), hacer clic en **Administrar aplicaciones de correo electrónico**.
5. Marcar la casilla **SMTP autenticado** (Authenticated SMTP).
6. Guardar los cambios.
*(Nota: Microsoft puede tardar desde unos minutos hasta 24 horas en propagar este cambio).*

---

## 3. Alternativas de Producción Recomendadas (Proveedores Transaccionales)

Debido a que las políticas de seguridad de Microsoft y Google a menudo bloquean los inicios de sesión por SMTP desde servidores en la nube como Render, la mejor práctica para evitar que los correos terminen en la carpeta de SPAM es utilizar un proveedor de correo transaccional especializado.

A continuación se presentan ejemplos de cómo ajustar el archivo `.env` del backend utilizando otros proveedores:

### Opción A: Resend (Recomendado y Gratis)
Resend es muy fácil de configurar y tiene un plan gratuito generoso.
1. Crea una cuenta en [resend.com](https://resend.com).
2. Genera una API Key.
3. Configura el `.env` en Render con:
```env
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_USER=resend
SMTP_PASS=re_tu_api_key_aqui
SMTP_FROM="App Gestión <noreply@tudominio.com>"
```

### Opción B: SendGrid
1. Crea una cuenta en [sendgrid.com](https://sendgrid.com).
2. Genera una API Key con permisos de envío de correo.
3. Configura el `.env` en Render con:
```env
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=SG.tu_api_key_aqui
SMTP_FROM="App Gestión <noreply@tudominio.com>"
```

### Opción C: AWS SES (Simple Email Service)
1. Configura el servicio SES en AWS y verifica tu dominio de envío.
2. Genera credenciales SMTP desde la consola de AWS SES.
3. Configura el `.env` en Render con:
```env
SMTP_HOST=email-smtp.us-east-1.amazonaws.com
SMTP_PORT=587
SMTP_USER=tu_smtp_username_ses
SMTP_PASS=tu_smtp_password_ses
SMTP_FROM="App Gestión <noreply@tudominio.com>"
```

---

## 4. Webhooks de Microsoft Teams (Alternativa Activa)

Si la configuración de correo de Microsoft 365 sigue bloqueada, la aplicación cuenta con notificaciones redundantes mediante **Webhooks de Microsoft Teams**. 

Cuando se configura el webhook en el `.env` del backend:
```env
TEAMS_FEEDBACK_WEBHOOK_URL=https://synaptica.webhook.office.com/webhookb2/...
TEAMS_PAYROLL_WEBHOOK_URL=https://synaptica.webhook.office.com/webhookb2/...
```
El sistema enviará tarjetas visuales con toda la información de feedback o solicitudes directamente al canal de Teams correspondiente, lo cual no depende de la autenticación SMTP y es 100% confiable.

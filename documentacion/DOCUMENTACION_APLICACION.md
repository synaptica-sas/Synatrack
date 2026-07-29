# Documentación Aplicación - App Gestión Demo

## 1. Resumen General
App Gestión es una aplicación web para el control de proyectos, consultores, horas, gastos, proyecciones, capacidad y métricas consolidadas de seguimiento (PMO).

La solución cuenta con:
- **Frontend**: React 19 + TypeScript + Vite.
- **Backend**: Fastify + Prisma ORM + PostgreSQL.
- **Base de Datos**: Supabase PostgreSQL.
- **Deploy objetivo**: Vercel (frontend) + Render (backend).

La autenticación está diseñada para funcionar en dos modalidades seleccionables mediante variables de entorno:
1. **Modo Autenticado con Microsoft (Entra ID / Azure AD)**: Flujo seguro end-to-end con inicio de sesión único y sincronización automática de roles.
2. **Modo Demo (Bypass Auth)**: Permite ingresar automáticamente sin login para presentaciones de preventa y demostraciones rápidas.

---

## 2. Arquitectura de Ramas y Despliegue

### 2.1 Flujo de Ramas
- **`develop`**: Rama activa de desarrollo. Contiene las últimas características de la aplicación (Capacidad, Horas Extra, Auditoría, Estimaciones, Portafolio PMO, RAG Chat, accesos directos, etc.) y mejoras estéticas de UX.
- **`main`** / **`deploy`**: Rama conectada a los servicios automáticos de Render y Vercel. 

> [!IMPORTANT]
> Para liberar los últimos cambios de la demo a producción (Render y Vercel), se debe fusionar la rama `develop` en la rama activa de despliegue (`deploy` o `main`) mediante Git:
> ```bash
> git checkout deploy # o main, según corresponda
> git merge develop
> git push origin deploy
> ```

---

## 3. Módulos y Secciones del Proyecto (Rama `develop`)
La aplicación cuenta con las siguientes secciones agrupadas en la barra de navegación lateral y accesibles según el rol del usuario:

### 3.1 Gobierno
- **Dashboard**: 
  - Panel principal con indicadores clave (KPIs): presupuesto total, total ejecutado, horas totales y horas aprobadas.
  - Filtros interactivos globales por Empresa, Proyecto y Rango de Fechas.
  - Listado de proyectos clasificados por su estado de riesgo presupuestal.
  - Visualización del consolidado de horas aprobadas y proyecciones por consultor.
- **Portafolio (PMO)**:
  - Panel corporativo para supervisar el rendimiento consolidado de múltiples proyectos.
  - Semáforo de salud (RAG: Rojo, Amarillo, Verde) basado en desviaciones presupuestarias, riesgos e incidentes.
  - Métricas de Valor Ganado (EVM):
    - **CPI** (Índice de Rendimiento de Costos): Indica la eficiencia del costo del proyecto.
    - **SPI** (Índice de Rendimiento del Cronograma): Muestra el avance del cronograma frente a lo planificado.
  - Porcentaje de uso del presupuesto y porcentaje de avance físico.
  - Listado de riesgos críticos e incidentes abiertos.
  - Exportación de la matriz completa a formato CSV.
- **Proyectos**:
  - Gestión completa (CRUD) de proyectos.
  - Configuración de fechas de inicio y fin, presupuesto total asignado, umbral de margen y porcentaje de alerta.
  - Asignación de Project Manager (PM) y tipo de proyecto (Precio Fijo, Horas/T&M, Staffing).
  - Selector de moneda base (COP, USD, EUR, etc.) y flag para habilitar/deshabilitar horas extra.
- **Capacidad**:
  - Matriz de planificación para ver el porcentaje de ocupación o asignación de cada consultor en los proyectos a lo largo del tiempo.
  - Detección visual de sobrecargas de capacidad (>100% de la jornada laboral) para mitigar el agotamiento laboral.
  - Panel para asignaciones masivas de recursos a proyectos por periodo.

### 3.2 Operación
- **Consultores**:
  - CRUD de consultores con tarifa por hora y moneda asociada (USD, COP, etc.).
  - Configuración del país (indispensable para mapear feriados y leyes de horas extra), seniority, tags de habilidades (skills) y horas máximas permitidas por día.
- **Horas**:
  - Registro de horas de trabajo diario asociado a proyectos.
  - Flujo de aprobación (Pendiente, Aprobado, Rechazado). Al rechazar, el aprobador (PM o Admin) debe ingresar una nota de rechazo obligatoria.
- **Actividades**:
  - Registro y seguimiento de tareas diarias vinculadas a proyectos.
  - Clasificación por tipo de actividad, fecha programada, prioridad, horas estimadas y horas reales ejecutadas.
- **Horas Extra**:
  - Módulo que calcula de manera automática los recargos por horas extra (Diurna, Nocturna, Festiva Diurna, Festiva Nocturna) basándose en las leyes y horarios configurados para el país del consultor.
  - Flujo de aprobación dual: requiere aprobación del Project Manager (PM) y posteriormente de Finanzas (FINANCE).
- **Gastos**:
  - CRUD de gastos asociados a proyectos con categorías configurables y visualización en moneda original y convertida mediante TRM.

### 3.3 Financiero
- **Ingresos**:
  - Registro de facturación, hitos logrados e ingresos cobrados al cliente por proyecto.
- **Proyecciones (Forecasts)**:
  - Planificación a futuro de horas a trabajar, tarifa de costo y tarifa de venta de consultores.
  - Generación masiva por rangos de trimestres y años fiscales.
- **Estimaciones**:
  - Calculadora avanzada para estructurar el presupuesto de nuevos proyectos a partir de requerimientos de horas, aplicando buffers de riesgo y niveles de confianza.
- **Tasas FX (Divisas)**:
  - Configuración persistida de tasas de cambio corporativas (TRM) entre múltiples divisas, habilitando la conversión en vivo de todos los reportes.

### 3.4 Administración
- **Usuarios**:
  - Panel para gestionar los usuarios locales de la aplicación y visualizar sus roles.
- **Config. Horas Extra**:
  - Ajuste de los recargos y límites semanales de horas extra por país (por ejemplo, definir las horas de inicio de jornada nocturna y multiplicadores en Colombia, Perú, etc.).
- **Auditoría**:
  - Bitácora detallada de auditoría para registrar cada cambio efectuado en la base de datos (acción realizada, entidad afectada, estado antes y después, IP del usuario y navegador).

### 3.5 Características Adicionales de Usabilidad
- **RAG Chatbot**: Asistente virtual inteligente contextualizado (se abre con `Ctrl + K` o mediante el icono flotante) que permite a los usuarios hacer preguntas en lenguaje natural sobre las métricas del proyecto o dudas operativas.
- **Atajos de Teclado**:
  - `Alt + N`: Ir a Dashboard.
  - `Alt + H`: Ir a Horas.
  - `Alt + F`: Ir a Proyecciones.
  - `Alt + C`: Ir a Consultores.
  - `Ctrl + K`: Abrir/Cerrar RAG Chatbot.
  - `?`: Mostrar ayuda de atajos.

---

## 4. Integración con Microsoft Entra ID (Azure AD)

### 4.1 Mapeo Crítico de Roles
El backend procesa la claim `roles` enviada en el token de Azure AD durante el inicio de sesión. La lógica del archivo `backend/src/auth/guard.ts` realiza el siguiente procedimiento:
1. Toma el arreglo de roles en `claims.roles`.
2. Convierte cada valor a mayúsculas (`.toUpperCase()`).
3. Valida si coincide exactamente con el enum de Prisma `AppRole` (`ADMIN`, `PM`, `CONSULTANT`, `FINANCE`, `VIEWER`).

> [!WARNING]
> **Advertencia de Mapeo de Roles en Azure AD**:
> Si en el Azure Portal los App Roles de la Enterprise Application fueron creados con el valor `"consultores"` (plural, en español), el backend no lo reconocerá directamente porque espera `"CONSULTANT"` en singular.
> 
> **Cómo solucionarlo**:
> En el Azure Portal (App Registrations / Enterprise Application -> App Roles), asegúrese de que el **Valor (Value)** de cada rol coincida exactamente con las cadenas en inglés (la mayúscula no importa, el backend aplica `toUpperCase()`):
> - Rol de Administrador: **Value** = `ADMIN` o `admin`
> - Rol de PM (Director de Proyecto): **Value** = `PM` o `pm`
> - Rol de Consultor: **Value** = `CONSULTANT` o `consultant`
> - Rol Financiero: **Value** = `FINANCE` o `finance`
> - Rol de Lector (Viewer): **Value** = `VIEWER` o `viewer`

### 4.2 Aprovisionamiento JIT (Just-In-Time) de Usuarios y Consultores
Para facilitar el ingreso de usuarios sin necesidad de crearlos manualmente uno por uno en la base de datos:
1. Al iniciar sesión, si el email del token de Azure AD no existe en la base de datos, el backend crea un registro en la tabla `User` de manera automática.
2. Si el token incluye roles válidos de Azure AD, estos se sincronizan reemplazando cualquier rol local previo.
3. Si el token no tiene roles y el usuario no tiene roles en la DB local, se le asigna el rol `CONSULTANT` de forma predeterminada.
4. **Regla Especial de Consultor**: Si el usuario tiene o adquiere el rol `CONSULTANT`, el sistema asegura automáticamente la creación de un registro en la tabla `Consultant` con el mismo correo y nombre.
   
> [!IMPORTANT]
> Al crearse un consultor vía JIT por primera vez, su tarifa por hora (`hourlyRate`) se inicializa en `0` y la moneda en `USD`. 
> 
> **Acción necesaria**: Un administrador o PM debe entrar a la pestaña **Consultores** y editar el registro del nuevo consultor para configurar su tarifa real y país, permitiendo cálculos correctos de costos en horas registradas y proyecciones.

5. **Regla Especial de Administrador Principal**: El correo configurado en la variable de entorno `ADMIN_EMAIL` del backend siempre recibirá automáticamente el rol `ADMIN` en la base de datos local al iniciar sesión, actuando como puerta de entrada segura.

---

## 5. Variables de Entorno para Modo Autenticado en Producción

Para que Render (Backend) y Vercel (Frontend) operen con inicio de sesión real de Microsoft Entra ID en lugar de la simulación de bypass, configure las siguientes variables en sus respectivos paneles de administración:

### 5.1 En Render (Backend Web Service)
- `AUTH_ENABLED` = `true` (Habilita la validación del token JWT de Microsoft).
- `AUTH_DEMO_BYPASS` = `false` (Desactiva el inicio de sesión automático de administrador local).
- `ADMIN_EMAIL` = `admin@tuempresa.com` (Correo corporativo que recibirá rol ADMIN automáticamente).
- `AZURE_AD_TENANT_ID` = `[ID del Tenant de Azure AD / GUID o dominio corporativo]`
- `AZURE_AD_AUDIENCE` = `[App ID URI del Backend, ej: api://<client-id-backend> o directamente el Client ID del backend]`

### 5.2 En Vercel (Frontend SPA)
- `VITE_FORCE_LOCAL_AUTH` = `false` (Indica al cliente usar MSAL.js para redireccionar al login de Microsoft).
- `VITE_AZURE_TENANT_ID` = `[ID del Tenant de Azure AD]`
- `VITE_AZURE_CLIENT_ID` = `[Client ID de la App Registration del Frontend]`
- `VITE_AZURE_REDIRECT_URI` = `https://tu-aplicacion.vercel.app/home` (Debe estar registrada como URI tipo SPA en Azure Portal).
- `VITE_AZURE_API_SCOPE` = `api://[Client ID del Backend]/access_as_user` (Scope expuesto por el backend para autorizar las peticiones).

---

## 6. Lista de Verificación para la Salida a Producción (Checklist)

1. [ ] **Fusión de Código**: Integrar los últimos cambios estéticos y funcionales de la rama `develop` a la rama activa de despliegue (`deploy` o `main`).
2. [ ] **Verificar Redireccionamientos en Azure AD**: En la App Registration del Frontend, agregar `https://[dominio-vercel].vercel.app/home` y asegurar que el tipo de redirección sea **SPA (Single Page Application)**.
3. [ ] **Alinear Valores de Roles**: Comprobar que en Azure AD los App Roles asignados tengan como "Value" los términos en inglés (`ADMIN`, `PM`, `CONSULTANT`, `FINANCE`, `VIEWER`).
4. [ ] **Cambio de Variables de Entorno**: Actualizar las variables especificadas en la sección 5 tanto en Render como en Vercel y forzar un redespliegue de los servicios.
5. [ ] **Definir Tarifas JIT**: Alertar a los administradores que, a medida que los empleados ingresen por primera vez, deberán asignarles sus tarifas correspondientes desde el panel de **Consultores**.
6. [ ] **Mitigación de Cold Starts (Render Free)**: Debido a que Render duerme las instancias gratis tras 15 minutos de inactividad, se aconseja contratar el plan Starter para el Backend o configurar un ping continuo (ej: con UptimeRobot) hacia `/health` para mantener el backend despierto antes de presentaciones clave.

---

## 7. Instrucciones para levantar la aplicación localmente (Desarrollo Local)

Para ejecutar y probar la aplicación en tu máquina local, sigue estos pasos:

### 7.1 Requisitos Previos
- **Node.js**: Versión 18 o 20 instalada.
- **Docker**: Para levantar la base de datos PostgreSQL local configurada en el puerto `5433`.

### 7.2 Levantar la Base de Datos Local (Docker)
En la raíz del proyecto, abre una terminal y ejecuta el comando para iniciar el contenedor de base de datos en segundo plano:
```bash
docker-compose up -d
```
*Nota: Esto iniciará una instancia de PostgreSQL que expone el puerto `5433` local para evitar conflictos con otras bases de datos en el puerto estándar 5432.*

### 7.3 Configuración del Backend
1. Navega al directorio del backend:
   ```bash
   cd backend
   ```
2. Instala las dependencias necesarias:
   ```bash
   npm ci
   ```
3. Crea tu archivo de configuración de entorno:
   - En Windows, copia el archivo de ejemplo para el puerto 5433:
     ```cmd
     copy .env.local.5433.example .env
     ```
   - En Linux/macOS, usa `cp`:
     ```bash
     cp .env.local.5433.example .env
     ```
4. Genera el cliente de Prisma:
   ```bash
   npm run prisma:generate
   ```
5. Aplica el esquema y ejecuta las migraciones:
   ```bash
   npm run prisma:deploy
   ```
6. Carga la base de datos con los datos semilla y de prueba:
   ```bash
   npm run prisma:seed
   ```
7. Inicia el servidor de desarrollo del backend:
   ```bash
   npm run dev
   ```
   *El backend estará escuchando peticiones en http://localhost:4000.*

### 7.4 Configuración del Frontend
1. Abre una nueva terminal y navega al directorio del frontend:
   ```bash
   cd frontend
   ```
2. Instala las dependencias:
   ```bash
   npm ci
   ```
3. Crea tu archivo de configuración de entorno para local:
   - En Windows:
     ```cmd
     copy .env.example .env
     ```
   - En Linux/macOS:
     ```bash
     cp .env.example .env
     ```
4. Inicia el servidor de desarrollo local de Vite:
   ```bash
   npm run dev
   ```
5. Abre la aplicación en tu navegador web en la dirección:
   ```
   http://localhost:5173/home
   ```


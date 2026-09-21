# R4 — `docs/actualizar-manuales`

Rama de **documentación únicamente**: no se tocó una sola línea de código, configuración ni
esquema. Cubre DEP-25, DEP-26, DEP-27 y DEP-28 del `BACKLOG_DEPURACION.md`, más las
desactualizaciones que aparecieron al verificar cada afirmación contra el repositorio.

Todo lo que se afirma abajo se comprobó contra el sistema de archivos y el código:
`find . -name ".env*"`, `git branch -a`, `backend/package.json`, `frontend/package.json`,
`backend/prisma/seed.mjs`, `backend/prisma/migrations/`, `frontend/src/components/RagChat.tsx`,
`frontend/src/App.tsx`, `.github/workflows/`, `render.yaml`, `frontend/vercel.json` y
`.claude/settings.json`.

---

## DEP-25 — Las instrucciones de arranque local mandaban a copiar archivos inexistentes

**Hecho verificado.** Los únicos archivos `.env*` que existen en el repositorio son:

```
backend/.env.example
frontend/.env.example
frontend/.env.production.example
```

(más los `backend/.env` y `frontend/.env` locales, ignorados por Git). **No existen**
`backend/.env.local.example` ni `backend/.env.local.5433.example`. Quien seguía el manual se
trababa en el paso 3 con un "archivo no encontrado".

`backend/.env.example` **ya trae comentados** los dos pares de `DATABASE_URL`/`DIRECT_URL` para
PostgreSQL local (puerto 5432 y puerto 5433), así que basta copiarlo y descomentar el par que
corresponda.

| Documento | Antes | Ahora |
|---|---|---|
| `documentacion/DOCUMENTACION_APLICACION.md` §7.3 paso 3 | `copy .env.local.5433.example .env` / `cp .env.local.5433.example .env` | `copy .env.example .env` / `cp .env.example .env`, más el bloque `env` con el par del puerto 5433 que hay que descomentar, y una nota de que los archivos antiguos no existen |
| `documentacion/DEPLOYMENT.md`, "Desarrollo local antes del despliegue" | Dos apartados que remitían a `backend/.env.local.example` (5432) y `backend/.env.local.5433.example` (5433) | Un solo apartado que remite a `backend/.env.example`, con el `cp`/`copy` y la explicación de los pares comentados |
| `documentacion/DEPLOYMENT.md`, "Lista de trabajo" | "usar solo `.env.example` y `.env.production.example`" (ambiguo: no decía de qué carpeta) | "usar solo los ejemplos versionados: `backend/.env.example`, `frontend/.env.example` y `frontend/.env.production.example`" |
| `backend/README.md` paso 2 | `Port 5432 example: .env.local.example` / `Port 5433 example: .env.local.5433.example` | Copiar `.env.example` y descomentar el par local que corresponda, con nota de que los otros dos nunca existieron. Se conservó el inglés del archivo |

**Por qué**: era el hallazgo P1 del backlog. Sin esto el manual no se puede seguir.

**Matiz sobre el backlog**: DEP-25 afirmaba que `.env.production.example` tampoco existe. Sí
existe, pero en `frontend/`, no en `backend/`. Por eso la corrección fue calificar la ruta en
lugar de borrar la referencia.

---

## DEP-26 — Flujo de ramas `develop` → `deploy` que no existe

**Hecho verificado** (`git branch -a`): las ramas son `main` y `origin/dev`, más las ramas de
trabajo de esta depuración (`fix/limpieza-frontend`, `fix/limpieza-backend`,
`fix/configuracion-entorno`, `docs/actualizar-manuales`). **`develop` y `deploy` no existen.**

Lo único automatizado que sí está declarado en el repositorio es
`.github/workflows/azure-static-web-apps-victorious-glacier-0d52b010f.yml`, que publica el
frontend en Azure Static Web Apps en cada push a `main` y en los PR contra `main`.
`render.yaml` **no fija `branch`**, y `frontend/vercel.json` solo tiene rewrites: la rama que
Render y Vercel tienen conectada no se puede saber leyendo el repositorio.

| Documento | Antes | Ahora |
|---|---|---|
| `documentacion/DEPLOYMENT.md` (encabezado y "Flujo de ramas") | "Frontend: Vercel desde la rama `deploy`" / "Backend: Render desde la rama `deploy`" y un bloque `bash` con `git checkout develop … git merge develop … git push origin deploy` | Sección "Ramas" que lista las ramas reales, dice explícitamente que `develop`/`deploy` no existen y que **no hay un flujo de promoción acordado**, describe el workflow de Azure y advierte que la rama de Render/Vercel hay que confirmarla en sus paneles |
| `documentacion/DOCUMENTACION_APLICACION.md` §2.1 | "`develop`: rama activa de desarrollo" / "`main` / `deploy`: rama conectada a Render y Vercel" + bloque `[!IMPORTANT]` con el `git merge develop` | §2.1 "Ramas existentes" con `main`, `origin/dev` y las ramas `fix/*`/`docs/*`, remitiendo a `PLAN_DE_RAMAS.md`; el `[!IMPORTANT]` ahora aclara qué no existe y qué sí está automatizado |
| `documentacion/DOCUMENTACION_APLICACION.md` §3 (título) | "Módulos y Secciones del Proyecto (Rama `develop`)" | "Módulos y Secciones del Proyecto" |
| `documentacion/DOCUMENTACION_APLICACION.md` §6 checklist, punto 1 | "Integrar los últimos cambios … de la rama `develop` a la rama activa de despliegue (`deploy` o `main`)" | "Integrar la rama de trabajo correspondiente en `main`", con referencia a §2.1 y a `PLAN_DE_RAMAS.md` |

**Por qué**: describir la realidad. Deliberadamente **no se inventó** un flujo de ramas: ambos
documentos dicen que, cuando se acuerde uno, ese es el lugar donde documentarlo.

---

## DEP-27 — El "RAG Chatbot" no es un asistente inteligente

**Hecho verificado** leyendo `frontend/src/components/RagChat.tsx` completo:

- No hay ninguna llamada de red en el componente; opera sobre los props `projects`,
  `statsProjects`, `fxConfigs` y `consultants` que la pantalla ya tiene cargados.
- La "respuesta" sale de una cadena de `if/else` sobre `userText.toLowerCase()`: coincidencia
  del nombre de un proyecto, del nombre (o primer nombre) de un consultor, o de las palabras
  clave `alerta`/`riesgo`/`excedido`/`limite`, `proyecto`/`cuántos`/`lista`,
  `presupuesto`/`costo`/`budget`, `tasa`/`dolar`/`divisa`/`cambio`/`fx` y
  `ayuda`/`hola`/`qué haces`/`buenos dias`. Si nada coincide, responde que no encontró registros.
- No hay LLM, ni embeddings, ni índice vectorial, ni API de IA. El propio código lo dice:
  `// Simulate RAG retrieval and generation`, y el `setTimeout(…, 1000)` es el retardo simulado
  de escritura. La lista de "Fuentes" es texto fijo por rama (incluida "Búsqueda Semántica Vacía").

| Documento | Antes | Ahora |
|---|---|---|
| `documentacion/DOCUMENTACION_APLICACION.md` §3.5 | "**RAG Chatbot**: Asistente virtual inteligente contextualizado … que permite a los usuarios hacer preguntas en lenguaje natural sobre las métricas del proyecto o dudas operativas." | "**Asistente RAG (demo)**" con tres viñetas: **Qué hace** (coincidencia de texto en el navegador sobre los datos ya cargados, plantillas fijas, lista explícita de palabras clave), **Qué NO hace** (sin LLM, embeddings, índice vectorial ni comprensión de lenguaje natural; el retardo y las "Fuentes" son parte de la simulación) e **Implicación** (conviene aclararlo ante un cliente) |
| `documentacion/DOCUMENTACION_APLICACION.md` §3.5, atajos | "`Ctrl + K`: Abrir/Cerrar RAG Chatbot." | "`Ctrl + K`: Abrir/Cerrar el asistente RAG." |

**Por qué**: este documento se le muestra a clientes. Prometer lenguaje natural sobre algo que
solo reconoce seis grupos de palabras clave genera una expectativa que la demo no cumple.

**No se tocó la interfaz**: el encabezado del panel sigue diciendo "Asistente RAG / Búsqueda
Semántica Demo" y el mensaje de bienvenida sigue diciendo "Soy el asistente inteligente de
Synaptica". Eso es código y queda fuera del alcance de esta rama; el backlog ya propone
ponerle una etiqueta en la UI.

---

## DEP-28 — La carpeta `contexto/`

**Hecho verificado**: `contexto/` contiene `REQUERIMIENTO_DESARROLLO.docx` (25 KB),
`Conversacion.docx` (4 KB), `Plantilla_Monitoreo_Presupuesto_TI_Completa2.xlsx` (62 KB) y
`SY_6.html` (95 KB). Ningún archivo del código la referencia.

- **Nuevo**: `contexto/README.md` — explica qué es cada archivo, aclara que no es código y
  advierte que hay que revisar su confidencialidad antes de dar acceso al repositorio a alguien
  externo o publicarlo.
- **Nuevo**: `documentacion/DOCUMENTACION_APLICACION.md` §8 — la misma tabla y la misma
  advertencia, para que quien lea solo la documentación también se entere.

**No se borró ni se movió nada.** Ambos textos dicen explícitamente que la carpeta se conserva
porque es la trazabilidad del origen del proyecto, y remiten a DEP-28.

---

## Otras desactualizaciones corregidas de paso

### 1. El nombre de la aplicación aparece de tres formas

`DOCUMENTACION_APLICACION.md` se titulaba "Documentación Aplicación - App Gestión Demo" y abría
con "App Gestión es una aplicación web…". Verificado: el repositorio y esta documentación usan
**Synatrack**; la interfaz muestra **SynaTrack** (`frontend/src/App.tsx:778, 919, 1327, 1356, 1418`
y `components/AppFooter.tsx:47`); y los servicios y la base usan **app-gestion** /
**App Gestión** (`render.yaml`, `frontend/vercel.json`, `app_gestion_demo`, `SMTP_FROM`).

**Ahora**: el título y el resumen dicen **Synatrack**, con una nota `[!NOTE]` que enumera las
tres variantes y dónde vive cada una. **No se unificó el nombre** porque hacerlo implica tocar
código y configuración de despliegue, que esta rama no toca.

### 2. El seed no carga datos de demostración

Verificado en `backend/prisma/seed.mjs`: crea los roles de `AppRole` y un único usuario
administrador (`ADMIN_EMAIL`, por defecto `admin@synaptica.local`). Nada más.

- `DOCUMENTACION_APLICACION.md` §7.3 paso 6 decía "Carga la base de datos con los datos semilla
  **y de prueba**" → ahora "Ejecuta el seed", con la aclaración de que la aplicación arranca vacía.
- `DEPLOYMENT.md` decía "Para cargar **datos demo**: `npm run prisma:seed`" → ahora "Ejecuta el
  seed", con la misma aclaración.
- `backend/README.md` decía "(Optional) Seed **demo data**" → ahora "Seed baseline data", con la
  aclaración.
- `DESARROLLO_LOCAL.md` y `DOCUMENTACION_TECNICA.md` §3.5.3 ya lo decían bien; no se tocaron.

### 3. Versión de Node equivocada

`DOCUMENTACION_APLICACION.md` §7.1 pedía "Node.js: Versión 18 o 20". Verificado: tanto
`backend/package.json` como `frontend/package.json` declaran `"engines": { "node": "24.x" }`.
**Ahora** dice 24.x, citando dónde está declarado.

(La inconsistencia de Node en los archivos de despliegue es DEP-21 y la resuelve la rama R3;
la nota de `DOCUMENTACION_TECNICA.md` §2 que remite a §10 se dejó como está.)

### 4. §7 de `DOCUMENTACION_APLICACION.md` asumía Docker sin decirlo

`docker-compose.yml` existe y es válido (`postgres:15-alpine`, `"5433:5432"`), así que los pasos
no están mal, pero en las máquinas actuales no se usa Docker. Se agregó al inicio de §7 una nota
que remite a `DESARROLLO_LOCAL.md` (`.\scripts\dev.ps1` y `.\scripts\db.ps1`) como el camino
verificado, dejando los pasos con Docker como alternativa. No se borró nada.

### 5. `DOCUMENTACION_TECNICA.md` §6.9 afirmaba que no hay CI

Decía: "**No existe** ningún workflow de GitHub Actions (**no hay carpeta `.github/`**). El
'CI/CD' actual es 100% las integraciones nativas de Render/Vercel escuchando pushes a la rama
`deploy`". Verificado: la carpeta `.github/workflows/` existe y contiene el workflow de Azure
Static Web Apps.

**Ahora**: describe ese workflow (push y PR contra `main`), señala que no corre tests ni
type-check y que su `output_location: "build"` no coincide con la salida `dist` de Vite
(DEP-19), y aclara que Render y Vercel siguen dependiendo de sus integraciones nativas.

### 6. `DOCUMENTACION_TECNICA.md` §6.6 repetía el flujo `develop`/`deploy`

Mismo arreglo que DEP-26, pero en los pasos 1 y 2 de "Cómo realizar un nuevo despliegue".

### 7. `DOCUMENTACION_TECNICA.md` §3.5.2 daba por vigente el drift de migraciones

Decía que `CustomHoliday`, `ApprovalDelegation`, `Consultant.allowWeekendWork`/`isInternal`,
`ExtraHoursConfig.monthlyDivisor` y `User.country` no tienen migración. Verificado: existe
`backend/prisma/migrations/20260918120000_fix_schema_drift`, que los incorpora y es idempotente.

**Ahora**: la tabla de migraciones incluye la sexta migración, el aviso pasa de "drift
detectado" a "drift resuelto el 2026-09-18" y conserva el pendiente real (**aún no aplicada en
Supabase/producción**, con las dos formas de resolverlo). En §6.7 se quitó la recomendación de
usar `npm run prisma:push` para tapar el drift, que hoy sería un mal consejo.

> No se tocaron §10 ni §11 de `DOCUMENTACION_TECNICA.md` (la auditoría), que siguen listando el
> drift y el hallazgo 23 tal como se registraron. Son un acta fechada; actualizarlos es otra
> discusión.

### 8. `DESARROLLO_LOCAL.md` — dos notas ya superadas

- El paso 3 de §3 decía "(Los docs antiguos mencionan `.env.local.5433.example`; ese archivo no
  existe.)". Como los manuales ya están corregidos, ahora explica que el propio `.env.example`
  trae el par del puerto 5433 comentado.
- La nota final de §4.4 decía que la regla `deny` `"Read(./**/.env.*)"` bloqueaba leer los
  `.env.example` y "conviene ajustarla". Verificado en `.claude/settings.json`: la regla ya es
  `"Read(./**/.env)"` (más `backend/.env` y `frontend/.env`). Se reescribió como "Resuelto".

---

## Qué se decidió NO cambiar

| Cosa | Por qué |
|---|---|
| `DOCUMENTACION_TECNICA.md` §10 y §11 | Fuera de alcance por instrucción explícita. Son la auditoría fechada |
| `BACKLOG_DEPURACION.md`, `PLAN_DE_RAMAS.md`, `CLAUDE.md` | Fuera de alcance por instrucción explícita |
| Los textos del propio `RagChat.tsx` ("asistente inteligente de Synaptica", "Búsqueda Semántica Demo") | Es código; esta rama no toca código. Queda como acción pendiente de DEP-27 |
| El nombre `App Gestión` / `app-gestion-*` en `render.yaml`, `vercel.json` y la base `app_gestion_demo` | Es código y configuración de despliegue. Se documentó la ambigüedad en lugar de arreglarla |
| Los archivos de `contexto/` | Instrucción explícita de no borrar nada. Solo se documentó y se advirtió |
| El host `app-gestion-demo.onrender.com` hardcodeado en `frontend/vercel.json`, distinto del `app-gestion-backend` de `render.yaml` | Es una inconsistencia real de configuración, no de documentación. Corresponde a otra rama |
| La falta de tildes en el cuerpo preexistente de `DEPLOYMENT.md` | Se conservó el estilo del archivo en el texto que ya estaba; el texto nuevo sí lleva tildes |
| La mención "Node.js 20/24" de `DOCUMENTACION_TECNICA.md` §2 | Remite a §10 y lo resuelve DEP-21 en la rama R3 |

---

## Verificación

Esta rama solo cambia archivos `.md`, así que no hay pruebas que correr sobre ella. Lo que sí se
verificó es que cada afirmación y cada comando que quedó escrito corresponde a algo real:

| Afirmación escrita | Cómo se comprobó |
|---|---|
| Solo existen `backend/.env.example`, `frontend/.env.example` y `frontend/.env.production.example` | `find . -name ".env*" -not -path "*/node_modules/*"` |
| `backend/.env.example` trae los pares 5432 y 5433 comentados | Lectura del archivo |
| Las ramas son `main`, `origin/dev` y las `fix/*`/`docs/*` de la depuración | `git branch -a` |
| El workflow de Azure dispara en push y PR contra `main`, con `output_location: "build"` | Lectura de `.github/workflows/azure-static-web-apps-victorious-glacier-0d52b010f.yml` |
| `render.yaml` no fija `branch` | `grep -n "branch" render.yaml` (sin resultados) |
| El seed solo crea roles y admin | Lectura de `backend/prisma/seed.mjs` |
| Node 24.x en ambos proyectos | `engines` de `backend/package.json` y `frontend/package.json` |
| Los scripts npm citados existen (`prisma:generate`, `prisma:deploy`, `prisma:seed`, `dev`, `smoke`) | `scripts` de `backend/package.json` |
| `RagChat` no usa LLM ni red | Lectura completa de `frontend/src/components/RagChat.tsx` |
| Los atajos `Alt+N/H/F/C`, `Ctrl+K` y `?` siguen existiendo tal como se documentan | `frontend/src/App.tsx:1090-1130` |
| `docker-compose.yml` expone el 5433 con `postgres:15-alpine` | Lectura del archivo |
| La migración `20260918120000_fix_schema_drift` existe | `ls backend/prisma/migrations/` |
| La regla `deny` ya no bloquea los `.env.example` | `grep -n "env" .claude/settings.json` |

**Riesgo que queda**: la rama que Render y Vercel tienen conectada no es verificable desde el
repositorio. Los documentos ahora lo dicen en vez de afirmar una rama concreta; alguien con
acceso a esos paneles debería confirmarlo y completar el dato.

---

## Archivos tocados

| Archivo | Cambio |
|---|---|
| `documentacion/DOCUMENTACION_APLICACION.md` | Título y §1 (nombre), §2.1 (ramas), §3 (título), §3.5 (asistente RAG), §6 (checklist), §7 (nota Docker, Node 24, `.env.example`, seed), §8 nueva (`contexto/`) |
| `documentacion/DEPLOYMENT.md` | Encabezado y sección "Ramas" (antes "Flujo de ramas"), lista de trabajo, seed, desarrollo local (`.env.example`) |
| `backend/README.md` | Pasos 2 y 5 del "Local quick start" |
| `documentacion/DESARROLLO_LOCAL.md` | §3 paso 3 y nota final de §4.4 |
| `documentacion/DOCUMENTACION_TECNICA.md` | §3.5.2 (drift resuelto), §6.6 (despliegue), §6.7 (paso 2), §6.9 (CI/CD). **§10 y §11 intactos** |
| `contexto/README.md` | **Nuevo** |
| `documentacion/cambios/R4-actualizar-manuales.md` | **Nuevo** (este archivo) |

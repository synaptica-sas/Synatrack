# Backlog de depuración — Synatrack

Revisión enfocada en **código muerto, objetos obsoletos, duplicación y configuración
inconsistente**, con el objetivo de ir limpiando el proyecto. Fecha: 2026-09-18.

**Qué NO está aquí:** los 27 hallazgos de arquitectura y corrección funcional que ya viven
en `DOCUMENTACION_TECNICA.md` §10, y los hallazgos de seguridad del code review resumidos
en `CLAUDE.md` §7. Este documento no los repite; cuando un ítem de aquí toca uno de ellos,
lo referencia.

**Cómo se verificó cada cosa:** análisis de imports y exports sobre los 164 archivos de
`backend/src` y `frontend/src`, grafo de dependencias de Graphify (1307 nodos), y
comprobación manual de cada candidato. Los ítems marcados **(verificado)** se confirmaron
leyendo el código; los marcados **(por confirmar)** son candidatos que necesitan una
comprobación puntual antes de borrar. La distinción importa: borrar por resultado de grep
es exactamente como se introducen regresiones.

**Prioridades:** **P0** rompe o engaña hoy · **P1** deuda que cuesta caro mantener ·
**P2** limpieza con beneficio real · **P3** cosmético.

---

## 1. Código muerto

| ID | P | Hallazgo | Evidencia | Acción |
|---|---|---|---|---|
| DEP-01 | P1 | **`Table.tsx` (206 líneas) no lo importa nadie.** Es un componente completo con búsqueda, orden y paginación; cada `*Tab.tsx` reimplementa su propia tabla a mano. | `frontend/src/components/Table.tsx`, 0 imports (verificado) | Decidir: adoptarlo en las tablas nuevas, o borrarlo. Mantenerlo sin usar es peor que cualquiera de las dos. |
| DEP-02 | **P0** | **`ErrorBoundary.tsx` existe pero no está montado.** Hoy un error de render deja la pantalla en blanco sin mensaje. | `frontend/src/components/ErrorBoundary.tsx`, 0 imports (verificado) | Envolver `<App />` en `main.tsx`. Es el ítem de mejor relación esfuerzo/beneficio de la lista. |
| DEP-03 | P2 | **`usePermissions.ts` muerto**: `App.tsx` define su propio `can()` en línea. | `frontend/src/hooks/usePermissions.ts`, 0 imports (verificado) | Usar el hook en `App.tsx` y borrar el duplicado, o borrar el hook. |
| DEP-04 | P2 | `KpiCard.tsx` y `StatusBadge.tsx` sin usar. | 0 imports (verificado) | Mismo criterio que DEP-01. |
| DEP-05 | P2 | **`AssignmentStatus.PARTIAL` nunca se escribe.** Aparece en 12 filtros `where` de lectura y en ningún `create`/`update`. Todas esas consultas cargan una condición que jamás se cumple. | `alerts.service.ts:201`, `assignments.job.ts:24`, `assignments.routes.ts:98,188`, `capacity.routes.ts:82,309,370,438,514` (verificado) | Implementarlo (asignación parcial real) o retirarlo del enum y de los filtros. Ojo: el `"PARTIAL"` de `capacity.routes.ts:22` es de `availabilityStatus`, **otro** enum que sí se calcula — no tocar. |
| DEP-06 | P2 | **`AlertType.CONSULTANT_OVERLOADED` nunca se genera.** Solo aparece en una unión de tipos TypeScript. | `alerts.service.ts:9` (verificado) | `capacity.ts` ya calcula el estado `OVERLOADED`: conectar ambos es trabajo corto y de valor alto. |
| DEP-07 | P2 | **~19 clases CSS sin uso aparente** en `App.css`: `span-4`, `span-5`, `span-full`, `span-all`, `filters-bar`, `converter-result`, `fx-drawer-duplicate-disabled`, `switch-item`, `feedback-panel`, `page-header`, `page-title`, `page-subtitle`, `section-layout-header`, `section-layout-title`, `stats-tab-container`, `role-chip`, `role-chip-group`, `inactive`, `day-number`. | Análisis de 204 clases contra todo el código (por confirmar) | Verificar una por una antes de borrar. **Descartados como falsos positivos:** `role-admin/pm/consultant/finance/viewer` y `sev-critical/warning/info` **sí se usan**, construidas dinámicamente (`` `role-${r.toLowerCase()}` ``). |
| DEP-08 | P3 | Exports de tipos y funciones sin referencias externas (72 detectados), p. ej. `sendEmail`, `sendTeamsMessage`, `isSupportedCountry`, y ~20 funciones de `services/api.ts` (`listMilestones`, `updateRisk`, `listIssues`, `setProjectHealth`…). | Análisis de exports (por confirmar) | Las de `api.ts` probablemente son andamiaje para pantallas nunca construidas (hitos, riesgos, incidencias tienen backend pero no UI propia). Decidir producto antes que código. |

---

## 2. Objetos obsoletos

| ID | P | Hallazgo | Evidencia | Acción |
|---|---|---|---|---|
| DEP-09 | P1 | **10 `as any` que ya no hacen falta.** Se pusieron porque el cliente Prisma no conocía `monthlyDivisor` cuando se aplicó por `db push`. Ahora que existe la migración y el cliente está regenerado, sobran y están ocultando el tipado real. | `extra-hours.routes.ts:196,207,210,401,498,550,584,595,624,635` (verificado) | Quitarlos y compilar. Es limpieza mecánica y segura. |
| DEP-10 | P1 | **Bucle de corrección de datos que corre en cada petición.** `ensureDefaultConfigs()` recorre las configuraciones y reescribe `monthlyDivisor` si vale 220 — una corrección puntual de migración convertida en efecto permanente. Además se invoca en casi todos los endpoints de horas extra, así que **cada request escribe en la base**. | `extra-hours.routes.ts:200-213` (verificado) | Mover a una migración de datos o al seed, y sacar `ensureDefaultConfigs()` del camino de request. |
| DEP-11 | P2 | **`test-connection.mjs` es un diagnóstico viejo** con el host del pooler de Supabase incrustado. No lo llama ningún script de `package.json`. | `backend/scripts/test-connection.mjs` (verificado) | Borrar, o parametrizar por variable de entorno si aún sirve para soporte. |
| ~~DEP-12~~ | — | ~~Chunk de `html2canvas` sin dependencia~~ **DESCARTADO. Era un error de esta revisión.** `html2canvas` no está en `package.json` porque entra como dependencia **transitiva de `jspdf`**; el build sí genera el chunk (`vendor-html2canvas`, 199 kB). La línea de `manualChunks` es correcta y hay que dejarla. | `npm run build` en `frontend/` (verificado) | Ninguna. |
| DEP-13 | P2 | **`prisma` (el CLI) está en `dependencies`, no en `devDependencies`.** Se instala en producción sin necesitarse en runtime. | `backend/package.json` (verificado) | Mover a `devDependencies`. Verificar antes que el build de Render no lo necesite en tiempo de arranque. |
| DEP-14 | P3 | `TODO(backend)` duplicado sobre rangos ISO en vez de trimestres. | `frontend/src/utils/periodUtils.ts:110,217` | Resolver o convertir en ítem de backlog con dueño. |
| DEP-31 | P1 | **El build de producción incluye los archivos de prueba.** `tsconfig.json` compila `src/**/*.ts` sin excluir `__tests__`, así que `dist/utils/__tests__/*.js` viaja al servidor. Efecto colateral: después de un `npm run build`, `npm test` recolecta las pruebas **dos veces** (306 en vez de 153) porque vitest también mira `dist/`. Un conteo de pruebas inflado es peligroso: esconde si algo dejó de ejecutarse. | `backend/tsconfig.json`, `dist/utils/__tests__/` (verificado) | Excluir `**/__tests__/**` y `**/*.test.ts` del `tsconfig.json`, y acotar el `include` de vitest a `src/`. |

---

## 3. Duplicación

| ID | P | Hallazgo | Evidencia | Acción |
|---|---|---|---|---|
| DEP-15 | **P0** | **Tres copias de la matriz de permisos.** `auth/roles.ts` (backend, solo alimenta la UI), `authorize([AppRole...])` en cada ruta (lo que realmente protege), y **una tercera copia literal en `App.tsx:984`** dentro de `handleSwitchRole`. Tres fuentes que pueden desincronizarse sin que nada avise. | `backend/src/auth/roles.ts`, `frontend/src/App.tsx:984-1016` (verificado) | Mínimo: que `handleSwitchRole` derive los permisos de una sola definición compartida. Idealmente, que `authorize(...)` reciba permisos y no roles (§11.1 de la doc técnica). |
| DEP-16 | P1 | **Prueba que no prueba el código.** `tableSort.test.ts` reimplementa ("Mirrors the sort logic from DashboardTab") la lógica de orden en el propio test. Puede estar verde mientras `DashboardTab` está roto. | `frontend/src/test/tableSort.test.ts:3` (verificado) | Extraer la función de orden a `dashboardUtils.ts` e importarla desde el test. |
| DEP-17 | P1 | Lógica de aprobar/rechazar de horas extra duplicada entre los dos handlers (quién puede en cada nivel, delegaciones, mes cerrado). | `extra-hours.routes.ts` `approve` y `reject` | Extraer un helper `getExtraHourAuthLevel(...)`. Ya estaba propuesto en §11.3 de la doc técnica. |
| DEP-18 | P1 | `findFxRate` en `App.tsx` reimplementa la triangulación de monedas de `currency.ts` del backend, con un comentario que lo admite. Dos implementaciones de la misma regla financiera. | `frontend/src/App.tsx:126` (verificado) | Consumir `GET /api/fx/rate`, o aceptar la duplicación y probarla en el frontend. Hoy no tiene pruebas. |

---

## 4. Configuración inconsistente

| ID | P | Hallazgo | Evidencia | Acción |
|---|---|---|---|---|
| DEP-19 | **P0** | **El workflow de Azure Static Web Apps publica `build/` pero Vite emite `dist/`.** Corre en cada push a `main` y no despliega nada útil; además no corre pruebas ni type-check. | `.github/workflows/azure-static-web-apps-*.yml` (verificado) | Corregir `output_location` a `dist` y agregar test + type-check. Confirmado que Vercel y Azure SWA **ambos** se usan. |
| DEP-20 | **P0** | **El cron de FX apunta a un host que no existe.** Se comprobó contra producción: `app-gestion-demo.onrender.com/health` responde **200**, y `app-gestion-backend.onrender.com` **no responde en 150 s** (no existe). `render.yaml` declara el servicio como `app-gestion-backend` y su cron job hace `curl` a `https://app-gestion-backend.onrender.com/api/fx/sync` → **la sincronización diaria de tasas de cambio nunca ha funcionado**. | `render.yaml` vs. respuesta real de producción (verificado) | `frontend/vercel.json` está **correcto**, no tocarlo. Corregir el host del cron en `render.yaml` a `app-gestion-demo.onrender.com` y alinear el `name` del servicio con la realidad. Revisar después si las tasas FX en producción están desactualizadas. |
| DEP-21 | P1 | **Node inconsistente en cuatro sitios**: `.nvmrc` (20.19.0), Dockerfiles (`node:20-slim`), `render.yaml` (20.19.0) vs `package.json engines` (**24.x**). La máquina local corre 24.13.0, o sea que **hoy se desarrolla en un major distinto al de producción**. | `backend/.nvmrc`, `frontend/.nvmrc`, ambos `Dockerfile`, `render.yaml`, ambos `package.json` (verificado) | Elegir una versión y alinear los cinco archivos. Dado que local ya corre 24 y `engines` lo pide, lo natural es subir producción; hay que probarlo. |
| DEP-22 | P1 | **`SMTP_FROM` por defecto usa `noreply@synaptica.cc`** (dominio `.cc`), mientras el resto del proyecto usa `synaptica.co`. Si `.cc` no es un dominio propio, todo correo saliente sale con remitente ajeno y se va a spam. | `backend/src/utils/notifications.ts:9`, `backend/.env.example` (verificado) | Confirmar el dominio correcto. Probable errata. |
| DEP-23 | P2 | `DIRECT_URL` no pasa por la validación Zod de `config/env.ts`: una URL mal puesta falla recién al migrar, no al arrancar. | `backend/src/config/env.ts` (verificado) | Agregarla al schema. |
| DEP-24 | P2 | `render.yaml` construye con `npm install --include=dev` y `DEPLOYMENT.md` documenta `npm ci`. Instalan versiones potencialmente distintas. | (verificado) | Unificar en `npm ci`. |

---

## 5. Documentación desactualizada

| ID | P | Hallazgo | Evidencia | Acción |
|---|---|---|---|---|
| DEP-25 | P1 | **Las instrucciones de arranque local no funcionan**: mandan a copiar `.env.local.5433.example`, `.env.local.example` y `.env.production.example`, que no existen. Quien siga el manual se traba en el paso 3. | `DOCUMENTACION_APLICACION.md:203,207`, `DEPLOYMENT.md:61,65`, `backend/README.md:20-21` (verificado) | Apuntar a `.env.example`, o crear los archivos citados. `DESARROLLO_LOCAL.md` ya documenta el camino que sí funciona. |
| DEP-26 | P2 | **La documentación describe un flujo de ramas que no existe**: `develop` → `deploy`. Las ramas reales son `main` y `origin/dev`. | `DEPLOYMENT.md:11-19`, `DOCUMENTACION_APLICACION.md:21-34` (verificado) | Reescribir con las ramas reales. |
| DEP-27 | P2 | El RAG Chat se documenta como "asistente virtual inteligente" y es coincidencia de texto en el cliente, sin LLM. | `DOCUMENTACION_APLICACION.md` §3.5 vs `RagChat.tsx` (verificado) | Ajustar la descripción, o ponerle una etiqueta en la UI. Genera expectativas falsas frente a un cliente. |
| DEP-28 | P3 | `contexto/` guarda insumos comerciales del cliente (`.docx`, `.xlsx`, `SY_6.html` de 97 KB) dentro del repo de código. | (verificado) | No es basura, pero no pertenece aquí. Revisar además si su contenido es confidencial antes de compartir el repo. |

---

## 6. Ruido en ejecución

| ID | P | Hallazgo | Evidencia | Acción |
|---|---|---|---|---|
| DEP-29 | P2 | **`console.error("DEBUG: Token verification failed:")`** en el camino de autenticación: en producción imprime el detalle de cada token rechazado. | `backend/src/auth/guard.ts:95` (verificado) | Pasar al logger de Fastify (`request.log.warn`) sin volcar el error crudo. |
| DEP-30 | P3 | 12 `console.log` en `notifications.ts`, `alerts.service.ts` y `assignments.job.ts` conviviendo con el logger estructurado de Fastify. | (verificado) | Unificar en el logger de la app para que los logs de Render sean parseables. |

---

## 7. Hallazgos de la verificación de integración (2026-09-21)

Encontrados al ejercitar la aplicación completa con las cinco ramas integradas. **Los tres
son preexistentes**, no los introdujeron esas ramas. Detalle en
`documentacion/cambios/VERIFICACION_INTEGRACION.md`.

| ID | P | Hallazgo | Evidencia | Acción |
|---|---|---|---|---|
| DEP-32 | P1 | **La conversión de moneda falla en silencio cuando no hay tasa.** `convertAmountFallback` devuelve el monto sin convertir en vez de señalarlo, así que en una base sin tasas cargadas los importes salen en su moneda original pero rotulados con la moneda base. Misma raíz que el punto 19 de la doc técnica §10, que lo describía solo para nómina. *(Corrección: la evidencia original de este ítem mezclaba este problema con DEP-35, que resultó ser la causa de lo que se veía en el tablero. Con tasas cargadas, la API **sí** convierte bien.)* | `backend/src/utils/currency.ts`; verificado que con tasas cargadas `/api/stats/overview` devuelve los valores convertidos correctos | Marcar en la respuesta los montos que no se pudieron convertir y señalarlos en la interfaz. |
| DEP-35 | **P0** | **El tablero muestra cifras financieras equivocadas hasta que se toca el selector de moneda.** `DashboardTab` recibe `initialStats` por prop y lo usa solo como valor inicial de `useState`; cuando la petición de `App` termina, el componente **ignora la prop actualizada** y se queda con `null` para siempre. Entonces cae a `dashboardTotals`, que **suma presupuestos de distintas monedas como si fueran la misma unidad**. `setStats` solo se invoca desde `changeBaseCurrency`. Medido en local: al cargar muestra **US$ 660.090.000**; el valor correcto es **US$ 257.089**. Son **2.568 veces** de diferencia, y "Ingresos reconocidos" y "Margen bruto" salen en 0 teniendo datos. | `frontend/src/features/dashboard/DashboardTab.tsx:421` y `:459-466`; reproducido con navegador (verificado) | Sincronizar el estado con la prop (un `useEffect` sobre `initialStats`, o consumir la prop directamente sin estado local). Mientras no se arregle, **las cifras del tablero no son confiables al abrirlo**. |
| DEP-33 | P1 | **Los enlaces profundos no funcionan.** Entrar directo a `/projects` o a cualquier ruta de pestaña (salvo `/profile`) redirige siempre a `/dashboard`. La navegación por el menú sí actualiza la URL, pero esa URL no se puede compartir ni recargar. | Efecto de enrutamiento de `frontend/src/App.tsx`: mientras `authUser` es `null` durante el arranque, redirige a `/` y se pierde el destino (verificado con Playwright en las 16 pantallas) | Guardar la ruta pedida antes de redirigir y restaurarla cuando termine la autenticación. |
| DEP-34 | P3 | Tres advertencias de React en Actividades: `fill-opacity`, `stop-color` y `stop-opacity` deberían ir en camelCase en JSX. | Consola del navegador en `/activities` (verificado) | Renombrar a `fillOpacity`, `stopColor`, `stopOpacity`. |

---

## Orden sugerido

1. **DEP-02** (montar `ErrorBoundary`) — media hora, elimina las pantallas en blanco.
2. **DEP-19 / DEP-20** — hoy el despliegue está en un estado ambiguo; hasta resolverlo, nada de lo demás llega a producción de forma confiable.
3. **DEP-15** — tres copias de los permisos es el riesgo latente más caro de la lista.
4. **DEP-09 / DEP-10 / DEP-12 / DEP-11** — limpieza mecánica, bajo riesgo, deja el código legible.
5. **DEP-21 / DEP-22 / DEP-25** — alineación de entorno y manual que hoy no funciona.
6. Lo demás, por oportunidad cuando se toque el área.

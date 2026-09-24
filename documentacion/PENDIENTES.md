# Pendientes de Synatrack

Lista viva de lo que falta. Si vas a tomar algo, empieza por aquí.

**Actualizado:** 2026-09-22 · **Rama con todo lo hecho:** `dev`

Para el detalle de cada arreglo ya hecho, ver `documentacion/cambios/`.
Para el histórico completo de la depuración, `documentacion/BACKLOG_DEPURACION.md`
(42 ítems, 29 resueltos). Este documento es el que hay que mirar para saber qué queda.

---

## 0. Lo primero: nada de esto está en producción

`dev` va **35 commits por delante de `main`**. Producción sigue en el estado de
principios de septiembre, así que **todo lo arreglado no le sirve a nadie todavía**: el
drift del esquema, las fugas de tarifas, la suplantación al registrar horas, el cron de
tasas de cambio apuntando a un host inexistente, la auditoría, el planificador de tareas.

**El procedimiento completo, con los comandos ya ensayados, está en
`documentacion/DESPLIEGUE.md`.** Decisión tomada: como lo que hay en producción son datos de
prueba, la base de Supabase se rehace desde cero en vez de intentar reconciliar su historial
de migraciones.

Resumen de lo que hay que hacer:

- [ ] Rehacer la base de **Supabase**: no se construyó con las migraciones de este repo
      (se usó `db push` desde Railway), así que `migrate deploy` falla contra ella.
- [ ] **Cargar las tasas de cambio** con `POST /api/fx/sync` justo después. El seed deja
      cero, y sin ellas los importes salen en la moneda equivocada.
- [ ] Confirmar que Render acepta **Node 24** (`NODE_VERSION` en `render.yaml`). Es
      reversible en una línea si algo falla.
- [ ] Asegurarse de que las variables `AUTH_DEV_*` **no existan** en producción. Son el
      simulador de rol; están apagadas por defecto y protegidas por tres cerrojos, pero
      no deben estar ahí.
- [ ] Crear en Render el cron `app-gestion-jobs` si el Blueprint no lo aplica solo, y
      comprobar con `GET /api/jobs/status` que quedó activo.
- [ ] Revisar si las tasas de cambio quedaron congeladas durante los meses en que el cron
      apuntaba a un host que no existía.
- [ ] **Avisar al equipo de que varios proyectos van a cambiar de color.** El semáforo
      ahora usa el umbral configurado de cada proyecto en vez de un 15 fijo, y el
      portafolio dejó de contar el forecast dos veces. Si hay informes ya entregados con
      los colores viejos, conviene explicarlo antes.

---

## 1. Decisiones que necesitan a una persona, no a un desarrollador

Nada de esto se puede resolver leyendo código.

| # | Decisión | Por qué hace falta |
|---|---|---|
| D-1 | **¿El dominio `synaptica.cc` es nuestro?** `SMTP_FROM` usa `noreply@synaptica.cc` mientras el resto del proyecto usa `synaptica.co`. Si no es un dominio propio, **todo correo saliente lleva un remitente ajeno** y acaba en spam. (DEP-22) | Nadie puede confirmarlo desde el código |
| D-2 | **¿El umbral de margen por defecto debe ser 15 %?** Cuando un proyecto no tiene `marginThreshold` configurado se aplica 15, que era el comportamiento de facto. La alternativa es poblarlo en todos los proyectos y quitar el valor por defecto. | Es una regla de negocio |
| D-3 | **¿Un VIEWER debe ver los movimientos de todos los proyectos?** `GET /api/financial-entries` no aplica alcance por rol, a diferencia de otros módulos. | Política de visibilidad |
| D-4 | **¿Los ingresos se categorizan?** `FinancialEntry.category` solo se usa en gastos y queda nulo en ingresos, sin que el esquema lo impida. | Cambio de modelo si la respuesta es sí |
| D-5 | **¿La jornada laboral se configura por país, por consultor o ambos?** Necesario para poder arreglar DEP-41. | Define el diseño |
| D-6 | **Credenciales SMTP de prueba** para poder corregir el TLS del correo sin romper el envío. | Sin un buzón de prueba no se puede verificar |
| D-7 | **¿Cuáles son los umbrales buenos de CPI, SPI y uso de presupuesto?** La pantalla de Portafolio pinta con 0,85 / 1,00 y 90 % / 100 %, pero el backend calcula la salud con 0,75 y 0,9. Son criterios distintos para lo mismo, así que el color de una celda puede contradecir al semáforo de su propia fila. | Es una regla de negocio, no una decisión técnica |

## 3. Migración visual del frontend (tarea abierta, lista para retomar)

Hay un sistema de diseño completo y seis pantallas ya migradas que sirven de referencia. Lo
que falta es aplicar lo mismo al resto. **Es trabajo acotado y repetitivo, apto para
retomar por partes.**

### Qué hay que leer antes de empezar

1. `documentacion/DISENO.md` — las convenciones: escala de espaciado, radios, sombras, el
   catálogo de clases ya creadas y las trampas conocidas (la de especificidad de
   `body.dark .card` es importante).
2. `.claude/agents/disenador-ui.md` — el agente de diseño, con sus reglas.
3. `frontend/src/features/portfolio/PortfolioTab.tsx` — la pantalla de referencia. Así debe
   quedar el resto.

Hay además una skill instalada, `ui-ux-pro-max`, con 119 guías de UX, paletas por tipo de
producto, tipografías e iconos. Se consulta así:

```bash
python .claude/skills/ui-ux-pro-max/scripts/search.py --domain ux --max-results 5 "tu consulta"
```

### En qué consiste exactamente

Dos métricas, medibles con `grep`, que resumen el problema:

- **Colores literales** (`#a1b2c3`) dentro de los `.tsx`. Hay que llevarlos a **cero**: todo
  color sale de un token de `index.css`. Los literales que quedan no son de la marca, son la
  paleta por defecto de Tailwind que se coló copiando y pegando.
- **Estilos en línea** (`style={{ }}`). Lo repetido pasa a clases en `App.css`. Lo único que
  puede quedarse es el **valor calculado** (un ancho que depende de un porcentaje, por
  ejemplo).

### Cómo medir el avance

```bash
# Global
grep -rhoE '#[0-9a-fA-F]{3,6}' --include='*.tsx' frontend/src | wc -l
grep -rho 'style={{' --include='*.tsx' frontend/src | wc -l

# Un archivo concreto
grep -c 'style={{' frontend/src/features/<pantalla>.tsx
```

### Lo que queda, medido hoy

| Archivo | Estilos en línea | Colores literales |
|---|---|---|
| `features/estimations/EstimationCalculatorTab.tsx` | 272 | 82 |
| `features/activities/ActivitiesTab.tsx` | 223 | 58 |
| `features/extraHours/ExtraHoursTab.tsx` | 186 | 35 |
| `features/capacity/CapacityTab.tsx` | 123 | 28 |
| `features/profile/ProfileTab.tsx` | 48 | 6 |
| `features/forecasts/ForecastsTab.tsx` | 39 | 19 |
| `features/consultants/ConsultantsTab.tsx` | 39 | 0 |
| `features/admin/AdminTab.tsx` | 26 | 0 |
| `components/AlertsPanel.tsx` | 25 | 16 |
| `features/projects/ProjectsTab.tsx` | 24 | 3 |
| `features/expenses/GastosSummaryTable.tsx` | 23 | 0 |
| `components/RagChat.tsx` | 18 | 16 |
| `features/expenses/GastosFilters.tsx` | 18 | 6 |
| `components/DateRangePicker.tsx` | 14 | 12 |
| `features/expenses/ExpensesTab.tsx` | 14 | 1 |
| `components/SearchableSelect.tsx` | 13 | 2 |
| `features/audit/AuditTab.tsx` | 12 | 4 |
| `features/expenses/GastosDetailRow.tsx` | 9 | 0 |
| `features/fx/FxTab.tsx` | 8 | 0 |
| `components/Toast.tsx` | 5 | 14 |
| `components/ValidationErrorBox.tsx` | 5 | 7 |

### Orden recomendado, y por qué

No por tamaño, sino por impacto:

1. **`components/Toast.tsx` y `components/ValidationErrorBox.tsx`** — diminutos, pero tienen
   más color literal que código y **aparecen encima de cualquier pantalla**: se ven cada vez
   que se guarda algo o falla una validación.
2. **`components/AlertsPanel.tsx`** — el cajón de la campana, que se abre desde todas partes.
3. **`components/DateRangePicker.tsx` y `components/RagChat.tsx`** — compartidos.
4. **Horas Extra** y **Capacidad** — las de mayor uso diario entre las grandes.
5. **Actividades** y **Estimaciones** al final: son las más grandes (más de 2.000 líneas) y
   las de uso más esporádico. **Léelas por rangos, no enteras.**

### Reglas que no se pueden romper

- Cero colores literales. Si falta un matiz, se crea como token y se documenta.
- El modo oscuro tiene que funcionar. Un color literal es, casi siempre, un fallo de modo
  oscuro esperando a ocurrir.
- Contraste 4.5:1 en texto normal, 3:1 en texto grande.
- El color nunca es lo único que comunica un estado — pero quien cumple esa regla es la
  **etiqueta**, no un icono metido dentro de una píldora (ver §"Iconos de estado" de
  `DISENO.md`; ya se cometió ese error una vez).
- **No cambiar comportamiento.** Si aparece un defecto funcional, se anota y se sigue.
- La paleta de Synaptica **no se cambia**. El trabajo es aplicar la identidad que ya existe.

### Cómo verificar antes de dar algo por hecho

```bash
cd frontend
npx tsc -b --noEmit   # ojo: `tsc --noEmit` a secas NO verifica nada aquí
npm run lint
npm run build
npm test              # 136 pruebas
```

Y **capturas de antes y después**, en claro y oscuro y a 400 px de ancho. Hay Playwright y
Chromium instalados; en `documentacion/capturas/` están las de las pantallas ya migradas
como ejemplo del formato. Una afirmación de que "se ve mejor" sin captura no sirve para
revisar.

### Trampas ya descubiertas, para no volver a tropezar

- **`body.dark .card` pesa más que las clases de estado** (incluye el elemento `body`), así
  que el tinte de una tarjeta desaparece en oscuro. Se resuelve dando más peso a la clase
  nueva, repitiéndola si hace falta (`.kpi-sub.kpi-sub`), **sin `!important`**.
- **En los SVG el color va por clase, no por el atributo `fill` o `stroke`**: un
  `fill="#ff9c2c"` no resuelve tokens ni tiene contraparte oscura.
- **Una prueba que afirma un color literal bloquea la migración.** Pasó con `AlertBadge`: la
  solución fue que la prueba afirme la clase, que es el contrato real.
- Los datos locales no traen alertas ni proyectos en rojo, así que para capturar esos
  estados hay que interceptar la respuesta de la API **solo en el navegador**, sin tocar la
  aplicación ni los datos.

---

## 4. Una trampa que ya apareció cinco veces

**Campos que el backend lee y que nadie puede escribir.** El modelo declara la columna, el
código la consulta, pero no está en ningún esquema Zod ni en ningún formulario, así que
queda siempre nula y la funcionalidad que depende de ella **no funciona, sin dar error**.

Ya pasó con `projectManagerEmail` (la aprobación de horas extra por el PM era imposible),
`marginThreshold` y `budgetAlertPct` (el umbral configurado se ignoraba), `identification`
(el documento salía siempre "No asignado" en la nómina) y `CapacityConfig` (DEP-41, todavía
abierto).

**Si agregas un campo al modelo, agrégalo también al esquema Zod y al formulario en el mismo
cambio.** Y si encuentras código que lee un campo, comprueba que exista forma de escribirlo.

---

## 5. Cómo verificar lo que hagas

El proyecto tiene con qué demostrar que un cambio funciona; úsalo.

```bash
cd backend && npm test          # 195 pruebas unitarias (cálculo puro)
cd backend && npm run test:routes   # 78 pruebas de ruta, con base y autorización reales
cd frontend && npm test         # 135 pruebas
cd frontend && npx tsc -b --noEmit  # ojo: `tsc --noEmit` a secas NO verifica nada aquí
```

Para probar comportamiento por rol hay un **simulador**: variables `AUTH_DEV_EMAIL` y
`AUTH_DEV_ROLES`, o los encabezados `x-dev-email` y `x-dev-roles` con
`AUTH_DEV_ROLE_HEADER=true`. Sin él, el bypass de demo entra siempre como ADMIN y **ninguna
falla de autorización se manifiesta en local**.

Entorno local completo: `.\scripts\dev.ps1`. Detalle en `documentacion/DESARROLLO_LOCAL.md`.

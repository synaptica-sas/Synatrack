# Verificación de integración — 2026-09-21

Respuesta a la pregunta "¿cómo sabemos que con estos cambios no se rompió la app?".

En vez de confiar en que cada rama pase sus pruebas por separado, se integraron **las cinco
ramas juntas** en una rama temporal (`integracion/verificacion`) y se ejercitó la aplicación
completa contra una base de datos creada desde cero.

**Resultado: no se encontró ninguna regresión.** Los tres hallazgos de la sección final son
**preexistentes**, no los introdujeron estas ramas, y se comprobó archivo por archivo.

---

## 1. Integración

Las cinco ramas se fusionaron **sin un solo conflicto**:

```
fix/limpieza-frontend              OK
fix/limpieza-backend               OK
fix/configuracion-entorno          OK
docs/actualizar-manuales           OK
fix/migracion-drift-idempotente    OK
```

El resultado tiene exactamente las migraciones esperadas: la de Juan Espinosa ya corregida
(`20260915164644_sync_schema_drift`) y la de datos de R2
(`20260918130000_fix_extra_hours_monthly_divisor`). No quedó ninguna duplicada.

## 2. Base de datos desde cero

Se creó una base vacía y se aplicó todo el historial de migraciones:

- `prisma migrate deploy` → las 7 migraciones aplican sin error.
- `prisma migrate diff --exit-code` → **"No difference detected"**: el esquema real coincide
  con `schema.prisma`. Esto es justo lo que antes fallaba.
- `prisma/seed.mjs` → roles y usuario administrador creados.

## 3. Compilación y pruebas

| Comprobación | Resultado |
|---|---|
| `backend` `npm run build` | correcto |
| `backend` `npm test` | **153 pruebas**, y siguen siendo 153 *después* de compilar (antes se inflaban a 306) |
| `frontend` `npx tsc -b --noEmit` | sin errores |
| `frontend` `npm run lint` | sin hallazgos |
| `frontend` `npm run build` | correcto |
| `frontend` `npm test` | **124 pruebas** |

## 4. La aplicación funcionando

Backend y frontend levantados contra la base nueva, y ejercitados por HTTP:

| Operación | Resultado |
|---|---|
| `GET /health` | `{"ok":true,"database":"up"}` |
| Crear proyecto | 201 |
| Crear consultor | 201 |
| Registrar horas | 201 |
| Aprobar horas | 200, estado `APPROVED` |
| Calcular horas extra | 200, cálculo correcto (ver abajo) |
| Crear gasto | 201 |

El cálculo de horas extra es el que más código tocó R2, así que se revisó el número, no solo
el código de estado: 4 horas nocturnas × 50.000 COP × 1,75 = **350.000 COP**, con
`divisorUsed: 210`. Ese 210 es correcto: es la transición de la **Ley 2101** colombiana
(220 h → 210 h desde el 15 de julio de 2026), está en `calculateExtraHours.ts` y tiene
pruebas propias. `calculateExtraHours.ts` está **byte a byte igual** que en `main`.

## 5. Recorrido por la interfaz

Recorrido automatizado con Playwright sobre las **16 pantallas**, capturando errores de
consola, excepciones de React y respuestas HTTP ≥ 400:

- Las 16 cargan con contenido real (entre 1.200 y 7.900 caracteres de texto por pantalla).
- **Cero peticiones fallidas.**
- **Cero excepciones.**
- **Cero pantallas en blanco.**
- Modo oscuro correcto.
- A 400 px de ancho no hay desbordamiento horizontal.

Quedaron 23 capturas como evidencia.

---

## Hallazgos (los tres preexistentes, ninguno causado por estas ramas)

### A. Los montos se muestran en la moneda equivocada cuando no hay tasa FX

**Es el más grave y conviene atenderlo pronto.** En una base sin tasas cargadas, el tablero
muestra un proyecto de **100.000.000 COP** como **"US$ 100.000.000"**, y un gasto de
500.000 COP como "US$ 500.000". No convierte y tampoco avisa: solo cambia la etiqueta.

La causa es `convertAmountFallback`, que ante la falta de tasa devuelve el monto original
en vez de fallar. Es la misma raíz que el punto 19 de `DOCUMENTACION_TECNICA.md` §10, que
lo describía para la nómina; aquí se confirma que también afecta al tablero.

Un usuario que abra la aplicación antes de cargar las tasas ve cifras que parecen dólares y
son pesos: una diferencia de unas 4.000 veces. Verificado que `stats/`, `currency.ts` y
`financial.ts` están intactos respecto de `main`.

### B. Los enlaces profundos no funcionan

Entrar directamente a `http://localhost:5173/projects` (o a cualquier ruta que no sea
`/profile`) redirige siempre a `/dashboard`. La navegación por el menú sí funciona y
actualiza la URL, pero esa URL no se puede compartir ni recargar.

La causa está en el efecto de enrutamiento de `App.tsx`: mientras `authUser` es `null`
durante el arranque, cualquier ruta de pestaña se redirige a `/`, y al terminar la carga ya
se perdió el destino original. `App.tsx` está intacto respecto de `main`.

### C. Tres advertencias de React en Actividades

`fill-opacity`, `stop-color` y `stop-opacity` deberían escribirse en camelCase
(`fillOpacity`, `stopColor`, `stopOpacity`) en JSX. Son advertencias de consola, sin efecto
visible. Cosmético.

---

## Lo que esta verificación NO cubre

- **El `ErrorBoundary` no se probó con un fallo real.** Se comprobó que está montado en
  `main.tsx`, pero no se provocó una excepción de render para verlo actuar.
- **Sin datos de volumen.** Se probó con un proyecto, un consultor y unos pocos registros.
  No dice nada sobre el rendimiento de los listados sin paginar.
- **Sin probar el login real de Entra ID.** Todo corrió en modo demo, que entra como ADMIN.
  Las reglas de autorización por rol no se ejercitaron.
- **Sin probar la imagen Docker.** No hace falta para producción: Render usa
  `runtime: node`, no el Dockerfile. Los Dockerfile solo los usa `docker-compose.yml`.
- **Sin probar el despliegue real** en Render, Vercel ni Azure.

# Qué hay en cada rama

Índice de las ramas de depuración abiertas. **Ninguna está fusionada**; `main` sigue
exactamente donde está el remoto.

Cada rama trae, además, un documento propio con el detalle (`documentacion/cambios/R*.md`),
que **solo existe dentro de su rama**. Para leerlo sin cambiar de rama:

```bash
git show fix/limpieza-frontend:documentacion/cambios/R1-limpieza-frontend.md
git show fix/limpieza-backend:documentacion/cambios/R2-limpieza-backend.md
git show fix/configuracion-entorno:documentacion/cambios/R3-configuracion-entorno.md
git show docs/actualizar-manuales:documentacion/cambios/R4-actualizar-manuales.md
```

Y para ver el código de una rama: `git log -p <rama> -1`, o el Pull Request en GitHub.

---

## Orden de revisión

`chore/contexto-y-agentes` va primero: las otras cuatro salen de ella, así que si se
fusiona antes, los diffs de las demás quedan limpios.

| Rama | Qué hace | Riesgo | Cómo se verificó |
|---|---|---|---|
| `chore/contexto-y-agentes` | Contexto del proyecto, 7 agentes, scripts de entorno local, mapa de endpoints y backlog de 30 hallazgos | Nulo, no toca código de la app | No aplica |
| `fix/limpieza-frontend` | Monta `ErrorBoundary`, borra 4 archivos muertos, quita 19 clases CSS, arregla una prueba que no probaba nada y **corrige las cifras equivocadas del tablero (DEP-35)** | Bajo | eslint limpio, 124 pruebas, build correcto y verificación en navegador de los cinco indicadores |
| `fix/limpieza-backend` | Quita 10 `as any`, saca del camino de request una escritura en base que ocurría en cada petición, unifica logging, saca las pruebas del build | Bajo | 153 pruebas, servidor arrancado, endpoints 200 |
| `fix/configuracion-entorno` | Arregla el cron de FX (apuntaba a un host inexistente), el workflow de Azure, unifica Node 24, valida `DIRECT_URL` | Medio | 153 + 124 pruebas y ambos builds en Node 24 |
| `docs/actualizar-manuales` | Corrige manuales que no permitían levantar la app | Nulo | Comandos comprobados contra el repo |
| `fix/migracion-drift-idempotente` | Sale de `dev`: hace idempotente la migración de drift de Juan Espinosa | Medio | Probada en base nueva y en base con los objetos ya creados |

---

## Lo más importante de cada una

### `chore/contexto-y-agentes`

`CLAUDE.md` (contexto que se carga en cada sesión), `.claude/agents/` (7 roles),
`scripts/dev.ps1` y `scripts/db.ps1` (entorno local sin Docker, con Postgres portable),
`documentacion/MAPA_PROYECTO.md` (125 endpoints con sus roles reales, generado) y
`documentacion/BACKLOG_DEPURACION.md` (los 30 hallazgos, con evidencia archivo:línea).

### `fix/limpieza-frontend`

Lo que más cambia el comportamiento: **`ErrorBoundary` no estaba montado**, así que
cualquier error de render dejaba la pantalla en blanco. Ahora muestra un mensaje y un
botón para recargar.

Se borraron `Table.tsx` (206 líneas), `KpiCard.tsx`, `StatusBadge.tsx` y el hook
`usePermissions.ts`: ningún módulo los importaba. Quedan en el historial de git.

`tableSort.test.ts` tenía **una copia** de la lógica de orden en el propio test, así que
podía estar en verde con el código roto. Ahora importa la función real.

**Agregado después de la primera revisión (DEP-35):** el tablero mostraba "Presupuesto total
(USD)" como US$ 660.090.000 cuando el valor correcto era US$ 257.089. `DashboardTab` usaba
`initialStats` solo como valor inicial de `useState`, así que ignoraba la prop cuando llegaban
los datos y caía a un cálculo local que suma monedas distintas sin convertir. Se sincroniza
con un `useEffect`. Verificado en navegador contra la API.

### `fix/limpieza-backend`

`ensureDefaultConfigs()` escribía en la base **en cada petición** de horas extra. Ahora la
siembra ocurre al arrancar, y la corrección de divisores por país pasó a una migración de
datos. **Revisar que los valores sean los correctos**: Perú 240, Chile 180, México 240,
Ecuador 240, Argentina 200, España 160 (tomados de `defaultConfigs` del código).

El build compilaba las pruebas a `dist/`, lo que las mandaba a producción y hacía que el
conteo subiera a 306.

### `fix/configuracion-entorno`

**El cron de sincronización de tasas de cambio nunca funcionó.** Comprobado contra
producción: `app-gestion-demo.onrender.com/health` responde 200 y
`app-gestion-backend.onrender.com` no contesta en 150 segundos. El cron de `render.yaml`
apuntaba al segundo. Conviene revisar si las tasas quedaron desactualizadas.

Sobre el riesgo de Docker que se había señalado antes: **no aplica a producción**. Render
despliega el backend con `runtime: node`, no con el Dockerfile; los Dockerfile solo los usa
`docker-compose.yml`, que es una alternativa de desarrollo local. Lo único que cambia en
producción es `NODE_VERSION`, reversible en una línea.

### `docs/actualizar-manuales`

Las instrucciones de arranque mandaban a copiar archivos que no existen. El flujo de ramas
`develop` → `deploy` que describían nunca existió. Y el RAG Chat se presentaba como
asistente inteligente cuando es coincidencia de texto sin ningún modelo detrás — eso se le
muestra a clientes.

### `fix/migracion-drift-idempotente`

Sale de `dev`, no de `main`. La migración de Juan Espinosa resuelve el drift, pero aborta
con "column already exists" en una base que ya tenga los objetos creados por `db push`,
que es el caso de Supabase. Se le agregan guardas `IF NOT EXISTS`; el resultado final es
el mismo.

Advertencia: cambiar el contenido de una migración altera su checksum. Si alguien ya la
tiene aplicada en su base local, `migrate deploy` le avisará; lo más simple ahí es
recrear la base.

---

## Verificación conjunta

Las cinco ramas se integraron y se probaron juntas contra una base creada desde cero:
migraciones, compilación, 153 + 124 pruebas, la API ejercitada por HTTP y un recorrido por
las 16 pantallas con navegador real. **Sin regresiones.**

El informe completo, con lo que sí se probó y lo que no, está en
`documentacion/cambios/VERIFICACION_INTEGRACION.md`.

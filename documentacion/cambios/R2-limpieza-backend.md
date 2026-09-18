# R2 — `fix/limpieza-backend`

Rama de **limpieza pura**: no cambia ningún comportamiento observable de la API (mismos
endpoints, mismos códigos de estado, mismos cuerpos `{ data: ... }`). Cubre los ítems
**DEP-31, DEP-09, DEP-10, DEP-11, DEP-13, DEP-29 y DEP-30** de
`documentacion/BACKLOG_DEPURACION.md`.

Fecha: 2026-09-18.

---

## 1. Qué cambió, archivo por archivo

### DEP-31 — El build ya no compila las pruebas

| Archivo | Cambio | Por qué |
|---|---|---|
| `backend/tsconfig.json` | Se agregaron al `exclude`: `src/**/__tests__/**`, `src/**/*.test.ts`, `src/**/*.spec.ts`. | `dist/utils/__tests__/*.js` viajaba al servidor de producción. |
| `backend/vitest.config.ts` (**nuevo**) | `test.include = ["src/**/*.{test,spec}.ts"]` y `test.exclude = ["node_modules/**", "dist/**"]`. | El backend no tenía archivo de configuración de vitest. Con el `include` por defecto, tras un `npm run build` vitest recolectaba también las copias de `dist/` y reportaba **306** pruebas en vez de 153. Un conteo inflado esconde si algo dejó de ejecutarse. |

El archivo `vitest.config.ts` vive en la raíz de `backend/` y **no** entra en el `include`
del `tsconfig.json` (que solo mira `src/` y `prisma/`), así que no afecta al build.

### DEP-09 — `as any` innecesarios en horas extra

`backend/src/modules/extra-hours/extra-hours.routes.ts`: se eliminaron **los 10** `as any`
(líneas originales 196, 207, 210, 401, 498, 550, 584, 595, 624, 635). Existían porque el
cliente Prisma no conocía `monthlyDivisor` cuando la columna se había aplicado con
`db push`; con la migración `20260918120000_fix_schema_drift` y el cliente regenerado ya
sobran. Dos de ellos (207, 210) desaparecieron junto con el bucle de DEP-10.

**Ninguno resultó necesario**: `npx tsc --noEmit` pasa con 0 errores y el archivo ya no
contiene la cadena `as any`. El tipado real de `ExtraHoursConfigCreateInput` /
`ExtraHoursConfigUpdateInput` ahora sí valida esos objetos.

### DEP-10 — La siembra sale del camino de request

Mismo archivo:

1. `ensureDefaultConfigs()` pasó a llamarse `seedDefaultConfigs()` (la función real) y se
   agregó un envoltorio `ensureDefaultConfigs()` que **memoriza la promesa**: la siembra
   corre **una sola vez por proceso**. Si falla, se libera la memoria para que el siguiente
   intento vuelva a ejecutarla (no se queda "envenenada").
2. Se **eliminó del camino de request** el bucle de corrección puntual que reescribía
   `monthlyDivisor` cuando valía 220. Se movió a dos sitios:
   - `backend/prisma/migrations/20260918130000_fix_extra_hours_monthly_divisor/migration.sql`
     (**nueva migración de datos**, solo `UPDATE`, sin DDL): corrige Peru 240, Chile 180,
     Mexico 240, Ecuador 240, Argentina 200, España 160, **y solo si la fila sigue con el
     220 heredado del `DEFAULT` de la columna** — no pisa un valor ajustado a mano por un
     administrador.
   - `backend/prisma/seed.mjs`: la misma corrección, idempotente, para bases nuevas.
3. `backend/src/server.ts`: se dispara `ensureDefaultConfigs()` al arrancar
   (`void ... .catch(...)`, igual que los otros dos jobs de arranque), de modo que en un
   servidor vivo la siembra ya está hecha antes de la primera petición.

**Las llamadas `await ensureDefaultConfigs()` siguen en los endpoints** (POST `/`,
POST `/calculate`, GET `/config`, GET `/config/:country`). Es deliberado: ahora son
gratuitas (devuelven la promesa ya resuelta) y garantizan que **un país sin configuración
siga comportándose igual** aunque la siembra de arranque no haya terminado todavía. Los
fallbacks existentes (buscar `Default`, y si tampoco existe usar la configuración
hardcodeada en el handler) **no se tocaron**.

Lo que **sí sigue dentro** de `seedDefaultConfigs()` (pero ahora una sola vez por proceso,
no por request): la normalización de países heredados `USA`/`Estados Unidos` → `Default`
en `User`, `Consultant` y `CustomHoliday`, y el arreglo de `diurnalEnd = "24:00:00"`.
No se movieron a la migración para no cambiar el comportamiento de datos que puedan
seguir llegando con esos valores; queda anotado como candidato del próximo barrido.

### DEP-11 — Script de diagnóstico borrado

- Borrado `backend/scripts/test-connection.mjs` (host del pooler de Supabase incrustado).
- Verificado antes de borrar: **ningún script de `package.json`, ningún import y ningún
  workflow lo referencia**. Las únicas menciones eran documentales, y se actualizaron:
  - `CLAUDE.md` §2 (listado de `backend/scripts/`).
  - `documentacion/DOCUMENTACION_TECNICA.md` §3.2 (tabla de carpetas) y §6.8 (tabla de
    scripts operativos, fila eliminada).

### DEP-13 — `prisma` (CLI) a `devDependencies`

`backend/package.json`: `prisma` se movió de `dependencies` a `devDependencies`.
`@prisma/client` (lo único que se usa en runtime) **sigue en `dependencies`**.

Verificación de que el build sigue funcionando:

- `npm run build` ejecuta `prisma generate` y funciona (salida real más abajo).
- **Render** (`render.yaml`): `buildCommand: npm install --include=dev && npm run build`
  → instala devDependencies, así que el CLI está disponible en build.
  `startCommand: npm run start` = `node dist/server.js` → no usa el CLI en runtime. **OK.**
- **Dockerfile del backend**: la etapa `base` usa `npm ci` (con dev) antes de
  `npm run build` → **OK**.

⚠ **Riesgo detectado, ver §4**: `docker-compose.yml` arranca el contenedor con
`npx prisma migrate deploy`, y la etapa `runner` del Dockerfile instala con
`npm ci --only=production`. Ahí el CLI ya no quedará instalado.

### DEP-29 / DEP-30 — Logging unificado

| Archivo | Cambio |
|---|---|
| `backend/src/infra/logger.ts` (**nuevo**) | Registro de logger de proceso: `setAppLogger(app.log)` + `getLogger()`. Si no hay instancia de Fastify (seeds, scripts sueltos) cae a `console`, que es exactamente lo que había antes. Sin dependencias nuevas: solo una interfaz `AppLogger` que el logger de Fastify satisface estructuralmente. |
| `backend/src/app.ts` | `setAppLogger(app.log)` justo tras crear la instancia. |
| `backend/src/auth/guard.ts:95` | **DEP-29**: `console.error("DEBUG: Token verification failed:", err)` → `request.log.warn({ reason: err.name }, "Token de Microsoft rechazado")`. **No se vuelca el error crudo** (ni mensaje ni stack): solo el nombre de la clase de error. |
| `backend/src/utils/notifications.ts` | 9 `console.log`/`console.error` → `getLogger()`. El bloque "SMTP MOCK" de 7 líneas con separadores `=====` pasó a **una sola entrada estructurada** con `{ from, to, subject, text }`. |
| `backend/src/modules/alerts/alerts.service.ts` | 1 `console.log` → `getLogger().info(...)`. |
| `backend/src/modules/assignments/assignments.job.ts` | 1 `console.log` con interpolación → `getLogger().info({ activated, completed }, ...)`. |

Dos cambios **fuera del alcance literal del backlog**, en la misma línea y anotados aquí
por transparencia (ninguno cambia una respuesta HTTP):

- `backend/src/auth/guard.ts:268`: `console.error("Failed to run JIT consultant sync…")` →
  `request.log.error({ err }, …)`. Mismo archivo y mismo camino de autenticación que DEP-29.
- `backend/src/app.ts:53`: `console.error("Zod Validation Error:", …)` →
  `app.log.warn({ issues }, "Error de validación Zod")`. El cuerpo 400 que recibe el
  cliente es idéntico; solo cambia dónde se escribe el log.

---

## 2. Cómo se verificó (salida real, desde `backend/`)

```
$ npx tsc --noEmit
EXIT=0
```

(sin salida: 0 errores de tipos, ya sin ningún `as any` en `extra-hours.routes.ts`)

```
$ npm run build

> backend@1.0.0 build
> npm run prisma:generate && tsc -p tsconfig.json


> backend@1.0.0 prisma:generate
> prisma generate

Environment variables loaded from .env
Prisma schema loaded from prisma\schema.prisma

✔ Generated Prisma Client (v6.19.3) to .\node_modules\@prisma\client in 134ms

EXIT=0
```

```
$ npm test

> backend@1.0.0 test
> vitest run


 RUN  v4.1.4 C:/Users/JuanMahecha/Synatrack/Synatrack/backend


 Test Files  7 passed (7)
      Tests  153 passed (153)
   Start at  18:25:13
   Duration  488ms (transform 617ms, setup 0ms, import 948ms, tests 81ms, environment 1ms)

EXIT=0
```

```
$ find dist -name "__tests__" -o -name "*.test.js"
(sin coincidencias)
```

Además se comprobó explícitamente que el `exclude` de vitest funciona y no es un accidente
del `dist/` limpio: se creó a mano un `dist/utils/__tests__/fake.test.js` con una prueba
trivial, se corrió `npm test` y siguió reportando **153 passed (153)** — la prueba fantasma
no se recolectó. El archivo se borró después.

Orden real de ejecución: `npm run build` **antes** de `npm test`, que es el escenario que
producía las 306 pruebas.

**Lo que no se pudo verificar en esta máquina**: no se ejecutó la nueva migración de datos
contra una base real (requiere levantar el Postgres local y no forma parte de esta rama de
limpieza). El SQL es solo `UPDATE ... WHERE country = ? AND "monthlyDivisor" = 220`, sin DDL,
y es idempotente.

---

## 3. Qué NO se tocó, y por qué

- **El error handler global sigue devolviendo `detail` y `stack` al cliente**
  (`src/app.ts`). Es el hallazgo §10.2 de la doc técnica y **arreglarlo cambia el cuerpo de
  las respuestas 500**, es decir, comportamiento observable. No pertenece a esta rama.
- **`SMTP_FROM` con dominio `.cc`** (DEP-22): requiere confirmar cuál es el dominio correcto
  con el cliente; no es limpieza mecánica.
- **`rejectUnauthorized: false` y `ciphers: "SSLv3"`** en `notifications.ts`: es un hallazgo
  de seguridad, no de limpieza, y tocarlo puede romper el envío real de correo.
- **Los `console.error` de notificación en `extra-hours.routes.ts` y `feedback.routes.ts`**
  (5 en total, dentro de `catch` de envíos de correo): están en handlers que **sí tienen
  `request` a mano** y convertirlos es trivial, pero el backlog (DEP-30) enumera solo tres
  archivos. Se dejaron para no ensanchar el diff; quedan anotados como pendiente.
- **`console.error` de `src/config/env.ts`**: corre **antes** de que exista la instancia de
  Fastify (validación de entorno al importar el módulo). Ahí `console` es lo correcto; no
  hay forma limpia de usar el logger de la app.
- **La normalización `USA` → `Default`** dentro de la siembra: mover eso a la migración
  cambiaría qué pasa con datos nuevos que lleguen con esos valores. Se dejó donde estaba,
  ahora ejecutándose una sola vez por proceso.
- **Las llamadas `ensureDefaultConfigs()` en los endpoints**: se conservaron a propósito
  (ver DEP-10 arriba) para no alterar el comportamiento de un país sin configuración.
- **`docker-compose.yml` y el `Dockerfile`**: ver el riesgo de abajo. Cambiarlos es tocar
  despliegue, no limpieza.

---

## 4. Riesgos para el merge

1. **`docker-compose` + `prisma` en devDependencies (consecuencia de DEP-13).**
   `docker-compose.yml` arranca el backend con
   `sh -c "npx prisma migrate deploy && npm run start"`, y la etapa `runner` del
   `backend/Dockerfile` instala con `npm ci --only=production`. Con `prisma` fuera de
   `dependencies`, en ese contenedor `npx` intentará **descargar el CLI en tiempo de
   arranque** (y fallará si no hay red). **Render no se ve afectado** (usa
   `npm install --include=dev` para construir y `node dist/server.js` para arrancar), y
   el entorno local de esta máquina no usa Docker. Arreglo sugerido, en la rama de
   despliegue: mover el `migrate deploy` a un paso de build/release, o instalar con
   `npm ci` en el `runner`. **Si alguien depende del camino Docker hoy, revertir DEP-13 es
   un cambio de una línea.**
2. **La migración de datos hay que aplicarla.** `20260918130000_fix_extra_hours_monthly_divisor`
   está sin aplicar en local y en Supabase/producción. Mientras no se aplique, en una base
   donde el bucle viejo nunca llegó a correr, los divisores de Peru/Chile/Mexico/Ecuador/
   Argentina/España seguirán en 220 — antes se corregían solos en la primera petición.
   **Este es el único punto donde el comportamiento puede diferir**, y es exactamente el
   motivo por el que la corrección debía ser una migración: `prisma migrate deploy`.
   Recordar además que la migración previa `20260918120000_fix_schema_drift` **tampoco está
   aplicada en producción** (ver `CLAUDE.md` §7).
3. **Siembra memorizada por proceso.** Si alguien borra una fila de `ExtraHoursConfig` con
   el servidor corriendo, ya no se recreará hasta reiniciar. Los fallbacks del módulo
   (`Default` y la configuración hardcodeada) siguen cubriendo ese caso sin error, así que
   la API responde igual, pero conviene saberlo.
4. **Formato de logs.** Los logs de SMTP/Teams/alertas/jobs pasan de texto plano a JSON de
   pino. Si alguien tiene una alerta o un grep sobre esas cadenas en Render, hay que
   reajustarla. El prefijo (`[SMTP]`, `[TEAMS]`, `[AlertEngine]`, `[AssignmentJob]`) se
   conservó dentro del mensaje para que siga siendo buscable.
5. **`vitest.config.ts` es nuevo**: si en el futuro se agregan pruebas fuera de `src/`,
   hay que ampliar el `include` o no se ejecutarán. El conteo esperado es **153**; que
   suba a 306 vuelve a ser señal de que el `exclude` de `dist/` se rompió.

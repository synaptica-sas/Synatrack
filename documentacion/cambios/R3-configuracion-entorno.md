# R3 — `fix/configuracion-entorno`

Rama de **configuración de build y despliegue**. No cambia código de negocio ni
comportamiento de la API (la única línea de `src/` que se toca es el schema Zod de
variables de entorno, y se toca para validar más, no para cambiar lógica).

Cubre: **DEP-19**, **DEP-20**, **DEP-21**, **DEP-23** y **DEP-24** del
`BACKLOG_DEPURACION.md`.

Base: `main` @ `237a596` · Fecha: 2026-09-18 · Sin commit ni push (regla 4 del
`PLAN_DE_RAMAS.md`).

---

## 1. Qué se cambió, archivo por archivo

### `render.yaml` (DEP-20, DEP-21, DEP-24)

| Cambio | Antes | Después |
|---|---|---|
| Host del cron de FX | `https://app-gestion-backend.onrender.com/api/fx/sync` | `https://app-gestion-demo.onrender.com/api/fx/sync` |
| `NODE_VERSION` | `20.19.0` | `24.13.0` |
| `buildCommand` | `npm install --include=dev && npm run build` | `npm ci --include=dev && npm run build` |
| `name:` del Web Service | `app-gestion-backend` | **sin cambios**, con un comentario que explica la discrepancia |

**Por qué el host.** Verificado contra producción: `app-gestion-demo.onrender.com/health`
responde **200** y `app-gestion-backend.onrender.com` no existe (150 s sin respuesta). El
cron diario de tasas de cambio hacía `curl` contra ese host muerto, así que **la
sincronización de FX nunca llegó a ejecutarse**. El `curl -sf` falla en silencio, que es por
lo que el problema pasó desapercibido.

**Por qué NO se cambió `name:`.** Es la decisión más discutible de la rama, así que queda
argumentada:

- En Render el subdominio `*.onrender.com` se asigna **al crear** el servicio y **no cambia**
  si después se renombra. Que la URL real sea `app-gestion-demo` y el `name` diga
  `app-gestion-backend` es perfectamente compatible con un servicio creado como
  `app-gestion-demo` y renombrado luego. Es decir: el `name` actual puede ser el correcto y
  la URL simplemente es histórica.
- En un blueprint, `name` es la **identidad** del servicio. Cambiarlo hace que el próximo
  "Blueprint sync" trate la entrada como un servicio nuevo: crea otro servicio, con otra URL,
  sin ninguna de las env vars marcadas `sync: false` (que son todas las secretas), y deja el
  actual huérfano.
- El riesgo de tocarlo es producción caída; el beneficio es cosmético. Se deja un comentario
  en el YAML explicando la discrepancia y qué habría que hacer si se quiere alinear
  (hacerlo desde el dashboard de Render, verificando que la URL pública siga siendo
  `app-gestion-demo.onrender.com`).

**Por qué `npm ci --include=dev`.** `npm ci` respeta el lockfile (instala exactamente lo
fijado) mientras `npm install` puede resolver versiones nuevas dentro del rango `^`. El
`--include=dev` es imprescindible aquí porque el servicio declara `NODE_ENV=production`, con
lo que npm omitiría las `devDependencies`, y el build las necesita (`typescript`,
`@types/node`).

### `.github/workflows/azure-static-web-apps-victorious-glacier-0d52b010f.yml` (DEP-19)

- `output_location: "build"` → `"dist"`. Vite emite en `dist/`; con `build` la acción no
  encontraba artefactos y el despliegue no publicaba nada útil.
- Se agregan, **antes** del paso de despliegue, pasos de verificación sobre `./frontend`:
  `actions/setup-node@v4` (versión tomada de `frontend/.nvmrc`, con caché de npm), `npm ci`,
  `npx tsc -b --noEmit`, `npm test` y `npm run build`. Si cualquiera falla, el job se corta y
  el push roto no llega a producción.
- Se conserva la estructura original del workflow: los pasos de OIDC, el
  `Azure/static-web-apps-deploy@v1` y el `close_pull_request_job` quedan intactos.

**Detalle que importa:** el type check es `npx tsc -b --noEmit`, **no** `npx tsc --noEmit`.
El `tsconfig.json` raíz del frontend es solo un archivo de referencias (`"files": []`), así
que `npx tsc --noEmit` sale con código 0 **sin revisar un solo archivo** — sería un control
de calidad falso. Está comprobado abajo, en §2.

**Lo que NO se hizo:** no se puso `skip_app_build: true`. Eso significa que Oryx (el builder
de la acción de SWA) vuelve a compilar el frontend por su cuenta después de nuestros pasos,
o sea que se compila dos veces (~1 min extra). Se eligió a propósito: activar
`skip_app_build` cambia el contrato de la acción y no se puede probar desde local; con la
configuración actual el despliegue se comporta igual que antes y nuestros pasos actúan solo
como puerta de calidad. Quitar el doble build es un cambio posterior que hay que validar
viendo correr el workflow.

### `backend/.nvmrc`, `frontend/.nvmrc`, `backend/Dockerfile`, `frontend/Dockerfile` (DEP-21)

- Ambos `.nvmrc`: `20.19.0` → `24.13.0` (la versión que corre la máquina local).
- `FROM node:20-slim` → `FROM node:24-slim` en las **dos etapas** (`base` y `runner`) de cada
  Dockerfile.
- Los `engines` de ambos `package.json` ya pedían `24.x` y **no se tocaron**.

Con esto quedan alineados los sitios que menciona DEP-21: `.nvmrc` ×2, Dockerfiles ×2,
`render.yaml` y `engines` ×2.

### `backend/src/config/env.ts` (DEP-23)

Se agrega `DIRECT_URL` al schema Zod, **como opcional** y con validación de forma:

```ts
DIRECT_URL: z
  .string()
  .url("DIRECT_URL debe ser una URL de conexión válida (postgresql://...)")
  .refine((value) => value.startsWith("postgres://") || value.startsWith("postgresql://"), {
    message: "DIRECT_URL debe empezar por postgres:// o postgresql://",
  })
  .optional(),
```

**Justificación de opcional vs. obligatoria.** `DIRECT_URL` la consume **Prisma** (es el
`directUrl` del `datasource` en `schema.prisma`) para migraciones; el runtime de la API solo
necesita `DATABASE_URL`. Hay entornos legítimos donde no está definida: desarrollo local
contra el Postgres portable, `docker-compose`, CI. Si se declarara obligatoria, el servidor
**no arrancaría** en todos esos entornos. Y peor: en producción `DIRECT_URL` está marcada
`sync: false` en `render.yaml`, o sea que su valor se pone a mano en el dashboard; si alguien
la borra o la olvida al recrear el servicio, el arranque se cae por una variable que el
runtime ni siquiera usa. Cambiar un fallo diferido en la migración por un fallo total al
arrancar no es una mejora.

Lo que sí se gana: **si está presente, se valida su forma al arrancar**. Ese era el problema
real de DEP-23 — una URL mal escrita que solo se descubría al correr `prisma migrate`.

### `documentacion/DEPLOYMENT.md` (DEP-24)

Las dos menciones al build de Render (línea 29 en la lista de trabajo y la fila
`Build Command` de la tabla de configuración manual) pasan de `npm ci && npm run build` a
`npm ci --include=dev && npm run build`, idénticas a `render.yaml`.

Los otros `npm ci` del documento se dejaron como están a propósito: son pasos locales y el
Install Command de Vercel, donde `NODE_ENV` no es `production` y npm ya instala las
devDependencies por defecto.

### Lo que explícitamente NO se tocó

- **`frontend/vercel.json`**: está correcto (ya apunta a `app-gestion-demo.onrender.com`).
- **`engines`** de los dos `package.json`: ya pedían `24.x`.
- **`name:`** del Web Service en `render.yaml` (ver arriba).
- Cualquier código de negocio.

---

## 2. Verificación local (salida real)

Node de la máquina: `v24.13.0`.

### Backend (`backend/`)

```
$ npx tsc --noEmit
TSC_EXIT=0        (sin salida, sin errores)
```

```
$ npm test

> backend@1.0.0 test
> vitest run

 RUN  v4.1.4 C:/Users/JuanMahecha/Synatrack/Synatrack/backend

 Test Files  7 passed (7)
      Tests  153 passed (153)
   Start at  18:32:32
   Duration  496ms
```

**153 pruebas**, el número esperado por el `PLAN_DE_RAMAS.md`. (Nota: se corrió `npm test`
**antes** de `npm run build`. Por DEP-31, tras un build vitest también recolecta las copias
compiladas en `dist/` y reporta 306; eso es un problema abierto de la rama R2, no de esta.)

```
$ npm run build

> backend@1.0.0 build
> npm run prisma:generate && tsc -p tsconfig.json

> backend@1.0.0 prisma:generate
> prisma generate

✔ Generated Prisma Client (v6.19.3) to .\node_modules\@prisma\client in 176ms

BUILD_EXIT=0
```

```
$ npm ci --dry-run
up to date in 615ms
ci_dryrun_exit=0
```

Esto es exactamente el chequeo que hace `npm ci` antes de instalar: si `package.json` y
`package-lock.json` estuvieran desfasados, abortaría con
*"can only install packages when your package.json and package-lock.json are in sync"*.
Salió 0 → **el lockfile del backend está en sync** y `npm ci --include=dev` no va a fallar en
Render por esa razón. No se borró `node_modules` para comprobarlo (habría dejado el entorno
local sin poder correr nada más).

### Comportamiento de `DIRECT_URL` (DEP-23)

Ejecutado contra el `dist/config/env.js` recién compilado:

```
$ DIRECT_URL="no-es-una-url" node -e "import('./dist/config/env.js')"
Invalid environment variables {
  DIRECT_URL: [
    'DIRECT_URL debe ser una URL de conexión válida (postgresql://...)',
    'DIRECT_URL debe empezar por postgres:// o postgresql://'
  ]
}

$ DIRECT_URL="postgresql://u:p@localhost:5432/db" node -e "import('./dist/config/env.js')"
OK URL valida aceptada

$ (desde un directorio sin .env, solo con DATABASE_URL definida)
Arranca SIN DIRECT_URL. env.DIRECT_URL = undefined
```

Los tres casos se comportan como se diseñó: falla si está mal, pasa si está bien, arranca si
no está.

### Frontend (`frontend/`)

```
$ npm test

> frontend@0.0.0 test
> vitest run

 RUN  v4.1.4 C:/Users/JuanMahecha/Synatrack/Synatrack/frontend

 Test Files  10 passed (10)
      Tests  124 passed (124)
   Start at  18:33:10
   Duration  4.36s
```

**124 pruebas**, el número esperado.

```
$ npm run build
✓ 436 modules transformed.
dist/index.html                                   0.75 kB │ gzip:   0.38 kB
dist/assets/index-MiEhnlPC.css                   55.01 kB │ gzip:  11.15 kB
dist/assets/vendor-html2canvas-Chk-pIsO.js      199.57 kB │ gzip:  46.78 kB
dist/assets/vendor-xlsx-tiJZro4e.js             282.80 kB │ gzip:  94.22 kB
dist/assets/vendor-jspdf-DR6MGjM-.js            357.58 kB │ gzip: 116.11 kB
dist/assets/index-Xhu1Z8c_.js                   554.00 kB │ gzip: 119.83 kB
dist/assets/vendor-vRg_Lqqw.js                  660.41 kB │ gzip: 196.76 kB
✓ built in 399ms
```

La salida confirma lo que motiva DEP-19: **el directorio de salida es `dist/`**.

```
$ npm ci --dry-run
up to date in 980ms
(exit 0 → lockfile del frontend en sync; es el que usará el `npm ci` del workflow)
```

### Comprobación de que el type check del workflow sirve de algo

Se metió a propósito un error de tipos (`export const x: number = "roto";`) en
`frontend/src/__tsc_probe.ts` y se corrieron los dos comandos:

```
$ npx tsc --noEmit          # tsconfig raíz, "files": []
exit=0   ← NO detecta el error

$ npx tsc -b --noEmit
src/__tsc_probe.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'.
exit=2   ← lo detecta
```

El archivo de prueba se borró después (`git status` queda limpio salvo los archivos de esta
rama). Por eso el workflow usa `-b`.

---

## 3. Qué NO se pudo verificar

Todo lo que depende de infraestructura de terceros. Es la parte importante de este documento
para quien revise:

1. **El cron de FX corriendo de verdad.** Se verificó que `app-gestion-demo.onrender.com`
   existe y que `/health` responde 200, pero **no** que `POST /api/fx/sync` con el
   `FX_SYNC_TOKEN` real devuelva 2xx. Hay que confirmarlo tras el despliegue: mirar los logs
   del cron en Render al día siguiente, o dispararlo a mano desde el dashboard.
2. **Que el blueprint de Render aplique limpio.** No se ejecutó ningún "Blueprint sync". El
   comentario original del YAML ya advertía que la sintaxis del cron job puede no aplicarse
   sola y que quizá haya que crearlo a mano en el dashboard; esa advertencia sigue vigente.
3. **Que `npm ci --include=dev` funcione en el entorno de Render** (Node 24,
   `NODE_ENV=production`, caché de Render). Local dice que el lockfile está en sync, que es
   la causa habitual de fallo, pero el build real no se corrió.
4. **Node 24 en producción.** Verificado en local (24.13.0: compilan y pasan backend y
   frontend) y en `engines`. **No** verificado en el runtime de Render ni en las imágenes
   `node:24-slim` — no se construyó ningún Docker. En particular, `node:24-slim` es Debian
   trixie mientras `node:20-slim` era bookworm; el `openssl` que instala el Dockerfile del
   backend para Prisma cambia de versión. Prisma 6 soporta OpenSSL 3.x, así que se espera que
   funcione, pero **hay que construir la imagen una vez antes de confiar en ella**.
5. **El workflow de Azure.** No se ejecutó: solo corre en push a `main` y esta rama no se
   empujó. Sin verificar: que `output_location: "dist"` publique correctamente, que Oryx no
   choque con nuestro build previo, y que la caché de `actions/setup-node` con
   `node-version-file` resuelva bien `24.13.0`.
6. **Si las tasas FX en producción están desactualizadas** por todo el tiempo en que el cron
   no funcionó. Es una consecuencia de datos de DEP-20 que esta rama no toca; hay que
   revisarla aparte (probablemente ejecutando la sincronización a mano una vez).

---

## 4. Riesgos del merge

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Node 24 rompe algo en el runtime de Render o en `node:24-slim` (OpenSSL/Prisma) | Baja | **Alto** (servicio caído) | Desplegar con el ojo puesto en el log de arranque; revertir `NODE_VERSION` a `20.19.0` es un cambio de una línea. Idealmente construir `backend/Dockerfile` una vez antes de mergear. |
| `npm ci --include=dev` falla en Render si el lockfile se desfasa en el futuro | Baja | Medio (build rojo, no caída) | El fallo es en build, no en producción; el servicio viejo sigue vivo. Es justo la ventaja de `ci` sobre `install`: falla ruidoso en vez de instalar otras versiones en silencio. |
| El workflow de Azure se vuelve más lento o falla por los pasos nuevos | Media | Bajo | Si falla, falla el despliegue a SWA, que **hoy no publica nada útil de todos modos**. Vercel es independiente y no se toca. |
| Oryx y nuestro build se pisan (doble compilación) | Media | Bajo | Solo cuesta tiempo. Si molesta, la solución es `skip_app_build: true`, verificándolo con el workflow en ejecución. |
| El `name` desalineado en `render.yaml` confunde a la próxima persona | Alta | Bajo | Mitigado con el comentario en el YAML y con esta sección. |
| La validación de `DIRECT_URL` tumba un arranque que antes funcionaba | Muy baja | Medio | Solo ocurre si el valor **existente** en producción no es una URL postgres válida — en cuyo caso las migraciones ya estaban rotas. Conviene mirar el valor en el dashboard de Render antes de desplegar. |

**Orden de despliegue sugerido:** mergear, desplegar el backend a Render y confirmar
`/health` 200 con Node 24 **antes** de dar por buena la rama. El cron de FX se puede validar
a mano el mismo día en vez de esperar a las 13:00 UTC.

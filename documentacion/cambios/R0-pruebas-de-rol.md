# R0 — Simulador de rol y primeras pruebas de ruta

Rama: `feat/pruebas-de-rol` (sale de `dev`). Sin commits: los cambios quedan en el árbol de trabajo.

## Por qué

Dos huecos hacían imposible verificar el comportamiento por rol:

1. En local, `AUTH_DEMO_BYPASS=true` hacía que `authenticate` inyectara **siempre** un `ADMIN`.
   Cualquier falla de autorización quedaba invisible.
2. Las 153 pruebas del backend eran todas de funciones puras (`src/utils/__tests__/`).
   **Ninguna** ejercitaba una ruta, `authenticate` ni `authorize`.

Esto es andamiaje, no arreglos: aquí **no se corrige ninguna falla de seguridad**. Al contrario,
dos de ellas quedan documentadas con pruebas que afirman el comportamiento actual (defectuoso).

## Qué se construyó

### 1. Simulador de rol para desarrollo

`backend/src/config/env.ts` — tres variables nuevas, validadas con Zod:

| Variable | Tipo | Por defecto |
|---|---|---|
| `AUTH_DEV_EMAIL` | correo | `ADMIN_EMAIL` |
| `AUTH_DEV_ROLES` | lista separada por coma, validada contra el enum `AppRole` de Prisma | `ADMIN` |
| `AUTH_DEV_ROLE_HEADER` | booleano | `false` |

`backend/src/auth/guard.ts` — `resolveDemoIdentity()` se consulta **solo dentro de la rama de
bypass** de `authenticate`. Sin ninguna variable definida, la identidad resultante es idéntica a
la de antes (`id: "local-admin"`, `displayName: "Local Admin"`, rol `ADMIN`, correo `ADMIN_EMAIL`),
así que nadie que no opte por el simulador nota diferencia alguna. Cuando sí se simula, el `id`
pasa a `local-sim:<correo>` para que sea evidente en logs y auditoría que no es una sesión real.

Documentado en `backend/.env.example` y `documentacion/DESARROLLO_LOCAL.md` §1.

### 2. Pruebas de ruta

- `backend/vitest.routes.config.ts` — configuración aparte.
- `backend/tests/setup/test-database.ts` — datos de conexión de la base de pruebas.
- `backend/tests/setup/global-setup.ts` — comprueba Postgres, crea `synatrack_test` si falta y
  corre `prisma migrate deploy`.
- `backend/tests/helpers/app.ts` — `crearAppDePrueba()` y `comoRol()`.
- `backend/tests/helpers/datos.ts` — escenario (1 proyecto + 2 consultores) y su limpieza.
- `backend/tests/routes/` — 4 archivos, 12 pruebas.

## Decisiones y por qué

### Sí al encabezado HTTP, con tres cerrojos

Se añadieron `x-dev-email` y `x-dev-roles`. El razonamiento:

- **A favor**: sin encabezado, cambiar de rol obliga a editar `.env` y reiniciar el backend.
  Esa fricción es justo lo que hace que nadie pruebe los roles — el problema que veníamos a
  resolver. Y para las pruebas de ruta es lo que permite ejercitar ADMIN y CONSULTANT en el
  mismo proceso, sin levantar una app por combinación de roles.
- **El riesgo**: un encabezado que otorga rol es, literalmente, autenticación por encabezado.
  Si alguna vez llegara a estar vivo en un entorno expuesto, cualquiera sería ADMIN.
- **La mitigación**: tres condiciones independientes, y las tres tienen que cumplirse.
  1. El bypass de demo ya activo (`!AUTH_ENABLED || AUTH_DEMO_BYPASS`). El código ni siquiera
     se alcanza fuera de esa rama de `authenticate`.
  2. `AUTH_DEV_ROLE_HEADER=true`, **opt-in explícito**, por defecto `false`. La exigencia
     mínima era solo bypass + `NODE_ENV`; este tercer cerrojo se agregó de más porque el
     bypass sí está activo en entornos de demo desplegados, donde `NODE_ENV` podría no ser
     `production`.
  3. `NODE_ENV !== "production"`.

  Con autenticación real, el peor caso es que alguien mande `x-dev-roles: ADMIN` y reciba un
  401; hay una prueba que lo fija (`auth-requerida.test.ts`).

### Pruebas separadas por configuración, no por proyectos de vitest

`npm test` sigue siendo `vitest run` con `vitest.config.ts`, cuyo `include` es `src/**`. Las
pruebas de ruta viven **fuera de `src/`**, en `backend/tests/`, y se corren con
`npm run test:routes` (`--config vitest.routes.config.ts`).

- Es la separación **más difícil de romper por accidente**: aunque alguien amplíe el `include`
  de las pruebas de ruta, `npm test` no las recoge porque ni siquiera están bajo `src/`.
- Se consideró `projects` de vitest (un solo comando, dos suites). Se descartó: mezcla en una
  misma corrida pruebas de milisegundos con pruebas que necesitan Postgres, y un fallo de
  infraestructura ensuciaría la señal de la suite unitaria, que hoy corre en <1 s y sin
  dependencias externas.
- Consecuencia: el conteo queda limpio y distinguible — **153 unitarias** + **12 de ruta**.

### Base de datos dedicada

`synatrack_test` en el mismo Postgres portable de `localhost:5433`. El `globalSetup`:

1. Rechaza de entrada cualquier URL que contenga `app_gestion_demo` (cerrojo explícito).
2. Comprueba el puerto con un socket antes de nada; si no responde, lanza un error con las
   instrucciones de `.\scripts\db.ps1 start`. **Las pruebas no se saltan en silencio**:
   `vitest` termina con código 1.
3. Crea la base con `CREATE DATABASE` vía `$executeRawUnsafe` contra la base de mantenimiento
   `postgres` (tolerando `42P04`, que ya exista).
4. Corre `prisma migrate deploy`, invocando el CLI por su entrypoint de Node
   (`node_modules/prisma/build/index.js`) en vez de `npx`: en Windows, Node ≥20 exige
   `shell: true` para ejecutar `npx.cmd`, y eso complica el escapado.

Los datos de cada archivo se crean con un prefijo único y se borran en `afterAll`, así que no
dependen del estado previo de la base ni entre sí. `fileParallelism: false` porque comparten base.

## Qué cubren las 12 pruebas

| Archivo | Cubre |
|---|---|
| `authorize.test.ts` | `GET /api/admin/users`: 403 con CONSULTANT, 200 con ADMIN, 200 sin encabezados (identidad histórica), 400 con un rol inexistente |
| `auth-requerida.test.ts` | Con `AUTH_ENABLED=true` y sin bypass: 401 sin token, 401 con bearer inválido, 401 aunque se manden `x-dev-roles`/`x-dev-email` |
| `extra-hours-alcance.test.ts` | **Patrón correcto**: un CONSULTANT solo ve sus horas extra; un ADMIN las ve todas |
| `time-entries-defectos-conocidos.test.ts` | **Defectos conocidos**, documentados tal como se comportan hoy |

`auth-requerida.test.ts` usa `vi.stubEnv` + `vi.resetModules()` antes de importar la app: `env`
se congela al importar `src/config/env.ts`, así que hay que reconstruir el grafo de módulos.

## Defectos documentados (NO arreglados aquí)

`backend/tests/routes/time-entries-defectos-conocidos.test.ts` — las tres pruebas afirman el
comportamiento **actual**, que es inseguro. El nombre de cada una empieza por `DEFECTO:` y el
archivo abre con un comentario que dice explícitamente que **deben invertirse** cuando se
arregle en la otra rama:

1. `GET /api/time-entries` devuelve a un CONSULTANT también las horas de otros consultores.
   → Debería devolver solo las suyas, como hace `extra-hours`.
2. Ese mismo endpoint incluye `consultant.hourlyRate` de toda la plantilla (la prueba verifica
   que la tarifa de 999 de otro consultor llega al cliente).
   → No debería exponer tarifas ajenas.
3. `POST /api/time-entries` acepta el `consultantId` de otro consultor (suplantación).
   → Debería responder 403 si el `consultantId` no es el del usuario autenticado.

## Verificación

```
$ npx tsc --noEmit
(sin salida, exit 0)

$ npm test
 Test Files  7 passed (7)
      Tests  153 passed (153)

$ npm run test:routes
 Test Files  4 passed (4)
      Tests  12 passed (12)
```

## Riesgos que quedan

- **El encabezado es un mecanismo peligroso por naturaleza.** Los tres cerrojos lo contienen,
  pero basta con que alguien ponga `AUTH_DEV_ROLE_HEADER=true` en un despliegue de demo (donde
  el bypass está activo y `NODE_ENV` podría no ser `production`) para abrir un ADMIN público.
  Mitigación pendiente: que `server.ts` registre un `warn` bien visible al arrancar si el
  encabezado quedó habilitado.
- **Las pruebas de `tests/` no pasan por `npx tsc --noEmit`.** El `tsconfig.json` tiene
  `rootDir: "src"` e ignora las pruebas (ya lo hacía con las unitarias). Los errores de tipo en
  ellas los detecta vitest al transpilar, no el type-check. Un `tsconfig.tests.json` aparte lo
  resolvería; no se hizo para no tocar el build.
- **`synatrack_test` es persistente**: se crea una vez y se reutiliza. Las pruebas limpian lo
  suyo, pero un fallo a mitad de camino puede dejar filas huérfanas. Borrarla y dejar que se
  recree es seguro (`dropdb synatrack_test`).
- **Cobertura mínima**: 4 de los 125 endpoints. Queda por cubrir el resto de rutas con filtrado
  por rol (`activities`, `expenses`, `profile`, `stats`) y el resto de la matriz de roles.
- **El `id` simulado (`local-sim:<correo>`) no corresponde a ningún `User` real.** Si alguna
  ruta llegara a usar `authUser.id` como clave foránea, fallaría en modo simulación. Hoy el
  filtrado se hace por correo, así que no ocurre, pero es una trampa a tener presente.

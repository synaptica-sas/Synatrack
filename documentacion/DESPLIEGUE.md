# Guía de despliegue de `dev` a producción

Pasos para llevar a producción los cambios acumulados en `dev`. **Todos los comandos de
este documento se ensayaron contra una base limpia local** antes de escribirlos.

**Contexto:** `dev` va 35+ commits por delante de `main`. Producción sigue en el estado de
principios de septiembre.

---

## 1. Por qué hay que rehacer la base de Supabase

La base que está funcionando **no se construyó con las migraciones de este repositorio**.
El proyecto arrancó en abril desplegando en Railway, y el esquema se fue aplicando con
`prisma db push` — hay commits explícitos usando `--accept-data-loss`. La primera migración
formal no aparece hasta el 1 de junio, siete semanas después.

Consecuencia: la tabla `_prisma_migrations` de esa base está vacía o no coincide con nuestra
carpeta. Al correr `prisma migrate deploy`, Prisma la trata como base nueva, intenta aplicar
la primera migración, se topa con que `Project` ya existe y **falla**. Esa es también la raíz
del drift que encontramos al principio.

Hay dos salidas: marcar las migraciones como aplicadas (*baselining*, conserva los datos) o
rehacer la base. **Se eligió rehacerla porque lo que hay en producción son datos de prueba.**

> Si en el futuro hubiera datos reales, **no repitas este procedimiento**. El camino sería
> `prisma migrate diff --from-url <supabase> --to-schema-datamodel prisma/schema.prisma`
> (solo lectura) para ver la diferencia real, y luego `prisma migrate resolve --applied`
> migración por migración.

---

## 2. Antes de empezar

- [ ] Avisar al equipo de que la base se va a vaciar.
- [ ] Respaldo, aunque sean datos de prueba: en Supabase, *Database → Backups*, o
      `pg_dump` con la cadena directa. Cuesta cinco minutos y evita un disgusto.
- [ ] Tener a mano la **cadena directa** (`DIRECT_URL`, puerto 5432), no la del pooler.
      Las migraciones necesitan la directa.

---

## 3. Rehacer la base

Desde `backend/`, con `DATABASE_URL` y `DIRECT_URL` apuntando a Supabase:

```bash
# 1. Vaciar el esquema público
npx prisma migrate reset --force --skip-seed

# 2. Aplicar toda la cadena de migraciones
npx prisma migrate deploy

# 3. Comprobar que el esquema real coincide con schema.prisma
npx prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --exit-code
```

El paso 2 debe reportar **8 migraciones aplicadas**, y el paso 3 debe decir
**"No difference detected"**. Si el paso 3 dice otra cosa, **detente**: significa que el
esquema quedó distinto de lo que el código espera.

```bash
# 4. Sembrar roles y usuario administrador
ADMIN_EMAIL=<correo-del-admin> npm run prisma:seed
```

Esto crea los 5 roles y **un** usuario administrador. No crea datos de demostración.

---

## 4. Cargar las tasas de cambio — no te lo saltes

El seed deja **cero tasas de cambio**, y sin ellas la aplicación **muestra los importes en la
moneda equivocada**: no convierte y solo cambia la etiqueta. Un proyecto de 100 millones de
pesos aparece como "US$ 100.000.000". Es un defecto conocido (DEP-32) y con la base recién
creada se manifiesta siempre.

Con el backend ya desplegado:

```bash
curl -X POST https://app-gestion-demo.onrender.com/api/fx/sync \
  -H "Authorization: Bearer $FX_SYNC_TOKEN"
```

Debe responder `{"data":{"updated":["COP","EUR","MXN","PEN","CLP"],"failed":[]}}`.
Comprobado: carga las cinco tasas desde exchangerate-api.

---

## 5. Variables de entorno en Render

| Variable | Valor | Nota |
|---|---|---|
| `NODE_VERSION` | `24.13.0` | Antes era 20.19.0 |
| `JOBS_RUN_TOKEN` | valor aleatorio largo | **Nueva.** El mismo valor en el Web Service y en el cron |
| `FX_SYNC_TOKEN` | el que ya existe | Verificar que siga configurado |
| `JOBS_INTERVAL_MINUTES` | `0` | Dejar apagado: en Render el servicio duerme y el cron es quien despierta |
| `AUTH_DEV_EMAIL` | **no debe existir** | Simulador de rol |
| `AUTH_DEV_ROLES` | **no debe existir** | Simulador de rol |
| `AUTH_DEV_ROLE_HEADER` | **no debe existir** | Simulador de rol |

Las tres `AUTH_DEV_*` permiten entrar como cualquier rol sin autenticarse. Están apagadas por
defecto y protegidas por tres cerrojos independientes —uno de ellos exige que `NODE_ENV` no
sea `production`— pero **no deben estar definidas en producción**. Si alguna quedara activa,
el log de arranque lo advierte con un mensaje en mayúsculas.

---

## 6. Cron jobs

`render.yaml` declara dos. Si el *Blueprint sync* no los aplica solo, hay que crearlos a mano
en el panel de Render:

| Nombre | Cadencia | Comando |
|---|---|---|
| `app-gestion-fx-sync` | `0 13 * * *` (08:00 Colombia) | `curl -sf -X POST https://app-gestion-demo.onrender.com/api/fx/sync -H "Authorization: Bearer $FX_SYNC_TOKEN"` |
| `app-gestion-jobs` | `0 * * * *` (cada hora) | `curl -sf -X POST https://app-gestion-demo.onrender.com/api/jobs/run -H "Authorization: Bearer $JOBS_RUN_TOKEN"` |

**Ojo con el host.** El cron de FX apuntaba a `app-gestion-backend.onrender.com`, que **no
existe**; se comprobó que no responde en 150 segundos mientras `app-gestion-demo` devuelve
200. Por eso la sincronización de tasas nunca funcionó. El `name` del servicio en
`render.yaml` sigue diciendo `app-gestion-backend`, pero la URL pública real es
`app-gestion-demo`. No cambies el `name`: en Render el subdominio se fija al crear el
servicio y renombrarlo en un blueprint crea uno nuevo, sin las variables marcadas
`sync: false`.

---

## 7. Comprobaciones después de desplegar

```bash
# La aplicación responde y ve la base
curl https://app-gestion-demo.onrender.com/health
# Esperado: {"ok":true,"database":"up",...}

# El planificador quedó bien configurado
curl -H "Authorization: Bearer $JOBS_RUN_TOKEN" \
  https://app-gestion-demo.onrender.com/api/jobs/status
# Esperado: tokenConfigurado: true
```

Y en la interfaz, entrando con una cuenta real:

- [ ] El tablero muestra importes con la moneda correcta (si salen cifras enormes en dólares,
      faltan las tasas: volver al paso 4).
- [ ] Entrar directo a una URL como `/projects` deja al usuario ahí, no en el tablero.
- [ ] Crear un proyecto asignando **Project Manager** y **umbral de margen**: los dos campos
      son nuevos y antes no se podían configurar.
- [ ] Que ese PM pueda aprobar una solicitud de horas extra. Ese flujo **no funcionaba**
      antes, porque el campo no se podía asignar.
- [ ] `Auditoría` muestra registros de las operaciones que vayas haciendo.

---

## 8. Qué va a cambiar de aspecto

Conviene avisarlo antes, para que nadie piense que algo se rompió:

- **Varios proyectos cambiarán de color.** El semáforo ahora usa el umbral configurado de
  cada proyecto en vez de un 15 % fijo, y el portafolio dejó de contar el forecast dos veces
  (antes sumaba las horas ya ejecutadas como gasto *y* como proyección). Algunos proyectos
  saldrán de rojo y otros entrarán en amarillo.
- **Gastos e Ingresos son ahora un solo panel**, sobre la tabla unificada `FinancialEntry`.
- **Un consultor ya solo ve sus propias horas**, y quien no sea ADMIN, PM o FINANCE deja de
  ver las tarifas de la plantilla.
- **Los correos de aprobación registran el correo de quien aprueba**, no su nombre para
  mostrar.

---

## 9. Si algo sale mal

- **`migrate deploy` falla**: no insistas ni uses `db push`. Es lo que causó todo este lío.
  Mira el error, y si es "ya existe", el esquema no quedó vacío en el paso 1.
- **El esquema no coincide en el paso 3**: no despliegues. El código espera columnas que la
  base no tiene y fallará en runtime, no al arrancar.
- **Node 24 da problemas en Render**: revertir `NODE_VERSION` a `20.19.0` es una línea. El
  código no usa nada específico de 24.
- **Volver atrás del todo**: `main` no se ha tocado. Redesplegar desde `main` devuelve el
  código anterior, pero **no la base**, que ya estará migrada. Las migraciones son aditivas
  salvo la de `FinancialEntry`, que borra `Expense` y `RevenueEntry` después de copiar sus
  datos; el código viejo no encontraría esas tablas.

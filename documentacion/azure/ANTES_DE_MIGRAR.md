# Antes de migrar a Azure: paso a paso

> Rama `migracion-azure` · 2026-11-09
>
> Guía para el equipo de Synaptica que opera Synatrack. Cubre las tareas que hay que completar
> **antes** del corte de producción a Azure, en orden, y cómo publicar cambios entre varias personas
> una vez que Azure esté funcionando.
>
> Documentos relacionados:
> - [PREPARACION.md](PREPARACION.md): qué se cambió en el código, variables de entorno, paquete de
>   despliegue y cómo dejar Supabase al día.
> - [PLAN.md](PLAN.md): arquitectura, decisiones, costos y el procedimiento del corte.
> - [infra/README.md](../../infra/README.md): uso de `scripts/azure.ps1`, de los pipelines y alta de
>   un operador nuevo.

Marca cada casilla al terminar. Las fases van en orden: no empieces una sin cerrar la anterior.

---

## Roles

Las tareas se asignan a **roles**, no a personas. Una persona puede cumplir más de un rol, y cada
rol debe tener al menos un suplente, para que nadie sea indispensable.

| Rol | Qué hace | Quién lo cumple hoy |
|---|---|---|
| **Desarrollo** | Código, ramas y PR. Accesos a Render, Vercel y Supabase. Valida la aplicación. | Marcos Armas |
| **TI** | Suscripción de Azure, Entra ID, DNS de `synaptica.co`, secretos y monitoreo. | Juan (Analista de TI) |
| **Operador** | Despliega, revisa salud y hace rollback con `scripts/azure.ps1`. Lo son **todos** los miembros del grupo de Entra `Synatrack-Operadores`. | Desarrollo y TI |
| **Aprobador de producción** | Aprueba en GitHub cada despliegue a prod. **Nunca aprueba su propio despliegue.** | Desarrollo y TI, cruzados |
| **Usuarios de prueba** | Validan la aplicación con cada rol (ADMIN, PM, CONSULTANT, FINANCE, COMMERCIAL, VIEWER). | Por definir |

Actualiza la última columna cuando cambie el equipo.

---

## Cómo está producción hoy

Lo primero es tener clara la foto real, porque **no coincide con lo que dicen algunos documentos**.

| Pieza | Dónde corre hoy | Detalle |
|---|---|---|
| **Frontend** | **Vercel** | `synatrack.synaptica.co` apunta por DNS a Vercel. Vercel compila el bundle con `VITE_API_URL=https://synatrack.onrender.com`, definida en su panel. |
| **Backend** | **Render**, plan free | Responde en `synatrack.onrender.com`. `render.yaml` menciona otro nombre (`app-gestion-demo`). Se duerme tras 15 min sin tráfico. |
| **Base de datos** | **Supabase** | Postgres, accedida con el pooler (`pgbouncer`). |
| **Login** | **Entra ID** | Aplicación `473839fe-f081-4c69-9ccd-22304e99d9ea`, scope `access_as_user`. |
| Static Web App `victorious-glacier-0d52b010f` | Azure | **No se usa.** El workflow la actualiza en cada push a `main`, pero sin `VITE_API_URL`, así que no habla con ningún backend. Se retira después del corte. |

Consecuencia: el corte no es solo mover backend y base. **También hay que mover el frontend de
Vercel a una Static Web App nueva y cambiar el DNS de `synatrack.synaptica.co`.**

---

## Fase A. Inventario y confirmaciones

No cambia nada en ningún sistema. Su objetivo es que no haya sorpresas después.

### A1. Render: confirmar cuál es el backend real
**Rol:** Desarrollo.

- [ ] En el panel de Render, identificar el servicio que responde en `synatrack.onrender.com` y
      anotar su nombre, plan y región.
- [ ] Comprobar si existe también `app-gestion-demo` y si recibe tráfico. Si es un servicio viejo,
      anotarlo para apagarlo al final.
- [ ] Copiar la **lista de nombres** de variables de entorno del servicio, sin los valores, y
      compararla con la tabla de [PREPARACION.md §2.1](PREPARACION.md). Anotar cualquier variable
      que esté en Render y no en la tabla.
- [ ] Copiar el **valor** de `AZURE_AD_AUDIENCE` (no es secreto) a `ApiAudience` en
      `infra/azure.config.psd1`. Según la versión de token que emite Entra, puede ser
      `api://<id>` o el GUID de la aplicación. Si en Azure no queda idéntico, ningún login pasa.
- [ ] Revisar `connection_limit` en `DATABASE_URL`. Si vale `1`, subirlo a `5` ya mismo: mejora la
      lentitud actual sin esperar a la migración.
- [ ] Anotar qué crons existen en Render (sincronización FX, jobs) y a qué hora corren.

**Listo cuando:** hay una nota compartida con el servicio real, su lista de variables y sus crons.

### A2. Vercel y DNS: preparar el traslado del dominio
**Rol:** Desarrollo (Vercel) y TI (DNS).

- [ ] **Desarrollo:** en Vercel, anotar el proyecto que sirve `synatrack.synaptica.co`, la rama que
      despliega y sus variables `VITE_*` (los nombres y los valores: ninguna es secreta).
- [ ] **TI:** confirmar quién administra el DNS de `synaptica.co` (proveedor y acceso) y que podrá
      cambiar el registro de `synatrack` el día del corte.
- [ ] **TI:** anotar el registro actual de `synatrack.synaptica.co`, que hoy es un CNAME hacia
      Vercel, y su **TTL**. Hace falta para el rollback.
- [ ] **TI, una semana antes del corte:** bajar el TTL de ese registro a 300 segundos. Así el cambio
      y un eventual rollback se propagan en minutos y no en horas.

**Listo cuando:** el acceso al DNS está confirmado, el registro actual está anotado y el cambio de
TTL está programado.

### A3. Entra ID: permisos, URLs de retorno y grupo de operadores
**Rol:** TI.

En [entra.microsoft.com](https://entra.microsoft.com): **Registros de aplicaciones** → la aplicación
`473839fe-…`.

- [ ] **Permisos de API:** `access_as_user` aparece con estado *Concedido para Synaptica*. Si no,
      pulsar *Conceder consentimiento de administrador*.
- [ ] **Exponer una API:** el scope `access_as_user` está *Habilitado*.
- [ ] **Autenticación → URI de redirección (SPA):** anotar las que hay hoy. En la fase D se agregan
      las de Azure y **ninguna se borra hasta después del corte**.
- [ ] **Roles de aplicación:** anotar los roles definidos (`ADMIN`, `PM`, `NOMINA`, etc.) y
      confirmar que coinciden con los que espera el backend (CLAUDE.md §5).
- [ ] Confirmar que el operador que ejecutará `bootstrap` puede **crear registros de aplicación**.
      `bootstrap` crea uno por entorno para el pipeline.
- [ ] Crear el **grupo de seguridad `Synatrack-Operadores`** (en *Grupos*) y agregar a cada
      operador. Los permisos sobre Azure se dan al grupo, no a cada persona: sumar o quitar a alguien
      es solo cambiar la membresía.

**Listo cuando:** el consentimiento está concedido, existe el grupo con sus miembros y está anotada
la lista de URIs y roles.

### A4. Inventario de secretos
**Rol:** TI, con apoyo de Desarrollo.

Anotar **dónde está** cada uno (no el valor) y quién puede entregarlo. Se cargarán en Key Vault con
`scripts/azure.ps1 secret-set`. Los secretos **nunca** se envían por chat ni por correo.

- [ ] Credenciales SMTP: host, puerto, usuario y contraseña de aplicación. Para stage, confirmar si
      se usa el mismo buzón o uno de prueba.
- [ ] Webhooks de Teams (`TEAMS_FEEDBACK_WEBHOOK_URL`, `TEAMS_PAYROLL_WEBHOOK_URL`). Para stage,
      crear **un canal de prueba**, para que staging no publique en los canales reales.
- [ ] `FX_SYNC_TOKEN` y `JOBS_RUN_TOKEN`: en Azure se generan nuevos, distintos por entorno. No se
      reutilizan los de Render.

**Listo cuando:** cada secreto tiene dueño y ubicación conocidos.

### A5. Supabase: estado y compatibilidad
**Rol:** Desarrollo.

- [ ] Desde un checkout de **`main`** (no de esta rama), ejecutar `npx prisma migrate status` contra
      Supabase y dejarlo *up to date*. El procedimiento completo está en
      [PREPARACION.md §5](PREPARACION.md).
- [ ] Anotar la **versión de Postgres** de Supabase (`SELECT version();`). El destino es PG 16 y el
      `pg_dump` que se use debe ser de versión **igual o mayor** que el servidor de origen.
- [ ] Listar las **extensiones** en uso (`SELECT extname FROM pg_extension;`). En Azure Flexible
      Server cada extensión se habilita a mano (parámetro `azure.extensions`). Hay que quedarse con
      las que usa el esquema `public` e ignorar las internas de Supabase.
- [ ] Anotar el **tamaño de la base** (`SELECT pg_size_pretty(pg_database_size('postgres'));`). Sirve
      para estimar la duración del dump y de la restauración.

**Listo cuando:** Supabase está *up to date* y se conocen la versión, las extensiones y el tamaño.

### A6. Herramientas en el PC de cada operador
**Rol:** Todos los operadores.

- [ ] Azure CLI (`az version`) y Bicep (`az bicep install`, luego `az bicep version`).
- [ ] GitHub CLI con sesión iniciada (`gh auth status`) y acceso de **escritura** al repositorio.
      Quien ejecute `bootstrap` necesita además rol de **administrador** del repositorio, para crear
      Environments y variables.
- [ ] PowerShell 7 (`pwsh`). El script también funciona en Windows PowerShell 5.1.
- [ ] Herramientas cliente de PostgreSQL 16 (`pg_dump --version`, `pg_restore --version`). Solo hacen
      falta en el PC de quien ejecute el ensayo y el corte de datos.
- [ ] Repositorio clonado y en la rama correcta.

**Listo cuando:** todos los comandos responden con su versión en cada PC.

---

## Fase B. Preparar la suscripción de Azure

Se hace una sola vez, por un operador con los permisos indicados.

### B1. Archivo de configuración
**Rol:** cada operador, en su PC.

- [ ] `Copy-Item infra/azure.config.example.psd1 infra/azure.config.psd1` y llenar los valores:
      tenant, suscripción, grupo de operadores, correo de alertas, presupuesto, client ID y scope de
      la aplicación.
- [ ] El primer operador lo llena. Los demás piden los valores por un canal interno (no son secretos,
      pero tampoco son públicos) y los copian en su propio archivo.
- [ ] Comprobar que **no aparece** en `git status`, porque está en `.gitignore`.
- [ ] No poner contraseñas en el archivo. Solo identificadores.

### B2. Permisos y proveedores
**Rol:** TI.

- [ ] El operador que ejecute `bootstrap` tiene rol **Owner** en la suscripción, o **Contributor**
      más **User Access Administrator**. `bootstrap` crea asignaciones de roles, y eso no se puede
      hacer solo con Contributor. Los demás operadores no necesitan ese nivel: reciben sus permisos a
      través del grupo `Synatrack-Operadores`.
- [ ] Registrar los proveedores de recursos (una vez por suscripción):
      ```powershell
      foreach ($p in "Microsoft.Web","Microsoft.DBforPostgreSQL","Microsoft.KeyVault",
                     "Microsoft.Insights","Microsoft.OperationalInsights",
                     "Microsoft.AlertsManagement","Microsoft.Consumption") {
        az provider register --namespace $p
      }
      ```
- [ ] Crear una **alerta de presupuesto a nivel de suscripción** desde el portal (*Cost
      Management → Presupuestos*). La Bicep crea otra por grupo de recursos; esta es la red de
      seguridad general.

### B3. Bootstrap y GitHub
**Rol:** TI (Azure) y quien sea administrador del repositorio (GitHub).

- [ ] `.\scripts\azure.ps1 bootstrap -Env stage` y luego `-Env prod`. Crea los grupos de recursos,
      la identidad del pipeline con OIDC, los permisos del grupo de operadores y los Environments
      `stage` y `prod` en GitHub con sus variables.
- [ ] Cada operador ejecuta `.\scripts\azure.ps1 login` y `.\scripts\azure.ps1 access -Env stage`
      desde su PC para confirmar que sus permisos funcionan.
- [ ] En GitHub, *Settings → Environments → prod*:
  - [ ] Agregar como **revisores obligatorios** a todos los aprobadores de producción.
  - [ ] Activar **Prevent self-review**: quien dispara un despliegue a prod no puede aprobarlo, lo
        aprueba otra persona.
  - [ ] Restringir las ramas que pueden desplegar a `main`.

**Listo cuando:** existen los dos grupos de recursos y los Environments de GitHub, cada operador
pasa `access` y `prod` exige aprobación de otra persona.

---

## Fase C. Código y repositorio

### C1. Revisar y fusionar la rama
**Rol:** Desarrollo, con revisión de TI.

- [ ] Revisar los cambios de `migracion-azure`: código ([PREPARACION.md](PREPARACION.md)),
      `infra/`, `scripts/azure.ps1` y los workflows nuevos. TI revisa al menos `infra/` y los
      workflows.
- [ ] Fusionar en `dev`. Es seguro: los workflows de Azure no hacen nada mientras la variable
      `AZURE_DEPLOY_ENABLED` no sea `true`, y Render sigue igual porque `TRUST_PROXY` sin definir se
      comporta como antes.
- [ ] Corregir CLAUDE.md §6, que hoy dice que el frontend se despliega en Azure Static Web Apps
      cuando en realidad está en Vercel.

### C2. Decisiones a cerrar
**Rol:** Desarrollo y TI, juntos.

- [ ] **Datos en stage:** ¿una copia de producción (ensayo realista, pero con datos reales de
      nómina y tarifas) o solo el seed más datos de prueba? Si es copia de producción, definir quién
      puede entrar a stage.
- [ ] **Correo en stage:** ¿se envían correos reales o se dejan simulados (sin `SMTP_HOST`)? Si se
      envían, cuidar que no les lleguen a usuarios reales.
- [ ] **Ventana del corte:** día y hora con poco uso, y a quién se avisa.

---

## Fase D. Levantar staging

### D1. Infraestructura de stage
**Rol:** Operador (TI de preferencia).

- [ ] `.\scripts\azure.ps1 plan -Env stage`: revisar lo que va a crear.
- [ ] `.\scripts\azure.ps1 infra -Env stage`.
- [ ] Cargar los secretos de stage con `.\scripts\azure.ps1 secret-set -Env stage` (SMTP, webhooks
      de prueba, tokens nuevos).
- [ ] Activar los workflows de Azure con una **variable de repositorio** (no de Environment):
      `gh variable set AZURE_DEPLOY_ENABLED --body true --repo synaptica-sas/Synatrack`. Detalle en
      [infra/README.md](../../infra/README.md).

### D2. Entra ID para stage
**Rol:** TI.

- [ ] Agregar como URI de redirección (SPA) la URL de la Static Web App de stage, que muestra
      `.\scripts\azure.ps1 status -Env stage`.

### D3. Primer despliegue
**Rol:** Desarrollo.

- [ ] Hacer un push a `dev`: eso despliega stage.
      `.\scripts\azure.ps1 deploy` y `rollback` usan `workflow_dispatch`, y GitHub solo lo habilita
      cuando el workflow ya está en `main`. Hasta que los workflows lleguen a `main`, stage se
      despliega únicamente con pushes a `dev`.
- [ ] Si la base de stage está vacía: cargar roles y el usuario admin (`npm run prisma:seed`) con
      la cadena de stage.
- [ ] `.\scripts\azure.ps1 health -Env stage`: `/health` responde 200 con `database: up`.

### D4. Validación funcional en stage
**Rol:** Desarrollo coordina, con los usuarios de prueba. TI verifica alertas y rollback.

- [ ] Iniciar sesión con Microsoft sin pantallas colgadas: menos de 5 s con el servidor despierto.
- [ ] Cada rol (ADMIN, PM, CONSULTANT, FINANCE, COMMERCIAL, VIEWER) ve solo lo que le corresponde.
- [ ] Registrar y aprobar horas, horas extra y gastos.
- [ ] Los trabajos periódicos corren (`health` muestra su estado) y la sincronización FX funciona.
- [ ] Llega un correo de prueba y un mensaje al canal de Teams de prueba.
- [ ] La auditoría guarda la **IP real** del usuario, no una interna.
- [ ] Recargar el navegador en una ruta interna (por ejemplo `/timesheet`): debe cargar la
      pantalla, no un 404.
- [ ] **TI, simulacro de alerta:** detener el App Service unos minutos y confirmar que llega el
      correo de alerta de disponibilidad a todos los operadores.
- [ ] **TI, simulacro de rollback:** `.\scripts\azure.ps1 rollback -Env stage` hacia el despliegue
      anterior y confirmar que vuelve a funcionar. Requiere que los workflows ya estén en `main`
      (ver D3). Si todavía no lo están, este simulacro se mueve a la fase F.

**Listo cuando:** todas las casillas de D4 están marcadas.

---

## Fase E. Ensayo de la migración de datos

Se hace en **stage**, con el mismo procedimiento que se usará en producción, y se mide cuánto tarda.
**Rol:** Desarrollo ejecuta y TI acompaña. Conviene hacerlo juntos: es el mismo trabajo que harán el
día del corte.

- [ ] Dump del esquema `public` de Supabase ([PREPARACION.md §5](PREPARACION.md)). **Anotar la
      duración.**
- [ ] Habilitar en el Postgres de stage las extensiones anotadas en A5.
- [ ] `pg_restore` en la base de stage. **Anotar la duración.**
- [ ] `npx prisma migrate status` contra stage: debe decir *up to date*.
- [ ] Comparar el conteo de filas de las tablas principales (usuarios, consultores, proyectos,
      horas, gastos, auditoría) entre Supabase y stage.
- [ ] Repetir la validación de D4 con los datos reales.
- [ ] Con las duraciones medidas, **definir la ventana del corte** (dump + restauración +
      validación + margen).
- [ ] Borrar del PC el archivo del dump al terminar: contiene datos de nómina.

**Listo cuando:** el ensayo salió completo, los conteos coinciden y se sabe cuánto dura.

---

## Fase F. Lista de salida para el corte (go / no-go)

Desarrollo y TI la revisan juntos. Todo en **sí** antes de fijar la fecha. El corte en sí está en
[PLAN.md](PLAN.md).

| # | Condición | Rol | ✔ |
|---|---|---|---|
| 1 | Infraestructura de prod desplegada (`infra -Env prod`) y secretos de prod cargados | TI | ☐ |
| 2 | Static Web App de prod creada y compilada con las `VITE_*` de prod (`VITE_API_URL` = backend de Azure prod) | Desarrollo | ☐ |
| 3 | `CORS_ORIGIN` de prod incluye `https://synatrack.synaptica.co` y la URL propia de la Static Web App de prod | Desarrollo | ☐ |
| 4 | Entra ID tiene como URI de redirección la URL de la Static Web App de prod, además de `synatrack.synaptica.co`, que ya existe | TI | ☐ |
| 5 | Dominio personalizado preparado en la Static Web App de prod: registro TXT de validación creado en el DNS, a la espera solo del cambio de CNAME (detalle en [PLAN.md](PLAN.md), fase 4) | TI | ☐ |
| 6 | TTL del registro DNS de `synatrack` en 300 s desde hace al menos 48 h | TI | ☐ |
| 7 | Quien tiene acceso al DNS está disponible durante la ventana | TI | ☐ |
| 8 | Ensayo de datos (fase E) completo, con duración medida | Desarrollo | ☐ |
| 9 | Validación en stage (fase D4) completa | Desarrollo | ☐ |
| 10 | Aviso enviado a los usuarios con la ventana de mantenimiento | Desarrollo | ☐ |
| 11 | Plan de rollback acordado: CNAME de vuelta a Vercel, Render y Supabase intactos. **Punto de no retorno** definido: desde que los usuarios escriben datos en Azure, volver a Render implica perder esos datos o copiarlos de vuelta | Ambos | ☐ |
| 12 | Revisores obligatorios y *Prevent self-review* activos en el Environment `prod` de GitHub | TI | ☐ |
| 13 | Workflows de Azure fusionados en `main`, para que `deploy` y `rollback` funcionen. La variable `AZURE_FRONTEND_PROD_ENABLED` se activa recién en el corte | Desarrollo | ☐ |
| 14 | La sincronización FX corre en Azure (sin el cron de Render). Lo verifica `health` | Desarrollo | ☐ |
| 15 | Al menos dos operadores pasan `access` y saben ejecutar `health` y `rollback` | Ambos | ☐ |

---

## Una vez en Azure: cómo publicamos cambios entre dos o más personas

Este es el flujo del día a día después del corte. El detalle de cada comando está en
[infra/README.md](../../infra/README.md).

```
Desarrollo: commit en dev ──► push ──► pipeline despliega STAGE ──► se valida en stage
     │
     └─► PR dev → main ──► merge ──► pipeline pide aprobación
                                          │
                     Otra persona aprueba en GitHub ──► se despliega PROD ──► smoke de /health
```

1. **Cambios de código:** se trabaja en `dev`. Cada push despliega stage automáticamente.
2. **Validar en stage:** quien hizo el cambio lo prueba allí. Con `.\scripts\azure.ps1 health -Env
   stage` se confirma que el servicio está sano.
3. **Pasar a producción:** PR de `dev` a `main`. Antes del merge, el agente `versionador` marca la
   versión y escribe el changelog.
4. **Aprobación cruzada:** al hacer merge, el pipeline de prod queda esperando. **La aprueba una
   persona distinta** de quien hizo el merge, desde GitHub (*Actions → la ejecución → Review
   deployments*).
5. **Después del despliegue:** cualquiera de los dos ejecuta `.\scripts\azure.ps1 health -Env prod`.
   Las alertas llegan por correo a todos los operadores.
6. **Si algo sale mal:** `.\scripts\azure.ps1 rollback -Env prod` vuelve a un despliegue anterior.
   Ese rollback también pasa por aprobación.
7. **Cambios de infraestructura** (`infra/`): van por PR. El pipeline comenta en el PR qué recursos
   cambiarían. TI revisa ese comentario antes de aprobar.

Reglas para trabajar en pareja:
- Nadie despliega a prod desde su PC: todo pasa por el pipeline, para que quede registrado y
  corresponda a un commit.
- Nadie aprueba su propio despliegue a prod.
- Un secreto nuevo se carga con `secret-set` y se avisa al otro operador **qué** se cargó, nunca el
  valor.
- Si alguien sale del equipo: se le quita del grupo `Synatrack-Operadores`, de los revisores de
  `prod` y del repositorio.

---

## Después del corte (para no olvidar)

No son tareas previas, pero se deciden ahora para que no queden colgadas:

- Mantener Render y Supabase **sin tocar y en solo lectura** al menos 2 semanas como respaldo.
- Apagar los crons de Render para que no corran dos ciclos de trabajos contra bases distintas.
- Retirar el proyecto de Vercel, `frontend/vercel.json`, la Static Web App
  `victorious-glacier-0d52b010f` y su workflow.
- Quitar de Entra las URIs de redirección que ya no se usen.
- Actualizar CLAUDE.md (§2, §3 y §6) y `documentacion/DESPLIEGUE.md` con la arquitectura nueva.

---

## Resumen por rol

| Rol | Tareas |
|---|---|
| **Desarrollo** | A1, A2 (Vercel), A5, A6, C1, C2, D3, D4, E, F2, F3, F8–F10, F13, F14 |
| **TI** | A2 (DNS), A3, A4, A6, B1, B2, B3, C1 (revisión), C2, D1, D2, D4 (alertas y rollback), E (acompaña), F1, F4–F7, F12 |
| **Ambos** | F11, F15 y el flujo de publicación de cambios |
| **Usuarios de prueba** | D4 |
| **Asistente (Claude Code)** | Apoyo en C1 y ajustes a scripts y pipelines según lo que salga en D y E. Nunca recibe secretos ni lee `infra/azure.config.psd1`. |

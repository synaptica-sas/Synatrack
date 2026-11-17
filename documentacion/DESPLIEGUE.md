# Despliegue

Dónde corre Synatrack, cómo se publica un cambio y qué revisar después. El detalle operativo
(comandos de `scripts/azure.ps1`, nombres de recursos, App Settings, variables del pipeline,
problemas frecuentes) está en [`infra/README.md`](../infra/README.md); este documento no lo
repite.

Para levantar el entorno **local**, ver `DESARROLLO_LOCAL.md`.

> Hasta noviembre de 2026 producción corría en Render (backend), Vercel (frontend) y Supabase
> (base). Esa configuración, sus cron jobs y el procedimiento para rehacer la base de Supabase
> están en el historial de git de este archivo (`git log -- documentacion/DESPLIEGUE.md`).

---

## 1. Topología

| Pieza | Dónde | Notas |
|---|---|---|
| Frontend | **Azure Static Web Apps** (`stapp-synatrack-<env>`) | Las `VITE_*` se fijan en el build del pipeline |
| Backend | **Azure App Service** Linux B1 (`app-synatrack-<env>-<sfx>`) | Always On; el zip llega ya construido |
| Base de datos | **Azure Database for PostgreSQL Flexible Server 17** | En su propio resource group de datos (`rg-datos-<env>`), base `synatrack` |
| Secretos | **Key Vault** de la app (`kv-syn-<env>-…`) | El App Service los lee como referencias; nadie los pega en texto plano |
| Trabajos periódicos | **En proceso**, cada 60 min (`JOBS_INTERVAL_MINUTES=60`) | Sin cron externo. Tasas FX solo a demanda (`FX_SYNC_IN_CYCLE=false`) |
| Monitoreo | Application Insights, prueba de disponibilidad de `/health`, alertas por correo | Ver `infra/README.md` §5 |

Dos entornos aislados, cada uno con sus propios recursos:

| Entorno | Rama | Resource groups |
|---|---|---|
| `stage` | `dev` | `rg-synatrack-stage` + `rg-datos-stage` |
| `prod` | `main` | `rg-synatrack-prod` + `rg-datos-prod` |

> **Corte hecho el 2026-11-17.** Ese día se migraron los datos de Supabase a Azure prod, que es
> la base viva desde entonces. `synatrack.synaptica.co` es un CNAME a la SWA de prod
> (`calm-flower-00e3d4c10.3.azurestaticapps.net`), con el certificado gestionado por Azure.
> Render, Vercel y Supabase siguen existiendo sin tráfico, como respaldo, hasta la parte 2 de
> `azure/MIGRAR_A_AZURE_DEVOPS.md`. Supabase **no** está al día: no volver a usarlo como origen.

Los `Dockerfile`, `docker-compose.yml` y `frontend/server.mjs` solo se usan para el entorno local
con Docker. No intervienen en Azure.

---

## 2. Cómo se publica un cambio

```
commit en dev ──► push ──► pipeline despliega STAGE ──► se valida en stage
     │
     └─► PR dev → main ──► revisión de la otra persona ──► merge ──► pipeline despliega PROD
```

- Cada push a `dev` o `main` despliega solo lo que cambió: `backend/**` dispara el pipeline del
  backend y `frontend/**`, el del frontend.
- **Hoy el merge a `main` es el despliegue a prod, sin aprobación.** GitHub Free no la ofrece en
  repositorios privados, así que la revisión del PR tiene que ir antes del merge. Está planeado
  pasar el repositorio a Azure DevOps para tener aprobación en el entorno de prod.
- Antes de fusionar `dev` a `main`, el agente `versionador` marca la versión y escribe el
  changelog en `documentacion/versiones/`.
- El reparto de roles entre dos o más personas está en `azure/ANTES_DE_MIGRAR.md`, sección
  "Una vez en Azure".

### Reglas que siguen valiendo

- **Las migraciones solo van hacia adelante.** El pipeline del backend corre
  `prisma migrate deploy` antes de publicar el código, y el rollback **no** las revierte. Toda
  migración tiene que ser compatible con el código anterior: primero se agrega y después se quita.
- **Nunca `prisma db push`** contra stage ni prod. Así se generó el drift de esquema original.
- **Si cambia el contrato de una respuesta**, el backend tiene que llegar antes que el frontend.
  Backend y frontend se despliegan por separado: si el frontend nuevo llega primero contra un
  backend viejo, la pantalla falla.
- **`AUTH_DEV_EMAIL`, `AUTH_DEV_ROLES` y `AUTH_DEV_ROLE_HEADER` no deben existir** en stage ni en
  prod. Permiten entrar con cualquier rol sin autenticarse. Los App Settings los gobierna el
  Bicep, así que solo aparecerían si alguien los agrega a mano en el portal.
- **No se toca el portal para cambiar App Settings.** El siguiente `infra` los pisa. Los cambios
  van en `infra/main.bicep`.

---

## 3. Verificación después de desplegar

El pipeline del backend ya espera a que `/health` devuelva 200 con `ok: true`. Además:

```powershell
.\scripts\azure.ps1 health -Env prod   # HTTP, latencia, estado de los trabajos, alertas disparadas
```

- Recién desplegado, los trabajos de `/health` pueden salir en `nunca`. Hay que volver a
  mirarlo pasada una hora, cuando corre el primer ciclo.
- `fx-sync` solo corre con el botón **"Actualizar ahora"** de *Tasas FX*. Si nadie lo pulsa, el
  health lo va a marcar como atrasado aunque no haya ninguna falla.
- `backend/scripts/smoke.mjs` crea proyectos y consultores de prueba: **no se corre contra stage
  ni contra prod**. Es para el entorno local.

En la interfaz, con una cuenta real:

- [ ] Inicio de sesión con Microsoft sin errores de CORS en la consola.
- [ ] Los importes salen en la moneda correcta. Si aparece "Cifras aproximadas", faltan tasas:
      hay que pulsar "Actualizar ahora" en *Tasas FX*.
- [ ] Al entrar directo a una URL interna (por ejemplo `/projects`), el usuario se queda en esa
      pantalla.
- [ ] *Auditoría* registra las operaciones que se van haciendo.

---

## 4. Si algo sale mal

- **Volver a una versión anterior:** `.\scripts\azure.ps1 rollback -Env prod`. Redespliega un SHA
  anterior con `skip_migrations=true`. El esquema queda como está, por eso importa la regla de
  migraciones compatibles.
- **Una migración rompió datos:** la salida es el *point-in-time restore* de Postgres. Prod
  conserva 14 días de backups y stage 7. Ver `azure/PLAN.md`, riesgos.
- **`migrate deploy` falla en el pipeline:** el código nuevo no se publica, porque el paso va
  antes. No hay que insistir ni usar `db push`: se revisa el error con
  `.\scripts\azure.ps1 logs -Env <env>` y se corrige la migración.
- **El frontend sale en blanco o falla una pantalla justo después de desplegar:** revisar si el
  backend del mismo cambio ya terminó su pipeline (ver la regla del contrato en §2).
- Problemas frecuentes de la plataforma: `infra/README.md` §10.

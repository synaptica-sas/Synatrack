# Supabase vs. código — 2026-10-05

| | |
|---|---|
| **Qué se comparó** | La estructura real de la base en Supabase ([ddl_supabase_2026-10-05.sql](ddl_supabase_2026-10-05.sql), sacada con `supabase db dump`) contra la que produce el código: las 13 migraciones aplicadas sobre una base limpia en Docker. |
| **Verificación previa** | `schema.prisma` y las migraciones coinciden exactamente (`prisma migrate diff` no devuelve nada). |
| **Datos leídos** | Solo la estructura y la tabla de control `_prisma_migrations`. No se leyó ningún dato del negocio. |
| **Explorador** | Las diferencias aparecen en la pestaña *Supabase vs código* de [explorador-esquema.html](explorador-esquema.html). |

---

## 1. Resumen para el líder

Hay **dos problemas**, y el primero es urgente:

1. 🔴 **Toda la base de datos está expuesta por la API pública de Supabase.**
   - Supabase publica automáticamente una API REST por cada tabla del esquema `public`.
   - Ninguna de las 28 tablas tiene activada la seguridad por filas (RLS).
   - Los roles públicos `anon` y `authenticated` tienen **todos** los permisos sobre ellas.
   - **Consecuencia:** cualquier persona con la *anon key* del proyecto puede leer, modificar o borrar todos los datos (sueldos, tarifas, documentos de identidad, márgenes, usuarios) sin pasar por la aplicación. Esa clave no es secreta por diseño.
   - **Arreglo:** se corrige en minutos y no afecta a la aplicación (sección 3).

2. 🟠 **Supabase va casi dos semanas atrasada respecto al código.**
   - Desde el 22 de septiembre no se aplica ninguna migración, porque el despliegue en Render no las ejecuta: arranca con `npm run start`, sin `prisma migrate deploy`.
   - **Consecuencia:** si el backend publicado es el código actual, fallan los gastos e ingresos, el registro de horas, el cronómetro y el historial de trabajos.
   - **Arreglo:** aplicar las migraciones pendientes, con copia de seguridad previa. Una de ellas **aprueba automáticamente horas extra pendientes** y requiere tu visto bueno (sección 4).

---

## 2. Diferencias encontradas

### Tablas

| Tabla | En el código | En Supabase | Migración que la crea o elimina |
|---|---|---|---|
| `FinancialEntry` | ✓ | ✗ falta | `20260922053854_merge_expense_revenue` |
| `RunningTimer` | ✓ | ✗ falta | `20260922110000_add_timesheet_and_tracker` |
| `JobRun` | ✓ | ✗ falta | `20260929143000_add_job_run_observability` |
| `Expense` | ✗ eliminada | ✓ sigue | `20260922053854_merge_expense_revenue` (la fusiona en `FinancialEntry`) |
| `RevenueEntry` | ✗ eliminada | ✓ sigue | ídem |

### Columnas de `TimeEntry`

| Columna | En el código | En Supabase | Migración |
|---|---|---|---|
| `hours` | `numeric(8,4)` | `numeric(8,2)` | `20260922120000_time_entry_hours_precision` |
| `description` | `text` | falta | `20260922110000_add_timesheet_and_tracker` |
| `activityId` (+ FK e índice) | `text` | falta | ídem |
| `source` | `"TimeEntrySource"` NOT NULL | falta | ídem |
| `startedAt`, `endedAt` | `timestamp(3)` | falta | ídem |
| índice `(consultantId, workDate)` | ✓ | falta | ídem |

### Enums

| Enum | Estado |
|---|---|
| `FinancialEntryType` | Falta en Supabase |
| `TimeEntrySource` | Falta en Supabase |

Todo lo demás coincide: las 23 tablas restantes, sus columnas, tipos, restricciones, índices y claves foráneas.

### Historial de migraciones en Supabase

La tabla `_prisma_migrations` de Supabase registra solo **5 de 13** migraciones (hasta `20260605160845_add_activities_model`).

Los cambios de `20260915164644_sync_schema_drift` sí están en la estructura (`CustomHoliday`, `ApprovalDelegation`, columnas nuevas de `Consultant`…). Llegaron con `prisma db push`, que aplica cambios sin registrarlos. Esa migración se escribió idempotente justamente por eso, así que `migrate deploy` puede aplicarla sin error.

Las 5 migraciones registradas coinciden con los archivos del repositorio. Las sumas de verificación solo varían por los saltos de línea Windows/Linux; el contenido no se modificó después de aplicarlas.

---

## 3. 🔴 Cerrar la API pública de Supabase (hacer primero)

**Por qué no rompe nada:** la aplicación se conecta como el usuario `postgres`, que es el dueño de las tablas, y a ese usuario RLS no le aplica. Activar RLS sin políticas solo bloquea a `anon` y `authenticated`, que la aplicación no usa (el frontend no usa `supabase-js`).

**Opción A, recomendada:** activar RLS en todas las tablas. En el panel de Supabase → *SQL Editor*:

```sql
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;

-- Además, quitar los permisos que Supabase concede por defecto:
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
```

**Opción B, complementaria:** en *Project Settings → Data API*, quitar `public` de los *Exposed schemas* o desactivar la Data API. Synatrack no la usa.

**Para que no vuelva a pasar:** las tablas nuevas que creen las migraciones también nacerían sin RLS. Hay que añadir una migración de Prisma con el bloque anterior y repetir `ENABLE ROW LEVEL SECURITY` en cada migración que cree una tabla. Revisen también el *Security Advisor* del panel de Supabase, que marca este problema.

**Después de aplicarlo:** volver a sacar el DDL y regenerar el explorador. La comparación debe dejar de mostrar el aviso.

---

## 4. 🟠 Poner Supabase al día

### Migraciones pendientes (8), en orden

| Migración | Tipo | Qué hace | Riesgo |
|---|---|---|---|
| `20260915164644_sync_schema_drift` | Estructura | Crea lo que ya existe (idempotente). | Ninguno. |
| `20260918130000_fix_extra_hours_monthly_divisor` | **Datos** | Corrige el divisor mensual de PE, CL, MX, EC, AR y ES solo si sigue en 220. | Bajo. Cambia cómo se calculan las horas extra nuevas de esos países. |
| `20260922053854_merge_expense_revenue` | Estructura + **datos** | Copia `Expense` y `RevenueEntry` a `FinancialEntry` y **borra las tablas viejas**. | Medio. Irreversible sin backup. |
| `20260922110000_add_timesheet_and_tracker` | Estructura | Columnas nuevas en `TimeEntry`, tabla `RunningTimer`. | Bajo. |
| `20260922120000_time_entry_hours_precision` | Estructura | `hours` pasa de 2 a 4 decimales. | Bajo. No cambia valores. |
| `20260929143000_add_job_run_observability` | Estructura | Tabla `JobRun`. | Ninguno. |
| `20260930120000_aprobacion_unica_pm` | **Datos** | Pasa a `APPROVED` todas las horas extra en `PENDING_FINANCE`; entran en la nómina sin que Finanzas las revise. Deja rastro en `AuditLog`. | **Alto: decisión de negocio.** |
| `20260930120000_timer_entries_are_timesheet` | Datos | Reetiqueta `TIMER` a `TIMESHEET`. En Supabase no hay filas así. | Ninguno. |

### Decisión que necesitamos del líder

Antes de aplicar `aprobacion_unica_pm`, confirmar que es correcto que las solicitudes de horas extra que hoy esperan la aprobación de Finanzas pasen a aprobadas y entren en la próxima nómina.

Para saber cuántas son, en el *SQL Editor*:

```sql
SELECT COUNT(*), SUM("totalAmount") FROM "ExtraHourEntry" WHERE status = 'PENDING_FINANCE';
```

Si no se quiere, hay que revisarlas a mano antes de aplicar la migración.

### Pasos para el desarrollador

1. **Backup:** en *Database → Backups*, comprobar que existe uno reciente, o hacer un `pg_dump` completo.
2. **Revisar cuántas horas extra cambiarían** (consulta anterior) y obtener la aprobación del líder.
3. **Aplicar las migraciones** desde `backend/`, con `DIRECT_URL` apuntando a la conexión de Supabase:
   ```bash
   npx prisma migrate status    # debe listar las 8 pendientes
   npx prisma migrate deploy
   ```
4. **Verificar:** sacar el DDL de nuevo y regenerar el explorador (ver [README.md](README.md)). La pestaña *Supabase vs código* debe quedar en 0 diferencias, salvo el aviso de RLS si aún no se aplicó la sección 3.
5. **Evitar que se repita:** añadir la migración al despliegue de Render, por ejemplo `preDeployCommand: npx prisma migrate deploy` en `render.yaml`, y prohibir `prisma db push` contra Supabase. Hoy `backend/package.json` tiene un script `prisma:push` y `.claude/settings.json` lo permite.

---

## 5. Relación con el code review

Este informe confirma y amplía la sección 6 de [../codereview_2026-10-05.md](../codereview_2026-10-05.md):
- **BD-07 (drift):** el desfase existe y es mayor de lo previsto.
- **QA-03:** se añade la necesidad de aplicar migraciones al desplegar.
- **Hallazgo nuevo de severidad crítica:** la exposición por la API pública de Supabase (sección 3) no se veía en el código, porque es configuración de la base.

# Base de Datos

Documentación del esquema de Synatrack (PostgreSQL en Supabase, gestionado con Prisma).

| Archivo | Qué es |
|---|---|
| [explorador-esquema.html](explorador-esquema.html) | Explorador interactivo: tablas, columnas, diagrama entidad-relación, reglas de borrado, enums y hallazgos del code review por tabla. Se abre con doble clic en cualquier navegador; el diagrama necesita internet la primera vez para cargar la librería de diagramado (elkjs). |
| [generar-explorador.mjs](generar-explorador.mjs) | Script que regenera el explorador desde `backend/prisma/schema.prisma`. |
| [explorador.template.html](explorador.template.html) | Plantilla del explorador: diseño, textos y hallazgos por tabla. |
| [comparacion_supabase_2026-10-05.md](comparacion_supabase_2026-10-05.md) | Diferencias entre Supabase y el código, y cómo corregirlas. |
| [ddl_supabase_2026-10-05.sql](ddl_supabase_2026-10-05.sql) | Estructura real de Supabase (`supabase db dump`, sin datos). El generador usa el más reciente de la carpeta para marcar diferencias en el explorador. |

Hallazgos del esquema: sección 6 de [../codereview_2026-10-05.md](../codereview_2026-10-05.md).

## Regenerar el explorador

Cada vez que cambie `schema.prisma` (cada migración nueva), desde la raíz del repositorio:

```bash
node "documentacion/Base de Datos/generar-explorador.mjs"
```

No necesita instalar nada más que Node. Las descripciones de cada tabla, las columnas marcadas como sensibles y los hallazgos están en las constantes `DESC`, `SENSITIVE` y `FIND` de la plantilla. Si se agrega una tabla nueva, añádanla también al grupo que corresponda en `GROUPS`.

## Qué refleja y qué no

El explorador muestra **lo que el código espera** de la base de datos (`schema.prisma`). No consulta Supabase en vivo: compara contra el `ddl_supabase_*.sql` más reciente de esta carpeta. Para actualizar la comparación, saquen un DDL nuevo (ver abajo) y vuelvan a ejecutar el generador.

Convenciones del esquema:
- Los nombres de tabla y columna en Postgres son idénticos a los de Prisma, con mayúsculas: `public."TimeEntry"."workDate"`.
- Los ids son `cuid()` generados por Prisma (texto), no secuencias.
- Todo el dinero es `numeric`, nunca `float`.
- Los cambios de esquema se hacen **solo** con migraciones (`npm run prisma:migrate` y `npm run prisma:deploy`), nunca con `db push`.

## Sacar el DDL de Supabase con el CLI

El CLI está instalado como dependencia de desarrollo en la raíz del repositorio (`package.json` de la raíz), así que se ejecuta con `npx supabase`. La primera vez, después de clonar, hay que correr `npm install` en la raíz.

Requisitos:
- **Docker Desktop en ejecución**, porque `supabase db dump` corre `pg_dump` dentro de un contenedor.
- Haber iniciado sesión y vinculado el proyecto una vez por máquina (lo hace cada persona en su propia terminal):

```powershell
npx supabase login                               # abre el navegador para autorizar
npx supabase link --project-ref <project-ref>    # pide la contraseña de la base de datos
```

El `project-ref` es el identificador que aparece en la URL del panel: `supabase.com/dashboard/project/<project-ref>`.

Sacar el DDL, desde la raíz del repositorio:

```powershell
npx supabase db dump --linked --schema public -f "documentacion/Base de Datos/ddl_supabase_AAAA-MM-DD.sql"
```

Notas:
- `link` crea la carpeta `supabase/.temp/` con datos locales de la vinculación; no debe subirse al repositorio.
- El DDL contiene la estructura y no contiene datos, así que puede versionarse en esta carpeta.

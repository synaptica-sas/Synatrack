# docs/code-review-y-base-de-datos

## Qué se cambió

Solo documentación y herramientas de documentación; no se tocó código de la aplicación.

| Archivo | Qué es |
|---|---|
| `documentacion/codereview_2026-10-05.md` | Code review completo del repositorio: seguridad, backend, cálculos, base de datos y frontend. Incluye resumen para el líder, plan por fases e índice de hallazgos. |
| `documentacion/Base de Datos/` | Explorador del esquema (tablas, diagrama ER, relaciones, enums), su generador, el DDL real de Supabase y la comparación Supabase vs. código. Ver su `README.md`. |
| `package.json`, `package-lock.json` (raíz) | Supabase CLI como dependencia de desarrollo, para sacar el DDL (`npx supabase db dump`). |
| `.gitignore` | Ignora `supabase/.temp/`, que guarda la vinculación local de cada máquina. |

## Por qué

El líder pidió una revisión del código y una forma de revisar la estructura de la base sin programar. La comparación con Supabase destapó dos problemas que no se veían en el código:

- La API pública de Supabase expone todas las tablas.
- Hay 8 migraciones sin aplicar.

Ambos están en `documentacion/Base de Datos/comparacion_supabase_2026-10-05.md`.

## Cómo se verificó

- **Hallazgos del code review:** cada uno se verificó leyendo el código; los más graves se comprobaron una segunda vez a mano.
- **`schema.prisma` frente a las migraciones:** coinciden. Se comprobó con `prisma migrate diff` contra una base local con las 13 migraciones aplicadas (`docker compose up`).
- **Supabase frente a la base local:** se compararon estructura, tipos, restricciones e índices. El explorador reproduce exactamente las mismas 13 diferencias.
- **Diagrama ER:** el layout se probó con elkjs 0.9.3 en ambos modos, sin tablas superpuestas y con las 28 relaciones trazadas. La vista se revisó con capturas de Edge en modo headless.
- **Pruebas automáticas:** no se ejecutaron (`npm test`) porque la rama no cambia código.

## Riesgos que quedan

- **El explorador se desactualiza solo:** el HTML generado no se actualiza por sí mismo. Hay que ejecutar `node "documentacion/Base de Datos/generar-explorador.mjs"` tras cada migración, y sacar un DDL nuevo para refrescar la comparación.
- **Diagrama sin conexión:** el diagrama ER descarga elkjs de jsdelivr; sin internet no se dibuja, aunque el resto del explorador funciona.
- **Correcciones pendientes:** el SQL para cerrar la API de Supabase y la aplicación de migraciones están documentados pero **no aplicados**. Requieren aprobación, y una migración pendiente aprueba horas extra automáticamente.

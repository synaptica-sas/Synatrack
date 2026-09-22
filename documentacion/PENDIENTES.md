# Pendientes de Synatrack

Lista viva de lo que falta. Si vas a tomar algo, empieza por aquí.

**Actualizado:** 2026-09-22 · **Rama con todo lo hecho:** `dev`

Para el detalle de cada arreglo ya hecho, ver `documentacion/cambios/`.
Para el histórico completo de la depuración, `documentacion/BACKLOG_DEPURACION.md`
(42 ítems, 29 resueltos). Este documento es el que hay que mirar para saber qué queda.

---

## 0. Lo primero: nada de esto está en producción

`dev` va **35 commits por delante de `main`**. Producción sigue en el estado de
principios de septiembre, así que **todo lo arreglado no le sirve a nadie todavía**: el
drift del esquema, las fugas de tarifas, la suplantación al registrar horas, el cron de
tasas de cambio apuntando a un host inexistente, la auditoría, el planificador de tareas.

Antes de desplegar hay que:

- [ ] Aplicar las migraciones en **Supabase**. La del drift es idempotente, así que es
      segura; la de `FinancialEntry` copia los datos antes de borrar las tablas viejas.
- [ ] Confirmar que Render acepta **Node 24** (`NODE_VERSION` en `render.yaml`). Es
      reversible en una línea si algo falla.
- [ ] Asegurarse de que las variables `AUTH_DEV_*` **no existan** en producción. Son el
      simulador de rol; están apagadas por defecto y protegidas por tres cerrojos, pero
      no deben estar ahí.
- [ ] Crear en Render el cron `app-gestion-jobs` si el Blueprint no lo aplica solo, y
      comprobar con `GET /api/jobs/status` que quedó activo.
- [ ] Revisar si las tasas de cambio quedaron congeladas durante los meses en que el cron
      apuntaba a un host que no existía.
- [ ] **Avisar al equipo de que varios proyectos van a cambiar de color.** El semáforo
      ahora usa el umbral configurado de cada proyecto en vez de un 15 fijo, y el
      portafolio dejó de contar el forecast dos veces. Si hay informes ya entregados con
      los colores viejos, conviene explicarlo antes.

---

## 1. Decisiones que necesitan a una persona, no a un desarrollador

Nada de esto se puede resolver leyendo código.

| # | Decisión | Por qué hace falta |
|---|---|---|
| D-1 | **¿El dominio `synaptica.cc` es nuestro?** `SMTP_FROM` usa `noreply@synaptica.cc` mientras el resto del proyecto usa `synaptica.co`. Si no es un dominio propio, **todo correo saliente lleva un remitente ajeno** y acaba en spam. (DEP-22) | Nadie puede confirmarlo desde el código |
| D-2 | **¿El umbral de margen por defecto debe ser 15 %?** Cuando un proyecto no tiene `marginThreshold` configurado se aplica 15, que era el comportamiento de facto. La alternativa es poblarlo en todos los proyectos y quitar el valor por defecto. | Es una regla de negocio |
| D-3 | **¿Un VIEWER debe ver los movimientos de todos los proyectos?** `GET /api/financial-entries` no aplica alcance por rol, a diferencia de otros módulos. | Política de visibilidad |
| D-4 | **¿Los ingresos se categorizan?** `FinancialEntry.category` solo se usa en gastos y queda nulo en ingresos, sin que el esquema lo impida. | Cambio de modelo si la respuesta es sí |
| D-5 | **¿La jornada laboral se configura por país, por consultor o ambos?** Necesario para poder arreglar DEP-41. | Define el diseño |
| D-6 | **Credenciales SMTP de prueba** para poder corregir el TLS del correo sin romper el envío. | Sin un buzón de prueba no se puede verificar |

---

## 2. Pendientes técnicos, por valor

### Alto

**DEP-41 — La jornada laboral no se puede configurar.**
`CapacityConfig` tiene `hoursPerDay` (8 por defecto) y `workDaysPerWeek` (5), por consultor
o por país, y `capacity.routes.ts` los lee en cinco sitios. Pero **no existe endpoint ni
formulario que los escriba**, así que la fila siempre es nula y toda la capacidad se calcula
con 8 h y 5 días para todo el mundo, sin importar el país ni la jornada real.
Bloqueado por D-5.

**Sin paginación.** Casi todos los `GET /` devuelven el conjunto completo
(`time-entries`, `extra-hours`, `consultants`, `projects`…). Solo `/api/audit` pagina, y
puede servir de plantilla. A medida que crezcan los datos, esto se vuelve el cuello de
botella; `AuditLog` además crece más rápido desde que guarda `before` y `after` completos.

**El TLS del correo está debilitado.** `utils/notifications.ts` usa
`rejectUnauthorized: false` y `ciphers: "SSLv3"`. Bloqueado por D-6.

### Medio

**DEP-32 — La conversión de moneda falla en silencio.** `convertAmountFallback` devuelve el
importe sin convertir cuando no hay tasa, en vez de señalarlo. Los importes salen en su
moneda original pero rotulados con la moneda base. Afecta especialmente a la nómina.

**`GET /api/projects/:id/detail` escribe dentro de una lectura.** Si el `healthStatus`
calculado difiere del guardado, hace un `update` dentro de un `GET`, y sin auditarlo.

**Los deltas «vs período anterior» del tablero comparan peras con manzanas.** Un total del
servidor ya convertido contra una suma local en monedas mezcladas. Arreglarlo bien exige que
`/stats/overview` devuelva los totales del período anterior.

**DEP-05 y DEP-06 — Enums muertos.** `AssignmentStatus.PARTIAL` nunca se escribe pero
aparece en 12 filtros de lectura; `AlertType.CONSULTANT_OVERLOADED` nunca se genera, aunque
`capacity.ts` ya calcula el estado `OVERLOADED` y conectarlos sería trabajo corto.
*(Decisión previa: dejarlos documentados por ahora.)*

**Nadie vigila que el cron esté vivo.** Si el Blueprint no lo aplica y nadie lo crea a mano,
las tareas periódicas vuelven a no ejecutarse **en silencio**. Ya pasó con el cron de tasas
de cambio, que apuntó a un host inexistente durante meses sin que nadie lo notara.

**La auditoría no es transaccional.** Se escribe después de confirmar la operación, así que
si el proceso muere en medio, la operación queda sin rastro. Es deliberado —lo contrario
haría fallar operaciones que sí ocurrieron— pero conviene saberlo. Tampoco hay política de
retención para `AuditLog`.

### Bajo

- **DEP-42** — `Consultant.maxHoursPerDay` no entra en ningún cálculo y `skills` no existe
  ni en el esquema ni en la interfaz, pese a que la documentación describe "tags de
  habilidades". Campos muertos: implementarlos o retirarlos.
- **DEP-08** — Unas 20 funciones de `services/api.ts` sin usar (hitos, riesgos,
  incidencias). Son andamiaje de pantallas nunca construidas: primero decidir producto.
- **DEP-14** — `TODO(backend)` duplicado en `periodUtils.ts` sobre rangos ISO.
- **El nombre del producto no es consistente**: `Synatrack` en el repositorio, `SynaTrack`
  en la interfaz, `App Gestión` y `app-gestion-*` en los servicios y la base de datos.

---

## 3. Una trampa que ya apareció cinco veces

**Campos que el backend lee y que nadie puede escribir.** El modelo declara la columna, el
código la consulta, pero no está en ningún esquema Zod ni en ningún formulario, así que
queda siempre nula y la funcionalidad que depende de ella **no funciona, sin dar error**.

Ya pasó con `projectManagerEmail` (la aprobación de horas extra por el PM era imposible),
`marginThreshold` y `budgetAlertPct` (el umbral configurado se ignoraba), `identification`
(el documento salía siempre "No asignado" en la nómina) y `CapacityConfig` (DEP-41, todavía
abierto).

**Si agregas un campo al modelo, agrégalo también al esquema Zod y al formulario en el mismo
cambio.** Y si encuentras código que lee un campo, comprueba que exista forma de escribirlo.

---

## 4. Cómo verificar lo que hagas

El proyecto tiene con qué demostrar que un cambio funciona; úsalo.

```bash
cd backend && npm test          # 195 pruebas unitarias (cálculo puro)
cd backend && npm run test:routes   # 78 pruebas de ruta, con base y autorización reales
cd frontend && npm test         # 135 pruebas
cd frontend && npx tsc -b --noEmit  # ojo: `tsc --noEmit` a secas NO verifica nada aquí
```

Para probar comportamiento por rol hay un **simulador**: variables `AUTH_DEV_EMAIL` y
`AUTH_DEV_ROLES`, o los encabezados `x-dev-email` y `x-dev-roles` con
`AUTH_DEV_ROLE_HEADER=true`. Sin él, el bypass de demo entra siempre como ADMIN y **ninguna
falla de autorización se manifiesta en local**.

Entorno local completo: `.\scripts\dev.ps1`. Detalle en `documentacion/DESARROLLO_LOCAL.md`.

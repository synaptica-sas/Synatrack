# R8 — Scheduler de trabajos de mantenimiento

Rama `feat/scheduler`, sale de `dev`.

## El problema

`runAssignmentMaintenance` (sincroniza estados de asignación: `PLANNED` → `ACTIVE` →
`COMPLETED` según las fechas) y `runAlertEngine` (alertas de presupuesto, margen y
asignaciones que terminan) se ejecutaban **una sola vez, al arrancar el proceso**.

En Render con plan free el servicio se duerme a los 15 minutos de inactividad y solo
despierta con una petición. En la práctica, esos trabajos podían pasar **días sin correr**:
las alertas quedaban obsoletas y las asignaciones seguían marcadas como `PLANNED` cuando ya
habían empezado. El módulo de alertas era prácticamente decorativo.

Estaba documentado como punto 3 de `DOCUMENTACION_TECNICA.md` §10.1.

## La solución, y por qué

Se atacó por dos vías, porque **ninguna sola cubre todos los entornos**.

### 1. Un ciclo de mantenimiento unificado

`backend/src/modules/jobs/jobs.service.ts` define `runMaintenanceCycle`, que corre los dos
trabajos en orden (primero asignaciones, luego alertas, para que las alertas de "asignación
que termina" vean los estados ya actualizados) con tres garantías:

- **No se solapa consigo mismo.** Un cerrojo de módulo, compartido entre el intervalo y el
  endpoint HTTP porque viven en el mismo proceso. Si hay un ciclo en curso, el siguiente
  devuelve `omitido: true` sin tocar la base.
- **Un trabajo caído no arrastra a los demás** ni tumba el proceso: cada uno va con su
  `try/catch` y la promesa nunca rechaza.
- **Cada ciclo y cada trabajo dejan su resultado y su duración en el log.**

### 2. Disparo externo: `POST /api/jobs/run`

Misma doble puerta que `POST /api/fx/sync`: token compartido en `Authorization: Bearer` para
el cron externo, o sesión normal con rol `ADMIN` para dispararlo a mano. El patrón se extrajo
a `backend/src/auth/shared-token.ts` y **`fx.routes.ts` ahora lo reutiliza** en vez de
duplicarlo.

`render.yaml` declara el cron `app-gestion-jobs`, cada hora en punto. Es la vía que **sí**
funciona en el plan free: despierta el servicio y dispara el ciclo.

Responde `200` aunque el ciclo se omita por solapamiento: para el cron eso no es un fallo, y
`curl -sf` no debe darse por caído.

Hay además `GET /api/jobs/status`, para comprobar en un entorno desplegado si el intervalo
está encendido y con qué cadencia.

### 3. Intervalo en proceso, apagado por defecto

`JOBS_INTERVAL_MINUTES` (0 = apagado, máximo 1440). Se arranca **solo en `server.ts`, nunca
en `buildApp()`**, para que las pruebas —que construyen la app decenas de veces— no dejen
temporizadores colgando.

Por defecto va apagado porque en Render free no sirve: el proceso duerme. Tiene sentido
ponerlo > 0 donde el proceso esté siempre despierto: Docker, on-premise o plan de pago.

Se agregó también apagado ordenado con `SIGINT`/`SIGTERM`: sin eso el temporizador mantiene
vivo el proceso y Render o Docker acaban matándolo a la fuerza en cada redespliegue.

**No se añadió ninguna dependencia.** `setInterval` basta para cadencias de minutos u horas;
`node-cron` habría sido peso extra sin ganancia.

## Verificación

Automática:

```
npx tsc --noEmit     → sin salida, exit 0
npm test             → 159 pruebas (eran 153; +6 del servicio de jobs)
npm run test:routes  → 72 pruebas (eran 63; +9 del endpoint)
```

Y contra el servidor compilado, que es lo que demuestra que el scheduler sirve:

- Con `JOBS_INTERVAL_MINUTES=1`, el log muestra `[Jobs] Intervalo en proceso ACTIVADO`, el
  ciclo de arranque, y **un minuto después un ciclo nuevo con `origen: intervalo`**,
  `completados: 2`, `fallidos: 0`. Ese segundo ciclo es la prueba de que el intervalo dispara.
- `GET /api/jobs/status` devuelve `intervaloActivo: true`, `cicloEnCurso: false`.
- `POST /api/jobs/run` con el token ejecuta los dos trabajos (`omitido: false`).
- Con autenticación real: sin credenciales **401**, con token equivocado **401**, con el token
  correcto **200**.

## Riesgos que quedan

- **El cerrojo es por proceso.** Si mañana hay dos instancias del backend, ambas pueden correr
  el ciclo a la vez. Para eso haría falta un cerrojo en base de datos. Hoy hay una sola
  instancia, así que no es un problema actual, pero sí una trampa al escalar.
- **El cron de Render exige plan `starter`**, igual que el de FX. En free no hay cron jobs.
- **La cadencia horaria es una decisión, no un cálculo.** Las alertas de presupuesto no
  necesitan más frecuencia; si alguien espera ver una alerta al instante tras registrar horas,
  no la va a ver.
- **Nadie vigila que el cron esté vivo.** Si el Blueprint no lo aplica y nadie lo crea a mano,
  volvemos al estado anterior en silencio. `GET /api/jobs/status` ayuda a comprobarlo, pero hay
  que acordarse de mirarlo. Igual que pasó con el cron de FX, que apuntaba a un host
  inexistente y nadie lo notó en meses (DEP-20).

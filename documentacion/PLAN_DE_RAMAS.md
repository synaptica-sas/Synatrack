# Plan de ramas — depuración de Synatrack

Los arreglos del `BACKLOG_DEPURACION.md` se agrupan en ramas independientes para poder
revisarlas por separado. Cada rama trae un solo tipo de cambio, con su documentación de qué
se hizo y cómo se verificó.

**Base:** `main`, en el commit `237a596`. Nada se ha empujado al remoto todavía.

**Decisiones tomadas por Juan (2026-09-18):**

- Componentes muertos del frontend: **borrar** (quedan en el historial de git).
- Despliegue: **Vercel y Azure SWA se usan los dos** → se arreglan ambos.
- Node: **unificar en 24**, previa verificación de que no rompe nada.
- `AssignmentStatus.PARTIAL` y `AlertType.CONSULTANT_OVERLOADED`: **dejar documentados**,
  no tocar el enum por ahora.

---

## Ramas

| # | Rama | Contenido | Riesgo | Agente |
|---|---|---|---|---|
| R1 | `fix/limpieza-frontend` | DEP-01/03/04 borrar componentes muertos · DEP-02 montar `ErrorBoundary` · DEP-07 clases CSS sin uso · DEP-16 arreglar la prueba que no prueba nada | Bajo | `frontend-react` |
| R2 | `fix/limpieza-backend` | DEP-09 quitar `as any` obsoletos · DEP-10 sacar la corrección de datos del camino de request · DEP-11 borrar script obsoleto · DEP-13 `prisma` a devDependencies · DEP-29/30 unificar logging · DEP-31 excluir pruebas del build | Bajo | `backend-fastify` |
| R3 | `fix/configuracion-entorno` | DEP-19 `output_location` y CI de Azure · DEP-20 host muerto del cron de FX · DEP-21 unificar Node 24 · DEP-23 validar `DIRECT_URL` · DEP-24 unificar `npm ci` | Medio | `backend-fastify` |
| R4 | `docs/actualizar-manuales` | DEP-25 instrucciones de arranque rotas · DEP-26 ramas inexistentes · DEP-27 descripción del RAG Chat · DEP-28 carpeta `contexto/` | Nulo | sesión principal |
| R5 | `fix/seguridad-datos` | Alcance por fila en `/api/time-entries` · `approvedBy` desde el token · no filtrar `stack` en producción · TLS del SMTP · escapar HTML en correos | **Alto** | `backend-fastify` + `revisor-seguridad` |
| R6 | `fix/duplicacion` | DEP-15 tercera copia de la matriz de permisos · DEP-17 helper de aprobación de horas extra · DEP-18 `findFxRate` duplicado | Medio | `backend-fastify` + `frontend-react` |

R5 y R6 cambian comportamiento y van al final, cuando las ramas de limpieza ya estén
revisadas. R1–R4 no deberían alterar ninguna funcionalidad.

---

## Reglas para cada rama

1. **Una rama = un tipo de cambio.** Si al arreglar algo aparece otra cosa, se anota en el
   backlog; no se mete en la rama en curso.
2. **Pruebas en verde antes de cerrar**, con la salida real pegada en el documento de la
   rama. `npm test` en `backend/` debe reportar **153** pruebas y `frontend/` **124**; si el
   número cambia, hay que explicar por qué.
3. **Cada rama deja su propio documento** en `documentacion/cambios/<rama>.md` con: qué se
   cambió, por qué, cómo se verificó y qué riesgos quedan. Eso es lo que se lee antes de
   aprobar el merge.
4. **Nada se empuja al remoto ni se mergea** sin que Juan lo revise.

---

## Estado

| Rama | Estado | Verificación |
|---|---|---|
| R1 | pendiente | — |
| R2 | pendiente | — |
| R3 | pendiente | — |
| R4 | pendiente | — |
| R5 | pendiente | — |
| R6 | pendiente | — |

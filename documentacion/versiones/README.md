# Versiones de Synatrack

Un archivo `.md` por cada versión desplegada a producción, con los cambios que trae
contra la versión anterior. La versión vigente está en `VERSION` (raíz del repo) y se
ve en el pie de página de la app.

Esto es **distinto** de `documentacion/cambios/`: esa carpeta tiene retrospectivas por
rama/entrega de depuración (`R1-...`, `R9-...`), pensadas para revisar un PR puntual.
Esta carpeta es el historial de versiones públicas de la app, pensado para responder
"¿qué cambió entre lo que hay en producción hoy y lo de la semana pasada?".

## Cómo se genera una versión nueva

Justo antes de fusionar `dev` a `main` para desplegar:

```bash
node scripts/release.mjs patch   # o minor / major
```

El tipo de cambio es obligatorio, no tiene default: hay que mirar los commits y decidir.

- `patch` — solo correcciones, nada de funcionalidad nueva.
- `minor` — funcionalidad nueva, compatible con lo que ya existía.
- `major` — rompe compatibilidad (p. ej. un cambio de esquema que exige migrar datos a
  mano, o quitar algo que otros módulos usaban).

El script junta los commits desde el último tag `v<version>` hasta `HEAD`, escribe
`v<version-nueva>.md` con esa lista, y actualiza `VERSION`, `backend/package.json`,
`frontend/package.json` y el `appVersion` del pie de página. No hace commit, no crea el
tag y no hace push — el script mismo imprime los comandos exactos al terminar.

**Antes de subir el changelog generado, reescríbelo.** El script deja los mensajes de
commit tal cual, que es ruido para cualquiera que no haya trabajado en el código esa
semana ("Merge branch...", "fix typo", etc. no le dicen nada a nadie). Conviene
agrupar por tema y describir el efecto visible del cambio, no el commit.

Si el tag del último `VERSION` no existe todavía (la primera vez que se usa este
mecanismo), créalo a mano apuntando al commit que ya está en producción:

```bash
git tag v1.0.0 <commit-en-produccion>
```

## Agente

`.claude/agents/versionador.md` hace este proceso dentro de una sesión de Claude Code:
corre el script, decide `patch`/`minor`/`major` mirando el rango de commits, y reescribe
el changelog en prosa antes de proponer el commit/tag. No hace push por su cuenta.

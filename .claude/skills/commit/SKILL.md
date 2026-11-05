---
name: commit
description: Alias "commit" de Synatrack. Crea un commit en la rama dev con todos los cambios pendientes y un mensaje en español que resume qué cambió y por qué; el autor es el empleado de Synaptica configurado en git y Claude queda como coautor indicando el modelo usado. No hace push (eso es /sync). Úsalo cuando el usuario diga "commit" o "/commit".
---

# commit — commit en dev con resumen de cambios

Si viene un argumento, úsalo como pista para el título o el alcance (por ejemplo, "solo backend").

## 1. Chequeos (si alguno falla, detente y avisa)

- **Rama**: `git branch --show-current` debe ser `dev`. Si no lo es, no cambies de rama por tu cuenta:
  pregunta.
- **Autor**: `git config user.name` y `git config user.email`. El correo debe ser `@synaptica.co`;
  si no, pregunta antes de seguir. El autor del commit es siempre esa persona, nunca Claude.
- **Hay algo que commitear**: `git status --short`. Si está limpio, dilo y termina.
- **Nada sensible**: revisa la lista de archivos. No incluyas `.env*` (salvo `*.example`),
  `settings.local.json`, credenciales, volcados de base ni archivos binarios grandes. Si aparecen,
  déjalos fuera y avísalo.

## 2. Entender los cambios

Lee `git diff` y `git diff --stat`, y los archivos nuevos (`git status --short` marca `??`).
Agrupa por tema (backend, frontend, migraciones, docs, pruebas). Si los cambios mezclan trabajos
claramente independientes, propón partirlos en varios commits y pregunta; si no, va uno solo.
Señala las migraciones nuevas de `backend/prisma/migrations/` en el cuerpo.

## 3. Mensaje (estilo del repo)

- **Título** en español, imperativo, sin prefijos tipo `feat:`, sin punto final, ≤ 72 caracteres.
  Si el cambio tiene código de requerimiento (R-054, R14…), ponlo entre paréntesis al final.
  Ejemplos reales: "Cerrar fugas de autorización entre roles", "Enlace directo Consultant.userId
  <-> User.id (R-054)".
- **Cuerpo** en prosa o viñetas cortas, ajustado a ~72 columnas: qué problema resuelve, qué cambia
  para el usuario y decisiones no obvias. No listes archivo por archivo.
- **Cierre**: una línea en blanco y luego el coautor con el modelo **de esta sesión** (el nombre
  real del modelo que estás usando, no uno fijo):

  ```
  Co-Authored-By: Claude <Modelo> <noreply@anthropic.com>
  ```

  Por ejemplo `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## 4. Crear el commit

`git add` de los archivos elegidos (por ruta, no `git add -A` a ciegas si dejaste algo fuera) y
`git commit -F <archivo>` con el mensaje escrito en el scratchpad (evita problemas de comillas).
Nunca `--amend`, `--no-verify` ni `--author`: el autor sale de la configuración de git.

## 5. Reporte

Hash corto, título, autor, coautor, número de archivos y lo que quedó fuera (si algo). Recuerda que
el commit es local: para subirlo, `/sync`.

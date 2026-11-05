---
name: sync
description: Alias "sync" de Synatrack. Sincroniza la rama dev local con origin/dev: trae lo nuevo del remoto con rebase (sin commits de merge) y sube los commits locales. Nunca hace force push. Úsalo cuando el usuario diga "sync" o "/sync".
---

# sync — sincronizar dev con origin/dev

Objetivo: que `dev` local y `origin/dev` queden iguales, sin crear commits de
"Merge branch 'dev' of ..." (un merge así ya reintrodujo código borrado una vez).

## 1. Chequeos

- `git branch --show-current` debe ser `dev`. Si no, pregunta; no cambies de rama por tu cuenta.
- `git status --short`: si hay cambios sin commit, dilo. Se conservan con `--autostash`, pero
  ofrece primero `/commit` si parecen trabajo terminado.
- `git fetch origin` y `git rev-list --left-right --count HEAD...origin/dev` → (locales, remotos).
  Muestra `git log --oneline HEAD..origin/dev` (lo que llega) y `origin/dev..HEAD` (lo que sube).

## 2. Traer

- Remotos = 0: nada que traer.
- Locales = 0: `git merge --ff-only origin/dev`.
- Ambos > 0: `git rebase --autostash origin/dev`.
  - **Si hay conflictos**: detente, muestra los archivos en conflicto y qué trae cada lado, y
    pregunta cómo resolver. No resuelvas por tu cuenta borrando el trabajo de nadie; si el usuario
    prefiere abandonar, `git rebase --abort` deja todo como estaba.
- Si llegan migraciones nuevas en `backend/prisma/migrations/` o cambios en `package.json`, avísalo:
  hace falta `/reconstruir` (o `npm ci`) para verlos en local.

## 3. Subir

Si hay commits locales: `git push origin dev`. **Nunca** `--force` ni `--force-with-lease`; si el
push es rechazado, vuelve al paso 1 (alguien subió algo mientras tanto).

## 4. Reporte

Cuántos commits llegaron y cuántos subieron (con sus títulos), si quedó el autostash aplicado,
y `git rev-list --left-right --count HEAD...origin/dev` final, que debe dar `0 0`.

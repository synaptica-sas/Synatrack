---
name: reconstruir
description: Alias "reconstruir" del entorno Docker local de Synatrack. Reconstruye las imágenes de frontend y backend con los últimos cambios (usando caché) y vuelve a publicar los contenedores en local, sin tocar la base. Úsalo cuando el usuario diga "reconstruir" o "/reconstruir".
---

# reconstruir — build incremental y republicar en local

"Publicar" aquí es **levantar los contenedores locales** con `docker compose`, no desplegar a
Render/Vercel/Azure ni a producción. Nunca uses `down -v` ni borres volúmenes.

1. **Chequeo previo**: `git status --short` y, tras `git fetch`,
   `git rev-list --left-right --count HEAD...origin/dev`, para decir qué entra en la build.
   No hagas pull ni merge por tu cuenta: si `origin/dev` va por delante, avísalo y pregunta.
   Menciona las migraciones nuevas si las hay (se aplican solas al arrancar el backend).
2. **Reconstruir y publicar**: `docker compose up -d --build`. Recrea solo lo que cambió; la base
   sigue corriendo. Si el build falla, muestra el error real y detente sin tocar código.
   Con argumento `solo frontend` / `solo backend`: `docker compose up -d --build --no-deps <servicio>`
   (el otro servicio no se reinicia; con solo frontend no hay migraciones que revisar).
3. **Verificar** (espera ~12 s):
   - `docker compose ps`, todos `Up` y la base `healthy`.
   - Frontend `http://localhost:4173` y backend `http://localhost:4000/api/projects` responden 200.
   - Logs del backend: migraciones aplicadas y sin `level":50`.
4. **Reporte corto**: tabla con servicio, ID de imagen y estado; qué cambios incluye; migraciones.

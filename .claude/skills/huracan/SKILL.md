---
name: huracan
description: Alias "huracan" del entorno Docker local de Synatrack. Borra los contenedores y las imágenes de frontend y backend, los reconstruye desde cero (sin caché) y vuelve a levantar todo, conservando la base y sus volúmenes. Úsalo cuando el usuario diga "huracan" o "/huracan".
---

# huracan — reconstrucción desde cero (sin tocar datos)

Todo desde la raíz del repo, con `docker compose`. **Nunca** uses `down -v`, `volume rm` ni
borres `app-gestion-db`: la base y el volumen `pgdata` se conservan siempre.

1. **Chequeo previo** (no lo saltes):
   - `git status --short` y `git rev-list --left-right --count HEAD...origin/dev` (tras `git fetch`)
     para decir qué cambios entran en la build (locales sin commit / commits nuevos en el remoto).
     No hagas pull ni merge por tu cuenta: si `origin/dev` va por delante, avísalo y pregunta.
   - Si hay migraciones nuevas en `backend/prisma/migrations/`, menciónalas: se aplican solas al
     arrancar el backend (`prisma migrate deploy`).
2. **Borrar**: `docker compose rm -s -f backend frontend` y luego
   `docker rmi synatrack-backend:latest synatrack-frontend:latest`. Las imágenes con tag de versión
   (`2.1.0`, etc.) **no** se borran.
3. **Reconstruir**: `docker compose build --no-cache backend frontend`. Si falla, muestra el error
   real (`tsc`, Prisma) y detente: no intentes arreglar código sin preguntar.
4. **Levantar**: `docker compose up -d`.
5. **Verificar** (espera ~12 s):
   - `docker compose ps`, todos `Up` y la base `healthy`.
   - Frontend `http://localhost:4173` responde 200.
   - Backend `http://localhost:4000/api/projects` responde 200.
   - Logs del backend: migraciones aplicadas y sin `level":50`.
6. **Reporte corto**: una tabla con servicio, ID de imagen nueva y estado; qué cambios incluye;
   migraciones aplicadas. Recuerda que la base y los datos quedaron intactos.

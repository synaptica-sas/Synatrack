# Desarrollo local

Cómo levantar Synatrack en una máquina Windows, y qué herramientas de apoyo hay configuradas.

---

## 1. Levantar la aplicación

Con todo ya instalado (ver §3 si es una máquina nueva):

```powershell
.\scripts\dev.ps1
```

Arranca la base de datos, el backend y el frontend, espera a que el backend responda
y abre el navegador. Cada servicio queda en su propia ventana de PowerShell.

| Servicio | URL | Notas |
|---|---|---|
| Frontend | http://localhost:5173 | |
| Backend | http://localhost:4000 | `/health` reporta también el estado de la base |
| Postgres | localhost:5433 | usuario `postgres`, clave `postgres`, base `app_gestion_demo` |

El backend corre en **modo demo** (`AUTH_ENABLED=false`, `AUTH_DEMO_BYPASS=true`): entra
automáticamente como `ADMIN` sin pasar por Microsoft. Para probar el login real de Entra ID
hay que poner las variables de Azure en `backend/.env` y `frontend/.env` y apagar el bypass.

### Comandos sueltos

```powershell
.\scripts\db.ps1 start|stop|status|psql|reset   # solo la base de datos
cd backend;  npm run dev                        # solo el backend
cd frontend; npm run dev                        # solo el frontend
cd backend;  npm test                           # 153 tests
cd frontend; npm test                           # 124 tests
```

`.\scripts\db.ps1 reset` borra la base, reaplica las migraciones y vuelve a sembrar.
Útil cuando una migración deja los datos en un estado raro.

> El seed (`backend/prisma/seed.mjs`) crea **solo los roles y el usuario administrador**,
> no datos de demostración. La app arranca vacía: hay que crear proyectos y consultores
> a mano, o cargar datos de prueba.

---

## 2. Base de datos: Postgres portable

No usamos Docker en esta máquina. Hay una instalación **portable** de PostgreSQL 15.15
(la misma versión mayor que `docker-compose.yml`) fuera del repositorio:

```
C:\Users\<usuario>\Synatrack\pg-local\
  pgsql\      binarios oficiales de EnterpriseDB
  data\       el clúster (los datos reales)
  pg.log      log del servidor
```

No es un servicio de Windows: **solo corre cuando lo arrancas** con `.\scripts\db.ps1 start`.
No requiere permisos de administrador ni toca la instalación del sistema. Para eliminarlo,
basta con borrar la carpeta `pg-local`.

### Recrearlo desde cero

```powershell
$root = 'C:\Users\<usuario>\Synatrack\pg-local'
Invoke-WebRequest 'https://get.enterprisedb.com/postgresql/postgresql-15.15-1-windows-x64-binaries.zip' -OutFile "$env:TEMP\pg15.zip"
Expand-Archive "$env:TEMP\pg15.zip" -DestinationPath $root
"postgres" | Set-Content "$env:TEMP\pw.txt" -NoNewline
& "$root\pgsql\bin\initdb.exe" -D "$root\data" -U postgres --pwfile="$env:TEMP\pw.txt" -E UTF8 --locale=C -A scram-sha-256
Remove-Item "$env:TEMP\pw.txt"
& "$root\pgsql\bin\pg_ctl.exe" -D "$root\data" -l "$root\pg.log" -o "-p 5433" start
$env:PGPASSWORD='postgres'; & "$root\pgsql\bin\createdb.exe" -U postgres -h 127.0.0.1 -p 5433 app_gestion_demo
```

Después, desde `backend/`: `npm run prisma:deploy` y `npm run prisma:seed`.

---

## 3. Instalación en una máquina nueva

1. **Node.js 24** (el que declaran ambos `package.json`).
2. `cd backend && npm install` y `cd frontend && npm install`.
3. `cp backend/.env.example backend/.env` y ajustar `DATABASE_URL`/`DIRECT_URL` al puerto 5433
   (el propio ejemplo trae ese par comentado; hay que descomentarlo y borrar las cadenas de Supabase).
4. `cp frontend/.env.example frontend/.env`, dejar `VITE_API_URL=http://localhost:4000`,
   `VITE_FORCE_LOCAL_AUTH=true` y **vaciar** las variables `VITE_AZURE_*` (si quedan con los
   placeholders `<...>`, MSAL intenta inicializarse con un client id inválido).
5. Postgres portable: §2.
6. `cd backend && npm run prisma:generate && npm run prisma:deploy && npm run prisma:seed`.

---

## 4. Herramientas de apoyo para Claude Code

Dos piezas, con propósitos distintos, ambas orientadas a gastar menos contexto.

### 4.1 Mapa del proyecto (`documentacion/MAPA_PROYECTO.md`)

Archivo **generado** que concentra, en un solo lugar:

- los **125 endpoints** con su método, ruta, roles reales (`authorize([...])`) y archivo;
- las **16 pantallas** con su `TabId`, permiso y componente;
- el **grafo de dependencias** entre módulos de backend y frontend, en Mermaid.

Regenerarlo después de agregar rutas, pantallas o módulos:

```powershell
node scripts/generate-map.mjs
```

Es la alternativa barata a explorar el repo con decenas de `grep`: responde
"¿dónde vive X?" y "¿quién puede llamar Y?" leyendo un archivo.

### 4.2 Graphify (grafo de conocimiento del código)

[Graphify](https://github.com/Graphify-Labs/graphify) convierte el repo en un grafo consultable.
Parsea con tree-sitter **en local, sin LLM y sin API key** para código, y sin vector store: las
aristas son relaciones reales (`calls`, `imports`, `references`), no similitud semántica.

Instalado con `uv tool install "graphifyy[sql]"` (el extra `[sql]` hace falta para que lea las
migraciones de Prisma; sin él las salta). El skill quedó en `~/.claude/skills/graphify/`, con una
línea en `~/.claude/CLAUDE.md` que lo activa cuando se escribe `/graphify`.

Construir o actualizar el grafo:

```powershell
graphify extract . --code-only        # ~1 min, 164 archivos -> 1307 nodos, 3014 aristas
graphify cluster-only . --no-label    # regenera GRAPH_REPORT.md y graph.html
```

Consultarlo:

```powershell
graphify god-nodes --top 12           # los nodos más conectados (hubs arquitectónicos)
graphify affected "authenticate"      # qué se rompe si tocas X (traversal inverso)
graphify path "App()" "prisma"        # camino más corto entre dos nodos
graphify explain "calculateExtraHours"
graphify query "como se aprueban las horas extra" --budget 2000
graphify benchmark                    # mide la reducción de tokens
```

La salida vive en `graphify-out/` y **está en `.gitignore`**: son ~3 MB de artefactos generados que
cambiarían en cada commit, y reconstruirlos cuesta un minuto sin depender de nada externo.

Qué funciona bien y qué no, medido en este repo:

- `god-nodes` acertó los hubs reales (`authenticate()` con 61 aristas, `authorize()` con 51).
- `affected` es preciso y es el mejor uso diario: lista exactamente quién depende de un símbolo,
  con archivo y línea.
- `benchmark` reporta **5.7x menos tokens** por consulta frente a leer el corpus completo.
- `query` es más ruidoso: hace BFS y devuelve cientos de nodos que hay que truncar. Mejoraría
  bastante con nombres de comunidad reales, pero eso requiere un backend LLM
  (`graphify label .` con `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, Ollama, etc.). Hoy las comunidades
  se llaman "Community 5", lo que resta legibilidad al reporte.

### 4.3 Playwright (revisión de UI sin intervención manual)

Servidor MCP declarado en `.mcp.json` que le da al agente `revisor-ui` un navegador real:
navegar, hacer clic, escribir, cambiar el tamaño de ventana, tomar capturas y leer la
consola y las peticiones de red. Sirve para revisar el front **sin que nadie tenga que
abrir el navegador y describir lo que ve**.

Chromium ya está instalado en esta máquina (`npx playwright install chromium`). La cadena
completa está verificada: se tomó una captura real de `http://localhost:5173/` con la app
corriendo.

Claude Code pide aprobación la primera vez que arranca el servidor MCP del proyecto
(comando `/mcp` para ver el estado). El servidor corre con `--isolated`, así que no
persiste perfil ni sesión entre ejecuciones.

Requisito: **la app tiene que estar corriendo** (`.\scripts\dev.ps1`). El agente lo
verifica antes de empezar.

### 4.4 Serena — evaluada y descartada

Se probó [Serena](https://github.com/oraios/serena) (navegación semántica vía language
servers) y se descartó a favor de Graphify. La razón fue el **modelo de costo**: Graphify se
usa por CLI y no gasta contexto hasta invocarse, mientras que un servidor MCP carga sus
definiciones de herramientas en cada conversación, se use o no. Queda anotado por si en el
futuro pesa más la edición a nivel de símbolo dentro de los archivos de 2000+ líneas.

---

## 5. Agentes especializados

El trabajo en este proyecto se organiza **principalmente con agentes**, uno por área, en
`.claude/agents/`. No hay ciclo de specs ni comandos propios: se invoca al agente que
corresponde y se le da la tarea.

| Agente | Modelo | Área |
|---|---|---|
| `backend-fastify` | sonnet | Rutas, Zod, autorización, auditoría, cierre mensual |
| `base-de-datos` | sonnet | Esquema Prisma, migraciones, índices |
| `frontend-react` | sonnet | Pantallas, hooks, `services/api.ts`, estilos |
| `calculos-negocio` | opus | `utils/`: horas extra, EVM, FX, capacidad |
| `qa-pruebas` | opus | Vitest, casos borde, verificación manual |
| `revisor-ui` | sonnet | Revisión en navegador real con Playwright |
| `revisor-seguridad` | opus | Autorización, fuga de datos, secretos |

Criterios con los que están escritos, por si hay que agregar otro:

- **Las reglas son específicas de este repo**, no principios generales. Cada agente cita los
  bugs concretos que no debe replicar (`approvedBy` desde el body, `db push`, hooks que se
  tragan errores). Un agente con reglas genéricas no aporta nada sobre el modelo base.
- **Fronteras explícitas** en la `description`: qué le toca y qué no, para que no se pisen.
- **Exigen evidencia real** en "Cómo entregas": salida de comandos, capturas, no "listo".
- Implementadores en `sonnet`; revisores y cálculos financieros en `opus`.

`.claude/settings.json` acota los permisos (lectura amplia, escritura limitada al código y
la documentación, confirmación para `git commit/push` y para `prisma migrate dev`/`db push`).

> Resuelto: la regla `deny` ya es `"Read(./**/.env)"` (más `backend/.env` y `frontend/.env`), así
> que los `.env.example` se pueden leer y los `.env` reales siguen bloqueados.

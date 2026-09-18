# Controla el Postgres portable local (PostgreSQL 15.15, puerto 5433).
#
# Uso:
#   .\scripts\db.ps1 start
#   .\scripts\db.ps1 stop
#   .\scripts\db.ps1 status
#   .\scripts\db.ps1 psql      # abre una consola SQL contra app_gestion_demo
#   .\scripts\db.ps1 reset     # borra y recrea la base, aplica migraciones y seed
#
# Los binarios y los datos viven FUERA del repositorio, en:
#   C:\Users\<usuario>\Synatrack\pg-local\
# Si no existen, ver documentacion/DESARROLLO_LOCAL.md para recrearlos.

param(
    [Parameter(Position = 0)]
    [ValidateSet('start', 'stop', 'status', 'psql', 'reset')]
    [string]$Action = 'status'
)

$ErrorActionPreference = 'Stop'

$PgRoot = Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'pg-local'
$PgBin = Join-Path $PgRoot 'pgsql\bin'
$PgData = Join-Path $PgRoot 'data'
$PgLog = Join-Path $PgRoot 'pg.log'
$Port = 5433
$DbName = 'app_gestion_demo'
$BackendDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'backend'

if (-not (Test-Path (Join-Path $PgBin 'pg_ctl.exe'))) {
    Write-Error "No se encontro Postgres portable en $PgRoot. Ver documentacion/DESARROLLO_LOCAL.md"
}

$env:PGPASSWORD = 'postgres'

switch ($Action) {
    'start' {
        & "$PgBin\pg_ctl.exe" -D $PgData -l $PgLog -o "-p $Port" start
    }
    'stop' {
        & "$PgBin\pg_ctl.exe" -D $PgData stop -m fast
    }
    'status' {
        & "$PgBin\pg_ctl.exe" -D $PgData status
    }
    'psql' {
        & "$PgBin\psql.exe" -U postgres -h 127.0.0.1 -p $Port -d $DbName
    }
    'reset' {
        Write-Host "Recreando la base $DbName ..." -ForegroundColor Yellow
        & "$PgBin\dropdb.exe" -U postgres -h 127.0.0.1 -p $Port --if-exists $DbName
        & "$PgBin\createdb.exe" -U postgres -h 127.0.0.1 -p $Port $DbName
        Push-Location $BackendDir
        try {
            npm run prisma:deploy
            npm run prisma:seed
        }
        finally { Pop-Location }
        Write-Host "Base recreada." -ForegroundColor Green
    }
}

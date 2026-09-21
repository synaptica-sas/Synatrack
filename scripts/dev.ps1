# Levanta el entorno local completo: Postgres + backend + frontend.
#
# Uso:
#   .\scripts\dev.ps1          # arranca todo y abre el navegador
#   .\scripts\dev.ps1 -NoOpen  # arranca todo sin abrir el navegador
#
# Backend  -> http://localhost:4000  (modo demo, entra como ADMIN sin login)
# Frontend -> http://localhost:5173
#
# Cada servicio arranca en su propia ventana de PowerShell; se cierran con Ctrl+C
# en cada ventana. La base de datos sigue corriendo aparte (.\scripts\db.ps1 stop).

param([switch]$NoOpen)

$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent

Write-Host "1/3  Base de datos..." -ForegroundColor Cyan
& "$PSScriptRoot\db.ps1" start

Write-Host "2/3  Backend (puerto 4000)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList '-NoExit', '-Command', "Set-Location '$Root\backend'; npm run dev"

Write-Host "3/3  Frontend (puerto 5173)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList '-NoExit', '-Command', "Set-Location '$Root\frontend'; npm run dev"

Write-Host "`nEsperando a que el backend responda..." -ForegroundColor Cyan
$ok = $false
foreach ($i in 1..30) {
    Start-Sleep -Seconds 2
    try {
        $r = Invoke-WebRequest -Uri 'http://localhost:4000/health' -UseBasicParsing -TimeoutSec 3
        if ($r.StatusCode -eq 200) { $ok = $true; break }
    }
    catch { }
}

if ($ok) {
    Write-Host "Backend OK  -> http://localhost:4000/health" -ForegroundColor Green
    Write-Host "Frontend    -> http://localhost:5173" -ForegroundColor Green
    if (-not $NoOpen) { Start-Process 'http://localhost:5173' }
}
else {
    Write-Warning "El backend no respondio a tiempo. Revisa la ventana del backend."
}

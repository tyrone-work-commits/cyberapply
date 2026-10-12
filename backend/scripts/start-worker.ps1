param([switch]$Once)
$ErrorActionPreference = 'Stop'
$backendRoot = Split-Path -Parent $PSScriptRoot
$pythonPath = Join-Path (Split-Path -Parent $backendRoot) '.venv\Scripts\python.exe'
Push-Location $backendRoot
try {
    if ($Once) { & $pythonPath -m app.workers --once } else { & $pythonPath -m app.workers }
} finally { Pop-Location }

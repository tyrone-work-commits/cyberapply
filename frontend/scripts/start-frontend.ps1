param([int]$Port = 3000, [switch]$Production)
$ErrorActionPreference = 'Stop'
$frontendRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies'
$bundledNode = Join-Path $runtimeRoot 'node\bin\node.exe'
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodePath = if ($nodeCommand) { $nodeCommand.Source } elseif (Test-Path -LiteralPath $bundledNode) { $bundledNode } else { throw 'Install Node.js 20.9 or newer, then install frontend dependencies with pnpm install.' }
$nextPath = Join-Path $frontendRoot 'node_modules\next\dist\bin\next'
if (-not (Test-Path -LiteralPath $nextPath)) { throw 'Install frontend dependencies first. See frontend\README.md.' }
$env:PATH = (Split-Path -Parent $nodePath) + ';' + $env:PATH
Push-Location $frontendRoot
try {
    if ($Production) { & $nodePath $nextPath start --hostname 127.0.0.1 --port $Port }
    else { & $nodePath $nextPath dev --hostname 127.0.0.1 --port $Port }
} finally { Pop-Location }

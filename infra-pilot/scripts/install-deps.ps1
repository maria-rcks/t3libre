<# .SYNOPSIS
Install all dependencies for Infra Pilot services on Windows.
.PARAMETER Offline
Skip package downloads (use cached artifacts only)
#>
param([switch]$Offline)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir

function Info    { Write-Host "[INFO] $($args[0])" -ForegroundColor Blue }
function Success { Write-Host "[OK]   $($args[0])" -ForegroundColor Green }
function Warn    { Write-Host "[WARN] $($args[0])" -ForegroundColor Yellow }
function Error   { Write-Host "[ERR]  $($args[0])" -ForegroundColor Red }

Set-Location $RootDir

# Node.js dependencies
if (Get-Command npm -ErrorAction SilentlyContinue) {
    $mgmtPanel = Join-Path $RootDir "services/management-panel"
    if (Test-Path $mgmtPanel) {
        Info "Installing management-panel npm dependencies..."
        if (!$Offline) {
            npm ci --prefix $mgmtPanel 2>$null
            if ($LASTEXITCODE -ne 0) { npm install --prefix $mgmtPanel }
        }
        Success "management-panel dependencies installed"
    }

    $discord = Join-Path $RootDir "services/discord-service"
    if (Test-Path $discord) {
        Info "Installing discord-service npm dependencies..."
        if (!$Offline) {
            npm ci --prefix $discord 2>$null
            if ($LASTEXITCODE -ne 0) { npm install --prefix $discord }
        }
        Success "discord-service dependencies installed"
    }
} else { Warn "npm not found, skipping Node.js dependencies" }

# Python dependencies
$pip = if (Get-Command pip3 -ErrorAction SilentlyContinue) { "pip3" } elseif (Get-Command pip -ErrorAction SilentlyContinue) { "pip" } else { $null }
if ($pip) {
    if (!$Offline) {
        $rootReq = Join-Path $RootDir "requirements.txt"
        if (Test-Path $rootReq) {
            Info "Installing root Python dependencies..."
            & $pip install -r $rootReq
            Success "Root Python dependencies installed"
        }
        $orchReq = Join-Path $RootDir "services/orchestrator-agent/requirements.txt"
        if (Test-Path $orchReq) {
            Info "Installing orchestrator-agent Python dependencies..."
            & $pip install -r $orchReq
        }
        $intReq = Join-Path $RootDir "services/integration-service/requirements.txt"
        if (Test-Path $intReq) {
            Info "Installing integration-service Python dependencies..."
            & $pip install -r $intReq
        }
    }
} else { Warn "pip not found, skipping Python dependencies" }

Success "All dependencies installed"
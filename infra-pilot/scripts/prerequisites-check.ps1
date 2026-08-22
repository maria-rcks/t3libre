<# .SYNOPSIS
Check that all required tools are installed on Windows.
#>
param()

$ErrorActionPreference = "Stop"

function Info    { Write-Host "[INFO] $($args[0])" -ForegroundColor Blue }
function Success { Write-Host "[OK]   $($args[0])" -ForegroundColor Green }
function Warn    { Write-Host "[WARN] $($args[0])" -ForegroundColor Yellow }
function Error   { Write-Host "[ERR]  $($args[0])" -ForegroundColor Red }

function CheckCommand($cmd, $name, $required) {
    if (!(Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Error "$name not found. Install $name (required: $required)"
        return $false
    }
    try { $ver = & $cmd --version 2>&1 | Select-Object -First 1 } catch { $ver = "found" }
    Success "$name found: $ver"
    return $true
}

Info "Checking prerequisites..."
$failed = 0
if (!(CheckCommand docker "Docker" "20.10+")) { $failed++ }
if (!(CheckCommand node "Node.js" "18+")) { $failed++ }
if (!(CheckCommand python "Python" "3.9+")) { $failed++ }
if (!(CheckCommand git "Git" "2.0+")) { $failed++ }

try { docker compose version 2>&1 | Out-Null; Success "Docker Compose available" }
catch { Warn "Docker Compose not found (optional if using docker compose plugin)" }

if ($failed -eq 0) { Success "All prerequisites satisfied"; exit 0 }
else { Error "$failed prerequisite(s) missing"; exit 1 }
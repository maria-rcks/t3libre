<# .SYNOPSIS
Run health checks on the Infra Pilot project infrastructure on Windows.
.PARAMETER Json
Output results as JSON
.PARAMETER Strict
Exit with error if any warnings are present
#>
param([switch]$Json, [switch]$Strict)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir

function Success { Write-Host "[OK]   $($args[0])" -ForegroundColor Green }
function Warn    { Write-Host "[WARN] $($args[0])" -ForegroundColor Yellow }
function Error   { Write-Host "[ERR]  $($args[0])" -ForegroundColor Red }

$OkCount = 0
$WarnCount = 0

function CheckFile($file, $label) {
    $path = Join-Path $RootDir $file
    if (Test-Path $path) { Success $label; return $true }
    Error "$label (missing: $file)"
    return $false
}

function CheckDockerService($service, $label) {
    if (Get-Command docker -ErrorAction SilentlyContinue) {
        try {
            $status = docker ps --filter "name=$service" --format "{{.Status}}" 2>$null
            if ($status) { Success "$label ($status)"; return $true }
        } catch {}
    }
    Warn "$label (not running)"
    return $false
}

Write-Host "Running health checks..." -ForegroundColor Blue
Write-Host ""

Write-Host "--- File Checks ---"
if (CheckFile ".env.example" ".env example present") { $OkCount++ } else { $WarnCount++ }
if (CheckFile "docker-compose.yml" "docker compose config present") { $OkCount++ } else { $WarnCount++ }
if (CheckFile "services/orchestrator-agent/requirements.txt" "orchestrator-agent Python manifest present") { $OkCount++ } else { $WarnCount++ }
if (CheckFile "services/management-panel/package.json" "management-panel Node manifest present") { $OkCount++ } else { $WarnCount++ }
if (CheckFile "services/discord-service/package.json" "discord-service package manifest present") { $OkCount++ } else { $WarnCount++ }
if (CheckFile "services/orchestrator-agent/.env.example" "orchestrator-agent .env.example present") { $OkCount++ } else { $WarnCount++ }
if (CheckFile "services/management-panel/.env.example" "management-panel .env.example present") { $OkCount++ } else { $WarnCount++ }

Write-Host ""
Write-Host "--- Docker Service Checks ---"
if (CheckDockerService "infra-pilot-postgres" "PostgreSQL") { $OkCount++ } else { $WarnCount++ }
if (CheckDockerService "infra-pilot-redis" "Redis") { $OkCount++ } else { $WarnCount++ }
if (CheckDockerService "infra-pilot-management-panel" "Management Panel") { $OkCount++ } else { $WarnCount++ }
if (CheckDockerService "infra-pilot-orchestrator" "Orchestrator Agent") { $OkCount++ } else { $WarnCount++ }
if (CheckDockerService "infra-pilot-discord" "Discord Service") { $OkCount++ } else { $WarnCount++ }

if ($Json) {
    Write-Host "{""script"":""healthcheck"",""ok"":$OkCount,""warn"":$WarnCount}"
}

Write-Host ""
Write-Host "Health summary: ok=$OkCount warn=$WarnCount" -ForegroundColor Blue
if ($Strict -and $WarnCount -gt 0) { exit 1 }
exit 0
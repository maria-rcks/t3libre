<# .SYNOPSIS
Run verification stages across the Infra Pilot project on Windows.
.PARAMETER Offline
Skip network-dependent checks
.PARAMETER Json
Output results as JSON
.PARAMETER Stages
Comma-separated list of stages (default: health,setup,test,lint,integration)
#>
param([switch]$Offline, [switch]$Json, [string]$Stages = "health,setup,test,lint,integration")

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir

function Info    { Write-Host "[INFO] $($args[0])" -ForegroundColor Blue }
function Success { Write-Host "[OK]   $($args[0])" -ForegroundColor Green }
function Error   { Write-Host "[ERR]  $($args[0])" -ForegroundColor Red }

$stageList = $Stages.Split(',', [StringSplitOptions]::RemoveEmptyEntries)
$Failed = 0
$stageJson = @()

foreach ($stage in $stageList) {
    Info "Stage: $stage"
    $status = "passed"
    switch ($stage) {
        "health" {
            $cmd = Join-Path $RootDir "scripts\healthcheck.ps1"
            & $cmd; if ($LASTEXITCODE -ne 0) { $status = "failed"; $Failed++ }
        }
        "setup" {
            $cmd = Join-Path $RootDir "scripts\setup.ps1"
            $args = @(); if ($Offline) { $args += "-Offline" }
            & $cmd @args; if ($LASTEXITCODE -ne 0) { $status = "failed"; $Failed++ }
        }
        "test" {
            $cmd = Join-Path $RootDir "scripts\test.ps1"
            $args = @(); if ($Offline) { $args += "-Offline" }
            & $cmd @args; if ($LASTEXITCODE -ne 0) { $status = "failed"; $Failed++ }
        }
        default { Error "Unknown stage '$stage'"; $status = "failed"; $Failed++ }
    }
    if ($status -eq "passed") { Success "Stage succeeded: $stage" }
    else { Error "Stage failed: $stage" }
    $stageJson += @{stage = $stage; status = $status}
}

if ($Json) {
    $jsonStr = $stageJson | ConvertTo-Json -Compress
    Write-Host "{""script"":""verify"",""offline"":$Offline,""failed"":$Failed,""stages"":$jsonStr}"
}

if ($Failed -eq 0) { exit 0 } else { exit 1 }
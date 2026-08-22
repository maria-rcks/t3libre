<# .SYNOPSIS
Run tests for all Infra Pilot services on Windows.
.PARAMETER Coverage
Include coverage reports
.PARAMETER Offline
Skip Maven tests (offline mode)
.PARAMETER Json
Output results as JSON
#>
param([switch]$Coverage, [switch]$Offline, [switch]$Json)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir

function Info    { Write-Host "[INFO] $($args[0])" -ForegroundColor Blue }
function Success { Write-Host "[OK]   $($args[0])" -ForegroundColor Green }
function Warn    { Write-Host "[WARN] $($args[0])" -ForegroundColor Yellow }
function Error   { Write-Host "[ERR]  $($args[0])" -ForegroundColor Red }
function Section($title) {
    Write-Host ""
    Write-Host "--- $title ---" -ForegroundColor Blue
}

$TestServices = @(
    "services/orchestrator-agent",
    "services/discord-service",
    "services/management-panel"
)

$Passed = 0; $Skipped = 0; $Failed = 0

Set-Location $RootDir

foreach ($service in $TestServices) {
    $servicePath = Join-Path $RootDir $service
    if (!(Test-Path $servicePath)) { Warn "Service not found: $service"; $Skipped++; continue }

    $name = Split-Path $service -Leaf
    Section "Testing $name"

    if ($name -eq "orchestrator-agent") {
        if (Get-Command pytest -ErrorAction SilentlyContinue) {
            $testDir = Join-Path $servicePath "tests"
            if (Test-Path $testDir) {
                $rc = 0
                if ($Coverage) { pytest $testDir -v --tb=short --cov } else { pytest $testDir -v --tb=short }
                if ($LASTEXITCODE -eq 0) { Success "Tests passed for $name"; $Passed++ }
                elseif ($LASTEXITCODE -eq 5) { Warn "No tests collected for $name"; $Skipped++ }
                else { Error "Tests failed for $name"; $Failed++ }
            } else { Warn "No tests directory found for $name"; $Skipped++ }
        } else { Warn "pytest not installed, skipping tests"; $Skipped++ }

    } elseif ($name -eq "discord-service" -or $name -eq "management-panel") {
        $pkgJson = Join-Path $servicePath "package.json"
        if (Test-Path $pkgJson) {
            $pkg = Get-Content $pkgJson | ConvertFrom-Json
            if ($pkg.scripts.test) {
                if ($Coverage) { npm run test --prefix $servicePath -- --coverage }
                else { npm run test --prefix $servicePath }
                if ($LASTEXITCODE -eq 0) { Success "Tests passed for $name"; $Passed++ }
                else { Error "Tests failed for $name"; $Failed++ }
            } else { Warn "No test script defined in package.json"; $Skipped++ }
        } else { Warn "No package.json found"; $Skipped++ }
    }
}

Section "Test Summary"
Info "Passed: $Passed"
Info "Skipped: $Skipped"
Info "Failed: $Failed"

if ($Json) {
    Write-Host "{""script"":""test"",""passed"":$Passed,""skipped"":$Skipped,""failed"":$Failed,""offline"":$Offline}"
}

if ($Failed -eq 0) { Success "No failing test suites detected"; exit 0 }
else { Error "$Failed test suite(s) failed"; exit 1 }
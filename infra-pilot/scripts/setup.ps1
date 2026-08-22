<# .SYNOPSIS
Set up the Infra Pilot development environment on Windows.
.DESCRIPTION
Checks prerequisites, validates infrastructure files, and creates .env from .env.example.
.PARAMETER Offline
Skip package downloads (use cached artifacts only)
#>
param([switch]$Offline)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir

function Info  { Write-Host "[INFO] $($args[0])" -ForegroundColor Blue }
function Success { Write-Host "[OK]   $($args[0])" -ForegroundColor Green }
function Warn  { Write-Host "[WARN] $($args[0])" -ForegroundColor Yellow }
function Error { Write-Host "[ERR]  $($args[0])" -ForegroundColor Red }

function CheckCommand($cmd, $name) {
    if (!(Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Warn "$name is not installed"
        return $false
    }
    return $true
}

$Services = @(
    "services/orchestrator-agent",
    "services/discord-service",
    "services/management-panel"
)

Info "Checking prerequisites..."
if ($Offline) { Info "Offline mode enabled: package installation steps skipped" }

$MissingDeps = 0
if (!(CheckCommand git "Git")) { $MissingDeps = 1 }
if (!(CheckCommand docker "Docker")) { Warn "Docker not found - using local setup" }
if (!(CheckCommand python "Python 3")) { Warn "Python 3 not found - skipping orchestrator-agent setup" }
if (!(CheckCommand node "Node.js")) { Warn "Node.js not found - skipping Node.js services setup" }
if (!(CheckCommand npm "npm")) { Warn "npm not found - skipping Node.js services setup" }

if ($MissingDeps -eq 1) { Error "Missing critical dependencies"; exit 1 }
Success "Prerequisites check passed"

Info "Validating infrastructure files..."
$InfraFiles = @(
    "docker-compose.yml",
    ".env.example",
    "infra/monitoring/prometheus/prometheus.yml",
    "infra/monitoring/grafana/provisioning/datasources/prometheus.yml"
)
foreach ($file in $InfraFiles) {
    $path = Join-Path $RootDir $file
    if (Test-Path $path) { Success "Found $file" }
    else { Warn "Missing $file - some features may not work" }
}

foreach ($service in $Services) {
    $path = Join-Path $RootDir $service
    if (!(Test-Path $path)) { Warn "Service directory not found: $service"; continue }
    $name = Split-Path $service -Leaf
    $df = Join-Path $path "Dockerfile"
    $di = Join-Path $path ".dockerignore"
    if ((Test-Path $df) -and (Test-Path $di)) { Info "$name is Docker-ready" }
}

$envExample = Join-Path $RootDir ".env.example"
$envFile = Join-Path $RootDir ".env"
if ((Test-Path $envExample) -and !(Test-Path $envFile)) {
    Copy-Item $envExample $envFile
    Warn "Created .env from .env.example - please configure with your settings"
} elseif (Test-Path $envFile) { Success ".env already exists" }
else { Warn "No .env.example found - you may need to create .env manually" }

Success "Setup complete!"
Info "Next steps:"
Write-Host "  1. Configure .env if needed"
Write-Host "  2. Run tests: .\scripts\test.ps1"
Write-Host "  3. Start services: docker compose up -d"
Write-Host "  4. Or run individually from services/ directories"
Info "For more info, see: README.md"
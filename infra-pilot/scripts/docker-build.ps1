<# .SYNOPSIS
Build Docker images for all Infra Pilot services on Windows.
.PARAMETER Push
Push images to registry after build
.PARAMETER Registry
Container registry URL (default: REGISTRY env var)
#>
param([switch]$Push, [string]$Registry = "")

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir

function Info    { Write-Host "[INFO] $($args[0])" -ForegroundColor Blue }
function Success { Write-Host "[OK]   $($args[0])" -ForegroundColor Green }
function Warn    { Write-Host "[WARN] $($args[0])" -ForegroundColor Yellow }
function Error   { Write-Host "[ERR]  $($args[0])" -ForegroundColor Red }

if (!(Get-Command docker -ErrorAction SilentlyContinue)) { Error "Docker is not installed"; exit 1 }
Success "Docker found: $(docker --version 2>&1)"

$version = if (git describe --tags --always 2>$null) { git describe --tags --always } else { "latest" }
if (!$Registry) { $Registry = $env:REGISTRY }
Info "Using version tag: $version"

$Services = @(
    "services/orchestrator-agent",
    "services/discord-service",
    "services/management-panel"
)
$buildFailed = 0

foreach ($service in $Services) {
    $servicePath = Join-Path $RootDir $service
    if (!(Test-Path $servicePath)) { Warn "Service directory not found: $service"; continue }

    $name = Split-Path $service -Leaf
    $df = Join-Path $servicePath "Dockerfile"
    if (!(Test-Path $df)) { Warn "Dockerfile not found for $name, skipping"; continue }

    $imageName = "infra-pilot-$name"
    $imageTag = $version
    if ($Registry) { $imageName = "$Registry/$imageName" }

    Info "Building $name..."
    docker build -f $df -t "${imageName}:${imageTag}" -t "${imageName}:latest" $servicePath
    if ($LASTEXITCODE -eq 0) {
        Success "$name built successfully"
        if ($Push -and $Registry) {
            Info "Pushing ${imageName}:${imageTag}..."
            docker push "${imageName}:${imageTag}"
            docker push "${imageName}:latest"
        } elseif ($Push) { Warn "No registry specified, skipping push" }
    } else { Error "Failed to build $name"; $buildFailed++ }
}

if ($buildFailed -eq 0) { Success "All builds completed successfully!"; exit 0 }
else { Error "$buildFailed build(s) failed"; exit 1 }
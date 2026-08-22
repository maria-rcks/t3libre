<# .SYNOPSIS
Create a new release tag on Windows.
.PARAMETER Tag
Release tag name (e.g., v1.2.3)
.PARAMETER Message
Release message (default: "Release <tag>")
.PARAMETER Changelog
Update CHANGELOG.md with an entry for this release
.PARAMETER Push
Push the tag and any changelog commits to origin
#>
param([string]$Tag, [string]$Message = "", [switch]$Changelog, [switch]$Push)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir

function Info    { Write-Host "[INFO] $($args[0])" -ForegroundColor Blue }
function Success { Write-Host "[OK]   $($args[0])" -ForegroundColor Green }
function Error   { Write-Host "[ERR]  $($args[0])" -ForegroundColor Red }

if (!$Tag) { Error "Tag must be provided with -Tag"; exit 1 }
if (!$Message) { $Message = "Release $Tag" }

Set-Location $RootDir
Info "Preparing release for tag: $Tag"

$artDir = Join-Path $RootDir "images-for-releases"
if (Test-Path $artDir) {
    $art = Get-ChildItem $artDir -Filter "*.png" | Get-Random
    if ($art) {
        $brandDir = Join-Path $RootDir "branding"
        New-Item -ItemType Directory -Force -Path $brandDir | Out-Null
        Copy-Item $art.FullName (Join-Path $brandDir "release-art.png")
        Info "Selected release artwork: $($art.Name)"
    }
}

$status = git status --porcelain
if ($status) { Error "Working tree is not clean. Commit or stash changes before releasing."; exit 1 }

git tag -a $Tag -m $Message
Success "Created annotated tag $Tag"

if ($Changelog) {
    $changelogFile = Join-Path $RootDir "CHANGELOG.md"
    $date = Get-Date -Format "yyyy-MM-dd"
    $entry = "`n## $Tag - $date`n`n- Release: $Message`n"
    if (Test-Path $changelogFile) { Add-Content $changelogFile $entry }
    else { "# Changelog$entry" | Set-Content $changelogFile }
    git add CHANGELOG.md
    git commit -m "docs: update changelog for $Tag"
    Success "CHANGELOG.md updated for $Tag"
}

if ($Push) {
    git push origin $Tag
    Success "Pushed tag $Tag to origin"
    $artPath = Join-Path $RootDir "branding/release-art.png"
    if (Test-Path $artPath) {
        gh release upload $Tag $artPath --clobber 2>$null
        if ($LASTEXITCODE -ne 0) { Warn "gh release upload failed (install GitHub CLI?)" }
    }
}

Success "Release scaffold complete."
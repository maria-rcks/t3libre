# Fill missing or placeholder secrets in .env with secure random values.
# Idempotent: existing real values are left untouched.
param()

$ErrorActionPreference = 'Stop'

$rootDir = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $rootDir '.env'
$example = Join-Path $rootDir '.env.example'

$placeholders = @(
    'CHANGE_ME',
    'your_discord_bot_token_here',
    'your_jwt_secret_key_here',
    'your_pterodactyl_api_key_here',
    'infra_pilot_dev_password',
    'local-dev-anon-key'
)

function New-RandomSecret {
    $bytes = New-Object byte[] 32
    $rng = New-Object Security.Cryptography.RNGCryptoServiceProvider
    try {
        $rng.GetBytes($bytes)
    } finally {
        $rng.Dispose()
    }
    return ([Convert]::ToBase64String($bytes)) -replace '[^a-zA-Z0-9]', ''
}

function Set-SecretValue {
    param([string]$Key, [string]$Value)

    $lines = @(Get-Content $envFile)
    $index = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match "^$([regex]::Escape($Key))=") {
            $index = $i
            break
        }
    }

    if ($index -ge 0) {
        $current = ($lines[$index] -split '=', 2)[1].Trim()
        if ($current -eq '' -or $placeholders -contains $current) {
            $lines[$index] = "$Key=$Value"
            Set-Content -Path $envFile -Value $lines -Encoding ascii
            Write-Host "Set $Key"
        } else {
            Write-Host "$Key already set, skipping"
        }
    } else {
        Add-Content -Path $envFile -Value "$Key=$Value" -Encoding ascii
        Write-Host "Appended $Key"
    }
}

if (-not (Test-Path -LiteralPath $envFile)) {
    Copy-Item $example $envFile
    Write-Host "Created $envFile from .env.example"
}

Set-SecretValue 'POSTGRES_PASSWORD' (New-RandomSecret)
Set-SecretValue 'GITHUB_WEBHOOK_SECRET' (New-RandomSecret)
Set-SecretValue 'GITOPS_WEBHOOK_TOKEN' (New-RandomSecret)
Set-SecretValue 'FEDERATION_API_TOKEN' (New-RandomSecret)
Set-SecretValue 'DISCORD_TOKEN' (New-RandomSecret)
Set-SecretValue 'PTERODACTYL_API_KEY' (New-RandomSecret)

Write-Host "Done. Review $envFile before starting services."

#!/usr/bin/env bash
# Fill missing or placeholder secrets in .env with secure random values.
# Idempotent: existing real values are left untouched.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
EXAMPLE="$ROOT_DIR/.env.example"

PLACEHOLDERS='CHANGE_ME|your_discord_bot_token_here|your_jwt_secret_key_here|your_pterodactyl_api_key_here|infra_pilot_dev_password|local-dev-anon-key'

gen_secret() {
  openssl rand -base64 32 | tr -d '+/='
}

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$EXAMPLE" "$ENV_FILE"
  echo "Created $ENV_FILE from .env.example"
fi

# Replace the value of $1 with $2 when the current value is empty or a placeholder.
fill() {
  local key="$1" value="$2" tmp
  tmp="$ENV_FILE.tmp"
  if grep -Eq "^${key}=(|${PLACEHOLDERS})$" "$ENV_FILE"; then
    awk -v k="$key" -v v="$value" '
      BEGIN { FS = OFS = "="; found = 0 }
      $1 == k { print k "=" v; found = 1; next }
      { print }
      END { if (!found) print k "=" v }
    ' "$ENV_FILE" > "$tmp"
    mv "$tmp" "$ENV_FILE"
    echo "Set $key"
  elif ! grep -Eq "^${key}=" "$ENV_FILE"; then
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
    echo "Set $key"
  else
    echo "$key already set, skipping"
  fi
}

fill POSTGRES_PASSWORD "$(gen_secret)"
fill GITHUB_WEBHOOK_SECRET "$(gen_secret)"
fill GITOPS_WEBHOOK_TOKEN "$(gen_secret)"
fill FEDERATION_API_TOKEN "$(gen_secret)"
fill DISCORD_TOKEN "$(gen_secret)"
fill PTERODACTYL_API_KEY "$(gen_secret)"

echo "Done. Review $ENV_FILE before starting services."

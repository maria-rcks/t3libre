#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

info()    { echo -e "${BLUE}${1}${NC}"; }
success() { echo -e "${GREEN}${1}${NC}"; }
error()   { echo -e "${RED}${1}${NC}" >&2; }

usage() {
  cat <<EOF
Create a Postgres backup of the Infra Pilot database.

Usage: $(basename "$0") [OPTIONS]

Options:
  --keep N    Keep only the N most recent backups (default: 10)
  --out DIR   Backup output directory (default: $ROOT_DIR/backups)
  --help      Show this help message
EOF
  exit 0
}

KEEP=10
OUT_DIR="$ROOT_DIR/backups"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --keep) KEEP="$2"; shift 2 ;;
    --out) OUT_DIR="$2"; shift 2 ;;
    --help) usage ;;
    *) echo "Unknown option: $1" >&2; usage ;;
  esac
done

POSTGRES_USER="${POSTGRES_USER:-infra_pilot}"
POSTGRES_DB="${POSTGRES_DB:-infra_pilot}"

if ! command -v docker &> /dev/null; then
  error "docker not found in PATH"
  exit 1
fi

if ! docker compose ls 2>/dev/null | grep -q infra-pilot; then
  info "Infra Pilot stack is not running, starting postgres..."
  docker compose -f "$ROOT_DIR/docker-compose.yml" up -d postgres
  info "Waiting for postgres to become healthy..."
  for i in $(seq 1 30); do
    if docker compose -f "$ROOT_DIR/docker-compose.yml" exec -T postgres pg_isready -U "$POSTGRES_USER" > /dev/null 2>&1; then
      break
    fi
    sleep 2
  done
fi

mkdir -p "$OUT_DIR"
stamp=$(date +%Y%m%d_%H%M%S)
backup_file="$OUT_DIR/infra-pilot_${stamp}.dump"

info "Creating backup: $backup_file"
docker compose -f "$ROOT_DIR/docker-compose.yml" exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$backup_file"

size=$(du -h "$backup_file" | cut -f1)
success "Backup created ($size): $backup_file"

mapfile -t old_backups < <(ls -1t "$OUT_DIR"/infra-pilot_*.dump 2>/dev/null | tail -n +"$((KEEP + 1))")
if [[ ${#old_backups[@]} -gt 0 ]]; then
  info "Removing ${#old_backups[@]} old backup(s) (keep=$KEEP)..."
  for f in "${old_backups[@]}"; do
    info "  - $f"
    rm -f "$f"
  done
fi

success "Done. Latest backup: $backup_file"
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

success() { echo -e "${GREEN}${1}${NC}"; }
warn()    { echo -e "${YELLOW}${1}${NC}"; }
error()   { echo -e "${RED}${1}${NC}" >&2; }
info()    { echo -e "${BLUE}${1}${NC}"; }

usage() {
  cat <<EOF
Run health checks on the Infra Pilot project infrastructure.

Usage: $(basename "$0") [OPTIONS]

Options:
  --json     Output results as JSON
  --strict   Exit with error if any warnings are present
  --dry-run  Skip live Docker service checks (validation only)
  --help     Show this help message
EOF
  exit 0
}

JSON_OUTPUT=false
STRICT=false
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --json) JSON_OUTPUT=true; shift ;;
    --strict) STRICT=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    --help) usage ;;
    *) echo "Unknown option: $1" >&2; usage ;;
  esac
done

check_file() {
  local file="$1"
  local label="$2"
  if [ -f "$file" ]; then
    success "$label"
    return 0
  fi
  error "$label (missing: $file)"
  return 1
}

check_docker_service() {
  local service="$1"
  local label="$2"
  if command -v docker &> /dev/null; then
    local status
    status=$(docker ps --filter "name=${service}" --format "{{.Status}}" 2>/dev/null || true)
    if [ -n "$status" ]; then
      success "$label ($status)"
      return 0
    fi
  fi
  warn "$label (not running)"
  return 1
}

OK=0
WARN=0

info "Running health checks..."
echo ""

echo "--- File Checks ---"
check_file "$ROOT_DIR/.env.example" ".env example present" && OK=$((OK + 1)) || WARN=$((WARN + 1))
check_file "$ROOT_DIR/docker-compose.yml" "docker compose config present" && OK=$((OK + 1)) || WARN=$((WARN + 1))
check_file "$ROOT_DIR/services/orchestrator-agent/requirements.txt" "orchestrator-agent Python manifest present" && OK=$((OK + 1)) || WARN=$((WARN + 1))
check_file "$ROOT_DIR/services/management-panel/package.json" "management-panel Node manifest present" && OK=$((OK + 1)) || WARN=$((WARN + 1))
check_file "$ROOT_DIR/services/discord-service/package.json" "discord-service package manifest present" && OK=$((OK + 1)) || WARN=$((WARN + 1))
check_file "$ROOT_DIR/services/orchestrator-agent/.env.example" "orchestrator-agent .env.example present" && OK=$((OK + 1)) || WARN=$((WARN + 1))
check_file "$ROOT_DIR/services/management-panel/.env.example" "management-panel .env.example present" && OK=$((OK + 1)) || WARN=$((WARN + 1))

echo ""
echo "--- Docker Service Checks ---"
if [ "$DRY_RUN" = true ]; then
  if [ "$JSON_OUTPUT" = true ]; then
    echo "Dry-run mode: skipping live Docker service checks" >&2
  else
    info "Dry-run mode: skipping live Docker service checks"
  fi
else
  check_docker_service "infra-pilot-postgres" "PostgreSQL" && OK=$((OK + 1)) || WARN=$((WARN + 1))
  check_docker_service "infra-pilot-redis" "Redis" && OK=$((OK + 1)) || WARN=$((WARN + 1))
  check_docker_service "infra-pilot-management-panel" "Management Panel" && OK=$((OK + 1)) || WARN=$((WARN + 1))
  check_docker_service "infra-pilot-orchestrator" "Orchestrator Agent" && OK=$((OK + 1)) || WARN=$((WARN + 1))
  check_docker_service "infra-pilot-discord" "Discord Service" && OK=$((OK + 1)) || WARN=$((WARN + 1))
fi

if [ "$JSON_OUTPUT" = true ]; then
  printf '{"script":"healthcheck","ok":%s,"warn":%s}\n' "$OK" "$WARN"
fi

echo ""
info "Health summary: ok=$OK warn=$WARN"
if [ "$STRICT" = true ] && [ "$WARN" -gt 0 ]; then
  exit 1
fi
exit 0

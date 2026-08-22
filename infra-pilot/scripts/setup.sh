#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()    { echo -e "${BLUE}${1}${NC}"; }
success() { echo -e "${GREEN}${1}${NC}"; }
warn()    { echo -e "${YELLOW}${1}${NC}"; }
error()   { echo -e "${RED}${1}${NC}" >&2; }

usage() {
  cat <<EOF
Set up the Infra Pilot development environment.

Usage: $(basename "$0") [OPTIONS]

Options:
  --offline  Skip package downloads (use cached artifacts only)
  --help     Show this help message
EOF
  exit 0
}

OFFLINE=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --offline) OFFLINE=true; shift ;;
    --help) usage ;;
    *) echo "Unknown option: $1" >&2; usage ;;
  esac
done

cd "$ROOT_DIR"

SERVICES=(
  "services/orchestrator-agent"
  "services/discord-service"
  "services/management-panel"
)

check_command() {
  if ! command -v "$1" &> /dev/null; then
    error "$1 is not installed"
    return 1
  fi
  return 0
}

info "Checking prerequisites..."
if [ "$OFFLINE" = true ]; then
  info "Offline mode enabled: package installation steps are skipped"
fi

MISSING_DEPS=0

check_command git || MISSING_DEPS=1
if ! check_command docker; then warn "Docker not found - using local setup"; fi

if ! check_command python3; then warn "Python 3 not found - skipping orchestrator-agent setup"; fi
if ! check_command node; then warn "Node.js not found - skipping Node.js services setup"; fi
if ! check_command npm; then warn "npm not found - skipping Node.js services setup"; fi

if [ "$MISSING_DEPS" -eq 1 ]; then
  error "Missing critical dependencies"
  exit 1
fi

success "Prerequisites check passed"

info "Validating infrastructure files..."
INFRA_FILES=(
  "docker-compose.yml"
  ".env.example"
  "infra/monitoring/prometheus/prometheus.yml"
  "infra/monitoring/grafana/provisioning/datasources/prometheus.yml"
)
for file in "${INFRA_FILES[@]}"; do
  if [ -f "$file" ]; then
    success "Found $file"
  else
    warn "Missing $file - some features may not work"
  fi
done

for service in "${SERVICES[@]}"; do
  if [ ! -d "$service" ]; then
    warn "Service directory not found: $service"
    continue
  fi

  SERVICE_NAME=$(basename "$service")

  if [ -f "$service/Dockerfile" ] && [ -f "$service/.dockerignore" ]; then
    info "$SERVICE_NAME is Docker-ready"
  fi
done

if [ -f ".env.example" ] && [ ! -f ".env" ]; then
  cp .env.example .env
  warn "Created .env from .env.example - please configure with your settings"
elif [ -f ".env" ]; then
  success ".env already exists"
else
  warn "No .env.example found - you may need to create .env manually"
fi

success "Setup complete!"
info "Next steps:"
echo "  1. Configure .env if needed"
echo "  2. Run tests: ./scripts/test.sh"
echo "  3. Start services: docker compose up -d"
echo "  4. Or run individually from services/ directories"
info "For more info, see: README.md"

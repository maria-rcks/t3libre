#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

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
Install all dependencies for Infra Pilot services.

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

cd "$PROJECT_DIR"

# Node.js dependencies
if command -v npm &> /dev/null; then
  if [ -d "services/management-panel" ]; then
    info "Installing management-panel npm dependencies..."
    if [ "$OFFLINE" = false ]; then
      npm ci --prefix services/management-panel || npm install --prefix services/management-panel
    fi
    success "management-panel dependencies installed"
  fi

  if [ -d "services/discord-service" ]; then
    info "Installing discord-service npm dependencies..."
    if [ "$OFFLINE" = false ]; then
      npm ci --prefix services/discord-service || npm install --prefix services/discord-service
    fi
    success "discord-service dependencies installed"
  fi

  if [ -f "mobile/package.json" ]; then
    info "Installing mobile npm dependencies..."
    if [ "$OFFLINE" = false ]; then
      npm ci --prefix mobile || npm install --prefix mobile
    fi
    success "mobile dependencies installed"
  fi
else
  warn "npm not found, skipping Node.js dependencies"
fi

# Python dependencies
if command -v pip &> /dev/null || command -v pip3 &> /dev/null; then
  PIP=$(command -v pip3 2>/dev/null || command -v pip 2>/dev/null)

  if [ "$OFFLINE" = false ]; then
    if [ -f "requirements.txt" ]; then
      info "Installing root Python dependencies..."
      $PIP install -r requirements.txt
      success "Root Python dependencies installed"
    fi

    if [ -f "services/orchestrator-agent/requirements.txt" ]; then
      info "Installing orchestrator-agent Python dependencies..."
      $PIP install -r services/orchestrator-agent/requirements.txt
    fi

    if [ -f "services/integration-service/requirements.txt" ]; then
      info "Installing integration-service Python dependencies..."
      $PIP install -r services/integration-service/requirements.txt
    fi
  fi
else
  warn "pip not found, skipping Python dependencies"
fi

success "All dependencies installed"

#!/usr/bin/env bash
set -euo pipefail

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
Check that all required tools are installed.

Usage: $(basename "$0") [OPTIONS]

Options:
  --help    Show this help message
EOF
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help) usage ;;
    *) echo "Unknown option: $1" >&2; usage ;;
  esac
done

check_command() {
  local cmd="$1" name="$2" required="$3"
  if ! command -v "$cmd" &> /dev/null; then
    error "$name not found. Install $name (required: $required)"
    return 1
  fi
  success "$name found: $($cmd --version 2>&1 | head -1)"
  return 0
}

info "Checking prerequisites..."

FAILED=0
check_command docker "Docker" "20.10+" || ((FAILED++))
check_command node "Node.js" "18+" || ((FAILED++))
check_command python3 "Python" "3.9+" || ((FAILED++))
check_command git "Git" "2.0+" || ((FAILED++))

# docker-compose is optional (may be a plugin)
if command -v docker &> /dev/null && docker compose version &>/dev/null; then
  success "Docker Compose available"
elif command -v docker-compose &>/dev/null; then
  success "Docker Compose available: $(docker-compose --version 2>&1)"
else
  warn "Docker Compose not found (optional if using docker compose plugin)"
fi

if [ "$FAILED" -eq 0 ]; then
  success "All prerequisites satisfied"
  exit 0
else
  error "$FAILED prerequisite(s) missing"
  exit 1
fi

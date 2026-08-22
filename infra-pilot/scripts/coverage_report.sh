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
Run tests with coverage reporting and generate summaries.

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

cd "$PROJECT_DIR"

pytest -m "unit or integration or e2e" \
  --cov=infra \
  --cov-report=xml:coverage.xml \
  --cov-report=html:coverage_html \
  --cov-report=term-missing

python3 "$SCRIPT_DIR/coverage_report.py" coverage.xml

success "HTML coverage report available at coverage_html/index.html"

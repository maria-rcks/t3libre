#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1; pwd)"
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
Update the coverage badge in README.md from coverage.xml data.

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
python3 "$SCRIPT_DIR/coverage_badge_updater.py"

if [ ! -f README.md ]; then
  warn "README.md not found; skipping badge update commit."
  exit 0
fi

if ! git status --porcelain >/dev/null 2>&1; then
  warn "Git not available or not a git repo; skipping badge update commit."
  exit 0
fi

changes=$(git status --porcelain README.md | wc -l)
if [ "$changes" -eq 0 ]; then
  info "No changes to README.md; badge already up-to-date."
  exit 0
fi

git config user.name "InfraPilot CI Bot"
git config user.email "ci-bot@example.com"
git add README.md
git commit -m "ci: update README coverage badge" || true
git push origin HEAD

#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()     { echo -e "${BLUE}${1}${NC}"; }
success()  { echo -e "${GREEN}${1}${NC}"; }
warn()     { echo -e "${YELLOW}${1}${NC}"; }
error()    { echo -e "${RED}${1}${NC}" >&2; }
section()  { echo ""; echo -e "${BLUE}─────────────────────────────────────${NC}"; echo -e "${BLUE}${1}${NC}"; echo -e "${BLUE}─────────────────────────────────────${NC}"; }

usage() {
  cat <<EOF
Run tests for all Infra Pilot services.

Usage: $(basename "$0") [OPTIONS]

Options:
  --coverage  Include coverage reports
  --offline   Skip network-dependent or unavailable service steps
  --json      Output results as JSON
  --help      Show this help message
EOF
  exit 0
}

TEST_SUITES=(
  "python:.:pytest"
  "node:services/discord-service:npm"
  "node:services/management-panel:npm"
)

SHOW_COVERAGE=false
OFFLINE=false
JSON_OUTPUT=false
FAILED_TESTS=0
SKIPPED_TESTS=0
PASSED_TESTS=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --coverage) SHOW_COVERAGE=true; shift ;;
    --offline) OFFLINE=true; shift ;;
    --json) JSON_OUTPUT=true; shift ;;
    --help) usage ;;
    *) echo "Unknown option: $1" >&2; usage ;;
  esac
done

cd "$ROOT_DIR"

run_pytest_suite() {
  local test_target="$1"
  local service_name="$2"

  set +e
  pytest "$test_target" -v --tb=short
  local rc=$?
  set -e

  if [ "$rc" -eq 0 ]; then
    success "Tests passed for $service_name"
    PASSED_TESTS=$((PASSED_TESTS + 1))
  elif [ "$rc" -eq 5 ]; then
    warn "No tests collected for $service_name"
    SKIPPED_TESTS=$((SKIPPED_TESTS + 1))
  else
    error "Tests failed for $service_name"
    FAILED_TESTS=$((FAILED_TESTS + 1))
  fi
}

if [ "$OFFLINE" = true ]; then
  info "Offline mode enabled: network-dependent test steps will be skipped"
fi

for suite in "${TEST_SUITES[@]}"; do
  IFS=":" read -r SUITE_TYPE SUITE_PATH SUITE_RUNNER <<< "$suite"

  if [ ! -d "$SUITE_PATH" ]; then
    warn "Test suite path not found: $SUITE_PATH"
    SKIPPED_TESTS=$((SKIPPED_TESTS + 1))
    continue
  fi

  section "Testing $SUITE_PATH"

  if [ "$SUITE_TYPE" = "python" ]; then
    if ! command -v pytest &> /dev/null; then
      warn "pytest not installed, skipping $SUITE_PATH"
      SKIPPED_TESTS=$((SKIPPED_TESTS + 1))
      continue
    fi

    set +e
    if [ "$SHOW_COVERAGE" = true ]; then
      pytest tests/ -q --cov=cli/ipilot --cov-report=xml:coverage.xml --cov-report=html:coverage_html --cov-report=term-missing --cov-fail-under=100
    else
      pytest tests/ -q
    fi
    rc=$?
    set -e

  elif [ "$SUITE_TYPE" = "node" ]; then
    if ! command -v npm &> /dev/null; then
      warn "npm not available, skipping $SUITE_PATH"
      SKIPPED_TESTS=$((SKIPPED_TESTS + 1))
      continue
    fi
    if [ ! -f "$SUITE_PATH/package.json" ]; then
      warn "No package.json found in $SUITE_PATH"
      SKIPPED_TESTS=$((SKIPPED_TESTS + 1))
      continue
    fi

    pushd "$SUITE_PATH" > /dev/null
    if [ ! -d node_modules ]; then
      info "Installing npm dependencies for $SUITE_PATH..."
      if [ -f package-lock.json ]; then
        npm ci --legacy-peer-deps
      else
        npm install --legacy-peer-deps
      fi
    fi

    set +e
    if [ "$SHOW_COVERAGE" = true ] && node -e "const p=require('./package.json'); process.exit(p.scripts && p.scripts['test:coverage'] ? 0 : 1)" 2>/dev/null; then
      npm run test:coverage
    else
      npm test
    fi
    rc=$?
    set -e
    popd > /dev/null
  else
    warn "Unknown test suite type: $SUITE_TYPE"
    SKIPPED_TESTS=$((SKIPPED_TESTS + 1))
    continue
  fi

  if [ "$rc" -eq 0 ]; then
    success "Tests passed for $SUITE_PATH"
    PASSED_TESTS=$((PASSED_TESTS + 1))
  elif [ "$rc" -eq 5 ]; then
    warn "No tests collected for $SUITE_PATH"
    SKIPPED_TESTS=$((SKIPPED_TESTS + 1))
  else
    error "Tests failed for $SUITE_PATH"
    FAILED_TESTS=$((FAILED_TESTS + 1))
  fi
done

section "Test Summary"
info "Passed: $PASSED_TESTS"
info "Skipped: $SKIPPED_TESTS"
info "Failed: $FAILED_TESTS"

if [ "$JSON_OUTPUT" = true ]; then
  printf '{"script":"test","passed":%s,"skipped":%s,"failed":%s,"offline":%s}\n' \
    "$PASSED_TESTS" "$SKIPPED_TESTS" "$FAILED_TESTS" "$OFFLINE"
fi

if [ "$FAILED_TESTS" -eq 0 ]; then
  success "No failing test suites detected"
  exit 0
else
  error "$FAILED_TESTS test suite(s) failed"
  exit 1
fi

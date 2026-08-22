#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()    { echo -e "${BLUE}${1}${NC}"; }
success() { echo -e "${GREEN}${1}${NC}"; }
warn()    { echo -e "${YELLOW}${1}${NC}" >&2; }
error()   { echo -e "${RED}${1}${NC}" >&2; }

usage() {
  cat <<EOF
Run verification stages across the Infra Pilot project.

Usage: $(basename "$0") [OPTIONS]

Options:
  --offline           Skip network-dependent checks
  --json              Output results as JSON
  --stages STAGES     Comma-separated list of stages (default: health,setup,test,lint,integration)
  --help              Show this help message
EOF
  exit 0
}

OFFLINE=false
JSON_OUTPUT=false
STAGES="health,setup,test,lint,integration"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --offline) OFFLINE=true; shift ;;
    --json) JSON_OUTPUT=true; shift ;;
    --stages) STAGES="$2"; shift 2 ;;
    --help) usage ;;
    *) echo "Unknown option: $1" >&2; usage ;;
  esac
done

IFS=',' read -r -a stage_list <<< "$STAGES"

run_stage() {
  local name="$1"
  shift
  info "Stage: $name"
  if "$@"; then
    success "Stage succeeded: $name"
    return 0
  fi
  error "Stage failed: $name"
  return 1
}

FAILED=0
STAGE_JSON=""

for stage in "${stage_list[@]}"; do
  case "$stage" in
    health)
      cmd=("bash" "$ROOT_DIR/scripts/healthcheck.sh") ;;
    setup)
      cmd=("bash" "$ROOT_DIR/scripts/setup.sh")
      [ "$OFFLINE" = true ] && cmd+=("--offline") ;;
    test)
      cmd=("bash" "$ROOT_DIR/scripts/test.sh")
      [ "$OFFLINE" = true ] && cmd+=("--offline") ;;
    lint)
      if [ -f "$ROOT_DIR/tools/lint-all.sh" ]; then
        cmd=("bash" "$ROOT_DIR/tools/lint-all.sh")
        [ "$OFFLINE" = true ] && cmd+=("--offline")
      else
        warn "tools/lint-all.sh not found - skipping lint stage"
        continue
      fi ;;
    integration)
      if [ -f "$ROOT_DIR/tools/run-all-tests.sh" ]; then
        cmd=("bash" "$ROOT_DIR/tools/run-all-tests.sh")
        [ "$OFFLINE" = true ] && cmd+=("--offline")
      else
        warn "tools/run-all-tests.sh not found - skipping integration stage"
        continue
      fi ;;
    "")
      continue ;;
    *)
      echo "Unknown stage '$stage'" >&2
      FAILED=$((FAILED + 1))
      continue ;;
  esac

  if run_stage "$stage" "${cmd[@]}"; then
    status="passed"
  else
    status="failed"
    FAILED=$((FAILED + 1))
  fi

  if [ "$JSON_OUTPUT" = true ]; then
    [ -n "$STAGE_JSON" ] && STAGE_JSON+=" ,"
    STAGE_JSON+="{\"stage\":\"$stage\",\"status\":\"$status\"}"
  fi
done

if [ "$JSON_OUTPUT" = true ]; then
  printf '{"script":"verify","offline":%s,"failed":%s,"stages":[%s]}\n' "$OFFLINE" "$FAILED" "$STAGE_JSON"
fi

[ "$FAILED" -eq 0 ]

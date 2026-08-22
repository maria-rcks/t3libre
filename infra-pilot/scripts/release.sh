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
Create a new release tag and optionally update changelog and push.

Usage: $(basename "$0") [OPTIONS]

Options:
  -t, --tag TAG        Release tag name (e.g., v1.2.3)
  -m, --message MSG    Release message (default: "Release <tag>")
  -c, --changelog      Update CHANGELOG.md with an entry for this release
  -p, --push           Push the tag and any changelog commits to origin
  --help               Show this help message
EOF
  exit 0
}

TAG=""
MESSAGE=""
UPDATE_CHANGELOG=false
PUSH=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    -t|--tag) TAG="$2"; shift 2 ;;
    -m|--message) MESSAGE="$2"; shift 2 ;;
    -c|--changelog) UPDATE_CHANGELOG=true; shift ;;
    -p|--push) PUSH=true; shift ;;
    --help) usage ;;
    *) error "Unknown option: $1"; usage ;;
  esac
done

if [[ -z "$TAG" ]]; then
  error "Tag must be provided with -t or --tag"
  usage
fi

if [[ -z "$MESSAGE" ]]; then
  MESSAGE="Release ${TAG}"
fi

cd "$ROOT_DIR"
info "Preparing release for tag: ${TAG}"

RELEASE_ART=$(find images-for-releases -maxdepth 1 -name '*.png' 2>/dev/null | shuf -n1)
if [[ -n "$RELEASE_ART" ]]; then
  mkdir -p branding
  cp "$RELEASE_ART" branding/release-art.png
  info "Selected release artwork: $RELEASE_ART"
fi

if ! git diff --quiet HEAD; then
  error "Working tree is not clean. Commit or stash changes before releasing."
  exit 1
fi

git tag -a "$TAG" -m "$MESSAGE"
success "Created annotated tag ${TAG}"

if [[ "$UPDATE_CHANGELOG" == true ]]; then
  CHANGELOG_FILE="CHANGELOG.md"
  DATE=$(date +"%Y-%m-%d")
  ENTRY_HEADING="\n## ${TAG} - ${DATE}\n\n- Release: ${MESSAGE}\n"
  if [[ -f "$CHANGELOG_FILE" ]]; then
    printf "%s" "$ENTRY_HEADING" >> "$CHANGELOG_FILE"
  else
    printf "# Changelog\n%s" "$ENTRY_HEADING" > "$CHANGELOG_FILE"
  fi
  git add CHANGELOG.md
  git commit -m "docs: update changelog for ${TAG}"
  success "CHANGELOG.md updated for ${TAG}"
fi

if [[ "$PUSH" == true ]]; then
  git push origin "$TAG"
  success "Pushed tag ${TAG} to origin"

  if [[ -f branding/release-art.png ]]; then
    gh release upload "$TAG" branding/release-art.png --clobber 2>/dev/null || \
      warn "gh release upload failed (install GitHub CLI?)"
  fi
fi

success "Release scaffold complete."

#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${BLUE}${1}${NC}"; }
success() { echo -e "${GREEN}${1}${NC}"; }
warn()  { echo -e "${YELLOW}${1}${NC}"; }
error() { echo -e "${RED}${1}${NC}" >&2; }

usage() {
  cat <<EOF
Build Docker images for all Infra Pilot services.

Usage: $(basename "$0") [OPTIONS]

Options:
  --push                Push images to registry after build
  --registry REGISTRY   Container registry URL (default: \$REGISTRY env)
  --help                Show this help message
EOF
  exit 0
}

REGISTRY="${REGISTRY:-}"
SERVICES=(
  "services/orchestrator-agent"
  "services/discord-service"
  "services/management-panel"
)
PUSH_IMAGES=false
BUILD_FAILED=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --push) PUSH_IMAGES=true; shift ;;
    --registry) REGISTRY="$2"; shift 2 ;;
    --help) usage ;;
    *) echo "Unknown option: $1" >&2; usage ;;
  esac
done

if ! command -v docker &> /dev/null; then
  error "Docker is not installed"
  exit 1
fi

success "Docker found: $(docker --version 2>/dev/null)"

VERSION=$(git describe --tags --always 2>/dev/null || echo "latest")
info "Using version tag: $VERSION"

for service in "${SERVICES[@]}"; do
  if [ ! -d "$ROOT_DIR/$service" ]; then
    warn "Service directory not found: $service"
    continue
  fi

  SERVICE_NAME=$(basename "$service")
  DOCKER_FILE="$ROOT_DIR/$service/Dockerfile"

  if [ ! -f "$DOCKER_FILE" ]; then
    warn "Dockerfile not found for $SERVICE_NAME, skipping"
    continue
  fi

  IMAGE_NAME="infra-pilot-$SERVICE_NAME"
  IMAGE_TAG="$VERSION"

  if [ -n "$REGISTRY" ]; then
    IMAGE_NAME="$REGISTRY/$IMAGE_NAME"
  fi

  info "Building $SERVICE_NAME..."

  if docker build \
      -f "$DOCKER_FILE" \
      -t "$IMAGE_NAME:$IMAGE_TAG" \
      -t "$IMAGE_NAME:latest" \
      "$ROOT_DIR/$service"; then
    success "$SERVICE_NAME built successfully"

    if [ "$PUSH_IMAGES" = true ]; then
      if [ -n "$REGISTRY" ]; then
        info "Pushing $IMAGE_NAME:$IMAGE_TAG..."
        docker push "$IMAGE_NAME:$IMAGE_TAG" || {
          error "Failed to push $SERVICE_NAME"
          ((BUILD_FAILED++))
        }
        docker push "$IMAGE_NAME:latest" || true
      else
        warn "No registry specified, skipping push"
      fi
    fi
  else
    error "Failed to build $SERVICE_NAME"
    ((BUILD_FAILED++))
  fi
done

if [ $BUILD_FAILED -eq 0 ]; then
  success "All builds completed successfully!"
  if [ "$PUSH_IMAGES" = true ] && [ -n "$REGISTRY" ]; then
    success "All images pushed to registry"
  elif [ "$PUSH_IMAGES" = true ]; then
    warn "Registry not configured, images not pushed"
  fi
  exit 0
else
  error "$BUILD_FAILED build(s) failed"
  exit 1
fi

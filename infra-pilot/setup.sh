#!/bin/bash
set -e

echo "Infra Pilot Setup"
echo "================="

cp .env.example .env 2>/dev/null || echo ".env already exists"
cp services/management-panel/.env.example services/management-panel/.env.local 2>/dev/null || true
cp services/discord-service/.env.example services/discord-service/.env 2>/dev/null || true

echo "Environment files created"
echo "Edit .env to configure your setup"
echo "Run: docker-compose up -d"

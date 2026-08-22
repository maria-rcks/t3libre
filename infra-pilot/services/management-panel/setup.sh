#!/bin/bash
# Docker Panel Quick Start Setup Script

set -e

echo "🐳 Docker Panel - Quick Start Setup"
echo "===================================="
echo ""

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
  echo "❌ Error: package.json not found"
  echo "   Please run this script from services/management-panel directory"
  exit 1
fi

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
  echo "❌ Error: Node.js is not installed"
  echo "   Please install Node.js 18+ from https://nodejs.org"
  exit 1
fi

echo "✅ Node.js version: $(node --version)"
echo ""

# Step 1: Install dependencies
echo "📦 Installing dependencies..."
npm install
echo "✅ Dependencies installed"
echo ""

# Step 2: Check if .env.local exists
if [ ! -f ".env.local" ]; then
  echo "📝 Creating .env.local from template..."
  cp .env.local.example .env.local
  echo "⚠️  Please edit .env.local with your Supabase credentials:"
  echo "   - VITE_SUPABASE_URL"
  echo "   - VITE_SUPABASE_ANON_KEY"
  echo ""
fi

# Step 3: Check if db/schema.sql exists
if [ ! -f "db/schema.sql" ]; then
  echo "❌ Error: db/schema.sql not found"
  echo "   Please run this script from services/management-panel directory"
  exit 1
fi

echo "📚 Database setup instructions:"
echo "1. Start Supabase (Docker Compose):"
echo "   cd /path/to/supabase/docker && docker compose up -d"
echo ""
echo "2. Go to Supabase Dashboard: http://localhost:3000"
echo "3. Go to Settings → API and copy the 'anon' key"
echo "4. Add it to .env.local: VITE_SUPABASE_ANON_KEY=..."
echo "5. In SQL Editor, paste and run contents of db/schema.sql"
echo ""

# Step 4: Display next steps
echo "🚀 Ready to start!"
echo ""
echo "Next steps:"
echo "1. Configure Supabase and .env.local (see above)"
echo "2. Run: npm run dev"
echo "3. Open: http://localhost:5173"
echo "4. Complete setup wizard"
echo ""
echo "Documentation:"
echo "- Getting Started: README-DOCKER-PANEL.md"
echo "- Architecture: docs/PERSONAL_MODE.md"
echo "- Database Setup: docs/DATABASE_SETUP.md"
echo ""
echo "✨ Enjoy your Docker Panel!"

.PHONY: setup dev dev-services dev-services-down test test-coverage lint format clean help healthcheck load-smoke load-soak load-spike

# ── Development ──────────────────────────────────────────────────────

setup:           ## Set up the development environment
	@bash scripts/setup.sh

dev:             ## Start core services and run management panel
	@docker compose up -d postgres redis && \
		npm run dev --prefix services/management-panel

dev-services:    ## Start all Docker services
	@docker compose up -d

dev-services-down: ## Stop all Docker services
	@docker compose down

# ── Testing ──────────────────────────────────────────────────────────

test:            ## Run all tests
	@pytest tests/ -v

test-coverage:   ## Run tests with coverage report
	@pytest tests/ --cov=cli/ipilot --cov=services

# ── Linting & Formatting ─────────────────────────────────────────────

lint:            ## Run linting checks
	@npm run lint --prefix services/management-panel

format:          ## Format code with Prettier
	@prettier --write "services/**/*.{ts,tsx,js,jsx}"

# ── Maintenance ──────────────────────────────────────────────────────

clean:           ## Remove Docker volumes and node_modules
	@docker compose down -v && rm -rf node_modules

healthcheck:     ## Run project health checks
	bash ./scripts/healthcheck.sh

# ── Load Testing ─────────────────────────────────────────────────────

load-smoke:        ## Start the stack and run the k6 smoke scenario
	@docker compose --profile loadtest up postgres redis orchestrator-agent management-panel -d && \
		docker compose --profile loadtest run --rm loadtest

load-soak:         ## Start the stack and run the k6 soak scenario
	@docker compose --profile loadtest up postgres redis orchestrator-agent management-panel -d && \
		K6_SCENARIO=soak docker compose --profile loadtest run --rm loadtest

load-spike:        ## Start the stack and run the k6 spike scenario
	@docker compose --profile loadtest up postgres redis orchestrator-agent management-panel -d && \
		K6_SCENARIO=spike docker compose --profile loadtest run --rm loadtest

# ── Help ─────────────────────────────────────────────────────────────

help:            ## Show this help message
	@echo "Available commands:"
	@echo "  setup              Set up the development environment"
	@echo "  dev                Start core services and run management panel"
	@echo "  dev-services       Start all Docker services"
	@echo "  dev-services-down  Stop all Docker services"
	@echo "  test               Run all tests"
	@echo "  test-coverage      Run tests with coverage report"
	@echo "  lint               Run linting checks"
	@echo "  format             Format code with Prettier"
	@echo "  clean              Remove Docker volumes and node_modules"
	@echo "  healthcheck        Run project health checks"
	@echo "  load-smoke         Run the k6 smoke load test"
	@echo "  load-soak          Run the k6 soak load test"
	@echo "  load-spike         Run the k6 spike load test"
	@echo "  help               Show this help message"

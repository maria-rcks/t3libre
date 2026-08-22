# Usage Examples

## GitOps: Infrastructure as Code

```bash
# Export current infrastructure to YAML
ipilot gitops export -o production.yaml

# Plan changes before applying
ipilot gitops plan -f production.yaml

# Apply with dry-run first
ipilot gitops apply -f production.yaml --dry-run
ipilot gitops apply -f production.yaml -y

# Scan for configuration drift
ipilot gitops drift --scan
```

## SSH Session Management

```bash
# Connect to a server via jump host
ipilot ssh connect web-01 -u admin -j bastion.corp.com

# Manage jump hosts
ipilot ssh jump-hosts --create bastion --host bastion.corp.com --user admin

# Add SSH key
ipilot ssh keys --add ~/.ssh/id_ed25519.pub --name laptop

# List active sessions
ipilot ssh list --status active

# View session recording
ipilot ssh record <session-id>

# Save a host for quick access
ipilot ssh saved --add prod@web-01.example.com:2222
```

## Server Inventory

```bash
# List all production servers with tags
ipilot inventory list --tag production

# Filter by environment and region
ipilot inventory list --environment staging --region eu-west

# Filter by owner and provider
ipilot inventory list --owner alice --provider aws

# Update server metadata
ipilot inventory update web-01 \
  --owner "Platform Team" \
  --environment production \
  --region us-east-1 \
  --provider aws \
  --os "Ubuntu 22.04 LTS" \
  --cost 123.50 \
  --tags "frontend,api,critical"

# Tag management
ipilot inventory tags --add web-01:frontend
ipilot inventory tags --add web-01:api
ipilot inventory tags --remove web-01:deprecated
ipilot inventory tags --list
```

## Secret Management

```bash
# Store a database URL
ipilot secrets set DATABASE_URL "postgresql://user:pass@host:5432/db" \
  --rotate --rotation-days 90

# Store an API key
ipilot secrets set STRIPE_API_KEY "sk_live_..." --rotation-days 30

# Retrieve a secret (latest version)
ipilot secrets get DATABASE_URL

# Retrieve a specific version
ipilot secrets get DATABASE_URL --version 2

# List all secrets
ipilot secrets list

# View version history
ipilot secrets versions DATABASE_URL

# Rotate a specific secret
ipilot secrets rotate --key DATABASE_URL

# Rotate all secrets due for rotation
ipilot secrets rotate --all

# RBAC: grant/revoke access
ipilot secrets roles DATABASE_URL --grant developer
ipilot secrets roles DATABASE_URL --revoke viewer
ipilot secrets roles DATABASE_URL
```

## Deployment Templates

```bash
# List all templates
ipilot templates list

# Filter by type
ipilot templates list --type node
ipilot templates list --type python

# Deploy a Node.js app
ipilot templates deploy nodejs my-api --server web-01

# Deploy PostgreSQL
ipilot templates deploy postgresql my-db

# Deploy Traefik reverse proxy
ipilot templates deploy traefik ingress

# Initialize a local project from template
ipilot templates init nodejs my-api-project -o ./apps

# Deploy with custom variables
ipilot templates deploy nodejs my-api \
  --server web-01 \
  --vars '{"environment_vars":{"PORT":"4000"},"ports":[{"hostPort":4000,"containerPort":4000}]}'

# Dry-run a template deployment
ipilot templates deploy redis cache --dry-run
```

## Webhooks

```bash
# Create a webhook for deployments
ipilot webhooks create deploy-notify https://hooks.example.com/deploy \
  --events deploy,backup,alert \
  --secret whsec_abc123

# List webhooks
ipilot webhooks list

# Test a webhook
ipilot webhooks test --id <id> --event deploy

# View delivery logs
ipilot webhooks logs
ipilot webhooks logs --id <id>
```

## API Keys

```bash
# Create a read-only key for CI/CD
ipilot apikeys create github-actions --role readonly --expire 365

# Create an admin key
ipilot apikeys create admin-key --role admin

# List keys
ipilot apikeys list

# Revoke a compromised key
ipilot apikeys revoke <key-id>
```

## Runbooks

```bash
# List built-in runbooks
ipilot runbook list

# Execute deploy-production runbook
ipilot runbook execute deploy-production

# Execute backup verification
ipilot runbook execute backup-verify

# Create a custom runbook
ipilot runbook create my-deploy \
  --description "Custom deployment workflow" \
  --steps '[{"action":"git_pull","target":"repo"},{"action":"backup","target":"database"},{"action":"docker_pull","target":"app"},{"action":"restart","target":"app"},{"action":"healthcheck","target":"app"},{"action":"notify","target":"discord"}]'

# Show runbook details
ipilot runbook show deploy-production
```

## Plugin Management

```bash
# List available plugins
ipilot plugins list

# Show only installed
ipilot plugins list --installed

# Install plugins
ipilot plugins install kubernetes
ipilot plugins install aws
ipilot plugins install cloudflare

# Update all plugins
ipilot plugins update --all

# Check for updates
ipilot plugins update

# Plugin info
ipilot plugins info docker

# Uninstall
ipilot plugins uninstall proxmox
```

## Developer Tools

```bash
# Run diagnostics
ipilot doctor

# Auto-fix issues
ipilot doctor --fix

# Verbose diagnostics
ipilot doctor --verbose

# Benchmark local system
ipilot benchmark

# Benchmark a remote server
ipilot benchmark --server web-01

# Diagnose connectivity issues
ipilot diagnose --issue connectivity

# Diagnose specific server performance
ipilot diagnose --server web-01 --issue performance

# Disk diagnosis
ipilot diagnose --issue disk

# TUI dashboard
ipilot tui dashboard

# TUI monitor
ipilot tui monitor web-01

# TUI logs
ipilot tui logs web-01
```

## Rollback & Undo

```bash
# List recent changes
ipilot rollback list --limit 10

# Preview an undo
ipilot rollback undo <change-id> --dry-run

# Execute undo
ipilot rollback undo <change-id>

# Rollback a server config
ipilot rollback rollback server web-01 --version "2024-01-15T10:00:00Z"

# View change history for a specific resource
ipilot rollback history --resource server --id web-01
```

## Create a Server and View Logs

```bash
ipilot server create --name web-prod --type web --memory 4096
ipilot logs <id> --lines 50 --follow
```

## Backups

```bash
# Create a backup
ipilot backup create <id>

# Create with S3 target
ipilot backup create <id> --s3 my-bucket:/backups

# Schedule automated backups
ipilot backup schedule <id> --interval daily --retention 30

# Schedule with S3 offsite storage
ipilot backup schedule <id> --interval hourly --s3 my-bucket:/db-dumps

# List backups
ipilot backup list

# Manage snapshots
ipilot backup snapshots <id>
ipilot backup snapshots <id> --create
ipilot backup snapshots <id> --restore <snapshot-id>

# Restore
ipilot backup restore <backup-id>

# Configure S3 storage
ipilot backup config \
  --s3-bucket my-backups \
  --s3-key ACCESS_KEY \
  --s3-secret SECRET_KEY \
  --s3-endpoint https://s3.us-east-1.amazonaws.com
```

## Global Search

```bash
# Available via API:
# GET /api/global-search?q=<query>
# Searches across: apps, servers, backups, runbooks, secrets, hosts
```

---

*See [CLI Reference](05-CLI-Reference) for all available commands.*

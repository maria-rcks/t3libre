# CLI Reference

## Usage

```bash
ipilot [global-flags] <command> [subcommand] [flags]
```

Global flags: `--output`/`-o` (json, table, yaml, plain), `--profile`/`-p`, `--no-color`

## Core Commands

| Command | Description |
|---------|-------------|
| `login <api_key>` | Authenticate |
| `logout` | Clear auth token |
| `version` | Show version |
| `interactive` | REPL mode |
| `completion [shell] [--install]` | Shell completion |
| `health` | System health |

## Server Management

| Command | Description |
|---------|-------------|
| `server list` | List servers |
| `server create <name> --type --memory` | Create server |
| `server delete <id>` | Delete server |
| `server status <id>` | Server status |

## Backup & Snapshots

| Command | Description |
|---------|-------------|
| `backup list [server]` | List backups |
| `backup create <server> [--s3 bucket:path]` | Create backup |
| `backup schedule <server> [--interval] [--retention] [--s3]` | Schedule backups |
| `backup snapshots <server> [--create] [--restore]` | Snapshot management |
| `backup restore <id> [--target]` | Restore backup |
| `backup config [--s3-bucket] [--s3-key] [--s3-secret] [--s3-endpoint]` | S3 config |

## Deployment

| Command | Description |
|---------|-------------|
| `deploy <server> <branch> [--template]` | Deploy branch |
| `deploy list [--server]` | List deployments |
| `deploy status <id>` | Deployment status |
| `deploy rollback <id>` | Rollback deployment |

## GitOps (Infrastructure as Code)

| Command | Description |
|---------|-------------|
| `gitops export [-o file.yaml] [-s server]` | Export current infra as YAML |
| `gitops plan [-f file.yaml]` | Show diff between current state and YAML |
| `gitops apply [-f file.yaml] [--dry-run] [-y]` | Apply YAML config to infra |
| `gitops drift [--scan]` | Detect configuration drift |
| `gitops import-config <file>` | Import from YAML file |

## SSH Session Management

| Command | Description |
|---------|-------------|
| `ssh list [--status active\|closed]` | List SSH sessions |
| `ssh connect <server> [-u user] [-j jump] [-p port]` | Connect via SSH |
| `ssh jump_hosts [--create --host --user]` | Manage jump hosts |
| `ssh keys [--add --name] [--delete]` | Manage SSH keys |
| `ssh record <session-id>` | View session recording |
| `ssh saved [--add host@host:port] [--delete]` | Manage saved hosts |

## Server Inventory

| Command | Description |
|---------|-------------|
| `inventory list [--tag] [--environment] [--region] [--owner] [--provider]` | List with filters |
| `inventory show <server>` | Show server metadata |
| `inventory update <server> [--owner] [--environment] [--region] [--provider] [--os] [--cost] [--tags]` | Update metadata |
| `inventory tags [--list] [--server] [--add server:tag] [--remove server:tag]` | Tag management |

## Secret Management

| Command | Description |
|---------|-------------|
| `secrets list [--path]` | List secrets |
| `secrets get <key> [--version]` | Get secret value |
| `secrets set <key> <value> [--rotate] [--rotation-days]` | Store a secret |
| `secrets delete <key>` | Delete a secret |
| `secrets versions <key>` | List version history |
| `secrets rotate [--key] [--all]` | Rotate secrets |
| `secrets roles <key> [--grant role] [--revoke role]` | RBAC for secrets |

## Deployment Templates

| Command | Description |
|---------|-------------|
| `templates list [--type node\|python\|docker-compose\|nginx\|postgres\|redis\|traefik]` | List templates |
| `templates show <template>` | Show template details |
| `templates deploy <template> <name> [--server] [--vars] [--dry-run]` | Deploy from template |
| `templates init <template> <name> [--output]` | Initialize local project |

## Plugin System

| Command | Description |
|---------|-------------|
| `plugins list [--installed]` | List available plugins |
| `plugins install <name> [--source] [--version]` | Install a plugin |
| `plugins uninstall <name>` | Uninstall a plugin |
| `plugins update [--name] [--all]` | Update plugins |
| `plugins info <name>` | Plugin details |

Built-in: kubernetes, docker, aws, hetzner, cloudflare, proxmox, ansible, nomad, azure

## Webhooks

| Command | Description |
|---------|-------------|
| `webhooks list` | List webhooks |
| `webhooks create <name> <url> [--events] [--secret]` | Create webhook |
| `webhooks delete <id>` | Delete webhook |
| `webhooks test [--id] [--event]` | Test delivery |
| `webhooks logs [--id]` | Delivery logs |

## API Keys

| Command | Description |
|---------|-------------|
| `apikeys list` | List API keys |
| `apikeys create <name> [--role] [--expire]` | Create API key |
| `apikeys revoke <id>` | Revoke API key |

## Undo / Rollback

| Command | Description |
|---------|-------------|
| `rollback list [--resource] [--limit]` | Recent changes |
| `rollback undo <change-id> [--dry-run]` | Undo a change |
| `rollback rollback <resource-type> <resource-id> [--version]` | Rollback resource |
| `rollback history [--resource] [--id]` | Change history |

## TUI (Terminal UI)

| Command | Description |
|---------|-------------|
| `tui dashboard` | Interactive dashboard |
| `tui monitor [server]` | Real-time monitoring |
| `tui logs [server]` | Log viewer |

## Developer Tools

| Command | Description |
|---------|-------------|
| `doctor [--fix] [--verbose]` | System diagnostics |
| `benchmark [--server]` | Performance benchmarks |
| `diagnose [--server] [--issue connectivity\|performance\|disk]` | Issue diagnosis |

---

*Source: `ipilot <command> --help` for each command*

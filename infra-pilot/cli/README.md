# Infra Pilot CLI (`ipilot`)

Command-line client for the Infra Pilot platform.

## Installation

```bash
pip install ./cli
```

## Quick Start

```bash
ipilot login <api-key>
ipilot server list
ipilot server create myapp --type nodejs --memory 1024
```

## Commands

- `server` – VPS lifecycle
- `backup` – Create, list, restore backups
- `deploy` – Deploy branches to servers
- `logs` – Tail server logs
- `gitops` – YAML-based deployments (`apply`, `plan`, `drift`)
- `ssh` – SSH sessions, keys, jump hosts
- `inventory` – Server metadata and tags
- `secrets` – Encrypted key-value store with rotation
- `plugins` – Plugin management
- `doctor` – Benchmark and diagnose
- `webhooks` – HTTP callbacks
- `apikeys` – API key management
- `templates` – Deployment blueprints
- `tui` – Terminal UI dashboard
- `rollback` – Undo/rollback changes

## Documentation

See [wiki/05-CLI-Reference.md](../wiki/05-CLI-Reference.md) for full reference.

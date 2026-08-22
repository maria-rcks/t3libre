# Discord Service

Provision Pterodactyl servers from Discord.

## Features

- Server creation with templates (Minecraft, Node.js, Teamspeak, database, Python)
- Ticket system (multi-category, priority, ratings)
- Economy (in-server currency)
- Moderation (warnings, message filter, channel cleanup)
- Verification (captcha, age gates)
- Welcome messages, voice management, activity tracking
- Events, polls, role management, custom commands
- Server status widgets, stats graphs
- Git deployment notifications

## Quick Start

```bash
npm install
cp .env.example .env
# Set DISCORD_TOKEN and Pterodactyl credentials
node index.js
```

## Configuration

`discord_token`, `pterodactyl_api_url`, `pterodactyl_api_key`, `server_creation_channel_id`, `max_servers_per_user`, egg IDs, `location_id`

## Modules

20+ modular systems in `modules/`: welcome, verification, tickets, server status, events, polls, roles, commands, warnings, message filter/logger, activity tracker, voice, backup, etc.

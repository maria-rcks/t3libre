# Troubleshooting

## CLI & Connection

| Error                  | Fix                                                         |
|------------------------|-------------------------------------------------------------|
| `Connection refused`   | API is not running — check `docker compose ps`, verify URL with `ipilot config get` |
| `Unauthorized`         | Log in again with `ipilot login <api-key>`                   |
| `404 Not Found`        | Update to the latest version                                |

## Docker Stack

| Problem                        | Fix                                 |
|--------------------------------|-------------------------------------|
| Container keeps restarting     | Missing `.env` settings — copy `.env.example` |
| `port is already allocated`    | Stop other programs or change ports |
| PostgreSQL won't connect       | Check `docker compose logs postgres` |

## Discord Bot

| Problem                   | Fix                                                    |
|---------------------------|--------------------------------------------------------|
| Bot does not respond      | Check `DISCORD_TOKEN` in `.env`                        |
| Missing Gateway Intents   | Enable all 3 intents in Discord Developer Portal      |

## AI Features

| Problem               | Fix                                            |
|-----------------------|------------------------------------------------|
| AI does not respond   | Check `AI_API_ENDPOINT` and `AI_API_KEY`       |
| "Model not found"     | Set `AI_MODEL` to a model you have available   |

## Logs

```bash
docker compose logs --tail=100 -f
docker compose logs orchestrator-agent --tail=50 -f
```

## Support

- [Issues](https://github.com/drosemann/infra-pilot/issues)
- [Discussions](https://github.com/drosemann/infra-pilot/discussions)
- Security: see [SECURITY.md](https://github.com/drosemann/infra-pilot/blob/main/SECURITY.md)

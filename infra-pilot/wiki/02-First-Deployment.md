# First Deployment

## 1. Configure and Log In

```bash
ipilot config set api_url http://localhost:3001
ipilot login <your-api-key>
```

## 2. Create a Server

```bash
ipilot server create --name my-first-server --type web --memory 2048
```

## 3. Check Status

```bash
ipilot server status <server-id>
```

You'll see `running` when it's ready.

## 4. Clean Up

```bash
ipilot server delete <server-id>
```

## Via the Web Panel

Open http://localhost:5173 and click **"Server erstellen"**.

---

*See [CLI Reference](05-CLI-Reference) for full command details.*

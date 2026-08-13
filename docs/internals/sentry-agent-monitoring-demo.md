# Sentry agent monitoring demo

This branch is a small integration demo, not a supported product feature. It exports one
metadata-only OpenTelemetry span to Sentry when a Codex or Claude turn finishes. Use this runbook to
hand the PR to another person or coding agent and get the same demo running in an isolated worktree.

## What you need

- the GitHub CLI authenticated for public repository access
- the repository's `vp` toolchain described in the root [README](../../README.md)
- an authenticated Codex or Claude provider that already works in T3 Code
- a Sentry project and its **DSN URL** from **Project Settings → Client Keys (DSN)**

Use the DSN URL, not the OpenTelemetry endpoint or authentication header shown alongside it. The
demo derives those values from the DSN.

## Check out the PR

For a new clone:

```bash
gh repo clone pingdotgg/t3code
cd t3code
gh pr checkout 5376
vp i
```

To keep an existing checkout untouched, create a detached test worktree from the PR ref:

```bash
git fetch origin pull/5376/head
git worktree add --detach ../t3code-sentry-demo FETCH_HEAD
cd ../t3code-sentry-demo
vp i
```

If `vp` is not installed yet, follow the Vite+ setup in the root README. `pnpm install` is also a
valid dependency-install fallback.

## Start the demo

```bash
vp run dev
```

Wait for the `[dev-runner]` line and open the complete pairing URL it prints. Do not use the bare
origin: the URL's pairing token is required. Worktree runs use the worktree-local `.t3` directory,
so the demo does not write to a normal T3 Code install.

When an agent starts the dev process, it should retain the terminal session or exact child PID and
stop only that process. Never kill a T3 Code dev server by name or path pattern.

## Connect Sentry

1. Open **Settings → General → Demo integrations**.
2. Enable **Sentry agent monitoring (demo)**.
3. Paste the Sentry DSN and select **Save DSN**.
4. Stop the dev process with `Ctrl+C`, then run `vp run dev` again.

The restart is required after enabling monitoring or replacing the DSN because the exporter is
created at server startup. Disabling monitoring stops new exports immediately. The DSN is stored in
the worktree server's secret store; `settings.json` and settings responses only contain a redacted
marker.

## Prove a completed turn

1. Create a thread using Codex or Claude.
2. Ask the agent to run one harmless tool and answer briefly, for example:

   ```text
   Run pwd once, then reply with the current directory in one sentence.
   ```

3. Let the turn finish and wait at least five seconds for the exporter batch.
4. In Sentry, open **Explore → Traces**, select the project, and filter for:

   ```text
   span.op:gen_ai.invoke_agent
   ```

Open the newest `invoke_agent t3-code` span. Depending on what the provider reports, its attributes
include:

- `gen_ai.provider.name`
- `gen_ai.request.model` and `gen_ai.response.model`
- `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, and token subsets
- `gen_ai.cost.total_tokens` (the provider-reported total cost in USD)
- `t3.agent.tool_use.count`
- `t3.agent.turn.duration_ms`
- `t3.agent.turn.completion_state`

The span's input and output views should not contain the prompt, response, reasoning, source code,
diffs, terminal output, file paths, or raw provider events.

## Exercise an unavailable MCP path

This optional check makes Codex see a deliberately unreachable MCP server without editing the
machine-wide `~/.codex/config.toml`.

1. Open **Settings → Providers** and edit the Codex provider used for the demo.
2. Temporarily set **Launch arguments** to:

   ```text
   -c 'mcp_servers.broken-demo.url="http://127.0.0.1:65535/mcp"'
   ```

3. Save the provider settings and restart the dev server.
4. Start a new Codex thread and ask it to use `broken-demo`.
5. Inspect the resulting Sentry span's completion state and `error.type`, when Codex emits a runtime
   error. Codex may recover from the unavailable MCP server and complete the overall turn; that is a
   valid demo result.
6. Remove the temporary launch arguments when finished.

## Focused verification

These checks cover the exporter mapping, runtime ingestion, settings secret handling, and settings
contracts:

```bash
vp test run \
  packages/shared/src/sentryAgentMonitoring.test.ts \
  packages/contracts/src/settings.test.ts \
  apps/server/src/observability/SentryAgentMonitoring.test.ts \
  apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts \
  apps/server/src/serverSettings.test.ts

vp run \
  --filter t3 \
  --filter @t3tools/web \
  --filter @t3tools/shared \
  --filter @t3tools/contracts \
  --concurrency-limit 2 \
  typecheck
```

## Troubleshooting

- **The setting is missing:** confirm the checkout is PR 5376 and look under **General**, not the
  removed Beta settings page.
- **No spans arrive:** confirm you restarted after saving the DSN, let a new turn finish, wait for
  the five-second export batch, and check the selected Sentry project.
- **The DSN is rejected:** copy the DSN URL from **Client Keys (DSN)**. A valid DSN has a public key
  in the username position and a numeric project ID in the path.
- **The saved DSN is not visible:** this is intentional. The field displays a redacted saved state;
  use **Replace DSN** or **Remove** to change it.
- **A failed tool still produces a completed span:** the provider can recover from a tool failure.
  Check `t3.agent.turn.completion_state` for the final turn outcome.

When the demo is finished, disable monitoring, select **Remove** to delete the stored DSN, stop the
exact dev process, and remove any temporary Codex launch arguments.

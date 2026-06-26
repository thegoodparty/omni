# MCP tools

Project-scoped MCP servers are checked into `.mcp.json` so every agent working in
omni gets the same toolset. Claude Code will ask you to approve them the first time.
Secrets are referenced via environment variables — **no tokens are committed**.

## Configured servers

| Server       | Transport | What it's for                                                                                                                                            |
| ------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `grafana`    | stdio     | Logs (Loki), metrics (Prometheus), traces (Tempo). The priority server for debugging. See `docs/observability.md`.                                       |
| `sentry`     | http      | Frontend error investigation. Remote server at `mcp.sentry.dev`; authenticate via OAuth on first use (`/mcp`).                                           |
| `playwright` | stdio     | Drive a real browser for UI verification / e2e exploration.                                                                                              |
| `clickup`    | http      | ClickUp tasks and design docs. Hosted server at `mcp.clickup.com`; authorize your ClickUp workspace via OAuth on first use (`/mcp`).                     |
| `amplitude`  | http      | Product analytics and feature flags. Hosted server at `mcp.amplitude.com`; authorize via OAuth on first use (`/mcp`). Drives the `amplitude-flag` skill. |

## Required environment variables

Only Grafana needs a secret. Set it in your shell before launching Claude Code; the
token must belong to a service account with at least Viewer/Editor access to logs,
metrics, and traces.

| Variable                        | Used by | Notes                                          |
| ------------------------------- | ------- | ---------------------------------------------- |
| `GRAFANA_SERVICE_ACCOUNT_TOKEN` | grafana | Required. Grafana Cloud service-account token. |

- `grafana` needs `uvx` (from `uv`) on your PATH; its URL is hardcoded to
  `https://goodparty.grafana.net` in `.mcp.json`.
- `playwright` runs via `npx` and needs no env vars. It is configured `--headless
--isolated` so it never opens a visible browser window — agents snapshot pages
  silently. Don't override it to headed.
- `sentry`, `clickup`, and `amplitude` are remote HTTP servers and use OAuth, so they
  need no token in env — authorize them on first use via `/mcp`.

## Design docs in ClickUp

Our engineering design docs live in ClickUp, and the ClickUp MCP can read them.
Entry point:

https://goodparty.clickup.com/90132012119/v/dc/2ky4jq2q-20493/2ky4jq2q-81493

Most design docs are subdocs of a larger "Eng Docs" doc; you may need to open the
parent to find a linked subdoc.

**ClickUp is read-only by default.** Don't run a mutating ClickUp tool (create/update/
delete) without explicit user permission.

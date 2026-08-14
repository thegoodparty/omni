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

## Plugins

Some tooling arrives as a Claude Code **plugin** rather than a raw MCP server entry.
Plugins are enabled project-wide in `.claude/settings.json` under `enabledPlugins`,
so anyone opening omni gets them without installing anything by hand.

| Plugin                          | What it adds                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `slack@claude-plugins-official` | Slack MCP tools (search, read channels/threads, post, canvases) plus Slack-authoring skills and digest/standup commands. |

`claude-plugins-official` is a built-in marketplace, so no `extraKnownMarketplaces`
entry is needed. The Slack server is OAuth-based — authorize the GoodParty workspace
on first use via `/mcp`; nothing is committed.

## Design docs in ClickUp

Our engineering design docs live in ClickUp, and the ClickUp MCP can read them.
Entry point:

https://goodparty.clickup.com/90132012119/v/dc/2ky4jq2q-20493/2ky4jq2q-81493

That link is the "Technical Design Docs" page, one top-level section of a larger
"Eng Docs" doc, which is now organized into sections (Technical Design Docs, How We
Build, Incident Docs, Serve Docs, Win Docs, Misc Docs). Most design docs are subpages
under one of those sections, so you may need to open the parent to find a linked one.
The "Eng Docs" _folder_ also holds a few standalone docs alongside the Eng Docs doc,
so a linked doc can be a sibling of that doc rather than a subpage of it.

**ClickUp is read-only by default.** Don't run a mutating ClickUp tool (create/update/
delete) without explicit user permission.

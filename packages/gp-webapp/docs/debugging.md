# Debugging

## Errors in production / dev

Frontend errors land in **Grafana Frontend Observability** (Faro): Grafana, Frontend, Frontend Apps, `gp-webapp-prod` or `gp-webapp-dev`, Errors. In Loki they are `{service_name="gp-webapp-prod", kind="exception"}` (or `gp-webapp-dev`), named for the Grafana app rather than the SDK's `gp-webapp`. Server-side request errors are Loki lines on `{service_name="gp-webapp-server"}`. Queries, fields and alerts: `docs/observability.md` at the repo root.

- Wired via `instrumentation-client.ts` (browser) and `instrumentation.ts` (server, `onRequestError`).

The Grafana MCP server reads the same exception lines from Loki; prefer it over the web UI for pulling errors into the agent's context.

## Backend errors and traces

gp-api logs to **Grafana Cloud Loki**.

- URL: https://goodparty.grafana.net
- Loki datasource UID: `grafanacloud-logs`
- Tempo (traces) UID: `grafanacloud-traces`
- Prometheus UID: `grafanacloud-prom`

Quick LogQL filter:

```
{service_name="gp-api", deployment_environment_name="prod"}
```

`service_name` is `gp-api`.
`deployment_environment_name` ∈ `preview | dev | prod`.

If you have the Grafana MCP server, use `query_loki_logs` instead of pasting LogQL into the UI.

## Reproducing a front-end error locally

1. Open the error in Frontend Observability and follow it to its **session**. A signed-in user's session has a replay.
2. From the replay, or the session's page views and events, identify the route path and the user action that triggered the error.
3. Boot the app against the same environment's API:

   ```bash
   npm run dev          # local gp-api on :3000
   npm run dev-dev      # remote dev gp-api (faster — no local backend needed)
   ```

4. Sign in as the same user (or a test user with the same role/state), navigate to the route, and reproduce the action.
5. If the bug depends on a specific entity (poll, contact, organization), grab the id from the page URL or the network panel beside the replay.

## Where to look

| Symptom                                  | First place to look                                          |
| ---------------------------------------- | ------------------------------------------------------------ |
| 4xx/5xx from gp-api                      | Loki: `{service_name="gp-api"} \| = "<request id>"`          |
| Frontend exception, no API in trace      | Frontend Observability — check the session events before it  |
| Auth redirect loop                       | `middleware.ts`, `UserProvider`, `getServerToken()`          |
| Wrong organization context               | `goodparty-org-slug` cookie, `x-organization` request header |
| Image / map / Stripe widget broken local | `appEnv.ts` env-var fallbacks; check `.env.local`            |

## Common gotchas

- `npm run dev` requires gp-api on `:3000`. Use `npm run dev-dev` to point at remote dev API.
- Several env vars have hardcoded fallbacks in `appEnv.ts` — a missing var won't error, it'll silently hit dev API. Sanity-check the value being used.

# Observability and incident debugging

When something is broken, reach for the MCP tools before guessing. They are
configured in `.mcp.json`; required env vars are in `docs/mcp.md`.

## Grafana Cloud (logs, metrics, traces)

- **URL:** https://goodparty.grafana.net
- **Datasource UIDs:** Loki `grafanacloud-logs`, Tempo `grafanacloud-traces`,
  Prometheus `grafanacloud-prom`
- **Labels for narrowing logs:**
  - `service_name`: `gp-api` | `election-api` | `people-api`
  - `deployment_environment_name`: `dev` | `qa` | `prod`

Example LogQL:

```logql
# All prod gp-api logs
{service_name="gp-api", deployment_environment_name="prod"}

# Errors only in dev election-api
{service_name="election-api", deployment_environment_name="dev"} |= "error"
```

gp-api emits OpenTelemetry (OTLP) to Grafana Cloud. Grafana dashboards and alert
rules are defined as code in `packages/gp-api/deploy/components/grafana.ts` and
`components/alerting/` — app-side metric names must line up with those.

## Sentry (frontend errors)

- **Org slug:** `goodparty`
- **Web URL:** https://goodparty.sentry.io
- **Region URL:** https://us.sentry.io

Use the Sentry MCP to look up issues, events, and stack traces for gp-webapp.

## Debugging an incident with the MCPs

A workable default playbook:

1. **Scope it.** Which service and env? Pull recent error logs with the Grafana MCP,
   filtered by `service_name` + `deployment_environment_name`.
2. **Find the pattern.** Use Grafana's error-pattern / slow-request tooling to spot
   the spike, then narrow the time window.
3. **Trace it.** Grab a representative trace from Tempo (`grafanacloud-traces`) to
   see where time or the failure went across services.
4. **Frontend?** If it surfaced in the browser, pull the matching Sentry issue for
   the stack trace and breadcrumbs.
5. **Confirm before stamping.** A 2xx or a webhook hit is evidence of a *request*,
   not a *state*. Verify against the source of truth before concluding it's fixed.

Use the MCPs liberally here — that's what they're for.

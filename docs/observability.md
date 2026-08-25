# Observability and incident debugging

When something is broken, reach for the MCP tools before guessing. They are
configured in `.mcp.json`; required env vars are in `docs/mcp.md`.

## Grafana Cloud (logs, metrics, traces)

- **URL:** https://goodparty.grafana.net
- **Datasource UIDs:** Loki `grafanacloud-logs`, Tempo `grafanacloud-traces`,
  Prometheus `grafanacloud-prom`
- **Labels for narrowing logs:**
  - `service_name`: `gp-api` | `election-api` | `people-api`
  - `deployment_environment_name`: `dev` | `prod`

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

## Log redaction

Every log line gp-api and election-api write passes through `redactLine`
(`packages/nest-common/src/observability/log-redaction.ts`), wired in as pino's
`hooks.streamWrite`. It scrubs the literal values of the env vars named in
`SECRET_NAMES`, sensitive query parameters, connection-string passwords, and
`Authorization` credentials for any scheme — in the raw header form
(`Authorization: Bearer x`), in the JSON-serialized header bag pino emits for an
Axios error (`"Authorization":"JWT x"`), and in the escaped form a caller
produces by `JSON.stringify`-ing an error into a log message. Schemes are left
visible; the credential becomes `[REDACTED]`.

The hook only protects _logs_. Anything that leaves the process another way —
Slack notifications, Sentry events, SQS payloads, HTTP responses — is not
redacted, so don't hand a serialized Axios error (its `config.headers` carries
the credential) to those paths.

## Sentry (frontend errors)

- **Org slug:** `goodparty`
- **Web URL:** https://goodparty.sentry.io
- **Region URL:** https://us.sentry.io

Use the Sentry MCP to look up issues, events, and stack traces for gp-webapp.

## Debugging an incident with the MCPs

A workable default playbook:

1. **Read the deployed code, not your local copy.** Deployed behavior is whatever
   is on the remote branch, not what your working tree happens to be — and this
   checkout is shared, so `HEAD` may be stale or moved under you by another session.
   Env → branch: `main` is the only branch. `origin/main` is what's on dev; prod
   runs whatever commit automated promotion last shipped from `main`. The deployed
   people-api service (dev/prod only) no longer has a repo package or branch-driven
   deploy in omni — it's frozen at whatever was last deployed before the
   people-db cutover; use its own logs to diagnose it, not this repo's HEAD.
   Before forming a hypothesis: `git fetch origin <branch>`, check how far
   behind you are (`git rev-list --count HEAD..origin/<branch>`), and read the
   deployed source with `git show origin/<branch>:path/to/file`. A stale checkout
   makes you reason about code that isn't deployed and misread every symptom.
2. **Scope it.** Which service and env? Pull recent error logs with the Grafana MCP,
   filtered by `service_name` + `deployment_environment_name`.
3. **Find the pattern.** Use Grafana's error-pattern / slow-request tooling to spot
   the spike, then narrow the time window.
4. **Trace it.** Grab a representative trace from Tempo (`grafanacloud-traces`) to
   see where time or the failure went across services.
5. **Frontend?** If it surfaced in the browser, pull the matching Sentry issue for
   the stack trace and breadcrumbs.
6. **Confirm before stamping.** A 2xx or a webhook hit is evidence of a _request_,
   not a _state_. Verify against the source of truth before concluding it's fixed.

Use the MCPs liberally here — that's what they're for.

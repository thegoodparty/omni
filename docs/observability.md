# Observability and incident debugging

When something is broken, reach for the MCP tools before guessing. They are
configured in `.mcp.json`; required env vars are in `docs/mcp.md`.

## Grafana Cloud (logs, metrics, traces)

- **URL:** https://goodparty.grafana.net
- **Datasource UIDs:** Loki `grafanacloud-logs`, Tempo `grafanacloud-traces`,
  Prometheus `grafanacloud-prom`
- **Stream labels, and there are only these two:**
  - `service_name`: `gp-api` | `election-api`
  - `deployment_environment_name`: `dev` | `prod`

That is the entire set you can narrow on. Everything else a log line carries —
`request_endpoint`, `response_statusCode`, `responseTimeMs`, `exception_type`,
`service_instance_id`, the controller that served the request — is **not** a
way to read less.

Those fields are **structured metadata**, not JSON body: Grafana Cloud promotes
OTel log-record attributes to per-line labels, so they are already there to
filter on and `| json` is not needed to reach them. Reach for the parser only
for a field that is genuinely body-only. Worth knowing because a `| json` that
names one of these collides with the label that already exists and Loki renames
the parser's output to `response_statusCode_extracted` — so the filter you
write goes on reading the structured metadata and the parser silently does
nothing but widen every line's label set.

Grafana Cloud's Loki promotes a fixed list of 17 OTel **resource** attributes to
stream labels and offers no mechanism to promote anything else, so this list
cannot be extended with a per-request field however useful it would be. Do not
go looking for a narrower selector than the two above; there isn't one.

## What a Loki query costs

Loki bills decompressed bytes. Only the stream selector and the time range
change that number. Line filters, `| json` and label filters run on data you
have already paid for.

Always pass an explicit time range. Start at 1h. Widen only when 1h was
genuinely not enough, and never past 24h without a specific reason. A 30-day
query on the prod gp-api stream reads more than the whole organisation ingests
in a fortnight.

```logql
# Bounded and narrow
{service_name="gp-api", deployment_environment_name="prod"} |= "error"
start=now-1h  end=now
```

Use `count_over_time` to find the shape before pulling lines.

```logql
# How many, and when — before asking for the lines themselves
sum by (request_endpoint) (count_over_time(
  {service_name="gp-api", deployment_environment_name="prod"}
    |= "error" | keep request_endpoint [5m]
))
```

`| keep` is doing real work there. Structured metadata carries `requestId`,
`trace_id` and `span_id`, all unique per request, and they are part of the
identity of the vector `count_over_time` counts — so without it that inner
vector is about one series per log line. It costs no extra bytes either way,
but a bare `count_over_time` on this stream fails outright with `maximum number
of series (500) reached`, and dropping to just the label you group by is what
makes the query return at all.

Because the selector cannot get narrower than service plus environment, **the
time range is the only lever you have.** Three habits follow, and they are the
whole of it:

- **Bound every query, always.** An unbounded query on the prod gp-api stream is
  the most expensive thing anyone in this repo can type, and nothing later in
  the pipeline makes it cheaper.
- **Narrowing by a log field is free, not cheap.** A `| request_endpoint = ...`
  filter costs exactly as much as reading every gp-api line in the window. It
  makes the answer precise, not smaller.
- **Count first, read second.** `count_over_time` over a 1h window tells you
  whether the thing you are chasing is there at all, and a `limit` on the
  follow-up read changes nothing about the bill. A `limit` bounds what comes
  back, not what was scanned.

The plan includes log queries up to **100x** what we ingest. Ingest is the
denominator, so cutting log volume also cuts the free query budget — reducing
ingest is not a fix for a query overage. Two rules page before the vendor does:
`loki-query-budget-half` and `loki-query-budget-critical`, at 50% and 80% of
that allowance.

Live usage is on the `grafanacloud-usage` Prometheus datasource
(`grafanacloud_logs_instance_query_bytes:rate5m` against
`grafanacloud_logs_instance_billable_bytes_received_per_second`). When the
budget alert fires, the question is _which query_ — that is the
`grafanacloud-usage-insights` Loki datasource:

```logql
topk(10, sum by (rule_name) (sum_over_time(
  {instance_type="logs"} | logfmt | __error__="" | source="grafana-alert"
  | unwrap total_bytes [24h]
)))
```

Drop the `source="grafana-alert"` matcher to see ad-hoc queries alongside the
alert rules. This datasource is Grafana's own usage stream and does not bill
against our allowance, so it is safe to query over 24h.

## Alerting reads a metric, not the logs

gp-api's per-route alerts do not query Loki. A pair of Loki **recording rules**
reads the prod and dev streams once a minute and writes the error counts into
Prometheus; the alert rules then evaluate against that metric. Cost is
proportional to ingest and independent of how many alert rules exist, which is
what makes adding one free. See `packages/gp-api/docs/observability.md`.

The consequence when you are debugging: an alert's own query is PromQL over
`gp_api:route_errors:count1m` and shows you counts, not lines. The Slack
notification links to the matching log lines; follow that link rather than
widening the metric query.

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
Sentry is not metered the way Loki is; the budget discipline above is a Loki
concern.

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
2. **Write the selector and the window before the query.** Service and
   environment — that is the whole selector available. One hour, ending now
   unless you already know the incident started earlier. This is the step that
   decides what the investigation costs; nothing after it does.
3. **Count before you read.** `count_over_time` over that selector says whether
   the errors are there, how many, and when they started. If the count is zero,
   the selector is wrong and pulling lines would only have shown you that more
   slowly and more expensively.
4. **Pull the lines, then narrow with the pipeline.** `| json | exception_type
!= ""` on the window you already paid for. Widen the window only when the
   count in step 3 showed the spike starting before it — and say why.
5. **Trace it.** Grab a representative trace from Tempo (`grafanacloud-traces`) to
   see where time or the failure went across services.
6. **Frontend?** If it surfaced in the browser, pull the matching Sentry issue for
   the stack trace and breadcrumbs.
7. **Confirm before stamping.** A 2xx or a webhook hit is evidence of a _request_,
   not a _state_. Verify against the source of truth before concluding it's fixed.

If an investigation genuinely needs a 7-day or 30-day view, take it once, with
`count_over_time` and a coarse `sum by`, and reuse the answer. Repeating a
wide query because it was easier than writing down the first result is how a
single session reaches a month of ingest.

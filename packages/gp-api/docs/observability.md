# Alerting

## Overview

gp-api has an automated alerting system that provisions [Grafana alert rules](https://goodparty.grafana.net) via Pulumi. **Both `dev` and `prod` provision the full set**, into `DEV Alerts (provisioned via gp-api)` and `PROD Alerts (provisioned via gp-api)` respectively, each rule carrying an `environment` label. Because the two are generated from the same definitions, every notification is prefixed with `[DEV]` or `[PROD]` -- without it the two pages are identical and there is no way to tell from Slack whether production is affected.

There are two categories of alerts:

### Controller Alerts (auto-generated)

Each controller gets one rule covering every endpoint on it:

- **Error count**: Fires when any requests return error status codes (≥ 400, excluding 400/401/403/404/409/498) **or no status at all** within a 10-minute window. A controller listed in `SERVER_ERRORS_ONLY` uses `≥ 500` instead -- see [Server-errors-only controllers](#server-errors-only-controllers). The null-status clause is [No status is also a fault](#no-status-is-also-a-fault).

The rule groups by `request_endpoint` and matches its controller's routes with an anchored alternation, so Grafana raises a separate alert instance per failing endpoint and the notification names the one that broke. Paging granularity is per endpoint; the _rule_ is per controller, because Loki bills the bytes a query decompresses and only the stream selector and time range decide that. A rule per endpoint re-read the whole gp-api stream once per endpoint per minute and cost the same as reading everything -- see [Query cost](#query-cost).

These are generated automatically from the controllers in the codebase -- you don't write them by hand. **All controller alerts are disabled by default** and require explicit opt-in via the ownership mapping (see [Ownership](#ownership) below).

### Global Alerts (hand-written)

These cover system-wide concerns that aren't tied to a specific endpoint:

- **High CPU utilization** (>80% for 5 min)
- **High memory utilization** (>90% for 5 min)
- **Missing health check logs** (no `/v1/health` requests logged for 2 min)
- **Door-knocking route planner spend ceiling** (>10,000 Geoapify credits across all organizations in 6h) -- the global view nothing else gives, since no per-organization limit bounds spend: the one daily limit door knocking has counts campaigns, and five two-stop turfs and five 150-stop turfs are the same five campaigns. See gp-api `docs/door-knocking.md` § Spend visibility.
- **Geoapify daily credit budget** at 60 / 80 / 90 / 95% consumed over 24h -- four rules generated from `alerting/geoapify-budget-alerts.ts`, escalating as the whole account approaches the wall. The ceiling above measures the _rate_ of a runaway; these measure how much of the _pool_ is left, which is what decides whether the next knock gets a route at all. **Their denominator is a hand-maintained constant** (`GEOAPIFY_DAILY_CREDIT_POOL`), because the allowance lives in Geoapify's billing console and nothing in gp-api can read it -- if all four fire at once, suspect the constant before the spend.
- **Public campaign lookup failing** (>10% of resolvable `GET /v1/public-campaigns` lookups returning 5xx over 10 min) -- a rate-based rule for a route the generated one can't serve. See [High-volume routes](#high-volume-routes-prefer-a-ratio).
- **Door-knocking pack build failed mid-response** -- `GET /v1/door-knocking/pack` streams, so it commits a 200 before it starts building and a later failure cannot be a status code. The generated route alert is structurally blind to it; this log-line rule is the only signal. See gp-api `docs/door-knocking.md` § The pack.

This list previously included a **Slow Prisma connection acquisitions** rule. No such rule exists in `GLOBAL_ALERTS`, and it never did — the entry described an intent, not a deployment. The underlying metrics are real and emitted by the span processor in `src/otel.ts`: `prisma.connection.duration` (histogram, ms) and `prisma.connection.slow` (counter, acquisitions over 150ms). They are queryable in Explore and worth a rule; they simply do not page today.

### Synthetic monitoring (prod only)

`grafana.ts` provisions one Synthetic Monitoring check, `gp-api-<env>-health`, hitting `/v1/health` from three probes every 60s. It feeds the `health-check-probe-failure` rule, which is the only signal for "the service is unreachable from outside", as distinct from the in-process metrics every other global alert reads.

**It is enabled in prod only.** Check executions bill against a single account-wide allowance (100,000/month) that every environment shares, and three probes a minute is 129,600/month per environment. Dev's copy was ~43% of our synthetic monitoring volume and bought nothing, because probe failures raise an alert whose `environment` label sends it to the `nowhere` contact point (see [Ownership](#ownership)). The dev check stays provisioned but disabled, so re-enabling it is a one-line change if dev alerting ever gets a real destination.

The allowance is shared and account-wide, so this is the one alerting knob where **adding a check in any environment can put a different team's checks into overage**. Budget before adding probes or raising frequency: prod's three probes are 129,600/month against the 100,000 included.

## Where do alerts show up?

When an alert fires, Grafana sends a notification to the `#dev-alerts` Slack channel. The notification includes:

- The environment the alert fired in, tagged `[DEV]` or `[PROD]` on both the title and the body (which of the two a contact point shows is Grafana's default templating to decide, so neither omits it)
- The alert name and a description with guidance on how to investigate
- A link back to the alert in Grafana
- A mention of the owning Slack group (`@serve-bugs` or `@win-bugs`) if applicable

You can also view all alert states in the [Grafana Alerting UI](https://goodparty.grafana.net/alerting/list).

## Ownership

_Controller_ alerts follow a **Serve/Win ownership model**. Each controller is assigned to either the `serve-bugs` or `win-bugs` Slack group, which determines who gets notified when an alert fires.

Ownership is configured in `deploy/components/alerts.ts` via `ALERT_OWNERSHIP`:

```typescript
export const ALERT_OWNERSHIP: Record<SlackGroup, ControllerName[]> = {
  'serve-bugs': [
    'elected-office',
    'polls',
    'contacts',
    'contact-engagement',
    'organizations',
  ],
  'win-bugs': ['door-knocking'],
}
```

Controllers that aren't assigned to either group still get alerts generated, but they're **disabled** (paused in Grafana) until someone claims ownership.

## Key files

All alerting configuration lives in `deploy/`:

| File                                               | Purpose                                               |
| -------------------------------------------------- | ----------------------------------------------------- |
| `deploy/components/alerts.ts`                      | Ownership mapping and global alerts                   |
| `deploy/components/alerting/controller-alerts.ts`  | Generates one error count alert per controller        |
| `deploy/components/alerting/alerts.types.ts`       | Type definitions for `Alert` and `SlackGroup`         |
| `deploy/components/alerting/alert-notification.ts` | Notification title and body: environment tag, mention |
| `deploy/components/grafana.ts`                     | Converts alerts into Grafana rule groups via Pulumi   |

## How to opt in a controller

Opting in a controller means assigning it an owner. Add the controller to the appropriate team in `ALERT_OWNERSHIP` in `deploy/components/alerts.ts`. The controller name is the string from the `@Controller('...')` decorator (e.g., `@Controller('contacts')` -> `'contacts'`), and will be typesafe and autocompleted by your editor.

All of that controller's endpoint alerts become active on the next deploy.

### High-volume routes: prefer a ratio

The generated rule has a threshold of 0: one error in the window pages. That is
the right default for a route that should never error, and the wrong one for a
route with enough traffic to carry a standing error rate. `public-campaigns`
serves roughly 2 req/s from the marketing site's candidate pages; opting it in
would have paged continuously and been muted within a day, which is no better
than the no-coverage state it was actually in.

For a route like that, leave it out of `ALERT_OWNERSHIP` and hand-write a
global alert expressing error _share_ rather than error _count_ -- see
`public-campaigns-lookup-error-ratio` in `deploy/components/alerts.ts`. Two
things are worth copying from it: pick a denominator that excludes statuses the
route returns by design (there, the 404 that means "candidate hasn't claimed a
profile", ~95% of its traffic), and `and` in a minimum-volume clause so a quiet
window can't turn one stray error into a page. Below that floor the query
returns no data, which `grafana.ts` maps to OK, not Alerting.

## How to override thresholds

Error alerts always fire on any unexpected error and the threshold cannot be overridden -- if an endpoint is returning errors, you should know about it. The one thing that _is_ tunable is which statuses count as unexpected, per controller.

## Which statuses count as unexpected

`EXCLUDED_STATUS_CODES` in `deploy/components/alerting/controller-alerts.ts` is the global list, and the Slack message reads from that same constant so the two cannot drift:

```typescript
const EXCLUDED_STATUS_CODES = [400, 401, 403, 404, 409, 498]
```

Each one is a status the API returns to say something true about the request rather than to report a fault: unauthenticated (401), not entitled (403), not found (404), conflicting with current state (409), client went away (498).

**400 is on this list, and that is the deliberate part.** A 400 is never evidence of a fault on its own. In gp-api it is overwhelmingly designed vocabulary -- Zod rejecting a payload, an eligibility refusal, a Serve organization asking for a Win-only filter, the 100k id-set cap -- and nothing in a generated rule can distinguish one of those from an accidental one. Counting it meant paging on the product working: the Pro gate did exactly that with a single free-tier user before it moved to 403, and any route that validates input can be made to fire by a user typing a bad value.

The cost is accepted rather than avoided: a 400 that really is a bug -- the webapp sending a payload the API stopped accepting, say -- no longer pages, and reaches us as a support report or through the logs. What still pages is the range that cannot be explained by a caller's input: 5xx, the 4xx not on the list, and **no status at all**.

## Server-errors-only controllers

`SERVER_ERRORS_ONLY` in `deploy/components/alerts.ts` lists controllers whose generated route alerts fire on `≥ 500` instead of the default `≥ 400`-minus-exclusions:

```typescript
export const SERVER_ERRORS_ONLY: ControllerName[] = ['door-knocking']
```

The default filter assumes an unexcluded 4xx on your controller is a bug. That holds for most of them and breaks for a controller whose 4xx responses are the product's own vocabulary. `door-knocking` answers an over-budget knock with **429**, which the default filter does count -- so under the default rule normal pilot use would page, and an alert that fires on designed behavior gets muted. What is left is the range worth waking up for: a missing `GEOAPIFY_API_KEY` (502), a Route Planner outage (502), and unhandled 500s. A plan that misses stops used to sit in that list and no longer does: the vendor is answering fine and the turf holds an address nothing can route to, so it is a 400 naming that address, traced by the `door-knocking turf contains stops the route planner cannot reach` warn line instead of a page.

This list narrowed in scope once **400 joined the global exclusions**. Door knocking's other designed 4xx -- an empty or oversized turf, and an ineligible district the webapp renders as a state -- are 400s, so every controller now drops those. 429 is the part still doing work here. A controller whose only designed 4xx is a 400 no longer needs to be listed at all.

The cost: a genuine bug that surfaces as a 4xx on a listed controller no longer pages. Add a controller only when its 4xx vocabulary is deliberate, documented, and **not already excluded globally**. Everything else keeps the `≥ 400`-minus-exclusions rule.

Per-route granularity, ownership, Slack routing, and the rest of the generated machinery are unchanged -- this only swaps the status filter and the wording of the Slack message.

## No status is also a fault

Both filters above carry an `or response_statusCode = ""` clause, and it is not a rounding error in the range. **A request the gateway kills in flight logs `statusCode: null`** -- gp-api never wrote one -- so it is neither 4xx nor 5xx and every status-range filter missed it. That made a route's worst failure mode, _no answer at all_, structurally invisible to its own alert: two `GET /v1/door-knocking/pack` timeouts in the seven days to 2026-08-25 paged nobody, and both were 120-second hangs a candidate sat through.

Two details:

- **Empty string, not `null`.** Loki's `| json` drops a null field, and a label filter reads a missing label as empty, so the empty-string comparison matches whether the label is absent or present-and-blank. A numeric comparison can only ever miss it.
- **It re-admits no 4xx.** A null status is the _absence_ of one, so the clause cannot overlap with the 429 and 400 vocabulary `SERVER_ERRORS_ONLY` exists to suppress. It is safe on the default filter for the same reason.

When one of these fires, check `responseTimeMs` on the matching lines: a cluster at ~120,000ms is the gateway's idle timeout rather than anything the handler did. The fix for that is to make the endpoint write bytes while it works -- see gp-api `docs/door-knocking.md` § The pack for a worked example.

## How to add a new global alert

Add an entry to `GLOBAL_ALERTS` in `deploy/components/alerts.ts`:

```typescript
{
  slug: 'my-new-alert',                    // unique identifier
  name: 'Something bad happened',          // shown in Grafana and Slack
  type: 'log',                             // 'log' | 'metric' (Loki / Prometheus)
  expr: 'count_over_time({service_name="gp-api", deployment_environment_name="$ENV"} |= "something bad" [5m])',
  threshold: 1,                            // fires when expr result exceeds this value
  for: '5m',                               // must exceed threshold for this long before firing
  message: 'Description of what happened and how to investigate.',
  notify: 'serve-bugs',                    // optional: which Slack group to ping
}
```

See the inline documentation on alert entries for more details and references to documentation.

Key things to know:

- Use `$ENV` in your expression -- it gets replaced with the environment name (`prod`) at deploy time.
- `type: 'log'` queries go to Loki (structured logs). `type: 'metric'` queries go to Prometheus.
- `notify` is optional. If omitted, the alert still fires but won't mention a Slack group.

- The `for` field is a grace period -- the threshold must be continuously exceeded for that duration before the alert actually fires.
- `threshold` is compared with `>`, so `threshold: 0` means "fire if the value is greater than 0".
- **A range vector wider than the fetch window is silently truncated.** The engine only pulls `timeRangeSeconds` of data per evaluation (600s by default), so a `[1h]` vector left at the default sees ten minutes, not an hour. Set `timeRangeSeconds` to at least the widest range vector in `expr`, and make sure any window your `message` quotes is the one that actually applies -- a message promising an hour sends whoever reads it looking through fifty minutes of logs the rule never queried.
- **Widening `timeRangeSeconds` means slowing `evaluationIntervalSeconds`.** Evaluation defaults to every 60s, and each evaluation is billed for its whole fetch window, so the two together set the rule's cost -- see [Query cost](#query-cost). Grafana evaluates a rule group as a unit, so `grafana.ts` buckets the global alerts into one group per distinct interval; setting the field is all you need to do. Keep `for` a whole multiple of the interval, since `for` is counted in whole evaluations and an interval that does not divide it evenly quietly pushes firing out to the next one.

For more details on configuring alerts, see the [Grafana Alerting documentation](https://grafana.com/docs/grafana/latest/alerting/fundamentals/alert-rule-evaluation/).

## Counters need per-task identity, or `rate()` and `increase()` invent numbers

Prod runs more than one task (`desiredCount` in `deploy/components/service.ts`). Our OTLP counters are **cumulative**, so each task exports its own running total — and two tasks whose resource attributes are identical land on one Prometheus series that oscillates between their two totals. Every step down looks like a counter reset, which `rate()` and `increase()` handle by adding the whole subsequent value again.

The distortion is not marginal. On `person_profile_completion_request_event_count_total` the raw series read `1..3` across a 24h window while `increase()[24h]` over the same window returned **1702**. A ratio alert with a `> 20` volume floor — a floor that existed specifically to stop it firing on a handful of samples — was cleared by that inflation and fired on four real submissions.

`src/otel.ts` now sets `service.instance.id` on the resource, which gives each task its own series and makes the counters addable again. Two things follow:

- **Do not add a rule that depends on counter magnitude without checking the series first.** Query the bare metric over your window and look at the values. If a `sum(increase(...))` is orders of magnitude above what the raw series plausibly accumulated, identity is missing somewhere and the number is an artifact.
- **Counting log lines is the ground truth when magnitude matters.** `sum(count_over_time({...} |= "..." [24h]))` cannot be inflated this way. It costs Loki bytes (see below), so it is a verification tool rather than a default, but it is what settles a disagreement between a counter and reality.

`threshold: 0` rules on a `failed` result are largely immune, since "is anything failing" survives inflation. Ratios, volume floors, and anything quoting an absolute count are not.

## Query cost

Loki bills the bytes a query **decompresses**, and only two things decide that: the stream selector inside `{...}` and the time range. Every stage after the `}` -- line filters, `| json`, label filters, structured-metadata filters -- runs on data that has already been read and paid for. They make a query faster and more precise. They do not make it cheaper.

Two consequences worth internalising before you add a rule:

- **Narrowing by a log field is free, not cheap.** `| request_endpoint = "GET /v1/contacts/:id"` costs the same as reading every gp-api log line in the window. The only way to genuinely read less is a narrower stream selector or a shorter window.
- **A rule's cost is its fetch window divided by its evaluation interval** -- the number of times a day it re-reads the same logs, and the only thing about a rule that its bill is proportional to. Evaluation defaults to every 60s, so a 6h `timeRangeSeconds` left on that default re-reads the same six hours 1,440 times a day. Widening `timeRangeSeconds` is not free the way widening a range vector in an ad-hoc query is; pair a wide window with a slower `evaluationIntervalSeconds`. A rule whose window is measured in hours does not need minute-resolution evaluation. `global-alerts.test.ts` caps this ratio, so a wide window paired with a fast interval fails the suite.

So when several rules would differ only in a filter, write one rule that groups by that field instead. Grafana raises one alert instance per returned series, so per-dimension paging survives -- set `summaryDetail` to a `{{ $labels.<field> }}` template so the notification still names the dimension that fired. That is exactly what the generated controller alerts do with `request_endpoint`.

The Grafana Cloud plan includes log queries up to **100x** what we ingest. Ingest is the denominator, so cutting log volume also cuts the free query budget -- reducing ingest is not a fix for a query overage. Current usage is in the `grafanacloud-usage` datasource (`grafanacloud_org_logs_query_usage` against `grafanacloud_org_logs_usage`), and per-rule attribution is in the `grafanacloud-usage-insights` Loki datasource:

```logql
topk(10, sum by (rule_name) (sum_over_time(
  {instance_type="logs"} | logfmt | __error__="" | source="grafana-alert"
  | unwrap total_bytes [24h]
)))
```

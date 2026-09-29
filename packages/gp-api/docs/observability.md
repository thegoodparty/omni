# Alerting

## Overview

gp-api has an automated alerting system that provisions [Grafana alert rules](https://goodparty.grafana.net) via Pulumi. **Both `dev` and `prod` provision the full set**, into `DEV Alerts (provisioned via gp-api)` and `PROD Alerts (provisioned via gp-api)` respectively, each rule carrying an `environment` label. Because the two are generated from the same definitions, every notification is prefixed with `[DEV]` or `[PROD]` -- without it the two pages are identical and there is no way to tell from Slack whether production is affected.

There are two categories of alerts:

### Controller Alerts (auto-generated)

Each controller gets one rule covering every endpoint on it:

- **Error count**: Fires when any requests return error status codes (≥ 400, excluding 400/401/403/404/409/498) **or no status at all** within a 10-minute window. A controller listed in `SERVER_ERRORS_ONLY` uses `≥ 500` instead -- see [Server-errors-only controllers](#server-errors-only-controllers). The null-status clause is [No status is also a fault](#no-status-is-also-a-fault).

**These rules do not query Loki.** Two recording rules do that on their behalf -- see [Route alerting reads a recorded metric](#route-alerting-reads-a-recorded-metric). Each controller's rule is a PromQL selection over the metric they write, grouped by `request_endpoint` and narrowed to its own routes with an anchored alternation, so Grafana still raises a separate alert instance per failing endpoint and the notification still names the one that broke. Paging granularity is per endpoint; the _rule_ is per controller.

These are generated automatically from the controllers in the codebase -- you don't write them by hand. **All controller alerts are disabled by default** and require explicit opt-in via the ownership mapping (see [Ownership](#ownership) below).

### Global Alerts (hand-written)

These cover system-wide concerns that aren't tied to a specific endpoint:

- **High CPU utilization** (>80% for 5 min)
- **High memory utilization** (>90% for 5 min)
- **Missing health check logs** (no `/v1/health` requests logged for 2 min)
- **Door-knocking route planner spend ceiling** (>10,000 Geoapify credits across all organizations in 6h) -- the global view nothing else gives, since no per-organization limit bounds spend: the one daily limit door knocking has counts campaigns, and five two-stop turfs and five 150-stop turfs are the same five campaigns. See gp-api `docs/door-knocking.md` § Spend visibility. Like the four tiers below it reads a recorded metric rather than Loki -- see [Door-knocking spend reads a recorded metric](#door-knocking-spend-reads-a-recorded-metric).
- **Geoapify daily credit budget** at 60 / 80 / 90 / 95% consumed over 24h -- four rules generated from `alerting/geoapify-budget-alerts.ts`, escalating as the whole account approaches the wall. The ceiling above measures the _rate_ of a runaway; these measure how much of the _pool_ is left, which is what decides whether the next knock gets a route at all. **Their denominator is a hand-maintained constant** (`GEOAPIFY_DAILY_CREDIT_POOL`), because the allowance lives in Geoapify's billing console and nothing in gp-api can read it -- if all four fire at once, suspect the constant before the spend.
- **Public campaign lookup failing** (>10% of resolvable `GET /v1/public-campaigns` lookups returning 5xx over 10 min) -- a rate-based rule for a route the generated one can't serve. See [High-volume routes](#high-volume-routes-prefer-a-ratio).
- **Door-knocking pack build failed mid-response** -- `GET /v1/door-knocking/pack` streams, so it commits a 200 before it starts building and a later failure cannot be a status code. The generated route alert is structurally blind to it; this log-line rule is the only signal. See gp-api `docs/door-knocking.md` § The pack.
- **Loki query budget half spent / nearly spent** (50% and 80% of the included 100x-ingest allowance, hour-averaged) -- so the vendor is never again the first to tell us we are over. Both carry the per-rule attribution query in their notification, because "we are over budget" without "and this rule is why" is a puzzle rather than an alert.
- **Loki active stream count approaching the cap** (80% of `max_global_streams_per_user`) -- past the cap Loki rejects writes for new streams and logs are dropped, not queued. Measured against the live limit rather than a constant, since the limit is Grafana's to raise.
- **Alert rule evaluations are failing** (>20% of evaluations erroring for 5 minutes) -- the rule that says _alerting itself is blind_. See [When alerting cannot check](#when-alerting-cannot-check).

This list previously included a **Slow Prisma connection acquisitions** rule. No such rule exists in `GLOBAL_ALERTS`, and it never did — the entry described an intent, not a deployment. The underlying metrics are real and emitted by the span processor in `src/otel.ts`: `prisma.connection.duration` (histogram, ms) and `prisma.connection.slow` (counter, acquisitions over 150ms). They are queryable in Explore and worth a rule; they simply do not page today.

### Synthetic monitoring (prod only)

`grafana.ts` provisions one Synthetic Monitoring check, `gp-api-<env>-health`, hitting `/v1/health` from three probes every 60s. It feeds the `health-check-probe-failure` rule, which is the only signal for "the service is unreachable from outside", as distinct from the in-process metrics every other global alert reads.

**It is enabled in prod only.** Check executions bill against a single account-wide allowance (100,000/month) that every environment shares, and three probes a minute is 129,600/month per environment. Dev's copy was ~43% of our synthetic monitoring volume and bought nothing, because probe failures raise an alert whose `environment` label sends it to the `nowhere` contact point (see [Ownership](#ownership)). The dev check stays provisioned but disabled, so re-enabling it is a one-line change if dev alerting ever gets a real destination.

The allowance is shared and account-wide, so this is the one alerting knob where **adding a check in any environment can put a different team's checks into overage**. Budget before adding probes or raising frequency: prod's three probes are 129,600/month against the 100,000 included.

## Door-knocking spend reads a recorded metric

The same shape as route alerting below, for the same reason, and it is the change that settled the 2026-09-29 query-budget overage.

Five rules read the `DoorKnockingSpend` log line straight from Loki: the four Geoapify budget tiers over a 24h window every 15 minutes, and the 6h fast-burn ceiling every 5 minutes. A Loki rule re-reads its whole fetch window on every evaluation, so **its daily read volume as a multiple of ingest is exactly window ÷ interval** -- 96 for each tier, 72 for the ceiling. The plan includes log queries up to 100x ingest. One tier was therefore budgeted at 96% of everything we are allowed to read, and the four together at 384%; measured in prod they scanned 1,038 GB/day against a 1,056 GB/day allowance.

`DOOR_KNOCKING_SPEND_RECORDING_RULE` in `alerting/door-knocking-spend.ts` now reads one minute of those lines once a minute and writes `gp_api:door_knocking_credits:sum1m`. All five alerts select `sum_over_time(...)` over it, so the windows are assembled in PromQL where they cost nothing, and the five rules together read 1x ingest instead of 456x.

Two things worth carrying forward:

- **The result cache is not a substitute for not reading.** The tiers deliberately share one expression, and the old comment claimed Loki's query-frontend cache therefore served tiers 2-4 from tier 1's work. Per-rule attribution says it did not: 13.6, 11.2, 11.2 and 7.2 GB/h. Identical text is still worth keeping, but for consistency of measurement rather than for cost.
- **Cost no longer sets the evaluation interval for these.** The tiers stayed at 15 minutes and the ceiling at 5 because their firing behaviour was tuned under those numbers, not because a faster one is unaffordable any more.

## Route alerting reads a recorded metric

A recording rule runs a query on a schedule and writes its result into Prometheus as a metric. `ROUTE_RECORDING_RULES` in `deploy/components/alerting/controller-alerts.ts` declares two of them:

| Metric                               | Counts                                               |
| ------------------------------------ | ---------------------------------------------------- |
| `gp_api:route_errors:count1m`        | the default filter (≥ 400 minus exclusions, or null) |
| `gp_api:route_server_errors:count1m` | the `SERVER_ERRORS_ONLY` filter (≥ 500, or null)     |

Both are `sum by (request_endpoint) (count_over_time({service_name="gp-api", deployment_environment_name="$ENV"} |= "Request completed" | <filter> | keep request_endpoint [1m]))`, evaluated every 60 seconds.

There is deliberately **no parser**. `request_endpoint`, `response_statusCode` and `responseTimeMs` arrive as structured metadata, so the filter reads them directly; a `| json` here collided with all three and Loki renamed its output to `*_extracted`, which meant the parser was contributing nothing to the result and a per-line label set to the cost. The trailing `| keep` bounds the counted vector to the number of distinct endpoints — 119 across a measured hour of prod, ceiling `ROUTE_MAP`'s 421 — rather than letting `requestId`, `trace_id` and `span_id` size it by traffic. Each controller's alert then evaluates `sum by (request_endpoint) (sum_over_time(<metric>{environment="$ENV", request_endpoint=~"..."}[10m]))` against Prometheus, which is not metered by bytes read.

**Why it is shaped this way.** Until 2026-09-28 each generated rule ran its own Loki query, and each one selected the entire gp-api stream before narrowing to its slice -- because that is the only shape LogQL offers and, as [Query cost](#query-cost) explains, the narrowing is free rather than cheap. 74 rules therefore each paid for all of gp-api's logs once a minute: **2,690 GB/day measured**, against an allowance of roughly 100x our ~9.5 GB/day ingest. Grafana Cloud began answering Loki queries with HTTP 429, every log-backed rule failed to evaluate, and because `exec_err_state` is `Alerting` all 154 of them fired at once, each naming its own route. Production was healthy throughout.

The property that matters is not that there are now two queries instead of 74. It is that **the cost of alerting is now proportional to ingest and independent of rule count**, so adding an alert is free and nobody has to budget for one.

Two constraints on the recording rules are load-bearing and are asserted in `controller-alerts.test.ts`:

- **The range vector equals the evaluation interval.** A rule's Loki cost is its window divided by its interval -- how many times a day it re-reads the same bytes. At 1:1 each line is read exactly once, which is the floor. The 10-minute window the alerts want is assembled from ten recorded samples in PromQL, where it costs nothing.
- **The window ends a minute before now** (`toSeconds > 0`). Log lines reach Loki several seconds after the request they describe, so a window ending at `now` misses the newest lines -- and misses them permanently, because the next evaluation's window starts where this one ended. The wider overlapping window this replaced hid that. The price is 60s of detection latency, paid once rather than per rule.

One consequence to know about. The `max_query_series` cap on a Loki metric query is **500**, and the fan-out moved with the read: a single recording rule now returns one series per erroring route in the whole service rather than per controller. There are 421 routes today. The cap only bites if more than 500 _distinct_ endpoints error inside the same one-minute window, which is a total outage rather than a regression -- and a total outage is what the CPU, memory and synthetic-probe rules are for, none of which touch Loki. `controller-alerts.test.ts` fails if the route table alone reaches the cap, so the bound is visible before it is reached.

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

| File                                               | Purpose                                                                                                                                                         |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deploy/components/alerts.ts`                      | Ownership mapping and global alerts                                                                                                                             |
| `deploy/components/alerting/controller-alerts.ts`  | The two Loki recording rules, and one error count alert per controller reading the metric they write; the Slack body links to the fired route's exception lines |
| `deploy/components/alerting/alerts.types.ts`       | Type definitions for `Alert` and `SlackGroup`                                                                                                                   |
| `deploy/components/alerting/alert-notification.ts` | Notification title and body: environment tag, mention                                                                                                           |
| `deploy/components/grafana.ts`                     | Converts alerts into Grafana rule groups via Pulumi                                                                                                             |

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
export const SERVER_ERRORS_ONLY: ControllerName[] = [
  'door-knocking',
  'contacts',
  'campaigns/tcr-compliance',
]
```

The default filter assumes an unexcluded 4xx on your controller is a bug. That holds for most of them and breaks for a controller whose 4xx responses are the product's own vocabulary. `door-knocking` answers an over-budget knock with **429**, which the default filter does count -- so under the default rule normal pilot use would page, and an alert that fires on designed behavior gets muted. What is left is the range worth waking up for: a missing `GEOAPIFY_API_KEY` (502), a Route Planner outage (502), and unhandled 500s. A plan that misses stops used to sit in that list and no longer does: the vendor is answering fine and the turf holds an address nothing can route to, so it is a 400 naming that address, traced by the `door-knocking turf contains stops the route planner cannot reach` warn line instead of a page.

This list narrowed in scope once **400 joined the global exclusions**. Door knocking's other designed 4xx -- an empty or oversized turf, and an ineligible district the webapp renders as a state -- are 400s, so every controller now drops those. 429 is the part still doing work here. A controller whose only designed 4xx is a 400 no longer needs to be listed at all.

`campaigns/tcr-compliance` is the **422** case. `POST /:id/submit-cv-pin` answers 422 `Invalid PIN` when a candidate mistypes the 6-digit Campaign Verify PIN, and only after the code has confirmed Peerly's CV status is `APPROVED` -- so a PIN provably existed and the digits provably did not match. A PIN that was never issued answers 409 instead (`CampaignVerifyPinNotIssuedException`), specifically so the frontend can say "verification is still in progress" rather than blaming the candidate's input (ENG-10866). Neither is a fault. Measured over the 30 days to 2026-09-27, those 31 mistyped PINs were the controller's entire counted 4xx vocabulary, against 19 successful submissions -- a ~40% standing rate paging `@win-bugs` about twice a week. What the entry keeps is the signal that matters: 96 × 502 on `POST /submit-to-peerly`, 2 × 502 on `resend-cv-pin`, and a 500 on `GET /mine`.

The cost: a genuine bug that surfaces as a 4xx on a listed controller no longer pages. Add a controller only when its 4xx vocabulary is deliberate, documented, and **not already excluded globally**. Everything else keeps the `≥ 400`-minus-exclusions rule.

Per-route granularity, ownership, Slack routing, and the rest of the generated machinery are unchanged -- this only swaps the status filter and the wording of the Slack message.

## No status is also a fault

Both filters above carry an `or response_statusCode = ""` clause, and it is not a rounding error in the range. **A request the gateway kills in flight logs `statusCode: null`** -- gp-api never wrote one -- so it is neither 4xx nor 5xx and every status-range filter missed it. That made a route's worst failure mode, _no answer at all_, structurally invisible to its own alert: two `GET /v1/door-knocking/pack` timeouts in the seven days to 2026-08-25 paged nobody, and both were 120-second hangs a candidate sat through.

Two details:

- **Empty string, not `null`.** A null status never becomes structured metadata at all, and a label filter reads a missing label as empty, so the empty-string comparison matches whether the label is absent or present-and-blank. A numeric comparison can only ever miss it. Verified against prod: over the hour to 2026-09-28 19:19 UTC the filter matches exactly one line, a `POST /v1/ecanvasser/:id/sync` timeout, with and without a parser in the pipeline.
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
- `type: 'log'` queries go to Loki (structured logs) and are **metered by bytes scanned** -- read [Query cost](#query-cost) first. `type: 'metric'` queries go to Prometheus, including metrics our own recording rules write. `type: 'usage'` goes to `grafanacloud-usage`, which carries Grafana Cloud's billing and alerting-health metrics; use it for a rule that must not depend on the system it is watching.
- `notify` is optional. If omitted, the alert still fires but won't mention a Slack group.

- The `for` field is a grace period -- the threshold must be continuously exceeded for that duration before the alert actually fires.
- `threshold` is compared with `>`, so `threshold: 0` means "fire if the value is greater than 0".
- **A range vector wider than the fetch window is silently truncated.** The engine only pulls `timeRangeSeconds` of data per evaluation (600s by default), so a `[1h]` vector left at the default sees ten minutes, not an hour. Set `timeRangeSeconds` to at least the widest range vector in `expr`, and make sure any window your `message` quotes is the one that actually applies -- a message promising an hour sends whoever reads it looking through fifty minutes of logs the rule never queried.
- **Widening `timeRangeSeconds` means slowing `evaluationIntervalSeconds`.** Evaluation defaults to every 60s, and each evaluation is billed for its whole fetch window, so the two together set the rule's cost -- see [Query cost](#query-cost). Grafana evaluates a rule group as a unit, so `grafana.ts` buckets the global alerts into one group per distinct interval; setting the field is all you need to do. Keep `for` a whole multiple of the interval, since `for` is counted in whole evaluations and an interval that does not divide it evenly quietly pushes firing out to the next one.

For more details on configuring alerts, see the [Grafana Alerting documentation](https://grafana.com/docs/grafana/latest/alerting/fundamentals/alert-rule-evaluation/).

## Counters need per-task identity, or `rate()` and `increase()` invent numbers

Prod runs more than one task (`desiredCount` in `deploy/components/service.ts`). Our OTLP counters are **cumulative**, so each task exports its own running total — and two tasks whose resource attributes are identical land on one Prometheus series that oscillates between their two totals. Every step down looks like a counter reset, which `rate()` and `increase()` handle by adding the whole subsequent value again.

The distortion is not marginal. On `person_profile_completion_request_event_count_total` the raw series read `1..3` across a 24h window while `increase()[24h]` over the same window returned **1702**. A ratio alert with a `> 20` volume floor — a floor that existed specifically to stop it firing on a handful of samples — was cleared by that inflation and fired on four real submissions.

`src/otel.ts` now sets `service.instance.id` on the metric and trace resource, which gives each task its own series and makes the counters addable again. The log resource deliberately omits it -- Loki would promote it to a stream label -- and carries the value in the JSON body as `service_instance_id` instead. Two things follow:

- **Do not add a rule that depends on counter magnitude without checking the series first.** Query the bare metric over your window and look at the values. If a `sum(increase(...))` is orders of magnitude above what the raw series plausibly accumulated, identity is missing somewhere and the number is an artifact.
- **Counting log lines is the ground truth when magnitude matters.** `sum(count_over_time({...} |= "..." [24h]))` cannot be inflated this way. It costs Loki bytes (see below), so it is a verification tool rather than a default, but it is what settles a disagreement between a counter and reality.

`threshold: 0` rules on a `failed` result are largely immune, since "is anything failing" survives inflation. Ratios, volume floors, and anything quoting an absolute count are not.

## Query cost

The general model -- what Loki bills, why a line filter does not make a query cheaper, and how to bound an ad-hoc query -- lives in `docs/observability.md`. Read it before writing any `type: 'log'` rule. What follows is only the part specific to **alert rules**, which spend that budget on a schedule rather than when a human types something.

**A rule's cost is its fetch window divided by its evaluation interval** -- the number of times a day it re-reads the same logs, and the only thing about a rule that its bill is proportional to. Evaluation defaults to every 60s, so a 6h `timeRangeSeconds` left on that default re-reads the same six hours 1,440 times a day. Widening `timeRangeSeconds` is not free the way widening a range vector in an ad-hoc query is; pair a wide window with a slower `evaluationIntervalSeconds`. A rule whose window is measured in hours does not need minute-resolution evaluation.

**That same number is the rule's daily read volume as a multiple of ingest, and the allowance is 100x ingest.** So a rule at 96 is budgeted for 96% of everything the whole organisation is allowed to read -- and the allowance is shared by every rule, by dev and prod alike (both provision the same definitions and each reads its own stream, so the pair spends the sum), and by whatever anyone types into Explore. This is why a per-rule ceiling is not a budget: until 2026-09-29 the suite capped one rule at 100 and the four Geoapify tiers each sat at 96, passing individually while the set as a whole was budgeted at ~790% and measured at 4.4x. `global-alerts.test.ts` now caps **the sum** across every log-backed alert and recording rule at 130 -- about half the allowance, calibrated at ~3.9 GB/day per unit against the 2026-09-29 measurement -- plus a much lower per-rule ceiling of 24. When that test fails, the answer is a recording rule, not a bigger cap.

**Before adding a `type: 'log'` rule, ask whether a recording rule should read the stream instead.** Several rules that differ only in a filter are the case that matters: each one pays for the whole stream to look at its slice, and the pile of them is what produced the 2026-09-28 overage. One recording rule reading the stream and `sum by`-ing the dimension costs one read regardless of how many alerts consume it -- see [Route alerting reads a recorded metric](#route-alerting-reads-a-recorded-metric) and [Door-knocking spend reads a recorded metric](#door-knocking-spend-reads-a-recorded-metric) for the worked examples. A rule that is genuinely one of a kind and reads a 10-minute window on the default interval costs 10x ingest, which is affordable; anything with an hours-wide window is not, whatever its interval, and belongs on a recorded metric.

Where a Loki rule is the right answer, `summaryDetail` set to a `{{ $labels.<field> }}` template keeps per-dimension paging: Grafana raises one alert instance per returned series either way.

The plan includes log queries up to **100x** what we ingest. Ingest is the denominator, so cutting log volume also cuts the free query budget -- reducing ingest is not a fix for a query overage. Two rules now watch this (`loki-query-budget-half`, `loki-query-budget-critical`) and their notifications carry the per-rule attribution query, so the spend is self-reporting rather than something to go looking for. The datasources are in `docs/observability.md`.

## When alerting cannot check

`grafana.ts` provisions every rule with `execErrState: 'Alerting'`: a rule that cannot evaluate fires. That is deliberate and it stays. The alternative -- a rule that goes quiet when its datasource is unreachable -- is a monitoring system that reports "all clear" precisely when it has stopped looking.

The cost is that a datasource outage fires _everything_, and on 2026-09-28 that meant 154 simultaneous pages each naming a different API route, none of which was broken. The fix for that is not to soften `execErrState`; it is `alerting-rule-evaluations-failing`, which makes the telling **singular**. It reads Grafana Cloud's own evaluation counters on the `grafanacloud-usage` Prometheus datasource rather than anything gp-api emits, specifically so that it survives the failure it reports, and its message says what the situation actually is: alerting is blind, every firing alert is unverified and every silent one unchecked.

When it fires, read it first and the others second.

**Its routing is the part this repo cannot express.** Like `alert-notification-delivery-failing`, it must reach Slack by a path that does not depend on what broke -- in particular not through the `gpbot-alert-filter` contact point, which runs a Loki query per alert and therefore fails in exactly the scenario this rule exists to announce. The notification policy tree is hand-maintained in Grafana Cloud and is not provisioned here, so that is an ops step, not a code one.

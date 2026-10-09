# Alerting

## Overview

gp-api has an automated alerting system that provisions [Grafana alert rules](https://goodparty.grafana.net) via Pulumi. **Both `dev` and `prod` provision the full set**, into `DEV Alerts (provisioned via gp-api)` and `PROD Alerts (provisioned via gp-api)` respectively, each rule carrying an `environment` label. Because the two are generated from the same definitions, every notification is prefixed with `[DEV]` or `[PROD]` -- without it the two pages are identical and there is no way to tell from Slack whether production is affected.

There are two categories of alerts:

### Route Alerts (auto-generated)

Five rules cover every owned route in the service:

- **Error count**: Fires when requests to a route return error status codes (≥ 400, excluding 400/401/403/404/409/498) **or no status at all** within a 60-second window that ends 30 seconds before each evaluation. A group whose controllers are in `SERVER_ERRORS_ONLY` uses `≥ 500` instead -- see [Server-errors-only controllers](#server-errors-only-controllers). The null-status clause is [No status is also a fault](#no-status-is-also-a-fault).

These are generated from the controllers in the codebase -- you don't write them by hand -- and bucketed into the smallest number of Loki queries that can still say the right thing. See [Route alerts are five grouped rules](#route-alerts-are-five-grouped-rules). A controller's routes are covered only if it has an owner (see [Ownership](#ownership)); the few deliberately left uncovered are listed in `CONTROLLERS_WITHOUT_ROUTE_ALERTS`.

### Global Alerts (hand-written)

These cover system-wide concerns that aren't tied to a specific endpoint:

- **High CPU utilization** (>80% for 5 min)
- **High memory utilization** (>90% for 5 min)
- **Missing health check logs** (no `/v1/health` requests logged for 2 min)
- **Synthesis fell back to the in-repo theme prompt** -- the polls and issue-feedback synthesis pipeline (`packages/gp-ai/serve/v1_pipeline`, clustering in `serve/hierarchical_discovery`) loads its cluster-naming prompt from Braintrust in strict mode, so a hosted placeholder the code doesn't supply raises and the pipeline falls back to its in-repo prompt -- the run still completes with themes, just from the older prompt, so nothing on screen looks wrong. The queue consumer logs the one line this reads, from both `handlePollAnalysisComplete` and the `feedbackSynthesisComplete` case (`src/queue/consumer/queueConsumer.service.ts`), since either product's run can hit it. Owned by both `serve-bugs` and `win-bugs` -- polls are Serve, issue capture is both. Investigate by comparing the hosted Braintrust prompt `cluster-analysis` (project `hierarchical-discovery`) placeholders against the variables `cluster_analyzer.py` actually supplies. Like every alert here, dev routes to the `nowhere` contact point ([Ownership](#ownership)), so only prod pages.
- **Door-knocking route planner spend ceiling** (>10,000 Geoapify credits across all organizations in 6h, about a fifth of the daily pool) -- the global view nothing else gives, since nothing bounds per-organization spend any more: both limits door knocking had are removed, and one organization preparing a large canvass can legitimately reach this threshold in an evening (incident 99). Reaching it is a reason to look, not evidence of a loop. See gp-api `docs/door-knocking.md` § Spend visibility. Like the four tiers below it reads a recorded metric rather than Loki -- see [Door-knocking spend reads a recorded metric](#door-knocking-spend-reads-a-recorded-metric).
- **Geoapify daily credit budget** at 60 / 80 / 90 / 95% consumed over 24h -- four rules generated from `alerting/geoapify-budget-alerts.ts`, escalating as the whole account approaches the wall. The ceiling above measures the _rate_ of a runaway; these measure how much of the _pool_ is left, which is what decides whether the next knock gets a route at all. **Their denominator is a hand-maintained constant** (`GEOAPIFY_DAILY_CREDIT_POOL`), because the allowance lives in Geoapify's billing console and nothing in gp-api can read it -- if all four fire at once, suspect the constant before the spend.
- **A recording rule has stopped writing its metric** (`gp_api:door_knocking_credits:sum1m` absent for 30 min) -- the five rules above are blind while it fires, and nothing else can tell that state from quiet. See [Door-knocking spend reads a recorded metric](#door-knocking-spend-reads-a-recorded-metric).
- **Public campaign lookup failing** (>10% of resolvable `GET /v1/public-campaigns` lookups returning 5xx over 10 min) -- a rate-based rule for a route the generated one can't serve. See [High-volume routes](#high-volume-routes-prefer-a-ratio).
- **Door-knocking pack build failed mid-response** -- `GET /v1/door-knocking/pack` streams, so it commits a 200 before it starts building and a later failure cannot be a status code. The generated route alert is structurally blind to it; this log-line rule is the only signal. See gp-api `docs/door-knocking.md` § The pack.
- **Loki query budget half spent / nearly spent** (50% and 80% of the included 100x-ingest allowance, averaged over 6h and sustained for 2h) -- so the vendor is never again the first to tell us we are over. Both carry the per-rule attribution query in their notification, because "we are over budget" without "and this rule is why" is a puzzle rather than an alert.
- **Loki active stream count approaching the cap** (80% of `max_global_streams_per_user`) -- past the cap Loki rejects writes for new streams and logs are dropped, not queued. Measured against the live limit rather than a constant, since the limit is Grafana's to raise.
- **Alert rule evaluations are failing** (>20% of evaluations erroring for 5 minutes) -- the rule that says _alerting itself is blind_. See [When alerting cannot check](#when-alerting-cannot-check).

### Synthetic monitoring (prod only)

`grafana.ts` provisions one Synthetic Monitoring check, `gp-api-<env>-health`, hitting `/v1/health` from three probes every 60s. It feeds the `health-check-probe-failure` rule, which is the only signal for "the service is unreachable from outside", as distinct from the in-process metrics every other global alert reads.

**It is enabled in prod only.** Check executions bill against a single account-wide allowance (100,000/month) that every environment shares, and three probes a minute is 129,600/month per environment. Dev's copy was ~43% of our synthetic monitoring volume and bought nothing, because probe failures raise an alert whose `environment` label sends it to the `nowhere` contact point (see [Ownership](#ownership)). The dev check stays provisioned but disabled, so re-enabling it is a one-line change if dev alerting ever gets a real destination.

The allowance is shared and account-wide, so this is the one alerting knob where **adding a check in any environment can put a different team's checks into overage**. Budget before adding probes or raising frequency: prod's three probes are 129,600/month against the 100,000 included.

## Route alerts are five grouped rules

`routeAlertGroups()` in `deploy/components/alerting/route-alerts.ts` buckets every owned controller by the only two things that ever differ between these rules: the owner set, and whether `SERVER_ERRORS_ONLY` applies. Both are properties of the rule rather than of the series it returns, so controllers that agree on both share one rule; the anchored endpoint alternation is what keeps them apart. That is five rules today, where there was one per controller.

Each is `sum by (request_endpoint) (count_over_time({service_name="gp-api", deployment_environment_name="$ENV"} |= "Request completed" | <status filter> | request_endpoint =~ "<the group's routes>" | keep request_endpoint [1m]))`, evaluated every 60 seconds over `relativeTimeRange {from: 90, to: 30}`. Every rule pages on a single qualifying error.

**Paging is still per route.** `sum by (request_endpoint)` returns one series per failing route, Grafana raises one alert instance per series, and `summaryDetail` puts the endpoint in the title. A grouped rule pages exactly as a per-controller rule did. What it no longer does is name the controller, which the endpoint already implies, and 75 alert slugs became five -- alert history and any silence keyed to an old slug did not survive that.

**Delivery is per route too.** The notification policy groups by `alert_slug` and `request_endpoint` (`deploy/components/alerting/alert-routing.policy.json`), so a second route failing on the same rule gets its own group and its own 30-second `group_wait` delivery. Grouped by slug alone, it joined the group the first route had already notified and waited for the 5-minute `group_interval`. A one-minute window has resolved it by then, so it went out as resolved, which pages nobody -- `POST /v1/domains/purchase` was lost exactly this way on 2026-09-30. Alerts without a `request_endpoint` label still group by slug alone. The policy tree is hand-edited in Grafana Cloud, not provisioned; the snapshot is what the tests check and what the deploy compares the live tree against.

**The window equals the interval.** A window fetched once per window means each log line is read exactly once, which is the floor for a rule that cannot afford to miss an error -- see [Query cost](#query-cost). That floor is one unit of the allowance whatever the window's width, so a minute costs exactly what ten minutes costs. A one-minute count is part of the ten-minute count containing it, so no quiet window becomes a page, and measured bursts all arrive inside a single minute: 2026-09-14 was 5 errors inside 14:39 and 47 inside 14:50, 2026-09-25 was 269/449/105 in three consecutive minutes, and 2026-09-29 was 7 inside 8 seconds.

**The window ends 30 seconds behind real time.** gp-api's logs land in Loki a few seconds behind the request (4.6s measured on 2026-09-29). A window ending at `now` cannot see a line that has not arrived, and the next window starts after that line's timestamp, so an error at the edge of a window used to be read by no evaluation at all. Each evaluation at `t` now reads `[t-90s, t-30s]` and the next reads `[t-30s, t+30s]`: back to back, no gap and no overlap, and any line that lands within 30 seconds of its request is counted. The price is 30 seconds of detection latency: an error is seen 30 to 90 seconds after it happens, where it was 0 to 60.

Nothing here is a liveness check; `health-check-probe-failure` is, and it is unaffected.

**`noDataState` is `OK`, and reading Loki is what makes that safe.** A Loki rule that cannot evaluate raises an execution error, which `execErrState: 'Alerting'` pages on; only a rule that evaluated fine and matched nothing reports no data. So "this route is fine" and "this alert is broken" are distinguishable states.

**There is deliberately no parser.** `request_endpoint`, `response_statusCode` and `responseTimeMs` arrive as structured metadata, so the filter reads them directly; a `| json` here collided with all three and Loki renamed its output to `*_extracted`, which meant the parser was contributing nothing to the result and a per-line label set to the cost. The trailing `| keep` bounds the counted vector to the number of distinct endpoints -- 119 across a measured hour of prod, ceiling `ROUTE_MAP`'s 421 -- rather than letting `requestId`, `trace_id` and `span_id` size it by traffic. The status filter runs before the endpoint regex because it is a cheap numeric test that discards nearly every line, leaving the expensive alternation to see only errors.

One consequence to know about. The `max_query_series` cap on a Loki metric query is **500**, and a grouped rule returns one series per erroring route across every controller it covers. The cap only bites if more than 500 _distinct_ endpoints error inside the same window, which is a total outage rather than a regression -- and a total outage is what the CPU, memory and synthetic-probe rules are for, none of which touch Loki. `route-alerts.test.ts` fails if a rule's own route list reaches the cap, so the bound is visible before it is reached.

## Door-knocking spend reads a recorded metric

A recording rule runs a query on a schedule and writes its result into Prometheus as a metric. `DOOR_KNOCKING_SPEND_RECORDING_RULE` in `alerting/door-knocking-spend.ts` is the only one we provision, and it is the exception rather than the pattern.

Five rules want the `DoorKnockingSpend` log line: the four Geoapify budget tiers over a 24h window every 15 minutes, and the 6h fast-burn ceiling every 5 minutes. Read from Loki that is 96x ingest for each tier and 72x for the ceiling; measured in prod the tiers alone scanned 1,038 GB/day against a 1,056 GB/day allowance. No evaluation interval makes a 24h window affordable, which is why this one is recorded: the rule reads one minute of those lines once a minute and writes `gp_api:door_knocking_credits:sum1m`, every alert `sum_over_time(...)`s over it, and the windows are assembled in PromQL where they cost nothing.

Three properties of that rule are load-bearing:

- **Its query has to say `queryType: "instant"` inside the model JSON.** That key is what Loki's backend reads to decide instant versus range; the `query_type` beside the model is the DataQuery level and the `instant`/`range` booleans in it are the query editor's own state, and neither changes what runs. Miss it and the rule fetches a point per step instead of one value, the frame is `timeseries-multi`, and the writer refuses it -- the same message the series-count fault below produces, from a completely different cause. Measured against prod Loki on this rule's own expression and window: with the key, `numeric-multi` and one point, accepted; without it, `timeseries-multi` and 61 points, rejected. It cost 3 hours of blind Geoapify budget alerting on 2026-09-29 (incident 84) and is pinned by `grafana.test.ts`.
- **It aggregates to a single unlabelled series.** Grafana's recording-rule writer only accepts a wide frame, and a Loki query returning one series per label set is `timeseries-multi`, which it rejects. The rejection is silent -- the rule reports `health: ok` and `lastError: null`, because a minute after a failed write there is nothing left to write. A bare `sum()` is the shape the writer accepts, so **anything that needs a dimension preserved reads Loki directly** and pays for it in rule count.
- **Its query ends in `or vector(0)`.** Without it the rule writes nothing in a minute with no spend, which is most minutes, and an absent metric means both "nothing was spent" and "the rule is broken". The explicit zero makes absence mean one thing, which is what `recorded-metric-not-writing` watches: `absent_over_time(gp_api:door_knocking_credits:sum1m{environment="$ENV"}[30m])`. **Watch a recording rule's output, not its health** -- health cannot distinguish a rule that works from one that merely runs. Read the health anyway once that alert fires, though: `GET /api/prometheus/grafana/api/v1/rules` returns `health` and `lastError` per rule, and in the 2026-09-29 case it reported `health: error` with the rejection quoted verbatim, which is the fastest route to the cause even though it could not have raised the alarm. Any recording rule added here has to hold the same property or it cannot be watched this way.

One measurement worth carrying forward: **the result cache is not a substitute for not reading.** The four tiers deliberately share one expression, and the claim was that Loki's query-frontend cache therefore served tiers 2-4 from tier 1's work. Per-rule attribution says it did not: 13.6, 11.2, 11.2 and 7.2 GB/h. Identical text is still worth keeping, but for consistency of measurement rather than for cost.

## Where do alerts show up?

When an alert fires, Grafana sends a notification to the `#dev-alerts` Slack channel. The notification includes:

- The environment the alert fired in, tagged `[DEV]` or `[PROD]` on both the title and the body (which of the two a contact point shows is Grafana's default templating to decide, so neither omits it)
- The alert name and a description with guidance on how to investigate
- A link back to the alert in Grafana
- A mention of the owning Slack group (`@serve-bugs` or `@win-bugs`) if applicable

You can also view all alert states in the [Grafana Alerting UI](https://goodparty.grafana.net/alerting/list).

### That link has to keep pointing at the rule that fired

A notification's _View in Grafana_ and _Silence_ links are built from the rule's uid and carry nothing else that identifies it, so the uid is the only thread from a page back to what sent it. Grafana mints one per rule in a group and reassigns them when the group's membership changes, so until `alertRuleUid` (`alerting/alert-rule-uid.ts`) pinned them to `gp-api-<env>-<slug>`, adding or removing an alert silently repointed other alerts' links.

That is not theoretical. Of the four pages from the 2026-09-28 17:01-18:25Z query-path outage that reached an incident, two links no longer resolve to the rule that sent them: `ffyfzdfereakga` was "[People] Public campaign lookup failing" and now opens "Alert notifications are failing to deliver", and `dfynonhv8ucqoa` was "[People] Person id repoint blocked" and now 404s. Both moved in the 2026-09-29 06:35Z deploy, half a day after the pages were sent and while they were still being read.

The same churn splits a rule's state history, which is keyed on the uid -- so "has this rule ever fired on real data" is unanswerable across a deploy unless you know the uid changed hands. Recording rules pinned theirs from the start; this is the alert half of the same decision.

## Ownership

_Route_ alerts follow a **Serve/Win ownership model**. Each controller is assigned to `serve-bugs`, `win-bugs` or both in `CONTROLLER_OWNERS` in `deploy/components/alerts.ts`, which decides who is notified and therefore which of the five rules its routes land in. `ALERT_OWNERSHIP` is derived from that map and keeps its old shape, so nothing downstream changed.

Both is the honest answer for a shared surface rather than a hedge: auth, users, payments and elections serve both products, and over-tagging costs someone a glance where under-tagging costs an outage.

A controller with no owner gets **no rule at all**, rather than a paused one. It has to be listed in `CONTROLLERS_WITHOUT_ROUTE_ALERTS` with a reason instead, and `route-alerts.test.ts` fails a controller that is in neither list, so a new controller cannot default into silence.

## Key files

All alerting configuration lives in `deploy/`:

| File                                                | Purpose                                                                                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `deploy/components/alerts.ts`                       | Ownership, the per-controller status override, and the global alerts                                                                       |
| `deploy/components/alerting/route-alerts.ts`        | The route groups and the five Loki rules they become; the Slack body links to the fired route's exception lines                            |
| `deploy/components/alerting/door-knocking-spend.ts` | The one recording rule, and the helper every Geoapify alert reads it through                                                               |
| `deploy/components/alerting/provisioned-alerts.ts`  | The recording-rule list, the provider dialect their expressions have to be written in, and the one list of provisioned slugs routing walks |
| `deploy/components/alerting/alerts.types.ts`        | Type definitions for `Alert`, `RecordingRule` and `SlackGroup`                                                                             |
| `deploy/components/alerting/alert-notification.ts`  | Notification title and body: environment tag, mention                                                                                      |
| `deploy/components/grafana.ts`                      | Converts alerts into Grafana rule groups via Pulumi                                                                                        |

## How to opt in a controller

Opting in a controller means assigning it an owner. Add it to `CONTROLLER_OWNERS` in `deploy/components/alerts.ts`. The controller name is the string from the `@Controller('...')` decorator (e.g., `@Controller('contacts')` -> `'contacts'`), and will be typesafe and autocompleted by your editor.

Its routes join the matching group's rule on the next deploy.

### High-volume routes: prefer a ratio

The generated rule has a threshold of 0: one error in the window pages. That is
the right default for a route that should never error, and the wrong one for a
route with enough traffic to carry a standing error rate. `public-campaigns`
serves roughly 2 req/s from the marketing site's candidate pages; opting it in
would have paged continuously and been muted within a day, which is no better
than the no-coverage state it was actually in.

For a route like that, hand-write a global alert expressing error _share_
rather than error _count_ -- see `public-campaigns-lookup-error-ratio` in
`deploy/components/alerts.ts`. Two things are worth copying from it: pick a
denominator that excludes statuses the route returns by design (there, the 404
that means "candidate hasn't claimed a profile", ~95% of its traffic), and
`and` in a minimum-volume clause so a quiet window can't turn one stray error
into a page. Below that floor the query returns no data, which `grafana.ts`
maps to OK, not Alerting.

## Which statuses count as unexpected

`EXCLUDED_STATUS_CODES` in `deploy/components/alerting/route-alerts.ts` is the global list, and the Slack message reads from that same constant so the two cannot drift:

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

Both filters above carry an `or ( response_statusCode = "" and responseTimeMs > 30000 )` clause, and it is not a rounding error in the range. **A request the gateway kills in flight logs `statusCode: null`** -- gp-api never wrote one -- so it is neither 4xx nor 5xx and every status-range filter missed it. That made a route's worst failure mode, _no answer at all_, structurally invisible to its own alert: two `GET /v1/door-knocking/pack` timeouts in the seven days to 2026-08-25 paged nobody, and both were 120-second hangs a candidate sat through.

Three details:

- **Empty string, not `null`.** A null status never becomes structured metadata at all, and a label filter reads a missing label as empty, so the empty-string comparison matches whether the label is absent or present-and-blank. A numeric comparison can only ever miss it. Verified against prod: over the hour to 2026-09-28 19:19 UTC the filter matches exactly one line, a single gateway-severed request timeout, with and without a parser in the pipeline.
- **The 30-second floor is what makes it usable.** A null status also covers the caller hanging up, which is not a fault and was four fifths of what the clause matched. 30s is well clear of any real handler and well under the gateway's ~120s idle timeout. On `mcp` it is load-bearing to the millisecond -- 19 of its 24 no-status completions land between 30001 and 30007ms, a calling client's own deadline expiring -- so raising `NO_STATUS_MIN_MS` at all silences that controller's entire measured error signal. The measurements are in `route-alerts.ts`.
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
- `type: 'log'` queries go to Loki (structured logs) and are **metered by bytes scanned** -- read [Query cost](#query-cost) first. `type: 'metric'` queries go to Prometheus, including the metric our own recording rule writes. `type: 'usage'` goes to `grafanacloud-usage`, which carries Grafana Cloud's billing and alerting-health metrics; use it for a rule that must not depend on the system it is watching.
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

**A Loki-backed rule's daily read volume, as a multiple of ingest, is exactly its fetch window divided by its evaluation interval.** Nothing else about the query changes it: an evaluation decompresses its whole fetch window, and only the stream selector and that window decide the bytes. Gapless coverage needs window ≥ interval, so **1 is the floor for any rule that must not miss anything**, and the only other lever is how many rules there are.

**The allowance is 100x ingest, and it is one allowance.** It is shared by every rule, by dev and prod alike (both provision the same definitions and each reads its own stream, so the pair spends the sum), and by whatever anyone types into Explore -- 149 GB/day of ad-hoc queries measured on 2026-09-29, which nothing in a test can bound. So `global-alerts.test.ts` sums window ÷ interval across every log-backed global alert, every route alert and every recording rule, and fails a PR whose **total** exceeds `MAX_TOTAL_REREAD_FACTOR`: 130, calibrated at ~3.9 GB/day per unit against the 2026-09-29 measurement, which is about half the allowance. A per-rule ceiling of 24 sits under it. The set totals 124 today: 118 for the eleven hand-written log alerts, 5 for the five route alerts, 1 for the door-knocking recording rule.

Three rules follow, and they are what 2026-09-28 and 2026-09-29 cost to learn:

- **Rule count is a budget line, so group rules that differ only in a filter.** Every Loki rule selects the entire gp-api stream before narrowing to its slice, because that is the only shape LogQL offers and the narrowing is free rather than cheap. 75 per-controller route rules, each at the floor, were 75x ingest: 2,690 GB/day measured. Grafana Cloud answered with HTTP 429, every log-backed rule failed to evaluate, and because `execErrState` is `Alerting` all 154 of them fired at once, each naming its own route, on a production that was healthy throughout.
- **A wide window needs a slow interval, and an hours-wide window needs a recorded metric.** A 6h window left on the default 60s interval re-reads the same six hours 1,440 times a day. A 24h window is unaffordable on Loki at any interval the per-rule cap allows.
- **A recording rule has to aggregate to one unlabelled series, and has to write an explicit zero.** Anything else is rejected silently, and the alerts reading it go quiet rather than loud: two route recording rules did exactly that, taking 168 alert rules blind with them while reporting `health: ok`. A query that needs a dimension preserved therefore reads Loki and pays in rule count. See [Door-knocking spend reads a recorded metric](#door-knocking-spend-reads-a-recorded-metric).

Where a Loki rule is the right answer, `summaryDetail` set to a `{{ $labels.<field> }}` template keeps per-dimension paging: Grafana raises one alert instance per returned series either way.

Ingest is the denominator, so cutting log volume also cuts the free query budget -- reducing ingest is not a fix for a query overage. Two rules watch the spend (`loki-query-budget-half`, `loki-query-budget-critical`) and their notifications carry the per-rule attribution query, so it is self-reporting rather than something to go looking for. The datasources are in `docs/observability.md`.

## When alerting cannot check

`grafana.ts` provisions every rule with `execErrState: 'Alerting'`: a rule that cannot evaluate fires. That is deliberate and it stays. The alternative -- a rule that goes quiet when its datasource is unreachable -- is a monitoring system that reports "all clear" precisely when it has stopped looking.

The cost is that a datasource outage fires _everything_, and on 2026-09-28 that meant 154 simultaneous pages each naming a different API route, none of which was broken. The fix for that is not to soften `execErrState`; it is `alerting-rule-evaluations-failing`, which makes the telling **singular**. It reads Grafana Cloud's own evaluation counters on the `grafanacloud-usage` Prometheus datasource rather than anything gp-api emits, specifically so that it survives the failure it reports, and its message says what the situation actually is: alerting is blind, every firing alert is unverified and every silent one unchecked.

When it fires, read it first and the others second.

**A route page that could not evaluate now says so, in the page itself.** A rule that fails to evaluate returns no series, so its alert instance carries none of the labels `sum by (request_endpoint)` would have produced -- and Go's template renders a missing key as the literal `[no value]`. On 2026-09-29 at 17:37Z a five-minute network timeout between the alerting engine and Grafana's own Prometheus (`dial tcp 98.85.154.20:443: i/o timeout`) therefore paged as ``[PROD] [priorities] Route errors detected `[no value]` ``, with a body asserting that `[no value]` had returned error responses and an "open this route's error lines" link filtered to `request_endpoint = "<no value>"`, which can only open on an empty screen. The routes it named had served no requests at all that hour. So `routeErrorAlerts` wraps its `summaryDetail` and `message` in `{{ if $labels.request_endpoint }}`, and the other branch says the rule did not run, drops every claim about a route, and links the evaluation-failure share on `grafanacloud-usage` instead. `execErrState` is untouched -- the page still arrives, it just stops describing an outage that was never measured.

That `{{ if }}` is honest rather than a guess at the state, which is what makes it available here and not in `buildAlertDescription`: annotation templating cannot see `grafana_state_reason`, but a route rule either carries a route label or does not, and on these rules it does not exactly when it failed to run. A no-data evaluation cannot be confused with it, because `noDataState` is `OK` and never notifies. An alert whose series carry no per-instance label have no such test and get the standing note instead.

The threshold on `alerting-rule-evaluations-failing` is 0.2 with `for: 5m`, deliberately above a transient -- the 2026-09-29 blip peaked at 7.6% of evaluations in one five-minute bucket and correctly did not fire it. That gap is the case the conditional text above covers: one rule, one failed evaluation, a page that has to explain itself because nothing else will.

**Every other notification carries a standing note instead.** A rule whose series carry no per-instance label has no such test available, and `alerting-rule-evaluations-failing` only helps a reader who spots it among the pile. So `buildAlertDescription` appends `EVALUATION_ERROR_NOTE` to every description this repo provisions -- global and generated alike -- and it says the one thing that distinguishes the two cases: a state reason of `Error` and values of `-1` mean the rule could not evaluate, so the numbers above measured nothing and this page is unverified. It is a standing line rather than a conditional one, which costs a sentence on pages that do not need it and is the cheaper half of that trade.

That line exists because on 2026-09-28 Grafana Cloud's internal datasource-query service degraded for 84 minutes (`received a non-200 response from the query service: 500`, `unable to load data source configuration`, and `context deadline exceeded` posting to `query-grafana-app-main.grafana-datasources.svc.cluster.local:6443`) and **190 of 216 rules fired**, each naming its own subject. Prod was healthy: one 5xx in the whole window. The memory page read "System memory utilization has exceeded 90% for 5 minutes... If the service is at risk of OOM, consider restarting it" while memory sat at 17%, which is worse than noise -- it aims the responder at restarting a healthy service. The global rules are exactly the ones with no label to test: that memory page, the external health probe and the nightly person-id sweep each paged with nothing wrong, and three separate incidents were opened off them.

To confirm the shape of one of these after the fact, the rule's own state history carries both the error text and the last good value:

```logql
{from="state-history", orgID="1"} | json | ruleUID="<uid>"
```

on the `grafanacloud-alert-state-history` datasource, which is Grafana's own stream and does not bill against our Loki allowance. `sum by (ruleUID) (count_over_time({from="state-history", orgID="1"} | json | current="Alerting (Error)" | keep ruleUID [2h]))` counts how much of the estate went with it.

**Its routing is the part this repo cannot express.** Like `alert-notification-delivery-failing`, it must reach Slack by a path that does not depend on what broke -- in particular not through the `gpbot-alert-filter` contact point, which runs a Loki query per alert and therefore fails in exactly the scenario this rule exists to announce. The notification policy tree is hand-maintained in Grafana Cloud and is not provisioned here, so that is an ops step, not a code one.

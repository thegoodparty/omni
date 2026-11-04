---
name: query-analytics-data
description: Answer a product-analytics question from GoodParty's Amplitude data (how many people did X, conversion from A to B, is event Y still firing, retention of Win or Serve users), through the Dashboard REST API (Delegate) or the amp CLI (developers). Use when someone asks for usage numbers, a funnel, retention, or whether an analytics event is live. Read-only.
---

# Query analytics data (Amplitude)

Answers analytics questions with aggregate numbers from Amplitude. Every step is a read; this
skill never creates or changes anything in Amplitude. Event metadata writes belong to
`event-metadata`, flags to `amplitude-flag`.

## Guardrails (do not skip these)

- **Aggregates only.** Answer with counts, rates, and trends. Never paste an individual's
  record, email, user id, Amplitude id, or event stream into Slack, a PR, or chat. GoodParty
  treats individual-level records as restricted. Web events carry an `email` property: never
  group by it, and never group by any id.
- **Bound every query.** Always pass an explicit date range, and pick the smallest one that
  answers the question.
- **Don't fan out.** Run at most 5 queries at a time per project (see "Limits").
- **Cite the source of every number.** Say which project, which date range, and what was
  counted (unique users or event totals), plus the chart link or endpoint it came from.

## Access: pick the path first

Detect which path this session has, then use only that path. Never print a key or token, and
never run `amp auth token`.

1. **Dashboard REST API (Delegate).** Available when `AMPLITUDE_DEV_API_KEY`,
   `AMPLITUDE_DEV_SECRET_KEY`, `AMPLITUDE_PROD_API_KEY`, and `AMPLITUDE_PROD_SECRET_KEY` are all
   set. HTTP Basic auth with the project's pair (`-u "$AMPLITUDE_PROD_API_KEY:$AMPLITUDE_PROD_SECRET_KEY"`
   for prod, the `DEV` pair for dev), base URL `https://amplitude.com`. These keys live on
   Delegate only. Covers ad-hoc segmentation, funnels, and retention.
2. **amp CLI (developers).** Available when `amp auth status --json | jq .authenticated` prints
   `true`. If `amp` is missing or not logged in, tell the user to run
   `npm install -g @amplitude/developer-cli` and then `amp auth login`. amp reads saved charts,
   saved metrics, the event list, and recent ingestion. It can't build an ad-hoc segmentation,
   funnel, or retention query. For those, either ask Delegate in Slack (it has the REST keys) or
   build a saved chart in the Amplitude UI and query it with `amp charts query`.

If neither is available, stop and say which one is missing.

## Projects

| Env  | Project       | `projectId` |
| ---- | ------------- | ----------- |
| dev  | GoodParty Dev | `703396`    |
| prod | GoodParty.org | `694490`    |

Questions about real users mean **prod**. Dev holds test traffic; use it only to check that new
instrumentation fires.

## Before you count

- **Use the exact raw event name** (Title Case, e.g. `Onboarding V2 - Welcome Completed`). Look it
  up first: `amp events list --project <id> --q "<words>" --json`, or on REST
  `GET /api/2/events/list` (visible events with this week's totals) and `GET /api/2/taxonomy/event`
  (definitions). The description's `gp-meta` block says whether the event is in use and what it
  supersedes; if it was superseded and the history wasn't merged, count both names (see
  `.claude/skills/event-metadata/SKILL.md`).
- **Win vs Serve is a property, not an event name.** Both products fire the same event names
  (`docs/product-vocabulary.md`, `.claude/skills/instrument-analytics-event/SKILL.md`, "Name the
  event"). Web events carry `activeProduct` (`win` or `serve`; null before the user has an org).
  Some events, mainly outreach, also carry `product`, which the governed outreach metrics read.
  Backend (gp-api) events don't carry `activeProduct`. Filter or group by the property, and say
  which one you used.
- **Staff impersonation is in the data.** Web events carry `impersonation`. For real-user counts,
  filter out `impersonation` = `true` and say so.

## Delegate: Dashboard REST API

Reference: https://amplitude.com/docs/apis/analytics/dashboard-rest.md. Dates are `YYYYMMDD` and
inclusive, in the project's time zone. Pass JSON params through `--data-urlencode` so event names
with spaces encode correctly.

```bash
AUTH="$AMPLITUDE_PROD_API_KEY:$AMPLITUDE_PROD_SECRET_KEY"   # DEV pair for 703396
E='{"event_type":"Onboarding V2 - Welcome Completed","filters":[
  {"subprop_type":"event","subprop_key":"activeProduct","subprop_op":"is","subprop_value":["serve"]},
  {"subprop_type":"event","subprop_key":"impersonation","subprop_op":"is not","subprop_value":["true"]}]}'

# How many: m=uniques (default) or totals; i=1 daily, 7 weekly, 30 monthly
curl -sS -G -u "$AUTH" https://amplitude.com/api/2/events/segmentation \
  --data-urlencode "e=$E" -d m=uniques -d i=7 -d start=20261001 -d end=20261031
# → .data.series (per interval), .data.seriesCollapsed (whole range), .data.xValues

# Conversion A → B: A and B are event JSON shaped like E, one e= per step in order;
# cs = conversion window in seconds (default 30 days)
curl -sS -G -u "$AUTH" https://amplitude.com/api/2/funnels \
  --data-urlencode "e=$A" --data-urlencode "e=$B" -d start=20261001 -d end=20261031
# → .data[0].cumulativeRaw (users per step), .cumulative (share of users who entered), .stepByStep

# Retention: se = start event, re = return event (_active for any active event); i=7 weekly
curl -sS -G -u "$AUTH" https://amplitude.com/api/2/retention \
  --data-urlencode "se=$A" --data-urlencode 're={"event_type":"_active"}' \
  -d i=7 -d start=20261001 -d end=20261031
# → .data.series[0].combined: index 0 is the cohort size, index N+1 is retained after N intervals

# A saved chart, on the chart's own definition and range (id from the chart URL)
curl -sS -u "$AUTH" https://amplitude.com/api/3/chart/<chartId>/query
```

Group by a property with `g` (event segmentation takes up to two; funnels and retention take one),
e.g. `-d g=country`; prefix custom user properties with `gp:`. Use the credentials of the project
that owns the chart, or the call returns 400.

Don't use `/api/2/useractivity` or user search to answer an analytics question. They return one
person's event stream, which is exactly what the guardrails keep out of shared channels.

### Limits

5 concurrent requests per key, shared across every Dashboard REST endpoint and every worker on
that project. Queries also spend a cost budget (concurrent 1,000, hourly 108,000), where
`cost = days × conditions × query-type cost` (minimum 10; ranges under 7 days count as 7; each
group by counts as 4 segments). On a 429, back off and shorten the range or drop group bys;
retrying right away doesn't refill an exhausted hourly budget.

## Developers: amp CLI

```bash
amp events list --project 694490 --q "Welcome" --json                 # find the exact name
amp events check-ingestion --project 694490 --event-type "<name>" --lookback-minutes 1440 --json
# → .data.status (e.g. not_observed), .data.count, .data.window (upload time, UTC); max 1440 minutes
amp charts list --project 694490 --q "<words>" --json                 # .data[].id, .name, .chart_type, .url
amp charts query --project 694490 --chart <id> --json                 # .data.data.series, .data.metadata, .data.timezone
amp metrics list --project 694490 --q "<words>" --json                # saved metric definitions
```

- "Is event Y still firing" beyond the last 24 hours needs a saved chart or Delegate.
- `amp charts query` runs on the chart's saved date range. In amp 0.6.0, `--time-range` returned
  400 "Must specify a valid start date or range" for every chart tried, so report the range from
  the chart rather than assuming one. Read `.data.warnings`: "returned no data for the requested
  range" is a real answer, not an error.
- `--time-series-limit 0` collapses each series to one number for the whole range.
- `.data.metric_semantics` says whether values can be summed across intervals; funnel and
  retention values can't.

## Answer

Lead with the number, then the project, the date range and time zone, what was counted (unique
users or event totals, any `activeProduct`/`product`/`impersonation` filter), and the chart link
or endpoint. Flag anything incomplete, such as a retention interval marked `incomplete` or a
current interval that hasn't finished.

## Common mistakes

- Answering a real-user question from dev.
- Counting only the new name of a superseded event whose history wasn't merged.
- Splitting Win and Serve by event name instead of `activeProduct` or `product`.
- Summing funnel or retention values across intervals.
- Pasting a user-level row, email, or id anywhere shared.
- Running more than 5 queries at once, or a year-long range when a month answers the question.

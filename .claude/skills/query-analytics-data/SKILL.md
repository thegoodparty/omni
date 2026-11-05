---
name: query-analytics-data
description: Answer a product-analytics question from GoodParty's Amplitude data (how many people did X, conversion from A to B, is event Y still firing, retention of Win or Serve users), through the amp CLI. Developers run it; Delegate has no Amplitude analytics access. Use when someone asks for usage numbers, a funnel, retention, or whether an analytics event is live. Read-only.
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
- **Bound every query.** Give every chart you query an explicit date range, the smallest one
  that answers the question.
- **Don't fan out.** Run at most 5 queries at a time per project.
- **Cite the source of every number.** Say which project, which date range, and what was
  counted (unique users or event totals), plus the chart link it came from.

## Access: developers only

This skill runs through a developer's `amp` login. Never print a token, and never run
`amp auth token`.

Check `amp auth status --json | jq .authenticated` prints `true`. If `amp` is missing or not
logged in, tell the user to run `npm install -g @amplitude/developer-cli` and then
`amp auth login`.

An agent without an amp login, Delegate included, has no Amplitude analytics access. Asked an
analytics question, it says so and asks a developer to run this skill.

## Projects

| Env  | Project       | `projectId` |
| ---- | ------------- | ----------- |
| dev  | GoodParty Dev | `703396`    |
| prod | GoodParty.org | `694490`    |

Questions about real users mean **prod**. Dev holds test traffic; use it only to check that new
instrumentation fires.

## Before you count

- **Use the exact raw event name** (Title Case, e.g. `Onboarding V2 - Welcome Completed`). Look it
  up first: `amp events list --project <id> --q "<words>" --json`. The description's `gp-meta`
  block says whether the event is in use and what it supersedes; if it was superseded and the
  history wasn't merged, count both names (see `.claude/skills/event-metadata/SKILL.md`).
- **Win vs Serve is a property, not an event name.** Both products fire the same event names
  (`docs/product-vocabulary.md`, `.claude/skills/instrument-analytics-event/SKILL.md`, "Name the
  event"). Web events carry `activeProduct` (`win` or `serve`; null before the user has an org).
  Some events, mainly outreach, also carry `product`, which the governed outreach metrics read.
  Backend (gp-api) events don't carry `activeProduct`. Filter or group by the property, and say
  which one you used.
- **Staff impersonation is in the data.** Web events carry `impersonation`. For real-user counts,
  filter out `impersonation` = `true` and say so.

## Query with amp

```bash
amp events list --project 694490 --q "Welcome" --json                 # find the exact name
amp events check-ingestion --project 694490 --event-type "<name>" --lookback-minutes 1440 --json
# → .data.status (e.g. not_observed), .data.count, .data.window (upload time, UTC); max 1440 minutes
amp charts list --project 694490 --q "<words>" --json                 # .data[].id, .name, .chart_type, .url
amp charts query --project 694490 --chart <id> --json                 # .data.data.series, .data.metadata, .data.timezone
amp metrics list --project 694490 --q "<words>" --json                # saved metric definitions
```

- amp can't build an ad-hoc segmentation, funnel, or retention query. For those, and for "is
  event Y still firing" beyond the last 24 hours, build a saved chart in the Amplitude UI and
  query it with `amp charts query`.
- `amp charts query` runs on the chart's saved date range. In amp 0.6.0, `--time-range` returned
  400 "Must specify a valid start date or range" for every chart tried, so report the range from
  the chart rather than assuming one. Read `.data.warnings`: "returned no data for the requested
  range" is a real answer, not an error.
- `--time-series-limit 0` collapses each series to one number for the whole range.
- `.data.metric_semantics` says whether values can be summed across intervals; funnel and
  retention values can't.

## Answer

Lead with the number, then the project, the date range and time zone, what was counted (unique
users or event totals, any `activeProduct`/`product`/`impersonation` filter), and the chart link.
Flag anything incomplete, such as a retention interval marked `incomplete` or a current interval
that hasn't finished.

## Common mistakes

- Answering a real-user question from dev.
- Counting only the new name of a superseded event whose history wasn't merged.
- Splitting Win and Serve by event name instead of `activeProduct` or `product`.
- Summing funnel or retention values across intervals.
- Pasting a user-level row, email, or id anywhere shared.
- Running more than 5 queries at once, or a year-long range when a month answers the question.

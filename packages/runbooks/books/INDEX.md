# Book Index

Read this first when given a task. Match keywords to find the right book.

## Routing Table

| Type | Trigger Keywords | Book | Description |
|------|------------------|------|-------------|
| ref | platform, architecture, services, how services connect, codebases, infrastructure, AWS, ECS, RDS, S3, SQS, deployment, integrations, onboarding flow, path to victory, P2V, P2P, outreach, polling, data platform, dbt | books/platform-overview.md | Complete GoodParty tech ecosystem reference — codebases, service architecture, auth flows, AWS infrastructure, deployment, data pipelines, and end-to-end feature walkthroughs |
| proc | voter, haystaq, scores, flags, databricks, L2, voter data, quick query, issue scores | books/query-voter-data.md | Quick-query Haystaq voter data (scores, flags, demographics) via Databricks |
| ref | grafana, traces, metrics, alerts, tempo, prometheus, loki, spans, connection pool, histogram, alert history, TraceQL | books/query-grafana.md | Query Grafana Cloud for traces, metrics, and alert history via the API |
| proc | circle, community, engagement, members, posts, comments, social media, circle.so | books/connect-circle-api.md | Query the Circle Admin API v2 for community engagement — spaces, posts, comments, members |
| proc | dau, mau, wau, stickiness, retention, cohort, engagement snapshot, circle report, community health | books/circle-engagement-snapshot.md | Generate Circle community engagement snapshot — DAU/WAU/MAU, stickiness, contribution mix, cohort retention, top spaces/contributors |
| proc | translate runbook to experiment, port runbook, convert runbook, new experiment, pmf experiment, manifest, instruction.md, dispatch SQS, broker scope, hs_ columns, voters_active, agent experiment | books/convert-runbook-to-experiment.md | Translate a locally-runnable runbook (`books/find-X.md`) into a self-service PMF experiment (`experiments/X/{manifest.json, instruction.md}`). Strict input → output procedure: scope sizing, broker quirks block to copy verbatim into instruction.md, validation, live dispatch + monitor in dev, common failures |
| proc | district issues, voter priorities, issue pulse, top concerns, news + voter data, find issues, haystaq + web, pair voter scores with news | books/find-district-issue-pulse.md | Given a state + district, find top 5 voter concerns (Haystaq scores) paired with one recent local news source per issue. Source runbook for the `district_issue_pulse` PMF experiment — workflow proven here before agent translation. |

## Types

- **proc** — step-by-step procedure for accomplishing a task
- **ref** — informational reference for lookup and context

## Quick Decisions

```
No match? → Ask the user or proceed without a book
```

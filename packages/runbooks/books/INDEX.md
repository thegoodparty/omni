# Book Index

Read this first when given a task. Match keywords to find the right book or command.

## Routing Table

| Type | Trigger Keywords | Procedure | Description |
|------|------------------|-----------|-------------|
| ref | platform, architecture, services, how services connect, codebases, infrastructure, AWS, ECS, RDS, S3, SQS, deployment, integrations, onboarding flow, path to victory, P2V, P2P, outreach, polling, data platform, dbt | books/platform-overview.md | Complete GoodParty tech ecosystem reference — codebases, service architecture, auth flows, AWS infrastructure, deployment, data pipelines, and end-to-end feature walkthroughs |
| proc | voter, haystaq, scores, flags, databricks, L2, voter data, quick query, issue scores | books/query-voter-data.md | Quick-query Haystaq voter data (scores, flags, demographics) via Databricks |
| ref | grafana, traces, metrics, alerts, tempo, prometheus, loki, spans, connection pool, histogram, alert history, TraceQL | books/query-grafana.md | Query Grafana Cloud for traces, metrics, and alert history via the API |
| proc | circle, community, engagement, members, posts, comments, social media, circle.so | books/connect-circle-api.md | Query the Circle Admin API v2 for community engagement — spaces, posts, comments, members |
| proc | dau, mau, wau, stickiness, retention, cohort, engagement snapshot, circle report, community health | books/circle-engagement-snapshot.md | Generate Circle community engagement snapshot — DAU/WAU/MAU, stickiness, contribution mix, cohort retention, top spaces/contributors |
| proc | translate runbook to experiment, port runbook, convert runbook, new experiment, pmf experiment, manifest, instruction.md, dispatch SQS, broker scope, hs_ columns, voters_active, agent experiment | books/convert-runbook-to-experiment.md | Translate a locally-runnable runbook (`books/find-X.md`) into a self-service PMF experiment (`experiments/X/{manifest.json, instruction.md}`). Strict input → output procedure: scope sizing, broker quirks block to copy verbatim into instruction.md, validation, live dispatch + monitor in dev, common failures |
| proc | district issues, voter priorities, issue pulse, top concerns, news + voter data, find issues, haystaq + web, pair voter scores with news | books/find-district-issue-pulse.md | Given a state + district, find top 5 voter concerns (Haystaq scores) paired with one recent local news source per issue. Source runbook for the `district_issue_pulse` PMF experiment — workflow proven here before agent translation. |
| proc | prd, product spec, tech design, architecture options, design doc, technical approach, bless architecture, options + tradeoffs, drawio, data flow diagram, multi-repo | commands/prd-to-tech-design.md | Convert a PRD into a blessed tech design doc + drawio data flow diagram, published as a ClickUp page under the PRD. Multi-repo recon, architecture options + tradeoffs, four required sections (I/O, DB, DR, diagram). Also `/prd-to-tech-design`. |
| proc | clickup, epic, design doc, breakdown, create epic, agent-ready tasks, ticket generation, work breakdown | commands/clickup-epic-create.md | Take a (blessed) tech design + repo and break the work into a ClickUp Epic with N agent-ready subtasks (context, impl details, AC, test plan). Redirects to `commands/prd-to-tech-design.md` if input is a PRD. Also `/clickup-epic-create`. |
| proc | clickup, edit epic, restructure, add task, remove task, archive task, change priority, dependency, snapshot diff | commands/clickup-epic-edit.md | Edit an existing ClickUp Epic and its subtasks via a snapshot/diff/apply flow — add, remove, edit, change priorities or dependencies. Default-archive on removals. Also `/clickup-epic-edit`. |
| proc | clickup, work on task, pick up ticket, implement task, claude code task, ac, acceptance criteria, scope confirmation | commands/work-on-clickup.md | Pull a ClickUp task, load its Epic plan, scope-confirm with four explicit options (`go`/`plan`/`focus`/`split`), implement against AC, verify, optionally update the ticket. Also `/work-on-clickup`. |
| proc | meeting briefing, agenda, city council, municipal, agenda PDF, constituent sentiment, Haystaq, priority items, briefing generation | commands/meeting-briefing.md | Generate a structured meeting briefing from an agenda PDF — agenda categorization, constituent sentiment from Haystaq, source-grounded card content. Also `/meeting-briefing`. |

## Types

- **proc** — step-by-step procedure for accomplishing a task
- **ref** — informational reference for lookup and context

## Where procedures live

- **`books/`** — procedures the agent reads and follows when asked. No install needed.
- **`commands/`** — procedures that *also* register as Claude Code slash commands (via `./install.sh`). The file content IS the procedure — agents can read it directly the same way they read books, plus invoke via `/<name>`.

Both are markdown procedures with the same shape. The split is about invocation surface, not content.

## Quick Decisions

```
No match? → Ask the user or proceed without a book
```

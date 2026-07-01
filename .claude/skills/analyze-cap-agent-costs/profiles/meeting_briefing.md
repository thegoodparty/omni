# Profile: meeting_briefing

Cost-analysis profile for the `meeting_briefing` CAP experiment. The registry entry
lives in `PROFILES` in `packages/runbooks/scripts/python/cap_cost_profiles.py`; this
file is the human-readable guidance.

## Headline metric

**Dollars per delivered briefing, INCLUDING failed attempts:**

    sum(experiment_run.costUsd over the cohort) / count(briefing_status == briefing_ready)

This charges the cost of every run — `awaiting_agenda`, `no_meeting_found`, and
`FAILED` runs included — against the briefings actually delivered. It is the honest
unit cost of the product, not the cost of a happy-path run. Always quote it from the
trusted `costUsd`, never from token x list price.

## Status field and outcome buckets

- Artifact status field: **`briefing_status`** (not `status`).
- Success: **`briefing_ready`** (the agent produced a full briefing).
- Other outcomes: `awaiting_agenda`, `no_meeting_found` (placeholder statuses), plus
  DB-`FAILED` runs and `no_artifact` (crashed before writing an artifact).

## Milestone attribution

Per-milestone cost attribution is **live**: the `pmf_runtime.milestone()` primitive
ships in gp-ai-projects and `build-cap-agent` agents mark a milestone at each Step
boundary. Runs that carry a `milestones.jsonl` get per-milestone attribution (the
heatmap and hot-region detector key on the named, ordered milestone). meeting_briefing
runs that predate the primitive have no markers and **fall back to turn-progress**
automatically; a cohort spanning the cutover will be mixed, and coverage reports the
milestone share. Do not infer milestone boundaries from tool-call regex — markers are
the only milestone source.

### Cost per milestone (how to read it)

The `milestone_costs` table and the `milestone_costs.png` bar chart report the
**marginal** cost of each phase: a milestone's cost is the spend on the turns between
that marker firing and the next one, NOT cumulative spend up to that point. Read a row
as "this phase of the run added $X." The columns:

- **marginal $ / share** — the phase's spend and its fraction of cohort spend.
- **cumulative** — running share in run order; a Pareto over phases (the point where
  it crosses ~80% is where the bulk of a run's money has been spent).
- **$ / turn** — marginal spend divided by the turns tagged with that milestone;
  because cost is `cache_read × turns`, a phase can be expensive from many cheap turns
  (high $, low $/turn) or few heavy ones (high $/turn) — this column tells them apart.
- **median / run** — the per-run distribution of that phase's cost.

For the 30-case Sonnet cohort, three milestones held ~76% of spend — discovery ~33%,
assemble ~23%, validate ~20% — which is why the cost lever is turn count in those
phases, not the cheap tail. The top-3 phases are highlighted in the bar chart, and the
report's concentration callout states their combined share.

## Standing findings (validated, carry into any analysis)

- **Cost is dominated by `cache_read` x turn-count on Opus.** The agent re-reads its
  accumulated context every turn, so total spend tracks turn count, not the kind of
  work. Expect the hot-region detector to surface the late, high-turn-count bands.
- **Discovery is cheap, so `meeting_resource_location` barely helps.** The agenda
  hint (the `meeting_resource_location` AGENDA row) shaves little off cost because
  discovery was never the expensive part — turn-count is. Briefing-produced runs run
  hotter (~135 turns, ~$12) than misses (`awaiting_agenda`/`no_meeting_found`, ~78
  turns, ~$6) for the same reason.
- **~33% of June runs were repeat dispatches of the same office.** The manual refresh
  path re-dispatches terminal runs, so a cohort can double-count offices. When
  reporting cost-per-office, dedupe on `organizationSlug` or flag the repeat rate.

## Reference cohort numbers (for sanity-checking)

From the 2026-06-22 cohort (42 runs): ~$7.74 per dispatched run, ~$12 per briefing
produced ($324.90 / 27 `briefing_ready`), ~15 min avg runtime, ~96% success. These
are recorded in `costUsd` and confirmed against the real Anthropic invoice.

# Profile: top_community_issues / trending_issues

Cost-analysis profile for the two community-issues CAP experiments. Both share one
registry entry shape in `PROFILES` in
`packages/runbooks/scripts/python/cap_cost_profiles.py` (`top_community_issues` and
`trending_issues` map to the same profile); this file is the human-readable guidance.
An org's product unit is the PAIR of runs (one per list type), so per-org cost is the
sum of both experiments' per-run cost.

## Headline metric

**Dollars per delivered issue list, INCLUDING failed attempts:**

    sum(experiment_run.costUsd over the cohort) / count(data_quality in (ok, partial))

`partial` still delivers a usable list (some lookups failed); `insufficient_signal`
is a legitimate near-empty artifact (thin-signal small towns), not a delivered list —
its cost is charged against the lists that were delivered. Always quote from the
trusted `costUsd`, never from token x list price.

## Status field and outcome buckets

- Artifact status field: **`data_quality`** (not `status`).
- Success: **`ok`**. Delivered: `ok` or `partial`.
- Other outcomes: `insufficient_signal` (near-empty list by design), plus DB-`FAILED`
  runs and `no_artifact` (crashed before writing an artifact).

## Milestone attribution

Both instructions mark milestones at each Step boundary (manifest v4+, 2026-07-02).
Phases: `feed`, `discovery`, `haystaq` (top_community only), `rank`, `verify`,
`annotate` (top_community only), `assemble`, `validate`. Runs predating v4 have no
markers and fall back to turn-progress; a cohort spanning the cutover is mixed.

## Standing findings (validated, carry into any analysis)

- **Spend lives in the research loop (`discovery` + `verify`), not the output.** The
  10 -> 5 issue-cap change (manifest v3) had ~no cost effect — selection happens after
  the expensive web-search loop.
- **Opus -> Sonnet (v3) cut ~44% but lengthened loops.** Sonnet runs more turns
  (trending 52 -> 91 turns/run), partly offsetting the ~5x cache_read price cut.
  Loop/turn count is the binding constraint on the $1/run target.
- **Cost is cache_read x turn-count**, same mechanism as meeting_briefing: the agent
  re-reads accumulated context every turn, so spend tracks turns, not work type.

## Reference cohort numbers (for sanity-checking)

- Opus/10 prod cohort (2026-06-26, 30 orgs x 2): $5.27/run top_community_issues,
  $4.32/run trending_issues, $9.60 per org pair.
- Sonnet/5 dev cohort (2026-06-30, exact-match 30 orgs x 2): $2.45/run
  top_community_issues, $2.89/run trending_issues, $5.34 per org pair (~44% cut).

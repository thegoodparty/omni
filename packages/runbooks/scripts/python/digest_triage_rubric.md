# Governance digest triage rubric (DATA-2174)

How items surfaced by the analytics event-health monitor are tiered in the
Slack digest. Applied by a deterministic pass first (`rules_tier` in
`digest_triage.py`), then reviewed by an LLM judge that may move an item by
at most one tier, with a stated reason. The judge can never demote a red
OKR-anchored break.

## Tiers

### 🔴 red — needs action now
An OKR-anchored event (watchlist row carrying `okr:`) showing a breaking
signal: anomaly drop, newly or persistently dormant, orphaned_firing, call
site removed while the name constant remains, counter blind spot, or
instrumented-never-observed. A broken anchor means the OKR metric built on
it is silently wrong — the case study is `Dashboard - Candidate Dashboard
Viewed` going quiet while the Active Candidates OKR read zero for a month.
Also red: a rank ≤ 2 transition (counter blind spot / orphaned firing /
call-site removed) on any watchlist event.
Red items repeat in every digest until resolved. That is intentional.

### 🟡 yellow — worth watching
Watchlist or elevated events with softer signals: newly dormant, a new
anomaly on a non-OKR event, an escalation that is not red, intent
divergence on a watched event. Rank ≤ 2 signals on non-watchlist events
land here (real, but nothing we have declared a metric on).

### ℹ️ fyi — informational
Resolved items, transitions on non-watchlist / non-elevated events, newly
instrumented events showing up healthy, watchlist proposals, catalog
movement, new instrumentation gaps.

## Judgment latitude
The rules tier is the default. Move an item ONE tier only when the facts
clearly warrant it, for example:
- A "new anomaly" on an event whose baseline is tiny (single digits) is
  noise → demote yellow → fyi.
- A non-OKR watchlist event that anchors an obvious funnel step and just
  flatlined to zero → promote yellow stays yellow, but a cluster of related
  events flatlining together may justify promoting the clearest one to red.
- A resolved item that resolved because the event was retired (not because
  it recovered) can be promoted fyi → yellow if its replacement is not yet
  observed.
Never demote a red item that carries an `okr` flag. State the reason for
every tier move.

## Editorial output
For every item write:
- `headline`: one line, what happened, with the key numbers (e.g. "-85% WoW
  (292 → 44)" or "dormant → orphaned_firing; last seen 2026-07-28").
- `action`: one line, the next concrete step, empty if none is warranted
  (e.g. "check PR #1124 for the rename", "confirm the Segment source is
  live"). Base it only on the facts provided — never invent PR numbers,
  people, or causes.

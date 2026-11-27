---
title: The product map checks each drawn flow against its code and marks drift on the page, never in CI
status: active
decided_by: [datawithtristan, agent]
date: 2026-11-24
code: ['#4067']
scope:
  - packages/runbooks/surfaces/product-map/**
supersedes: []
superseded_by:
---

# The product map checks each drawn flow against its code and marks drift on the page, never in CI

## Decision

Every build of the product map compares each hand-drawn flow with the steps its
code declares (`drift.py`, `sources.json`) and marks a flow whose steps changed
as "Changed since drawn" on the page. Drift does not fail the build or the
runbooks tests. Only the map's own bookkeeping fails tests: a drawn surface
with no `sources.json` entry, or an entry with no drawing.

Tristan decided that drift marks the page only. The agent chose the mechanism:
a JSON sidecar that names each flow's source files and the literal markers
around its step list, read by regex in the dependency-free build, with the
drawn step ids read from `map.js` itself.

## Context

The map's flows are hand-drawn and went stale silently. Serve onboarding gained
five flag-gated steps after it was drawn, and when the guard first ran, six
more flows had moved under their drawings. The people who change those flows
are product engineers, while one analyst maintains the drawings. The republish
routine runs `build.py` with a bare interpreter and no `npm ci`.

## Alternatives rejected

- Fail the runbooks tests on drift: the red check would land on whoever next
  touches the map, not on the engineer who changed the flow, and it would be
  noise in an unrelated PR.
- Store the drawn step ids in `sources.json` too: two lists to keep in step,
  which is the same drift one level down.
- Run TypeScript to read the step lists: the build cannot run webapp code, as
  in the productMap.ts record.

## Revisit if

The outreach wizards' `step` property values land in the snapshot. Comparing a
drawing against the steps that actually fire would be sturdier than reading
code.

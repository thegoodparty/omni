---
title: An agent migration is one PR, judged on that PR, and its rollback is its list lines
status: active
decided_by: [swain]
date: 2026-11-25
code: []
scope:
  - packages/gp-api/deploy/agentsOnGpApi.ts
  - docs/agent-evals.md
---

# An agent migration is one PR, judged on that PR, and its rollback is its list lines

## Decision

Moving a background agent from the PMF Engine to gp-api's engine is one PR: the
agent, its readers, its judge suite, and its entry in the preview, dev and prod
lists in `deploy/agentsOnGpApi.ts`. There is no separate later PR to flip a
switch, and no dev-first stage.

The proof is the pairwise judge on that PR. Dev runs `main`'s lists until the PR
merges, so the base arm is the PMF Engine in dev and the candidate arm is the
PR's preview on gp-api's engine. A verdict of BETTER, NO DIFFERENCE FOUND or
CAN'T SAY with `handledWhen` unregressed, plus Delegate's approval, is the
migration passing; promoting the PR is the migration happening.

Rollback is reverting the PR's list lines, so the PR has to leave a revert
safe. It does that by making the agent's readers two-way before the flip: the
dispatch gate and the latest-run read query both `AgentRun` and `ExperimentRun`
by org and agent type, and a read by id falls through to the other table, the
way `agentRunRoutes.service.ts`'s `read` does.

One-way readers are the shape on main today: every migrated agent's gate and
latest-run read (the community-issue pair, `sectionRun.ts`, and
`meeting_schedule` in `meetingBriefings.service.ts`) picks one table from
`runsOnGpApi`. That makes the flip atomic but leaves the other engine's runs
invisible, so after a revert the gate finds no run for an org that has one and
dispatches a second. The two-way readers are the migration author's work, in the
migration PR; whoever reviews that PR is who checks it, because the judge
verdict never tests a revert.

## Context

The rule this replaces put dev first: land the agent with its switch on in dev
only, compare dev's runs against a preview's, then flip prod in a later PR. It
split one change across two merges and a window in which dev and prod ran
different engines — the state the judge's two arms already produce without a
second merge. Its second PR had no judge of its own either.

The lists are the source of truth for which engine runs an agent where, and a
judge run in a preview needs the agent in the preview list or both arms run the
PMF Engine and the suite compares it with itself.

The trade: the merge is the prod flip, so the verdict precedes production
traffic and a revert is the only recovery. That is why the revert has to be
safe before the merge, not assumed.

## Alternatives rejected

- **Dev first, prod in a later PR.** Two merges and a dev-vs-prod engine
  divergence for a comparison the judge already makes across dev and a preview;
  the second merge adds no proof.
- **Judge after merging.** The proof would arrive after the change is live, and
  a WORSE verdict would leave only a revert.
- **Readers that keep switching tables with `runsOnGpApi`.** Today's shape. It
  makes the flip atomic but leaves the other engine's runs invisible, so a
  revert strands them and the gate dispatches a duplicate. Only acceptable if the
  rule does not promise a revert.
- **A by-id fallthrough on its own.** It fixes a reader that already holds a run
  id, and the gates do not: they search by org, agent type and status, so they
  have to query both tables themselves.

## Revisit if

A migrated agent has a side effect that cannot be undone by reverting a deploy,
or an agent has no pairwise suite at all.

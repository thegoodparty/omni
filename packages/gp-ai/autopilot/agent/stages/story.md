## STAGE: story

You were dispatched to implement exactly one story: `CLICKUP_TASK_ID`, a
subtask of an epic (`EPIC_TASK_ID`, or its ClickUp parent if that's unset —
see step 1). This run's scope is that one ticket — never touch another
ticket, another branch, or the feature card's own status.

### 1. Move the ticket and read your context

Move `CLICKUP_TASK_ID` to `in progress` via
`shared.clickup_client.ClickUpClient.update_task`. Then read, in this order:

1. The story ticket itself — its Context, Implementation Details, Acceptance
   Criteria, and Test Plan.
2. `EPIC_TASK_ID`. **If it's empty**, the dispatcher hasn't always threaded
   it through yet — derive it yourself:
   `ClickUpClient.get_task(CLICKUP_TASK_ID)` and use its `parent` field as the
   epic id for the rest of this run. An unset `EPIC_TASK_ID` means "look it
   up," never "no epic."
3. The epic's breakdown summary comment on that epic id (posted by the
   epic-create stage) — the flag key, the story order, and any epic-wide
   notes you need.
4. The approved TDD the epic-create stage read, linked from the breakdown
   summary or the epic card's description.

### 2. Branch and implement

Work in the omni checkout already cloned into your workspace. Cut a fresh
branch for this story alone — never reuse or extend a branch from another
run. Follow the repo's own conventions rather than inventing your own: read
the nearest `AGENTS.md` to what you're touching before writing code, route
any shape that crosses a service boundary through `@goodparty_org/contracts`,
and name new tests `*.test.ts` run under Vitest.

**Every new runtime code path this story adds must be gated behind the
epic's feature flag** (the key from the epic's breakdown summary). If this
story is itself the flag-wiring story, that gate IS the implementation; every
other story checks the flag rather than reintroducing it.

**If this story is the flag-wiring story**, once you've decided how the flag
gets overridden off in dev (a cookie, a query param, a per-user override —
whatever this codebase already uses, or whatever you build), post a comment
on the epic (the id you resolved in step 1) naming that mechanism explicitly.
The epic's breakdown summary comment was written before any story existed,
so it cannot carry this — the `qa` stage that verifies later stories reads
your comment for it, not the breakdown summary alone.

### 3. Verify before shipping

Run the affected package's verify (its `AGENTS.md` names the command — e.g.
gp-api's `npm run verify`). Never open a PR on a red verify. If verify fails
for a reason outside this story's scope, park rather than silently expanding
scope to fix it.

### 4. Ship

Open the PR following the `ship-pr` skill's conventions: a why-focused body
(no test-plan section, no AI-authorship footer), targeting `main`.

Arm auto-merge **as a merge commit**, with this exact command — never
`--squash`, never a bare `--auto`:

    gh pr merge <n> --auto --merge

Then confirm it actually armed as a merge commit:

    gh pr view <n> --json autoMergeRequest -q .autoMergeRequest.mergeMethod

must print `MERGE`. If it doesn't, disarm and re-arm rather than assuming the
first command worked.

### 5. Drive delegate to approval

Re-trigger delegate-reviewer review after every push you make (comment
`delegate review`), and check `reviewDecision` before pushing anything
further — don't push blind into an in-flight review. Fix blockers yourself;
if a finding needs a human call (it's verifiably wrong, or touches something
outside this story's scope), park instead of deciding alone. Your exit
condition for this phase is the PR **approved and auto-merge armed** — not
merely opened.

### 6. Wait for the merge, then hand off

Once delegate has approved and auto-merge is armed, wait for the merge
itself (branch protection gates it on delegate approval plus a green `E2E`)
within your deadline — not for the dev deploy that follows it; the merge is
the event this stage waits on. Once it merges, move `CLICKUP_TASK_ID` to
`qa` — the conductor treats that move as a legitimate trigger for the next
stage, not a gate you're bypassing.

If your deadline arrives while you're still waiting on the merge, don't just
end your turn — that leaves nothing on the card for `parked-stage` to find,
and nothing to trigger picking this wait back up later. Park instead, the
same primitive you'd use for a real question, with a status note in place of
one:

    python -m autopilot.agent.feedback park --task-id <CLICKUP_TASK_ID> \
        --stage story \
        --question "Merge pending: PR #<n> is approved with auto-merge armed but hasn't merged yet. Comment here once it merges to resume."

This writes the same `[autopilot:parked stage=story]` marker `resume` looks
for, moves the card to `feedback needed`, and pings Slack — never move the
ticket to `qa` on a hunch instead. The run's reported outcome is whatever the
park primitive actually stamps (`feedback_parked`); "merge pending" is the
state you're telling a human in the parking comment, not a separate outcome
this stage invents.

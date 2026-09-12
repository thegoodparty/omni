## STAGE: resume

You were dispatched because a human commented on, or moved back, a card that
autopilot had parked waiting for feedback. There is no session to pick up —
every autopilot run starts cold — so rebuild your context from what is
actually written down on the card, not from anything you might remember.

### 1. Find out which stage parked

Run:

    python -m autopilot.agent.feedback parked-stage --task-id <CLICKUP_TASK_ID>

This reads the card's full comment thread and prints the stage named by the
most recent `[autopilot:parked stage=...]` marker — the same marker
`autopilot.agent.feedback park` writes when a stage asks for feedback. That
stage is who you are now for the rest of this run: reread its instruction
file (`stages/<stage>.md`) and follow its contract. This resume instruction
only covers picking the work back up; the parked stage's instruction still
governs what "done" looks like and what you produce.

### 2. Rebuild context from durable artifacts

Read, in this order:

1. The full ClickUp comment thread on `CLICKUP_TASK_ID` (and `EPIC_TASK_ID`,
   if set) — the parking comment's numbered questions, and everything a human
   said in reply.
2. The linked, approved TDD page (and its breakdown page, if the task points
   at one).
3. If the parked stage is **story**: the PR's current state via `gh pr view`
   / `gh pr checks` — a human may have pushed commits, approved, or requested
   changes while the card was parked.

Re-deriving this from scratch every time is the accepted cost of an autopilot
run keeping no session state anywhere: nothing else remembers what a parked
run was doing.

### 3. Decide what to do with the answers

Compare the parking comment's numbered questions against the thread that
followed. For each one, work out whether it was genuinely answered — a
relevant reply, not just any reply in the thread.

- **All answered**: continue the parked stage's remaining work under that
  stage's own contract, using the answers you found.
- **Some still unanswered**: park again, asking only the ones still
  outstanding. `autopilot.agent.feedback park` drops any question that
  matches one already asked in a prior parking comment on this card, so
  passing the original list back is safe — it will not duplicate what the
  thread already carries.

Either way, scope every ClickUp write to `CLICKUP_TASK_ID` / `EPIC_TASK_ID` —
never another card.

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

### 4. A status-note park is not a question to answer

`story` and `qa` also park when their own deadline arrives mid-wait — a PR
approved and armed but not yet merged, or a merged commit not yet deployed —
using the same marker but a status note ("Merge pending: ..." / "Deploy
pending: ...") instead of a real question. Don't wait for a human reply to
"answer" it: check whether the condition itself has resolved instead — `gh pr
view` / `gh pr checks` for a pending merge, or the deployed commit for a
pending deploy.

A pending condition that has gone RED is not "still pending" — it is your
work. Failing checks or delegate blockers on the story's own PR are the
story stage's job, and parking to ask permission to fix your own PR stalls
the epic (the first live epic stalled three stories exactly this way). Fix
them, push, re-trigger delegate, and only then either finish the handoff or
park again with an honest status note. The same applies when the conductor
auto-resumed you onto a stranded-run park with no human reply: the card is
where a safety net put it, the PR state is the work, do it.

This shortcut applies ONLY to those status-note parks. A qa park whose
question starts "QA failed" is a real question about real findings — never
auto-resolve it with the deploy check above, because "the commit is live on
dev" resolves nothing: the findings were produced against that same live
commit. But you don't wait for a reply here either. A resume of a QA-failed
park is always human-initiated (the conductor drops the bot's own comments,
never auto-resumes "QA failed" parks, and only a human can drag through the
gate), so being in this run at all means a human acted. Acted is not the same as authorized: read what they
actually did first. A drag with no comment, or a reply that answers a
finding, names a fix, or asks for a re-check, means re-run the QA walk with
that context. A reply that signals something else — cancelling the story,
an unrelated question — is not permission to re-verify: park again with a
clarifying question instead, because a re-run that passes would move the
ticket to `done` against what the human actually asked for. The re-run's outcome is qa.md's to decide, not the bullets below —
everything passed moves the ticket to `done`, anything failed posts fresh
findings and parks again with a new "QA failed" question; the
Resolved/Still-not-resolved bullets apply only to status-note parks.

- **Resolved** (the PR has since merged; the commit is now live on dev):
  continue straight into that stage's remaining handoff steps — moving the
  ticket to `qa`, or running the QA walk — you don't need a reply in the
  thread for this case.
- **Still not resolved**: park again with the same status note (step 3's
  dedup means this is safe to repeat) and end your turn.

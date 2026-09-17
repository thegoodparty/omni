## STAGE: epic-create

You were dispatched because a feature card moved into the state that kicks
off planning. Your job is to turn its approved TDD into a linked story
breakdown that later `story` runs can each pick up one at a time, then hand
the card to a human for a quality check before any code gets written. You
never advance the card past that gate — this run's boundary is the plan, not
the implementation.

### 1. Find the approved TDD

Read `CLICKUP_TASK_ID` (the feature card) with
`shared.clickup_client.ClickUpClient`. The phase-1 convention is a link to the
approved TDD doc in the card's description. If you find one, read the doc in
full before doing anything else — it is the only source of design; never
invent architecture, data model, or scope the TDD doesn't state.

If the card carries no TDD link, do not guess or draft one yourself. Park:

    python -m autopilot.agent.feedback park --task-id <CLICKUP_TASK_ID> \
        --stage epic-create --question "What's the approved TDD for this feature?"

and end your turn. A run with no TDD to break down has nothing else to do.

### 2. Create the feature flag

Every pipeline-built feature ships dark behind an Amplitude flag (see
`agent/amplitude_flags.py`) created at kickoff — on in dev, 0% in prod.
Decide the key:

- **The TDD names one** — use it as written.
- **It doesn't** — generate one from the feature slug, and record the key and
  how you derived it in the breakdown summary comment (step 5) so nobody has
  to reverse-engineer it later.

Call `AmplitudeFlagClient.create_feature_flag(flag_key, description)`. It is
idempotent, so re-running this stage against a card that already has a flag
just returns the existing state — never create a second flag for the same
feature.

**The first story you write in step 3 is always the flag-wiring story** — the
one that adds the flag check and the dark/no-op path everything else lands
behind. Every later story depends on it, and every runtime code path any
story adds must sit behind that flag.

**Exception**: skip the flag entirely only when the TDD says, in so many
words, that this change has no runtime surface (a docs-only change, a
one-time backfill script, internal tooling nothing user-facing gates). A TDD
that is merely silent about a flag is not the same as a TDD that rules one
out — default to creating the flag.

### 3. Break the TDD into stories

Write subtasks of the feature card at the `/clickup-epic-create` quality bar:
each one self-contained (a reader who hasn't seen the TDD can execute it
alone), with a Context section, Implementation Details naming real files in
this repo, checkable Acceptance Criteria, and a Test Plan naming the actual
framework. You are running headless, so skip that command's interactive
phases (the question round, the editor review loop) — go straight from
reading the TDD to creating the subtasks; route anything you'd otherwise ask
a human through the feedback loop instead (step 4).

Create each story as a subtask of `CLICKUP_TASK_ID` via
`shared.clickup_client.ClickUpClient.create_task(..., parent=CLICKUP_TASK_ID)`,
in dependency order, and wire the dependency links between them: the
flag-wiring story has no dependency, every story behind it depends on the
flag-wiring story, and anything with a real ordering constraint on top of
that depends on its predecessor. Every ClickUp write this stage makes is
scoped to the feature card and the subtasks you create under it — never
another card.

### 4. Questions go through the feedback loop

If the TDD is ambiguous or missing a decision you can't make yourself, never
guess and never reach for an interactive question tool — this run is
headless and nobody is watching it live. Park (see step 1's command shape)
with the specific question, and end your turn. A human's answer, or the card
moving back, re-dispatches a fresh `resume` run that picks this stage's work
back up.

### 5. Hand off

Post one summary comment on `CLICKUP_TASK_ID` covering: the stories you
created (title and id) in order, the flag key and how it was chosen, and any
open questions you parked on earlier in this run. Then move the card to
`feedback needed` and end your turn — that column is where a human reviews
the breakdown (the same column a park lands in; the summary comment is what
tells the reviewer this is a finished breakdown, not an open question).

This run never moves the card to `executing` or any status past the review
gate — that is a human call, not something this stage decides.

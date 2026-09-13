## STAGE: qa

You were dispatched to verify one story, `CLICKUP_TASK_ID`, after its PR
merged. You are read-only against the app — this run never edits code — and
every write you make is scoped to the story ticket itself.

### 1. Wait for deploy

The merge landing does not mean the commit is live: the release train still
has to deploy it to dev. If the merged commit isn't live on dev yet, wait and
retry within your deadline rather than failing the story outright — a
still-deploying commit is not a QA failure.

If your deadline arrives before the commit deploys, don't just end your
turn — that leaves nothing on the card for `parked-stage` to find, and
nothing to trigger picking this wait back up later. Park instead, the same
primitive you'd use for a real question, with a status note in place of one:

    python -m autopilot.agent.feedback park --task-id <CLICKUP_TASK_ID> \
        --stage qa \
        --question "Deploy pending: commit <sha> merged but isn't live on dev yet. Comment here once it deploys to resume."

This writes the same `[autopilot:parked stage=qa]` marker `resume` looks
for, moves the card to `feedback needed`, and pings Slack — never move the
ticket to `in progress` or `done` on a hunch instead. The run's reported
outcome is whatever the park primitive actually stamps (`feedback_parked`);
"deploy pending" is the state you're telling a human in the parking comment,
not a separate outcome this stage invents.

### 2. Log in

Redeem a Clerk sign-in ticket for the provisioned dev test user to get an
authenticated session. Never put credentials in a prompt or a comment — the
ticket flow is the only login path this stage uses.

### 3. Flag-on: walk the acceptance criteria

With the epic's feature flag enabled in dev, drive a real browser (Playwright
MCP) through every acceptance criterion on the story ticket, one at a time.
Take one screenshot per criterion as you confirm it.

### 4. Flag-off: parity smoke

`EPIC_TASK_ID` may be empty — the dispatcher hasn't always threaded it
through yet. If so, derive it yourself: `ClickUpClient.get_task(CLICKUP_TASK_ID)`
and use its `parent` field as the epic id below. An unset `EPIC_TASK_ID` means
"look it up," never "no epic."

Turn the flag off using whatever override mechanism the epic's flag-wiring
story actually established. The breakdown summary comment on the epic
predates every story and never carries this; read the flag-wiring story's own
follow-up comment on the epic instead, where it names the mechanism it
built. Don't assume a cookie, a query param, or any other specific mechanism
— read what that comment actually says. With the flag off, smoke-check the
surfaces this story touched still behave the way they did before the story
shipped.

### 5. Verdict

- **Anything failed**: post a numbered findings comment on `CLICKUP_TASK_ID`
  (expected vs. actual per finding), attach the screenshots via the ClickUp
  attachment API, and move the ticket back to `in progress`.
- **Everything passed**: move the ticket to `done`.

Either way, screenshots belong on the ticket, not left behind in the
container — attach them before you end your turn.

### 6. Stay read-only

This run never edits code, never opens a PR, and never touches any ticket
other than `CLICKUP_TASK_ID`. If something looks broken in a way this story
didn't cause, note it in your findings comment rather than fixing it.

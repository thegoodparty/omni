## STAGE: qa

You were dispatched to verify one story, `CLICKUP_TASK_ID`, after its PR
merged. You are read-only against the app — this run never edits code — and
every write you make is scoped to the story ticket itself.

### 1. Build the effective acceptance criteria

The ticket body is not the whole spec. Read the story's full ClickUp comment
thread before judging anything. A human comment that changes, drops or
replaces an acceptance criterion supersedes the ticket body, and a later human
ruling supersedes an earlier one (ENG-11384 failed an AC that a human had
already reversed with "put @dev-only back"). Bot and autopilot comments are
not scope decisions.

Build the effective AC list: the ticket's ACs with each human change applied.
Judge the story against that list only. A criterion a human de-scoped is never
a QA failure, even if the shipped code doesn't meet it (ENG-11383 failed two
ACs a human had de-scoped).

State the list at the top of the verdict comment, in both the pass and the
fail case: the effective ACs, then each de-scoped or changed AC with the
comment that de-scoped or changed it (author and date). If a comment is
ambiguous about whether it changes an AC, keep the AC and say so in the
comment rather than silently dropping it.

### 2. Classify: does the story have UI?

Find the story's merged PR number from its `Merge pending: PR #<n>` park
comment, then read its changed files:

    gh pr view <n> --json files -q '.files[].path'

If no changed file is under `packages/gp-webapp/`, `packages/gp-admin/` or
`packages/candidate-sites/`, the story has no UI (mock controllers, fixtures,
crons, backend-only changes). Parse the comment text, not the card status.
If there is no such park comment, look for the PR linked on the story or via
`gh pr list --state merged --search "<ticket id>"`. If you still can't find
the PR, treat the story as having UI and keep the normal flow.

**No UI:** skip steps 3 through 6 (deploy wait, test-user provisioning, the
Playwright walk and the flag-off smoke) and verify each effective AC against
the merged PR instead:

- Read the code path each AC describes in the merged diff. "The tests passed"
  or "covered via Vitest" is not evidence on its own: ENG-11351's QA passed two
  wrong ACs that way and it led to ENG-11377. Check that the code does what the
  AC says and that a test actually exercises it.
- Check the PR's CI with `gh pr checks <n>` and require it green.

Then go to the verdict. A failure takes the same findings-and-park path (no
screenshots to attach). A pass moves the ticket to `done`, with no wait for the
deploy.

**Has UI:** continue with step 3, judging the walk against the effective AC
list from step 1.

### 3. Wait for deploy

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

### 4. Provision a test user and log in

Provision your own dev test user through gp-api's test-fixtures API
(`packages/gp-api/src/testFixtures/AGENTS.md` documents the endpoints and
states). Authenticate with a short-lived Clerk M2M token minted from
`AUTOPILOT_MACHINE_SECRET` — Clerk caps M2M token lifetimes, so mint fresh
each run rather than expecting a stored token:

    TOKEN=$(curl -sf -X POST https://api.clerk.com/v1/m2m_tokens \
        -H "Authorization: Bearer $AUTOPILOT_MACHINE_SECRET" \
        -H "Content-Type: application/json" \
        -d '{"seconds_until_expiration": 7200}' | jq -r .token)

    curl -sf -X POST "$GP_API_DEV_BASE_URL/v1/test-fixtures/users" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -d '{"state": "<the product state the story needs>"}'

The create response carries a single-use Clerk `signInToken`: redeem it in
the browser on a public page
(`window.Clerk.client.signIn.create({ strategy: 'ticket', ticket })` then
`setActive`) to get an authenticated session — the fixture doc above has the
full recipe. If you need to log in again (retry, expired ticket), re-mint the
session with `POST /v1/test-fixtures/users/<id>/session` instead of creating
a second fixture user. Never put credentials — the token, the machine
secret, the `signInToken`, or fixture passwords — in a prompt, a comment, a
screenshot, or any output; and clean up with
`DELETE /v1/test-fixtures/users` (body `{"userIds": [<ids>]}`) before you end
your turn, pass or fail.

### 5. Flag-on: walk the acceptance criteria

With the epic's feature flag enabled in dev, drive a real browser (Playwright
MCP) through every effective acceptance criterion from step 1, one at a time.
Take one screenshot per criterion as you confirm it.

### 6. Flag-off: parity smoke

If the epic's breakdown summary says `flag-key: none`, the epic has no flag:
skip this step and go to the verdict.

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

### 7. Verdict

- **Anything failed**: post a numbered findings comment, opening with the effective AC list from step 1, on `CLICKUP_TASK_ID`
  (expected vs. actual per finding), attach the screenshots via the ClickUp
  attachment API, then park:

      python -m autopilot.agent.feedback park --task-id <CLICKUP_TASK_ID> \
          --stage qa \
          --question "QA failed: see the findings comment above. Fix (or answer) the findings, then comment here or move the card back to in progress to re-verify."

  Never move the ticket to `in progress` yourself — for a story that status
  is a dead end the conductor routes nothing from (the first live QA fail
  proved it: the card sat unroutable until a safety net parked it). The park
  lands the card in `feedback needed` with the marker `resume` needs, and a
  human's answer or drag re-dispatches QA.
- **Everything passed**: post a short verdict comment that opens with the
  effective AC list from step 1, then move the ticket to `done`.

Either way, any screenshots belong on the ticket, not left behind in the
container — attach them before you end your turn.

### 8. Stay read-only

This run never edits code, never opens a PR, and never touches any ticket
other than `CLICKUP_TASK_ID`. If something looks broken in a way this story
didn't cause, note it in your findings comment rather than fixing it.

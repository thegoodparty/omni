---
name: ship-pr
description: Open a PR following GoodParty conventions and drive the delegate-reviewer bot to approval autonomously. Use when the user says "open a PR", "ship this", "create a PR", "create a PR and address delegate", or otherwise wants changes turned into an approved PR in omni.
---

# Ship a PR and converge with delegate

Three gates in one run: open the PR (Phase 1), drive `delegate-reviewer[bot]`
to `Approved.` (Phase 2), and confirm the **E2E** check is green (Phase 3). Fully
autonomous — only stop to surface a pre-flight failure you must rule on, a finding
you've verified is wrong or too high-blast-radius to auto-apply, or an e2e failure
that is flaky/pre-existing/infra rather than caused by your diff.

**A PR is only mergeable when, at the same HEAD SHA, delegate is `Approved.` AND
the E2E check is green.** As of 2026-06-15 the gp-webapp Playwright e2e suite is a
**hard merge gate**, not advisory — delegate approval alone is not enough. So
"done" means both gates pass on the same commit.

Repo conventions this skill enforces (from the root `CLAUDE.md`): PR bodies explain
**why**, not what; **no** "test plan" section; **no** `Co-Authored-By: Claude` and
no "Created by Claude" footers. **PRs always target `develop`.**

## Pre-flight checks (how to verify)

Purpose: don't open a PR — or push a loop fix — that will obviously fail the
package's CI and waste a delegate round.

**How to verify is documented in each package's `CLAUDE.md`** (its "Verify"
section). Find the package(s) the diff touches
(`git diff --name-only origin/develop...HEAD`), open the relevant
`packages/<dir>/CLAUDE.md`, and run the verification steps it lists. There is no
single universal command — gp-api has `npm run verify`; others document their own
lint / type-check / test / build steps.

Address workspaces by **path**: `npm run <script> -w packages/<dir>`. npm's `-w`
matches a name or a path, and some package names differ from their folder (the
scoped libs `@goodparty_org/sdk`, `@goodparty_org/contracts`), so the path form
always resolves.

## Phase 1 — open the PR (fully auto)

1. **Branch first if needed.** If you're on `develop`, create a feature branch
   (`git checkout -b <name>`, short kebab-case from the change) before committing.
   Never commit directly to `develop`.

2. **Run pre-flight checks on the touched package(s)** (see "Pre-flight checks"
   above). Find them with `git diff --name-only origin/develop...HEAD`.
   - **Pass** → continue.
   - **Fail** → STOP. Show exactly what failed, then ask the user: fix it now, or
     open anyway (escape hatch for pre-existing or unrelated failures). Do not
     silently proceed.

3. **Open or attach.** Either way, pre-flight (step 2) must have passed first —
   on a resume against an existing PR, run it before entering Phase 2.
   - If the branch already has an open PR (`gh pr view --json number,url`), don't
     recreate it; go straight to Phase 2 against it.
   - Otherwise push the branch and `gh pr create --base develop`. Write a
     **why-focused** body (the motivation and the tradeoff, not a file-by-file
     recap). Omit any test-plan section and any AI-authorship footer.

## Phase 2 — converge with delegate (autonomous to approval)

Delegate is `delegate-reviewer[bot]`. It submits a GitHub **review**:

- `APPROVED` — body is `Approved.`
- `COMMENTED` — body starts with `**N blocker(s).**` and asks you to reply
  `delegate review` after fixing.

Findings carry stable `<!-- delegate-finding-id: <uuid> -->` markers: in-diff
findings are inline review comments, out-of-diff findings live in the review body.
Re-reviews are prefixed `_X resolved since last review, Y new._`.

Loop:

1. **Get the review for the current HEAD.** Anchor on the commit, not a timestamp,
   so this is correct even on a fresh resume against an existing PR. Fetch the
   latest `delegate-reviewer[bot]` review (`gh api
repos/thegoodparty/omni/pulls/<n>/reviews`) and compare its `commit_id` to the
   PR's HEAD SHA:
   - **A review already exists at HEAD** (its `commit_id` == HEAD) → use it; go to
     step 2. Do **not** re-trigger (that wastes a capped round and corrupts
     delegate's resolved-count).
   - **HEAD has no review yet** → get one: a just-opened PR auto-reviews (just
     wait); if you just pushed fixes to an existing PR, post an issue comment
     `delegate review` to trigger.
   - Then poll every ~30–60s for a review whose `commit_id` == HEAD. Budget
     **~10 min**; if none lands, stop and report.

2. **Verdict.**
   - `APPROVED` (`Approved.`) → delegate gate passed. Go to **Phase 3** to confirm
     e2e before declaring done — do not exit yet.
   - Otherwise parse the blockers: review body + inline comments
     (`gh api .../pulls/<n>/comments`), keyed by `delegate-finding-id`.

3. **Triage each finding — comply by default, but verify first.** Read the cited
   code before acting. If the claim is real, apply the fix. **Escalate instead of
   auto-applying** (hand the finding back to the user with your reasoning) when:
   - the finding is **verifiably wrong** against the actual code, OR
   - it touches a **high-blast-radius** surface: Prisma schema/migrations;
     auth / permissions / security; `@goodparty_org/contracts` or any cross-service
     payload; **deleting** code or behavior; or anything **outside the diff's
     scope**.

4. **Apply, then loop or stop.** Make the verified-valid fixes (respect repo style;
   no AI footers). Before pushing, re-run pre-flight on the affected package(s) —
   never push failing lint/types/test. Commit and push (always push the fixes
   you've made, so agreed work isn't lost). Then decide by what's left:
   - **Nothing escalated this round** → comment `delegate review` and loop back to
     step 1.
   - **Anything escalated this round** → do _not_ re-trigger or loop. Stop and hand
     back the escalated findings (alongside the fixes you just pushed) for the
     user's call. Escalation always wins over looping.

5. **Round cap.** Stop after **3 rounds** even if not approved. Hand back a summary:
   resolved, still-outstanding, and escalated findings.

## Phase 3 — confirm the E2E gate is green (autonomous)

The E2E job (`gp-webapp.yml`, job name **`E2E`**) runs Playwright against this PR's
freshly deployed full-stack preview. It runs on every PR that deploys the gp-webapp
preview, and **re-runs on every push** — so a fix in Phase 2 also re-triggers it.
It is slow: it waits on gp-api's (slow) deploy of this commit before the ~15-min
suite runs, with a 45-min job timeout. Anchor on HEAD, the same as delegate.

1. **Does e2e apply to this PR?** If the PR has no `E2E` check at all (e.g. a
   backend-only PR that doesn't deploy a gp-webapp preview), there is nothing to
   gate on — Phase 3 is satisfied. Confirm via `gh pr checks <n>` (no `E2E` row) and
   move on.

2. **Find the E2E result for the current HEAD.** Use `gh pr checks <n>` for the
   `E2E` check's conclusion, and read the upserted results comment (stable marker
   `<!-- gp-webapp-e2e-results -->`) for the ✅/❌ status, passed/failed/total counts,
   the failed-test names, and the HTML-report link.
   - **In progress / not started for HEAD** → poll every ~60–90s. Budget **~45 min**
     (it waits on the gp-api deploy first). If it never resolves, stop and report.
   - **Green** (`E2E` success, 0 failed) → **done**. Combined with delegate
     `Approved.` at this HEAD, report success and exit.
   - **Failing** → go to step 3.

3. **Triage failures — fix what your diff broke, escalate the rest.** Pull the
   failed-test names from the results comment and open the HTML report / workflow
   logs (`gh run view <run-id> --log-failed`) to see the actual failure, not just
   the name. Then:
   - **A real regression your diff caused** (the flow you changed now fails its
     spec) → fix it. Reproduce locally where feasible:
     `npm run test:e2e -w packages/gp-webapp` (needs a configured `BASE_URL` + Clerk
     test stack against a real API — see `packages/gp-webapp/e2e-tests/CLAUDE.md`).
   - **Flaky, pre-existing, or infra** (gp-api deploy failed, Clerk/auth stack down,
     a failure unrelated to your diff and present on `develop`) → **escalate**, don't
     churn. Hand back the failing specs with your evidence; a single re-run for a
     suspected flake is fine, blind re-pushing is not.

4. **Apply, then re-converge.** Make the verified-valid e2e fixes (re-run pre-flight
   on affected packages first — never push failing lint/types/unit tests). Commit and
   push. The push re-triggers **both** delegate and e2e for the new HEAD, so loop
   back to **Phase 2 step 1** (comment `delegate review`) and re-confirm both gates at
   the new HEAD. Done requires both green on the *same* commit.

5. **Round cap.** Stop after **2 e2e-fix rounds**. Beyond that, hand back the
   still-failing specs (with report links and your read) rather than churning on
   suspected flakes.

## Stop conditions (always report, never loop past these)

- Delegate `Approved.` **and** the `E2E` check green at the same HEAD → success.
- 3 delegate rounds, or 2 e2e-fix rounds, reached → summary handback.
- ~10 min poll with no new review, or ~45 min with no e2e result → timeout handback.
- A pre-flight failure (any phase), an escalated finding, or an e2e failure that is
  flaky/pre-existing/infra → wait for the user.

## Notes

- All findings escalated to the user need: the file/line, delegate's claim, and
  _your_ verified take (agree / disagree, with evidence). For an escalated **e2e**
  failure: the failing spec name(s), the HTML-report / workflow-run link, and your
  read (your diff vs. flake/pre-existing/infra, with evidence).
- Keep docs current: if a fix you apply changes behavior, architecture, or a
  convention, update the nearest `CLAUDE.md`/`docs/` in the same commit (root
  `CLAUDE.md` rule).

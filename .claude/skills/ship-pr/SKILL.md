---
name: ship-pr
description: Open a PR following GoodParty conventions and drive the delegate-reviewer bot to approval autonomously. Use when the user says "open a PR", "ship this", "create a PR", "create a PR and address delegate", or otherwise wants changes turned into an approved PR in omni.
---

# Ship a PR and converge with delegate

Three gates in one run: open the PR (Phase 1), drive `delegate-reviewer[bot]`
to `Approved.` (Phase 2), and confirm every GitHub check on the PR is green
(Phase 3). Fully autonomous — only stop to surface a pre-flight failure you must
rule on, a finding you've verified is wrong or too high-blast-radius to auto-apply,
or a check failure that is flaky/pre-existing/infra rather than caused by your
diff.

**A PR is only mergeable when, at the same HEAD SHA, delegate is `Approved.` AND
every non-skipped GitHub check is green.** As of 2026-06-15 the gp-webapp
Playwright **`E2E`** check is a **hard merge gate**, not advisory — but it's not
the only one: any package touched by the diff can add its own required check (a
`Validate`/typecheck job, a lint job, etc.), and those are just as blocking.
Delegate approval alone is not enough for any of them. So "done" means delegate
approved and the full set of checks green, all on the same commit.

Repo conventions this skill enforces (from the root `CLAUDE.md`): PR bodies explain
**why**, not what; **no** "test plan" section; **no** `Co-Authored-By: Claude` and
no "Created by Claude" footers. **PRs always target `main`.**

## Pre-flight checks (how to verify)

Purpose: don't open a PR — or push a loop fix — that will obviously fail the
package's CI and waste a delegate round.

**How to verify is documented in each package's `CLAUDE.md`** (its "Verify"
section). Find the package(s) the diff touches
(`git diff --name-only origin/main...HEAD`), open the relevant
`packages/<dir>/CLAUDE.md`, and run the verification steps it lists. There is no
single universal command — gp-api has `npm run verify`; others document their own
lint / type-check / test / build steps.

Address workspaces by **path**: `npm run <script> -w packages/<dir>`. npm's `-w`
matches a name or a path, and some package names differ from their folder (the
scoped libs `@goodparty_org/sdk`, `@goodparty_org/contracts`), so the path form
always resolves.

## Phase 1 — open the PR (fully auto)

1. **Branch first if needed.** If you're on `main`, create a feature branch
   (`git checkout -b <name>`, short kebab-case from the change) before committing.
   Never commit directly to `main`.

2. **Run pre-flight checks on the touched package(s)** (see "Pre-flight checks"
   above). Find them with `git diff --name-only origin/main...HEAD`.
   - **Pass** → continue.
   - **Fail** → STOP. Show exactly what failed, then ask the user: fix it now, or
     open anyway (escape hatch for pre-existing or unrelated failures). Do not
     silently proceed.

3. **Open or attach.** Either way, pre-flight (step 2) must have passed first —
   on a resume against an existing PR, run it before entering Phase 2.
   - If the branch already has an open PR (`gh pr view --json number,url`), don't
     recreate it; go straight to Phase 2 against it.
   - Otherwise push the branch and `gh pr create --base main`. Write a
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
     the full check set before declaring done — do not exit yet.
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

## Phase 3 — confirm every GitHub check is green (autonomous)

GitHub reports one row per CI job on the PR. Any package touched by the diff can
contribute its own required check (a `Validate`/typecheck job, a lint job, a build,
etc.), and gp-webapp additionally runs Playwright as the **`E2E`** check whenever
the PR deploys a full-stack preview. **The gate is the whole set, not just `E2E`**
— a failing `Validate` job is exactly as blocking as a failing `E2E` run and gets
the same triage. All checks **re-run on every push**, so a fix in Phase 2 also
re-triggers them. Anchor on HEAD, the same as delegate.

1. **Enumerate the checks for this PR.** `gh pr checks <n> --json name,bucket,link`
   (or equivalent). A check whose `bucket` is `skipping`/`skipped` isn't required —
   ignore it. **An empty remaining set is not automatically "done"** — in this repo
   essentially every PR triggers a full check matrix (Validate/build/deploy jobs
   across every package, even for a docs-only diff), so an empty result right after
   opening or pushing almost always means checks haven't registered yet, not that
   none apply. Re-enumerate after a short wait (~30s, a couple of tries); only
   treat the set as genuinely empty if it stays empty across those retries.

2. **Wait for every `pending`/`in_progress` check to resolve.** Poll every
   ~60–90s. `E2E`, when present, is the slow one — it waits on gp-api's (slow)
   deploy of this commit before its ~15-min suite runs, with a 45-min job timeout —
   so budget **~45 min** for the full set. If any required check never resolves in
   that window, stop and report.

3. **All resolved — read the verdict.**
   - **Every required check green** → **done**. Combined with delegate `Approved.`
     at this HEAD, report success and exit.
   - **One or more failing** → go to step 4, one at a time.

4. **Pull the actual failure, then triage — fix what your diff broke, escalate the
   rest.**
   - **`E2E` failing**: read the upserted results comment (stable marker
     `<!-- gp-webapp-e2e-results -->`) for the ✅/❌ status, passed/failed/total
     counts, the failed-test names, and the HTML-report link, then open the HTML
     report / workflow logs (`gh run view <run-id> --log-failed`) for the actual
     failure, not just the name.
   - **Any other check failing** (e.g. a package's `Validate`/typecheck job): pull
     its log the same way — `gh run view --job <job-id> --log` (job id from the
     check's `link`) — for the actual failure, not just the check name.
   - Either way:
     - **A real regression your diff caused** (e.g. a contract change that broke
       another package's fixtures/types, or the flow you changed now fails its
       e2e spec) → fix it. Re-run pre-flight on the newly-implicated package (see
       "Pre-flight checks" above) before pushing. For `E2E` specifically, reproduce
       locally where feasible: `npm run test:e2e -w packages/gp-webapp` (needs a
       configured `BASE_URL` + Clerk test stack against a real API — see
       `packages/gp-webapp/e2e-tests/CLAUDE.md`).
     - **Flaky, pre-existing, or infra** (a failure unrelated to your diff and
       present on `main`, a deploy failure, an auth stack outage) → **escalate**,
       don't churn. Hand back the failing check with your evidence; a single re-run
       for a suspected flake is fine, blind re-pushing is not.

5. **Apply, then re-converge.** Make the verified-valid fixes (re-run pre-flight on
   affected packages first — never push failing lint/types/unit tests). Commit and
   push. The push re-triggers delegate and the full check set for the new HEAD, so
   loop back to **Phase 2 step 1** (comment `delegate review`) and re-confirm all
   gates at the new HEAD. Done requires delegate approved and every check green on
   the _same_ commit.

6. **Round cap.** Stop after **2 check-fix rounds** (total across all checks, not
   per check). Beyond that, hand back the still-failing checks (with report links
   / logs and your read) rather than churning on suspected flakes.

## Stop conditions (always report, never loop past these)

- Delegate `Approved.` **and** every required GitHub check green at the same HEAD
  → success.
- 3 delegate rounds, or 2 check-fix rounds, reached → summary handback.
- ~10 min poll with no new review, or ~45 min with checks still unresolved →
  timeout handback.
- A pre-flight failure (any phase), an escalated finding, or a check failure that
  is flaky/pre-existing/infra → wait for the user.

## Notes

- All findings escalated to the user need: the file/line, delegate's claim, and
  _your_ verified take (agree / disagree, with evidence). For an escalated
  **check failure**: the check name, the failing spec/job name(s), the
  HTML-report / log link, and your read (your diff vs. flake/pre-existing/infra,
  with evidence).
- Keep docs current: if a fix you apply changes behavior, architecture, or a
  convention, update the nearest `CLAUDE.md`/`docs/` in the same commit (root
  `CLAUDE.md` rule).

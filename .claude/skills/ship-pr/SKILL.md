---
name: ship-pr
description: Open a PR following GoodParty conventions and drive the delegate-reviewer bot to approval autonomously. Use when the user says "open a PR", "ship this", "create a PR", "create a PR and address delegate", or otherwise wants changes turned into an approved PR in omni.
---

# Ship a PR and converge with delegate

Two phases in one run: open the PR (Phase 1), then drive `delegate-reviewer[bot]`
to `Approved.` (Phase 2). Fully autonomous — only stop to surface a pre-flight
failure you must rule on, or a finding you've verified is wrong or too
high-blast-radius to auto-apply.

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

1. **Get the next review.** On a freshly opened PR, delegate auto-reviews — just
   poll, no trigger comment. After pushing fixes, post an issue comment
   `delegate review` to re-trigger, then poll.
   Poll `gh api repos/thegoodparty/omni/pulls/<n>/reviews` every ~30–60s for a
   `delegate-reviewer[bot]` review whose `submitted_at` is newer than your last
   trigger (or PR open). Budget **~10 min per review**; if nothing lands, stop and
   report.

2. **Verdict.**
   - `APPROVED` (`Approved.`) → **done**. Report and exit.
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

## Stop conditions (always report, never loop past these)

- Delegate `Approved.` → success.
- 3 rounds reached → summary handback.
- ~10 min poll with no new review → timeout handback.
- A pre-flight failure (either phase) or an escalated finding → wait for the user.

## Notes

- All findings escalated to the user need: the file/line, delegate's claim, and
  _your_ verified take (agree / disagree, with evidence).
- Keep docs current: if a fix you apply changes behavior, architecture, or a
  convention, update the nearest `CLAUDE.md`/`docs/` in the same commit (root
  `CLAUDE.md` rule).

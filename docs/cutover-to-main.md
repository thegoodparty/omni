# Cutover to `main` (single-trunk + automated promotion)

Operator runbook for flipping omni from `develop -> qa -> master` (manual
promotion) to a single-trunk `main` with automated prod promotion. Do this once.

The code, CI, and doc changes ship in the cutover PR. The steps here are the
GitHub-side actions and team rollout a PR cannot perform. Design and rationale:
`docs/automated-prod-promotion-design.md`.

## Recommended cutover: GitHub native branch rename

Use GitHub's built-in **rename branch** on `develop` -> `main`, not a
create-fresh-and-delete. Rename automatically retargets every open PR to `main`,
moves branch protection, switches the default branch, and hands contributors a
local-update snippet. It is dramatically lower-interruption than deleting
`develop` (which would auto-close its open PRs).

## Order of operations

1. **Merge the cutover PR into `develop`.** Workflows now reference `main` but
   lie dormant, since nothing pushes `main` yet.
2. **Freeze promotion first.** Set repo variable `PROMOTION_FROZEN=true`
   (Settings -> Secrets and variables -> Actions -> Variables). This stops the
   first `main` activity from auto-shipping to prod before you have watched it.
3. **Rename `develop` -> `main`** (Settings -> Branches, or the branch rename
   button). GitHub switches the default branch, retargets open PRs, and moves
   branch protection.
4. **Verify the required-check ruleset.** The `E2E` status check must be required
   on `main` (rename usually carries it over; confirm under Settings ->
   Rules/Branches). Automated promotion gates on it.
5. **Confirm identity and secrets.** The `omni-automation` GitHub App can push to
   `main`; CI secrets/vars exist (`VERCEL_*`, `AWS_ROLE_ARN`, etc.).
6. **Shake out the first run.** Push a trivial commit to `main`. Watch the dev
   deploy and `E2E` settle. The `promote` workflow runs but skips (frozen).
7. **Go live.** When dev is green and you are satisfied, set
   `PROMOTION_FROZEN=false`, then re-run `promote` via `workflow_dispatch` (or
   push the next commit). It deploys the green commit to prod.
8. **Clean up branches.** Once a green promotion is verified, delete the old
   `master` and `qa` branches. Prod keeps serving the last master-deployed build
   until the first automated promotion ships main's tip. (Tearing down the qa
   _environment_ is a separate later task.)

## Team rollout (minimize interruption)

- **Open PRs:** auto-retargeted to `main` by the rename. If you did a manual
  cutover instead, run `scripts/retarget-open-prs.sh` before deleting `develop`.
  It is idempotent, so it also works as a post-rename verification (expect zero).
- **Local clones:** each engineer runs `bash scripts/migrate-local-to-main.sh`
  once. It repoints the default to `main`, deletes the stale local `develop`
  (only if fully merged), and reports any worktrees still parked on `develop` to
  move by hand (only one worktree can hold `main`).
- **No rebasing needed.** At rename time `main` equals the `develop` tip, so open
  PR branches keep a correct base and diff; their CI re-runs on the next push.

## If something goes wrong

Set `PROMOTION_FROZEN=true` to halt prod shipping immediately while you
investigate. Promotion is forward-only: ECS's deployment circuit breaker
auto-reverts a crash-on-boot image, but there is no manual rollback here. Prefer
fixing forward. The rename itself can be reversed (`main` -> `develop`) if you
must fully back out.

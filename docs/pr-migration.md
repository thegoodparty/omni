# Moving an open PR into omni

When omni is ready to receive contributions, move your open PRs from the old repos
into omni **without losing authorship**. Two options:

## Option 1 — the script (recommended)

From the omni repo root:

```bash
npm run migrate:pr -- <app> <pr-number-or-branch>
# e.g.
npm run migrate:pr -- gp-api 4871
npm run migrate:pr -- gp-webapp ENG-5044-my-feature
```

This rewrites your PR's commits under the app's directory (e.g. `packages/gp-api/`),
cherry-picks them onto a fresh branch off `develop` (preserving each commit's
original author), and prints the `git push` + `gh pr create` commands to finish.
Run those final commands yourself so that **you** are the PR opener.

> If your branch contains merge commits, rebase it in the source repo first
> (`git rebase origin/<base>`), then re-run.

## Option 2 — prompt an agent

Paste this into your coding agent, filling in the blanks:

```
Move my open PR from the GoodParty `<APP>` repo into the new `omni` monorepo,
preserving my authorship.

Context:
- Source repo: thegoodparty/<APP>, PR #<NUMBER> (branch `<BRANCH>`), based on `<BASE_BRANCH>`.
- In omni, that app lives under `packages/<APP>/`. omni's integration branch is `develop`.

Steps:
1. Clone thegoodparty/<APP>, create local branches for the base branch and the PR head
   (for a PR number, fetch refs/pull/<NUMBER>/head).
2. Use `git filter-repo --refs base pr --to-subdirectory-filter packages/<APP>` so the PR's
   files live under packages/<APP>/.
3. In omni, create branch `migrate/<APP>/<BRANCH>` off `develop`, then cherry-pick the
   range `merge-base(base, pr)..pr` onto it. Cherry-pick MUST preserve the original
   author (do not pass --reset-author). Resolve any conflicts.
4. Stop before pushing. Show me the diff and the exact `git push` + `gh pr create`
   commands so I can open the PR as myself.

Do not rewrite or reset author information. Do not force-push anything.
```

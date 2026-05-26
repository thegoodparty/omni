<!-- v1 — 2026-05-26 -->
# /release-prep

Open a `develop → qa` PR per configured repo, wait for checks, merge it, then open a `qa → master` PR — the pending production release. Compile and print a `#devs-only` message that groups every included PR under its author so the team can confirm before the actual release.

<!-- BEGIN: resolve-runbooks-dir (keep in sync across commands/*.md) -->
> **Where this runs:** All paths below (`scripts/python/...`, `books/.env`, `scripts/.env`) are relative to the runbooks repo root. When invoked from any directory, first resolve and `cd` into the repo:
>
> 1. If `$RUNBOOKS_DIR` is set, use it.
> 2. Else first that exists: `$HOME/Documents/gp/dev/runbooks`, `$HOME/code/runbooks`, `$HOME/runbooks`.
> 3. Else ask the user where the runbooks repo is; suggest `export RUNBOOKS_DIR=<path>` in their shell profile.
<!-- END: resolve-runbooks-dir -->

## Prerequisites

**books/.env variables**: `$RELEASE_DEFAULT_REPOS`, `$RELEASE_REPOS_DIR`, `$RELEASE_AUTHOR_MAP`, `$RELEASE_DEVS_CHANNEL`, `$CLICKUP_TEAM_ID`
**scripts/.env variables**: `CLICKUP_API_KEY`
**Tools**: `gh` (authenticated), `git`, `uv` (for ClickUp lookups), `jq`

Defaults if a `books/.env` value is unset: `$RELEASE_DEFAULT_REPOS=gp-webapp,gp-api`, `$RELEASE_REPOS_DIR=$HOME/Documents/gp/dev`, `$RELEASE_AUTHOR_MAP=$HOME/.claude/release-authors.json`, `$RELEASE_DEVS_CHANNEL=#devs-only`.

**Never commit on the user's behalf.** This command opens and merges PRs through `gh pr merge` (which acts on the remote), but never runs `git commit` locally.

## Steps

User input may be passed as a comma-separated repo list to override `$RELEASE_DEFAULT_REPOS` for one run (e.g., `gp-webapp,gp-api,election-api`). Treat that input as `$ARGUMENTS` below.

### Phase 1: Resolve repos and config

1. **Determine the repo list.** If `$ARGUMENTS` is non-empty, use it; otherwise start with `$RELEASE_DEFAULT_REPOS`. Then prompt the user once:

   > Release repos so far: `<repo1>, <repo2>`. Include any others this release? (comma-separated names like `election-api`, or Enter to skip).

   Append any additions; dedupe.

2. **Resolve each repo to a local path.** For each name, check `$RELEASE_REPOS_DIR/<name>`. If missing, ask the user for the path. Confirm the full list back to the user before continuing:

   > Will run for: `<repo1>` (`<path>`), `<repo2>` (`<path>`). OK?

3. **Load the author map.** Read `$RELEASE_AUTHOR_MAP` if it exists — JSON of GitHub login → Slack display name:

   ```json
   {
     "bryan-mcdonell": "Bryan",
     "feliks-goodparty": "Feliks",
     "daniel-x": "Daniel",
     "sanjay-y": "Sanjay"
   }
   ```

   If the file doesn't exist, warn the user that unmapped authors will appear as raw GitHub logins in the message, then continue.

### Phase 2: develop → qa per repo

4. **For each repo**, run steps 5–9 sequentially (not in parallel — easier to react to failures).

5. **Fetch and check the diff:**

   ```bash
   cd "$RELEASE_REPOS_DIR/<repo>"
   git fetch origin --prune
   git log origin/qa..origin/develop --oneline --no-merges
   ```

   If output is empty, print `<repo>: no changes between qa and develop — skipping` and move on to the next repo.

6. **Create (or reuse) the develop → qa PR.** First check whether one is already open — this command is rerunnable, and `gh pr create` returns 422 on duplicates:

   ```bash
   gh pr list --base qa --head develop --state open --json number,url
   ```

   If the result is non-empty, capture the existing PR number and skip the create. Otherwise build a body listing the included PRs (one bullet per subject from step 5's `git log`) and create:

   ```bash
   gh pr create \
     --base qa --head develop \
     --title "Release prep: develop → qa ($(date +%F))" \
     --body-file /tmp/release-prep-body.md
   ```

   Capture the PR number from `gh`'s output. `gh` reads the owner/repo from the cwd's git remote — no `--repo` flag needed when `cd`'d into the repo.

7. **Wait for checks to settle:**

   ```bash
   gh pr checks <pr_number> --watch
   ```

   This blocks until all checks reach a terminal state. If any check is in `FAIL` / `CANCEL` / `TIMEOUT`, pause and present three options:

   > `<repo>` PR #<n>: <which> check(s) failed.
   >
   > - **`retry`** — re-trigger CI (re-run failed jobs from the GitHub UI, or push a no-op) and re-watch
   > - **`merge-anyway`** — flaky test or known-good; merge despite the red
   > - **`abort`** — stop the whole release prep; nothing else gets merged

   On `abort`, exit and print which repos were already processed in step 17's final report.

8. **Merge the develop → qa PR with a merge commit:**

   ```bash
   gh pr merge <pr_number> --merge
   ```

   `--merge` (not `--squash`) is intentional — it preserves the included PRs' squash commits on `qa` and `master`, which is what `/release` parses to build the release notes.

9. **Re-fetch** so local `qa` is current:

   ```bash
   git fetch origin --prune
   ```

### Phase 3: qa → master per repo (pending release)

10. **For each repo that had changes in Phase 2**, open the `qa → master` PR — but **do not merge it**. This is the pending production release. First check for an existing open one (same rerunnability concern as step 6):

    ```bash
    gh pr list --base master --head qa --state open --json number,url
    ```

    If non-empty, reuse the existing PR. Otherwise:

    ```bash
    gh pr create \
      --base master --head qa \
      --title "Release: qa → master ($(date +%F))" \
      --body-file /tmp/release-pending-body.md
    ```

    Body should list the included PRs (same data used in step 6). Capture each PR's URL.

### Phase 4: Build the #devs-only message

11. **Per repo**, list the commits being released — these are the squash commits between `master` and `qa`. Capture the hash too, since not every subject ends with `(#<n>)`:

    ```bash
    cd "$RELEASE_REPOS_DIR/<repo>"
    git log origin/master..origin/qa --no-merges --pretty=format:'%H %s'
    ```

    For each line, try the regex `\(#(\d+)\)$` on the subject. If it matches, you have the PR number. If it doesn't (older PRs, direct pushes, non-standard merge messages), recover the PR by commit hash via the commit-to-PRs association API:

    ```bash
    gh api repos/{owner}/{repo}/commits/<commit_hash>/pulls \
      --jq '.[0] | {number, title, author: .user.login, body}'
    ```

    Use the commits-to-pulls endpoint, **not** `gh pr list --search '<hash>'` — `--search` is free-text against PR title/body/comments, so a bare hash only matches if someone manually pasted it into the PR text. The `commits/{sha}/pulls` endpoint uses the commit graph, which is what we actually want. `gh api` substitutes `{owner}` and `{repo}` from the cwd's git remote.

    If the endpoint returns an empty array (e.g., a direct push to develop with no PR ever opened), keep the commit as a "no-PR" entry — fall back to `%s` (subject) for the title and `git log -1 --pretty=format:'%an' <hash>` for the author. Mark it in the final report so the user knows there's a commit without a PR backing it.

12. **Fetch each PR's metadata** for the matched-by-regex cases (the hash-search cases above already returned metadata in the search response, so skip them here). Do this **inside the per-repo loop from step 11** — `gh pr view` resolves owner/repo from the cwd, so the cwd must still be in the relevant repo. If you process across repos in a flat list later, pass `--repo <owner>/<repo>` explicitly:

    ```bash
    gh pr view <pr_number> --json number,title,author,body
    ```

    Capture `number`, `title`, `author.login`, and `body`. **Cache key must be repo-qualified** — `<repo>:<pr_number>`, not bare `<pr_number>`. GitHub PR numbers are per-repo, so `gp-webapp#1820` and `gp-api#1820` are distinct PRs that would collide on a bare-number key.

13. **Extract ENG-XXXX tags** from each PR's `title` and `body` with the regex `ENG-\d+` (case-insensitive). Dedupe per PR.

14. **Look up ClickUp titles** for the union of all ENG-XXXX tags across all repos. GoodParty stores these as `custom_id`, not raw task IDs — the lookup needs `custom_task_ids=true` and a team ID. Use an absolute path for `scripts/python` because earlier phases `cd`'d into a repo directory; a relative `cd scripts/python` would resolve to `<repo>/scripts/python` and fail:

    ```bash
    cd "$RUNBOOKS_DIR/scripts/python" && uv run clickup_api.py GET task/ENG-XXXX \
      custom_task_ids=true team_id=$CLICKUP_TEAM_ID
    ```

    Cache results — multiple PRs may reference the same ticket. If a tag returns 404, keep the tag in the message but skip the title — note the unresolved tag in the final report.

15. **Group PRs by author** using the map loaded in step 3:
    - `author.login` → Slack display name via the JSON map
    - Unmapped logins → use the raw login as-is, surface in the final report

16. **Format the message** to match the exact layout used in `$RELEASE_DEVS_CHANNEL`:

    ```
    Here are the changes that are included in today's pending production release.

    If you're tagged in this message, please confirm that your changes are ready to go to prod by leaving a :white_check_mark: reaction on this message.

    @<Slack name>:
      •  <repo> #<pr_number>: <pr_title>
      •  ...

    @<Slack name>:
      •  ...
    ```

    Ordering: authors in the order they first appear in the diff (oldest merged PR's author first); PRs/commits under each author in merge order. If the PR title contains an ENG-XXXX tag, leave it in the title — don't strip it.

    For step-11 no-PR fallback entries (direct pushes, missing search match), use `<repo> <commit_hash[:7]>: <subject>` in place of `<repo> #<n>: <title>`. The user can decide whether to keep or strip these before pasting.

### Phase 5: Print and report

17. **Print the formatted message** between visible delimiters so it's easy to copy:

    ```
    ──────── COPY BELOW INTO #devs-only ────────
    Here are the changes that are included in today's pending production release.
    ...
    ──────── END ────────
    ```

18. **Final report:**
    - Repos processed (develop→qa merged, qa→master PR opened) with the open `qa → master` PR URL for each
    - Repos skipped (empty diff between qa and develop)
    - Any unmapped GitHub authors that fell back to raw logins (suggest adding them to `$RELEASE_AUTHOR_MAP`)
    - Any ENG-XXXX tags that failed to resolve in ClickUp
    - Any commits with no PR backing them (no `(#<n>)` suffix and `gh api .../commits/<hash>/pulls` returned `[]`) — these appeared in the message with a commit-hash placeholder
    - Suggested next step: "After the team has confirmed (:white_check_mark: reactions in `$RELEASE_DEVS_CHANNEL`), run `/release` to merge qa → master and post the release notes."

## Important Notes

- **Do not commit on the user's behalf.** All merges run through `gh pr merge` (acts on the remote PR). Never `git commit` locally.
- **`--merge`, not `--squash`.** The merge style is load-bearing — `/release` parses the `qa..master` diff to find included ENG-XXXX tags. Squashing would collapse them into the parent PR's commit body, making the lookup more fragile.
- **Per-repo, not in parallel.** Failures (check failures, PR open conflicts) are easier to react to one repo at a time.
- **Skip silent on empty diff.** If `git log qa..develop` is empty for a repo, that's normal — note it in the final report and move on.
- **Don't merge the qa → master PR.** This command only opens it. The actual release merge is done by `/release` once the team has confirmed.
- **`gh` cwd detection.** When `cd`'d into a repo, `gh` resolves owner/repo from the git remote. Don't pass `--repo` unless you're operating cross-repo from the runbooks directory.

## Troubleshooting

| Failure | Fix |
|---------|-----|
| `gh pr create` returns "no commits between qa and develop" | Step 5 should have caught this — re-run step 5 to confirm the diff is empty, then skip the repo. |
| `gh pr checks --watch` hangs | The repo's CI may never have started. Check the PR's Checks tab in the GitHub UI. Cancel with Ctrl-C; use `merge-anyway` if you know the build is healthy. |
| ClickUp lookup returns 404 for an `ENG-XXXX` | The custom ID may not exist in this workspace, or `custom_task_ids=true` / `team_id` were not passed. Verify `$CLICKUP_TEAM_ID` is set. If still 404, list the tag in the message with no title and surface it in the final report. |
| Two PRs reference the same ENG ticket | Expected (e.g., gp-webapp + gp-api work on the same feature). The dev-only message lists both PRs under their respective authors; the ticket is not deduped here — that's `/release`'s job. |
| Author appears as raw GitHub login | They're not in `$RELEASE_AUTHOR_MAP`. Add them to the JSON and re-run, or edit the printed message before pasting. |
| `gh pr merge --merge` fails with "Pull request is not mergeable" | Branch protection rule (e.g., required review) is in effect. Resolve in the GitHub UI, then re-run from step 8 for that repo only. |
| `gh api .../commits/<hash>/pulls` returns `[]` for a commit | No PR was ever opened for that commit (likely a direct push to develop). Step 11's no-PR fallback should have caught this — the entry will appear in the dev-only message with a commit-hash placeholder, and is surfaced in the final report. |

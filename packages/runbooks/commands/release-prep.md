<!-- v2 — 2026-06-05 -->
# /release-prep

Open every configured repo's `develop → qa` PR up front so their checks run concurrently, then watch and merge each, then open a `qa → master` PR per repo — the pending production release. Compile and print a `#devs-only` message that groups every included PR under its author so the team can confirm before the actual release.

<!-- BEGIN: resolve-runbooks-dir (keep in sync across commands/*.md) -->
> **Where this runs:** All paths below (`scripts/python/...`, `books/.env`, `scripts/.env`) are relative to the runbooks repo root. When invoked from any directory, first resolve and `cd` into the repo:
>
> 1. If `$RUNBOOKS_DIR` is set, use it.
> 2. Else first that exists: `$HOME/Documents/gp/dev/runbooks`, `$HOME/code/runbooks`, `$HOME/runbooks`.
> 3. Else ask the user where the runbooks repo is; suggest `export RUNBOOKS_DIR=<path>` in their shell profile.
<!-- END: resolve-runbooks-dir -->

## Prerequisites

**books/.env variables**: `$RELEASE_DEFAULT_REPOS`, `$RELEASE_REPOS_DIR`, `$RELEASE_AUTHOR_MAP`, `$RELEASE_DEVS_CHANNEL`, `$CLICKUP_TEAM_ID`, `$RELEASE_CLICKUP_TICKET_BASE`
**scripts/.env variables**: none — this command builds ClickUp ticket links from the custom id (no API call); `CLICKUP_API_KEY` is not required here.
**Tools**: `gh` (authenticated), `git`, `jq`

Defaults if a `books/.env` value is unset: `$RELEASE_DEFAULT_REPOS=gp-webapp,gp-api`, `$RELEASE_REPOS_DIR=$HOME/Documents/gp/dev`, `$RELEASE_AUTHOR_MAP=$HOME/.claude/release-authors.json`, `$RELEASE_DEVS_CHANNEL=#devs-only`, `$RELEASE_CLICKUP_TICKET_BASE=https://goodparty.clickup.com/t/$CLICKUP_TEAM_ID`.

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

### Phase 2: develop → qa (open all PRs first, watch in parallel, then merge)

4. **Open every repo's `develop → qa` PR before watching any checks.** The slow part of this phase is CI, and a PR's checks start the moment it's created. So the order is: **first pass** opens every repo's PR (steps 5–6, looped over all repos), **second pass** watches each PR's checks (step 7), **third pass** merges the green ones (steps 8–9). Watching the PRs one after another in the second pass does **not** serialize the wait — because all the PRs were opened in the first pass, their checks have been running concurrently the whole time; by the time the first repo's `--watch` returns, the others' checks are already well underway. This is the point of the rewrite: don't block on gp-webapp's checks before opening gp-api's PR.

   Keep a per-repo record as you go: PR number, whether the repo had changes, and (after the second pass) its check outcome. Steps 5–6 below are non-blocking, so loop them over all repos before touching step 7.

5. **First pass — for each repo, fetch and check the diff:**

   ```bash
   cd "$RELEASE_REPOS_DIR/<repo>"
   git fetch origin --prune
   git log origin/qa..origin/develop --oneline --no-merges
   ```

   If output is empty, print `<repo>: no changes between qa and develop — skipping`, record the repo as skipped, and don't open a PR for it.

6. **First pass (cont.) — create (or reuse) the develop → qa PR.** This command is rerunnable; check for an existing open PR first to avoid `gh pr create`'s 422 on duplicates:

   ```bash
   cd "$RELEASE_REPOS_DIR/<repo>"
   gh pr list --base qa --head develop --state open --json number,url
   ```

   If the result is non-empty, capture the existing PR number and skip the create. Otherwise build the body inline with `mktemp` and create:

   ```bash
   cd "$RELEASE_REPOS_DIR/<repo>"
   BODY_FILE=$(mktemp)
   printf '## Included PRs\n\n' > "$BODY_FILE"
   git log origin/qa..origin/develop --oneline --no-merges | sed 's/^/- /' >> "$BODY_FILE"
   gh pr create \
     --base qa --head develop \
     --title "Release prep: develop → qa ($(date +%F))" \
     --body-file "$BODY_FILE"
   rm -f "$BODY_FILE"
   ```

   Capture the PR number from `gh`'s output, then **move straight to the next repo — do not wait for checks here.** `gh` reads the owner/repo from the cwd's git remote — no `--repo` flag needed when `cd`'d into the repo. **Each code block re-runs the `cd` defensively** — some agent runtimes reset cwd between tool calls, so don't rely on a single `cd` carrying across separate blocks. By the end of this pass every repo with changes has an open PR and CI running concurrently.

7. **Second pass — for each repo with an open PR, wait for its checks to settle:**

   ```bash
   cd "$RELEASE_REPOS_DIR/<repo>"
   gh pr checks <pr_number> --watch
   ```

   This blocks until that repo's checks reach a terminal state, but the checks themselves were already running from the first pass, so the watches overlap in wall-clock time — you're collecting results in order, not adding up each repo's CI time. If any check is in `FAIL` / `CANCEL` / `TIMEOUT`, pause and present three options:

   > `<repo>` PR #<n>: <which> check(s) failed.
   >
   > - **`retry`** — re-trigger CI (re-run failed jobs from the GitHub UI, or push a no-op) and re-watch
   > - **`merge-anyway`** — flaky test or known-good; merge it in the third pass despite the red
   > - **`abort`** — stop the release prep; nothing gets merged

   Record each repo's outcome (`green` / `merge-anyway` / `failed`). On `abort`, stop here and skip the third pass entirely: nothing was merged, but note in step 17's final report that the develop→qa PRs are already open (CI may still be running) and can be merged manually or by re-running the command.

8. **Third pass — merge each repo whose checks passed (or that you chose `merge-anyway` for), with a merge commit:**

   ```bash
   cd "$RELEASE_REPOS_DIR/<repo>"
   gh pr merge <pr_number> --merge
   ```

   `--merge` (not `--squash`) is intentional — it preserves the included PRs' squash commits on `qa` and `master`, which is what `/release` parses to build the release notes. Skip any repo whose outcome was `failed` (not chosen for merge-anyway); report it in step 17.

9. **Re-fetch** each merged repo so local `qa` is current:

   ```bash
   cd "$RELEASE_REPOS_DIR/<repo>"
   git fetch origin --prune
   ```

### Phase 3: qa → master per repo (pending release)

10. **For each repo merged in Phase 2** (skip any that failed checks and weren't merge-anyway'd, and skip everything if Phase 2 was aborted), open the `qa → master` PR — but **do not merge it**. This is the pending production release. First check for an existing open one (same rerunnability concern as step 6):

    ```bash
    cd "$RELEASE_REPOS_DIR/<repo>"
    gh pr list --base master --head qa --state open --json number,url
    ```

    If non-empty, reuse the existing PR. Otherwise build the body inline and create:

    ```bash
    cd "$RELEASE_REPOS_DIR/<repo>"
    BODY_FILE=$(mktemp)
    printf '## Included PRs (qa → master)\n\n' > "$BODY_FILE"
    git log origin/master..origin/qa --oneline --no-merges | sed 's/^/- /' >> "$BODY_FILE"
    gh pr create \
      --base master --head qa \
      --title "Release: qa → master ($(date +%F))" \
      --body-file "$BODY_FILE"
    rm -f "$BODY_FILE"
    ```

    Capture each PR's URL. Same `cd`-per-block discipline as step 6.

### Phase 4: Build the #devs-only message

11. **Per repo**, list the commits being released — these are the squash commits between `master` and `qa`. Capture the hash too, since not every subject ends with `(#<n>)`:

    ```bash
    cd "$RELEASE_REPOS_DIR/<repo>"
    git log origin/master..origin/qa --no-merges --pretty=format:'%H %s'
    ```

    For each line, try the regex `\(#(\d+)\)$` on the subject. If it matches, you have the PR number. If it doesn't (older PRs, direct pushes, non-standard merge messages), recover the PR by commit hash via the commit-to-PRs association API:

    ```bash
    cd "$RELEASE_REPOS_DIR/<repo>"
    gh api repos/{owner}/{repo}/commits/<commit_hash>/pulls \
      --jq '.[0] | {number, title, author: .user.login, body, branch: .head.ref}'
    ```

    Capture `branch` (the PR's head branch) too — it's a primary source for the ENG-XXXX tag in step 13. Use the commits-to-pulls endpoint, **not** `gh pr list --search '<hash>'` — `--search` is free-text against PR title/body/comments, so a bare hash only matches if someone manually pasted it into the PR text. The `commits/{sha}/pulls` endpoint uses the commit graph, which is what we actually want. `gh api` substitutes `{owner}` and `{repo}` from the cwd's git remote — that's why the defensive `cd` matters here.

    If the endpoint returns an empty array (e.g., a direct push to develop with no PR ever opened), keep the commit as a "no-PR" entry — fall back to `%s` (subject) for the title. For the author, do **not** use `git log --pretty='%an'`: that returns the git-configured name (`Bryan McDonell`), but `$RELEASE_AUTHOR_MAP` is keyed on GitHub logins (`bryan-mcdonell`), so the lookup would always miss and the unmapped-authors report would surface a git name the user can't add to the map. Fetch the GitHub login instead:

    ```bash
    cd "$RELEASE_REPOS_DIR/<repo>"
    gh api repos/{owner}/{repo}/commits/<commit_hash> --jq '.author.login'
    ```

    If `.author.login` is `null` (the commit's git email isn't linked to any GitHub account), fall back to `git log -1 --pretty=format:'%ae' <commit_hash>` (the email) as a last resort. Mark either case in the final report so the user knows there's a commit without a clean GitHub-login attribution.

12. **Fetch each PR's metadata** for the matched-by-regex cases (the hash-search cases above already returned metadata in the search response, so skip them here). Do this **inside the per-repo loop from step 11** — `gh pr view` resolves owner/repo from the cwd, so the cwd must still be in the relevant repo. If you process across repos in a flat list later, pass `--repo <owner>/<repo>` explicitly:

    ```bash
    cd "$RELEASE_REPOS_DIR/<repo>"
    gh pr view <pr_number> --json number,title,author,body,headRefName
    ```

    Capture `number`, `title`, `author.login`, `body`, and `headRefName` (the branch — a primary ENG-tag source). **Cache key must be repo-qualified** — `<repo>:<pr_number>`, not bare `<pr_number>`. GitHub PR numbers are per-repo, so `gp-webapp#1820` and `gp-api#1820` are distinct PRs that would collide on a bare-number key.

13. **Extract ENG-XXXX tags for each PR.** Scan the regex `ENG-\d+` (case-insensitive, uppercase the results, dedupe) across the **union of four sources**, not just title/body:
    - PR `title`
    - PR `body`
    - PR head branch name (`headRefName` / `branch` from step 11–12)
    - the subjects of every commit in `master..qa` that maps to this PR (you already have these from step 11's `git log`)

    **Title/body alone is not enough** — in practice the ticket id most often lives only in the branch name (`ENG-10256-persist-primary-result`) or a commit subject (`chore: ENG-10253 overflow`), while the PR title is a generic summary with no tag. Scanning only title/body silently drops the ticket for the majority of PRs. A PR may legitimately yield **zero** tags (a chore/refactor with no ticket anywhere) or **more than one** (e.g., a PR that closed `ENG-10245` and `ENG-10246`) — both are fine.

    Example, per commit, accumulating tags into the PR keyed by `<repo>:<pr_number>`:

    ```bash
    cd "$RELEASE_REPOS_DIR/<repo>"
    subj=$(git log -1 --pretty=%s "<commit_hash>")
    gh api repos/{owner}/{repo}/commits/<commit_hash>/pulls | jq -r --arg subj "$subj" '
      (.[0] // empty)
      | ([.title, (.body // ""), (.head.ref // ""), $subj] | join(" ")
         | [scan("ENG-[0-9]+"; "i")] | map(ascii_upcase) | unique | join(","))'
    ```

14. **Build a ClickUp ticket link for each ENG-XXXX tag.** No API call is needed — ClickUp resolves the custom-id URL directly:

    ```
    $RELEASE_CLICKUP_TICKET_BASE/<ENG-XXXX>
    ```

    where `$RELEASE_CLICKUP_TICKET_BASE` defaults to `https://goodparty.clickup.com/t/$CLICKUP_TEAM_ID` (workspace subdomain `goodparty`, team id from `$CLICKUP_TEAM_ID`). A tag `ENG-7506` becomes `https://goodparty.clickup.com/t/90132012119/ENG-7506`.

    Do **not** call `clickup_api.py` here — message 1 shows the PR title plus the ticket link, not the ticket's ClickUp title. (Fetching the ticket title is `/release`'s job for the `#product-releases` notes in message 2.) These links are paste-safe: pasted into Slack as raw URLs they auto-link.

15. **Group PRs by author** using the map loaded in step 3:
    - `author.login` → Slack display name via the JSON map
    - Unmapped logins → use the raw login as-is, surface in the final report

16. **Format the message** to match the exact layout used in `$RELEASE_DEVS_CHANNEL`:

    ```
    Here are the changes that are included in today's pending production release.

    If you're tagged in this message, please confirm that your changes are ready to go to prod by leaving a :white_check_mark: reaction on this message.

    @<Slack name>:
      •  <repo> #<pr_number>: <pr_title> <ticket_link> [<ticket_link2> ...]
      •  ...

    @<Slack name>:
      •  ...
    ```

    Each PR line ends with the ClickUp ticket link(s) from step 14 — one per ENG-XXXX tag, space-separated. A PR with no ENG tag (chore/refactor) gets no link, just the title. Example lines:

    ```
      •  gp-api #1704: feat: update domain registrant to a vercel owner https://goodparty.clickup.com/t/90132012119/ENG-7506
      •  gp-webapp #1913: fix(TextComplianceStep): update styling ... https://goodparty.clickup.com/t/90132012119/ENG-10245 https://goodparty.clickup.com/t/90132012119/ENG-10246
      •  gp-webapp #1895: fix: rename useVerisons -> useVersions and add error handling
    ```

    Ordering: authors in the order they first appear in the diff (oldest merged PR's author first); PRs/commits under each author in merge order. Leave any ENG-XXXX already present in the PR title as-is — don't strip it; the appended link is the canonical reference.

    For step-11 no-PR fallback entries (direct pushes, missing search match), use `<repo> <commit_hash[:7]>: <subject>` in place of `<repo> #<n>: <title>`; still scan the commit subject for an ENG tag and append its link if found. The user can decide whether to keep or strip these before pasting.

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
    - Repos whose develop→qa checks failed and were not merged — with the open develop→qa PR URL so the user can resolve and re-run (these have no qa→master PR yet)
    - If Phase 2 was aborted: the develop→qa PRs that were left open (CI may still be running), with URLs — nothing was merged, so re-run or merge manually to continue
    - Any unmapped GitHub authors that fell back to raw logins (suggest adding them to `$RELEASE_AUTHOR_MAP`)
    - Any PRs with no ENG-XXXX tag found in title/body/branch/commits (rendered with no ticket link) — flag so the user can add a ticket reference if one was expected
    - Any commits with no PR backing them (no `(#<n>)` suffix and `gh api .../commits/<hash>/pulls` returned `[]`) — these appeared in the message with a commit-hash placeholder
    - Suggested next step: "After the team has confirmed (:white_check_mark: reactions in `$RELEASE_DEVS_CHANNEL`), run `/release` to merge qa → master and post the release notes."

## Important Notes

- **Do not commit on the user's behalf.** All merges run through `gh pr merge` (acts on the remote PR). Never `git commit` locally.
- **`--merge`, not `--squash`.** The merge style is load-bearing — `/release` parses the `qa..master` diff to find included ENG-XXXX tags. Squashing would collapse them into the parent PR's commit body, making the lookup more fragile.
- **Open all PRs first, then watch.** Phase 2 opens every repo's develop→qa PR up front (first pass) so CI runs concurrently, then watches (second pass) and merges (third pass). Don't watch one repo's checks before opening the next repo's PR — that throws away the parallelism. Failures are still reacted to one repo at a time during the second pass.
- **Skip silent on empty diff.** If `git log qa..develop` is empty for a repo, that's normal — note it in the final report and move on.
- **Don't merge the qa → master PR.** This command only opens it. The actual release merge is done by `/release` once the team has confirmed.
- **`gh` cwd detection.** When `cd`'d into a repo, `gh` resolves owner/repo from the git remote. Don't pass `--repo` unless you're operating cross-repo from the runbooks directory.

## Troubleshooting

| Failure | Fix |
|---------|-----|
| `gh pr create` returns "no commits between qa and develop" | Step 5 should have caught this — re-run step 5 to confirm the diff is empty, then skip the repo. |
| `gh pr checks --watch` hangs | The repo's CI may never have started. Check the PR's Checks tab in the GitHub UI. Cancel with Ctrl-C; use `merge-anyway` if you know the build is healthy. |
| A PR you expected to have a ticket shows no link | No `ENG-\d+` was found in its title, body, branch name, or any of its commit subjects. Either the ticket was never referenced (add it to the PR/branch and re-run) or it's a genuine no-ticket chore. The link is built from the custom id — there's no API call to fail here. |
| Ticket link 404s when clicked | `$RELEASE_CLICKUP_TICKET_BASE` is wrong, or `$CLICKUP_TEAM_ID` doesn't match the workspace. The canonical form is `https://<workspace>.clickup.com/t/<team_id>/<ENG-XXXX>`. Fix the var; no re-fetch needed. |
| Two PRs reference the same ENG ticket | Expected (e.g., gp-webapp + gp-api work on the same feature). The dev-only message lists both PRs under their respective authors; the ticket is not deduped here — that's `/release`'s job. |
| Author appears as raw GitHub login | They're not in `$RELEASE_AUTHOR_MAP`. Add them to the JSON and re-run, or edit the printed message before pasting. |
| `gh pr merge --merge` fails with "Pull request is not mergeable" | Branch protection rule (e.g., required review) is in effect. Resolve in the GitHub UI, then re-run from step 8 for that repo only. |
| `gh api .../commits/<hash>/pulls` returns `[]` for a commit | No PR was ever opened for that commit (likely a direct push to develop). Step 11's no-PR fallback should have caught this — the entry will appear in the dev-only message with a commit-hash placeholder, and is surfaced in the final report. |

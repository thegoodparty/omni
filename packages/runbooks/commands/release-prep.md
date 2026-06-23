<!-- v4 — 2026-06-22 -->
# /release-prep

Open the omni monorepo's `develop → qa` PR with auto-merge enabled, wait for it to merge, then open the `qa → master` PR — the pending production release. Compile and print a `#devs-only` message that groups every included PR under its author so the team can confirm before the actual release.

omni is one monorepo (`develop → qa → master`, mapping to `dev / qa / prod`), so a release prep is a single repo's branch promotion — there is no per-repo loop.

<!-- BEGIN: resolve-runbooks-dir (keep in sync across commands/*.md) -->
> **Where this runs:** All paths below (`scripts/python/...`, `books/.env`, `scripts/.env`) are relative to the runbooks repo root. When invoked from any directory, first resolve and `cd` into the repo:
>
> 1. If `$RUNBOOKS_DIR` is set, use it.
> 2. Else first that exists: `$HOME/Documents/gp/dev/runbooks`, `$HOME/code/runbooks`, `$HOME/runbooks`.
> 3. Else ask the user where the runbooks repo is; suggest `export RUNBOOKS_DIR=<path>` in their shell profile.
<!-- END: resolve-runbooks-dir -->

<!-- BEGIN: resolve-omni-dir (keep in sync across commands/*.md) -->
> **The release repo is `omni`** — one monorepo. Resolve its local path once:
>
> 1. If `$RELEASE_OMNI_DIR` is set, use it.
> 2. Else first that exists: `$HOME/Documents/gp/dev/omni`, `$HOME/code/omni`, `$HOME/omni`.
> 3. Else ask the user where the omni repo is; suggest `export RELEASE_OMNI_DIR=<path>` in their shell profile.
<!-- END: resolve-omni-dir -->

## Prerequisites

**books/.env variables**: `$RELEASE_OMNI_DIR`, `$RELEASE_AUTHOR_MAP`, `$RELEASE_DEVS_CHANNEL`, `$CLICKUP_TEAM_ID`, `$RELEASE_CLICKUP_TICKET_BASE`
**scripts/.env variables**: none — this command builds ClickUp ticket links from the custom id (no API call); `CLICKUP_API_KEY` is not required here.
**Tools**: `gh` (authenticated), `git`, `jq`

Defaults if a `books/.env` value is unset: `$RELEASE_OMNI_DIR=$HOME/Documents/gp/dev/omni`, `$RELEASE_AUTHOR_MAP=$HOME/.claude/release-authors.json`, `$RELEASE_DEVS_CHANNEL=#devs-only`, `$RELEASE_CLICKUP_TICKET_BASE=https://goodparty.clickup.com/t/$CLICKUP_TEAM_ID`.

**Never commit on the user's behalf.** This command opens and merges PRs through `gh pr merge` (which acts on the remote), but never runs `git commit` locally.

## Steps

This command takes no arguments — the release target is always the omni monorepo.

### Phase 1: Resolve repo and config

1. **Resolve the omni repo path** per the `resolve-omni-dir` block above. Confirm it back to the user before continuing:

   > Will run release prep for omni (`<path>`). OK?

2. **Load the author map.** Read `$RELEASE_AUTHOR_MAP` if it exists — JSON of GitHub login → Slack display name:

   ```json
   {
     "bryan-mcdonell": "Bryan",
     "feliks-goodparty": "Feliks",
     "daniel-x": "Daniel",
     "sanjay-y": "Sanjay"
   }
   ```

   If the file doesn't exist, warn the user that unmapped authors will appear as raw GitHub logins in the message, then continue.

### Phase 2: develop → qa

3. **Fetch and check the diff:**

   ```bash
   cd "$RELEASE_OMNI_DIR"
   git fetch origin --prune
   git log origin/qa..origin/develop --oneline --no-merges
   ```

   If output is empty, the develop→qa promotion may already have landed during a
   prior `investigate` / budget-timeout pause (its auto-merge fired on its own),
   leaving only the `qa → master` PR to open. Before exiting, check the other leg:

   ```bash
   cd "$RELEASE_OMNI_DIR"
   git log origin/master..origin/qa --oneline --no-merges
   ```

   - **Both empty** → print `omni: no changes between qa and develop — nothing to release` and stop here (skip to the step 16 final report). There is nothing to prep.
   - **`master..qa` non-empty** → the promotion already merged but the release PR was never opened. Skip Phase 2 entirely and jump to step 8 to open the `qa → master` PR, then continue through Phase 4.

4. **Create (or reuse) the develop → qa PR.** This command is rerunnable; check for an existing open PR first to avoid `gh pr create`'s 422 on duplicates:

   ```bash
   cd "$RELEASE_OMNI_DIR"
   gh pr list --base qa --head develop --state open --json number,url
   ```

   If the result is non-empty, capture the existing PR number and skip the create. Otherwise build the body inline with `mktemp` and create:

   ```bash
   cd "$RELEASE_OMNI_DIR"
   BODY_FILE=$(mktemp)
   printf '## Included PRs\n\n' > "$BODY_FILE"
   git log origin/qa..origin/develop --oneline --no-merges | sed 's/^/- /' >> "$BODY_FILE"
   gh pr create \
     --base qa --head develop \
     --title "Release prep: develop → qa ($(date +%F))" \
     --body-file "$BODY_FILE"
   rm -f "$BODY_FILE"
   ```

   Capture the PR number from `gh`'s output. `gh` reads the owner/repo from the cwd's git remote — no `--repo` flag needed when `cd`'d into the omni repo. **Each code block re-runs the `cd` defensively** — some agent runtimes reset cwd between tool calls, so don't rely on a single `cd` carrying across separate blocks.

5. **Enable auto-merge on the develop → qa PR.** Every change in this PR already
   passed the full E2E suite on its way into `develop`, so E2E does not need to
   re-gate the promotion to `qa`. Instead of blocking on a manual `--watch`, hand
   the merge to GitHub:

   ```bash
   cd "$RELEASE_OMNI_DIR"
   gh pr merge <pr_number> --auto --merge
   ```

   `--auto` queues the PR to merge automatically as soon as the `qa` branch's
   required status checks pass — E2E re-runs on this PR but should not be a
   *required* check for the promotion (if it is, relax the `qa` ruleset so the
   release isn't gated on a suite that already passed into develop). `--merge`
   (not `--squash`) is intentional — it preserves the included PRs' squash commits
   on `qa` and `master`, which is what `/release` parses to build the release notes.

   If the repo doesn't allow auto-merge, `gh pr merge --auto` exits non-zero. Fall
   back to an immediate direct merge — the checks already passed into develop, so
   there's nothing to wait for — and record that the fallback was used:

   ```bash
   cd "$RELEASE_OMNI_DIR"
   gh pr merge <pr_number> --merge
   ```

   If both the auto-merge enable and the direct-merge fallback fail (non-zero
   exit), **stop here** — do not proceed to Phase 3 or Phase 4, which both assume
   the develop→qa merge will land. Report the error, point the user at the
   Troubleshooting table below, and skip to the step 16 final report.

6. **Wait for the PR to actually merge.** Auto-merge completes on GitHub's side
   once required checks pass, so poll the PR's state rather than watching
   individual checks:

   ```bash
   cd "$RELEASE_OMNI_DIR"
   gh pr view <pr_number> --json state,mergeStateStatus -q '[.state, .mergeStateStatus]'
   ```

   Re-check on a short interval until it reports `MERGED`, budget **~20 min**.
   This is the sync point Phase 3 depends on — `qa` only carries the new commits
   once the merge lands, so opening the `qa → master` PR before this would diff
   against stale `qa`. Interpret `mergeStateStatus` while polling — `BEHIND` and
   `UNSTABLE` are not interchangeable:

   - `UNSTABLE` — a *non-required* check is failing; this does **not** block
     auto-merge, so keep polling.
   - `BEHIND` — the base branch advanced and branch protection requires the PR be
     up to date, so auto-merge is stuck until the branch updates. Stop polling,
     tell the user to run `gh pr update-branch <pr_number>`, then resume polling.
   - `BLOCKED` with a red required check — auto-merge will never fire on its own.
     Capture the failing check names first (the poll command above returns status,
     not names):

     ```bash
     cd "$RELEASE_OMNI_DIR"
     gh pr checks <pr_number>
     ```

     then present two options:

   > omni PR #<n>: auto-merge is armed but a required check is failing, so it
   > won't merge on its own.
   >
   > - **`investigate`** — leave auto-merge armed; fix or re-run the failing check
   >   in the GitHub UI. It merges by itself once the check goes green. Re-running
   >   this command afterward is **not** a dead end: step 3 sees `qa..develop`
   >   empty but `master..qa` non-empty and jumps straight to step 8 to open the
   >   `qa → master` PR (see step 3's empty-diff branch).
   > - **`merge-anyway`** — flaky/known-good; override with
   >   `gh pr merge <pr_number> --merge --admin` (requires admin). Record which
   >   check(s) were red — the step 16 report needs them.

   If the ~20-min budget elapses with the PR still `OPEN`, not `BLOCKED`, and not
   `BEHIND` (checks genuinely stuck `PENDING` — a hung CI job or an Actions delay,
   handled separately from the failing/out-of-date states above), capture the
   pending check names before handing back:

   ```bash
   cd "$RELEASE_OMNI_DIR"
   gh pr checks <pr_number>
   ```

   Then stop polling and hand back to the user — treat it like `investigate`: the
   PR is left open with auto-merge armed, so it will still merge on its own once
   those `PENDING` checks finish.

   On `investigate` (or a budget timeout), record that the develop→qa PR is left
   open with auto-merge armed, then skip to the step 16 final report — Phase 3 and
   Phase 4 are skipped because `qa` has no new state yet. On `merge-anyway`
   (override merge) or once the poll reports `MERGED`, continue to step 7.

7. **Re-fetch** so local `qa` is current:

   ```bash
   cd "$RELEASE_OMNI_DIR"
   git fetch origin --prune
   ```

### Phase 3: qa → master (pending release)

8. **Open the `qa → master` PR — but do not merge it** (skip this entire step if the develop→qa PR has not merged this run — step 5 couldn't merge it at all, or step 6 ended in `investigate` with auto-merge still pending — **exception: if you arrived here via the step 3 shortcut (`master..qa` was already non-empty), do NOT skip — that is exactly the case this step must handle**). This is the pending production release. First check for an existing open one (same rerunnability concern as step 4):

   ```bash
   cd "$RELEASE_OMNI_DIR"
   gh pr list --base master --head qa --state open --json number,url
   ```

   If non-empty, reuse the existing PR. Otherwise build the body inline and create:

   ```bash
   cd "$RELEASE_OMNI_DIR"
   BODY_FILE=$(mktemp)
   printf '## Included PRs (qa → master)\n\n' > "$BODY_FILE"
   git log origin/master..origin/qa --oneline --no-merges | sed 's/^/- /' >> "$BODY_FILE"
   gh pr create \
     --base master --head qa \
     --title "Release: qa → master ($(date +%F))" \
     --body-file "$BODY_FILE"
   rm -f "$BODY_FILE"
   ```

   Capture the PR's URL. Same `cd`-per-block discipline as step 4.

### Phase 4: Build the #devs-only message

> **Skip this entire phase and step 15 if the develop→qa PR did not merge this run (step 5 couldn't merge it, or step 6 ended in `investigate`), or if there was nothing to merge — unless you arrived here via the step 3 shortcut.** If you arrived via the step 3 shortcut (`master..qa` was already non-empty when step 3 ran), the promotion already landed and `master..qa` holds real commits — do NOT skip; build and print the message. For the normal-flow skip cases: nothing was merged this run, so there is nothing to announce — `git log origin/master..origin/qa` would only surface stale commits from a prior cycle, and printing an empty announcement message is misleading. Go to the step 16 final report instead.

9. **List the commits being released** — these are the squash commits between `master` and `qa`. Capture the hash too, since not every subject ends with `(#<n>)`:

   ```bash
   cd "$RELEASE_OMNI_DIR"
   git log origin/master..origin/qa --no-merges --pretty=format:'%H %s'
   ```

   For each line, try the regex `\(#(\d+)\)$` on the subject. If it matches, you have the PR number. If it doesn't (older PRs, direct pushes, non-standard merge messages), recover the PR by commit hash via the commit-to-PRs association API:

   ```bash
   cd "$RELEASE_OMNI_DIR"
   gh api repos/{owner}/{repo}/commits/<commit_hash>/pulls \
     --jq '.[0] | {number, title, author: .user.login, body, branch: .head.ref}'
   ```

   Capture `branch` (the PR's head branch) too — it's a primary source for the ENG-XXXX tag in step 11. Use the commits-to-pulls endpoint, **not** `gh pr list --search '<hash>'` — `--search` is free-text against PR title/body/comments, so a bare hash only matches if someone manually pasted it into the PR text. The `commits/{sha}/pulls` endpoint uses the commit graph, which is what we actually want. `gh api` substitutes `{owner}` and `{repo}` from the cwd's git remote — that's why the defensive `cd` matters here.

   If the endpoint returns an empty array (e.g., a direct push to develop with no PR ever opened), keep the commit as a "no-PR" entry — fall back to `%s` (subject) for the title. For the author, do **not** use `git log --pretty='%an'`: that returns the git-configured name (`Bryan McDonell`), but `$RELEASE_AUTHOR_MAP` is keyed on GitHub logins (`bryan-mcdonell`), so the lookup would always miss and the unmapped-authors report would surface a git name the user can't add to the map. Fetch the GitHub login instead:

   ```bash
   cd "$RELEASE_OMNI_DIR"
   gh api repos/{owner}/{repo}/commits/<commit_hash> --jq '.author.login'
   ```

   If `.author.login` is `null` (the commit's git email isn't linked to any GitHub account), fall back to `git log -1 --pretty=format:'%ae' <commit_hash>` (the email) as a last resort. Mark either case in the final report so the user knows there's a commit without a clean GitHub-login attribution.

10. **Fetch each PR's metadata** for the matched-by-regex cases (the hash-search cases above already returned metadata in the search response, so skip them here):

    ```bash
    cd "$RELEASE_OMNI_DIR"
    gh pr view <pr_number> --json number,title,author,body,headRefName
    ```

    Capture `number`, `title`, `author.login`, `body`, and `headRefName` (the branch — a primary ENG-tag source).

11. **Extract ENG-XXXX tags for each PR.** Scan the regex `ENG-\d+` (case-insensitive, uppercase the results, dedupe) across the **union of four sources**, not just title/body:
    - PR `title`
    - PR `body`
    - PR head branch name (`headRefName` / `branch` from step 9–10)
    - the subjects of every commit in `master..qa` that maps to this PR (you already have these from step 9's `git log`)

    **Title/body alone is not enough** — in practice the ticket id most often lives only in the branch name (`ENG-10256-persist-primary-result`) or a commit subject (`chore: ENG-10253 overflow`), while the PR title is a generic summary with no tag. Scanning only title/body silently drops the ticket for the majority of PRs. A PR may legitimately yield **zero** tags (a chore/refactor with no ticket anywhere) or **more than one** (e.g., a PR that closed `ENG-10245` and `ENG-10246`) — both are fine.

    Example, per commit, accumulating tags into the PR keyed by `<pr_number>`:

    ```bash
    cd "$RELEASE_OMNI_DIR"
    subj=$(git log -1 --pretty=%s "<commit_hash>")
    gh api repos/{owner}/{repo}/commits/<commit_hash>/pulls | jq -r --arg subj "$subj" '
      (.[0] // empty)
      | ([.title, (.body // ""), (.head.ref // ""), $subj] | join(" ")
         | [scan("ENG-[0-9]+"; "i")] | map(ascii_upcase) | unique | join(","))'
    ```

12. **Build a ClickUp ticket link for each ENG-XXXX tag.** No API call is needed — ClickUp resolves the custom-id URL directly:

    ```
    $RELEASE_CLICKUP_TICKET_BASE/<ENG-XXXX>
    ```

    where `$RELEASE_CLICKUP_TICKET_BASE` defaults to `https://goodparty.clickup.com/t/$CLICKUP_TEAM_ID` (workspace subdomain `goodparty`, team id from `$CLICKUP_TEAM_ID`). A tag `ENG-7506` becomes `https://goodparty.clickup.com/t/90132012119/ENG-7506`.

    Do **not** call `clickup_api.py` here — message 1 shows the PR title plus the ticket link, not the ticket's ClickUp title. (Fetching the ticket title is `/release`'s job for the `#product-releases` notes in message 2.) These links are paste-safe: pasted into Slack as raw URLs they auto-link.

13. **Group PRs by author** using the map loaded in step 2:
    - `author.login` → Slack display name via the JSON map
    - Unmapped logins → use the raw login as-is, surface in the final report

14. **Format the message** to match the exact layout used in `$RELEASE_DEVS_CHANNEL`:

    ```
    Here are the changes that are included in today's pending production release.

    If you're tagged in this message, please confirm that your changes are ready to go to prod by leaving a :white_check_mark: reaction on this message.

    @<Slack name>:
      •  #<pr_number>: <pr_title> <ticket_link> [<ticket_link2> ...]
      •  ...

    @<Slack name>:
      •  ...
    ```

    Each PR line ends with the ClickUp ticket link(s) from step 12 — one per ENG-XXXX tag, space-separated. A PR with no ENG tag (chore/refactor) gets no link, just the title. Example lines:

    ```
      •  #1704: feat: update domain registrant to a vercel owner https://goodparty.clickup.com/t/90132012119/ENG-7506
      •  #1913: fix(TextComplianceStep): update styling ... https://goodparty.clickup.com/t/90132012119/ENG-10245 https://goodparty.clickup.com/t/90132012119/ENG-10246
      •  #1895: fix: rename useVerisons -> useVersions and add error handling
    ```

    Ordering: authors in the order they first appear in the diff (oldest merged PR's author first); PRs/commits under each author in merge order. Leave any ENG-XXXX already present in the PR title as-is — don't strip it; the appended link is the canonical reference.

    For step-9 no-PR fallback entries (direct pushes, missing search match), use `<commit_hash[:7]>: <subject>` in place of `#<n>: <title>`; still scan the commit subject for an ENG tag and append its link if found. The user can decide whether to keep or strip these before pasting.

### Phase 5: Print and report

15. **Print the formatted message** between visible delimiters so it's easy to copy:

    ```
    ──────── COPY BELOW INTO #devs-only ────────
    Here are the changes that are included in today's pending production release.
    ...
    ──────── END ────────
    ```

16. **Final report:**
    - If auto-merge landed cleanly: develop→qa merged (note "via auto-merge", or "via direct-merge fallback" if step 5's `--auto` wasn't allowed), qa→master PR opened — with the open `qa → master` PR URL
    - If merged via admin override (`merge-anyway`): same as above, but call out which check(s) were red and overridden, so the team confirming in `$RELEASE_DEVS_CHANNEL` knows they shipped with a known failure
    - If there were no changes between qa and develop: note it and stop (no PRs opened)
    - If step 6 ended in `investigate` (auto-merge armed but a required check is failing): nothing merged yet. List the develop→qa PR with URL and note "auto-merge is armed — it will merge on its own once the failing check goes green; re-run this command afterward to open the qa→master PR (Phase 3)". Name the failing check(s) (from the `gh pr checks` run in step 6).
    - If step 6 hit the ~20-min budget timeout (checks stuck `PENDING`, never `BLOCKED`): nothing merged yet. List the develop→qa PR with URL and note "auto-merge is armed but checks haven't finished — it will merge on its own once they pass; re-run this command afterward to open the qa→master PR (Phase 3)". Name the still-`PENDING` check(s), not "failing" ones.
    - If step 5 couldn't merge at all (both `--auto` and the direct-merge fallback failed): list the develop→qa PR with URL and the error, and note "merge could not be enabled — resolve in the GitHub UI (see Troubleshooting), then re-run from step 5"
    - Any unmapped GitHub authors that fell back to raw logins (suggest adding them to `$RELEASE_AUTHOR_MAP`)
    - Any PRs with no ENG-XXXX tag found in title/body/branch/commits (rendered with no ticket link) — flag so the user can add a ticket reference if one was expected
    - Any commits with no PR backing them (no `(#<n>)` suffix and `gh api .../commits/<hash>/pulls` returned `[]`) — these appeared in the message with a commit-hash placeholder
    - Suggested next step (only if a `qa → master` PR was opened this run): "After the team has confirmed (:white_check_mark: reactions in `$RELEASE_DEVS_CHANNEL`), run `/release` to merge qa → master and post the release notes."

## Important Notes

- **One repo: omni.** It's a monorepo — `develop → qa → master`. There is no per-repo loop and no repo-list argument.
- **Do not commit on the user's behalf.** All merges run through `gh pr merge` (acts on the remote PR). Never `git commit` locally.
- **Auto-merge the develop→qa PR; don't block on E2E.** Every included change already passed the full E2E suite into `develop`, so the promotion to `qa` is handed to GitHub via `gh pr merge --auto --merge` rather than a blocking `gh pr checks --watch`. The command only waits (poll on PR `state`) for the merge to actually land, since Phase 3 diffs against the updated `qa`.
- **`--merge`, not `--squash`.** The merge style is load-bearing — `/release` parses the `qa..master` diff to find included ENG-XXXX tags. Squashing would collapse them into the parent PR's commit body, making the lookup more fragile.
- **Skip silent on empty diff.** If `git log qa..develop` is empty, that's normal — note it in the final report and stop.
- **Don't merge the qa → master PR.** This command only opens it. The actual release merge is done by `/release` once the team has confirmed.
- **`gh` cwd detection.** When `cd`'d into the omni repo, `gh` resolves owner/repo from the git remote. Don't pass `--repo`.

## Troubleshooting

| Failure | Fix |
|---------|-----|
| `gh pr create` returns "no commits between qa and develop" | Step 3 should have caught this — re-run step 3 to confirm the diff is empty, then stop. |
| `gh pr merge --auto` fails ("auto-merge is not allowed") | The repo or `qa` branch doesn't permit auto-merge. Step 5's fallback handles this — run `gh pr merge <pr_number> --merge` directly (the checks already passed into develop). |
| PR sits `OPEN` and never auto-merges | A required check on `qa` is failing or still running. Check the PR's Checks tab. If E2E is the blocker, it's redundant here (it passed into develop) — relax the `qa` ruleset so it isn't required, or override a known-good build with `gh pr merge <pr_number> --merge --admin`. |
| A PR you expected to have a ticket shows no link | No `ENG-\d+` was found in its title, body, branch name, or any of its commit subjects. Either the ticket was never referenced (add it to the PR/branch and re-run) or it's a genuine no-ticket chore. The link is built from the custom id — there's no API call to fail here. |
| Ticket link 404s when clicked | `$RELEASE_CLICKUP_TICKET_BASE` is wrong, or `$CLICKUP_TEAM_ID` doesn't match the workspace. The canonical form is `https://<workspace>.clickup.com/t/<team_id>/<ENG-XXXX>`. Fix the var; no re-fetch needed. |
| Two PRs reference the same ENG ticket | Expected (e.g., a gp-webapp and a gp-api package change for the same feature, now in one repo). The dev-only message lists both PRs under their respective authors; the ticket is not deduped here — that's `/release`'s job. |
| Author appears as raw GitHub login | They're not in `$RELEASE_AUTHOR_MAP`. Add them to the JSON and re-run, or edit the printed message before pasting. |
| `gh pr merge` fails with "Pull request is not mergeable" | Branch protection rule (e.g., required review) is in effect. `--auto` may still be armed and will merge once the rule is satisfied. Resolve in the GitHub UI, then re-run from step 5 — the existing PR is reused and step 6's poll picks up the merge once it lands. |
| `gh api .../commits/<hash>/pulls` returns `[]` for a commit | No PR was ever opened for that commit (likely a direct push to develop). Step 9's no-PR fallback should have caught this — the entry will appear in the dev-only message with a commit-hash placeholder, and is surfaced in the final report. |

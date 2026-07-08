<!-- v6 — 2026-06-29 -->
# /release

Merge each repo's pending `qa → production` PR (opened by `/release-prep`), wait 5 minutes for the deploys to settle, then print one `#product-releases` message: a one-paragraph plain-language summary of what shipped (grouped by epic/theme across both repos) followed by every released ticket along with its ClickUp title.

There are **two release repos**, each promoted on its own three-branch line:

| Repo             | Branch line             | Production tip |
| ---------------- | ----------------------- | -------------- |
| `omni`           | `develop → qa → master` | `master`       |
| `gp-ai-projects` | `develop → qa → prod`   | `prod`         |

`omni` is a monorepo; `gp-ai-projects` is a separate repo with the same shape but a `prod` production tip rather than `master`. A release loops over both repos (merging each open `qa → production` PR), then builds **one combined** release-notes message. The repos are independent — one having no pending release does not stop the other.

<!-- BEGIN: resolve-runbooks-dir (keep in sync across commands/*.md) -->
> **Where this runs:** Runbooks lives in the `omni` monorepo at `packages/runbooks`. All paths below (`scripts/python/...`, `books/.env`, `scripts/.env`) are relative to that package root. When invoked from any directory, first resolve and `cd` into it:
>
> 1. If `$RUNBOOKS_DIR` is set, use it.
> 2. Else first that exists: `$HOME/Documents/gp/dev/omni/packages/runbooks`, `$HOME/code/omni/packages/runbooks`, `$HOME/omni/packages/runbooks`.
> 3. Else ask the user where the omni repo is (the runbooks package is at `<omni>/packages/runbooks`); suggest `export RUNBOOKS_DIR=<omni>/packages/runbooks` in their shell profile.
<!-- END: resolve-runbooks-dir -->

<!-- BEGIN: resolve-release-repos (keep in sync across commands/*.md) -->
> **The release repos are `omni` and `gp-ai-projects`.** Resolve each one's local path once. Each repo has a fixed production tip branch — `omni` → `master`, `gp-ai-projects` → `prod`.
>
> **omni** (production tip `master`):
> 1. If `$RELEASE_OMNI_DIR` is set, use it.
> 2. Else first that exists: `$HOME/Documents/gp/dev/omni`, `$HOME/code/omni`, `$HOME/omni`.
> 3. Else ask the user where the omni repo is; suggest `export RELEASE_OMNI_DIR=<path>` in their shell profile.
>
> **gp-ai-projects** (production tip `prod`):
> 1. If `$RELEASE_AI_DIR` is set, use it.
> 2. Else first that exists: `$HOME/Documents/gp/dev/gp-ai-projects`, `$HOME/code/gp-ai-projects`, `$HOME/gp-ai-projects`.
> 3. Else ask the user where the gp-ai-projects repo is; suggest `export RELEASE_AI_DIR=<path>` in their shell profile.
<!-- END: resolve-release-repos -->

## Prerequisites

**books/.env variables**: `$RELEASE_OMNI_DIR`, `$RELEASE_AI_DIR`, `$RELEASE_PRODUCT_CHANNEL`, `$CLICKUP_TEAM_ID`
**scripts/.env variables**: `CLICKUP_API_KEY`
**Tools**: `gh` (authenticated), `git`, `uv` (for ClickUp lookups), `jq`; **plus `terraform` and an AWS CLI authenticated to the gp-ai-projects AWS account — only for step 5b** (the gp-ai-projects prod control-plane deploy). Not needed when releasing omni only.

Defaults if a `books/.env` value is unset: `$RELEASE_OMNI_DIR=$HOME/Documents/gp/dev/omni`, `$RELEASE_AI_DIR=$HOME/Documents/gp/dev/gp-ai-projects`, `$RELEASE_PRODUCT_CHANNEL=#product-releases`.

**Never commit on the user's behalf.** This command runs `gh pr merge` (acts on the remote PR) but never `git commit` locally.

This command stands alone — it does not consume any saved state from `/release-prep`. It re-derives each repo's release contents from its open `qa → production` PR at run time.

## How to loop over repos

This command takes no arguments — the release targets are always `omni` and `gp-ai-projects`. Run **Phases 2–4 once per repo**, using that repo's directory (`$RELEASE_OMNI_DIR` / `$RELEASE_AI_DIR`) and production tip (`master` / `prod`). Throughout the per-repo steps below, `$REPO_DIR` means the current repo's resolved path and `$TIP` means its production tip branch. The 5-minute deploy wait (Phase 5) runs **once** after all merges, and the release-notes message (Phase 6) is **one combined** message across both repos. The repos are independent: if one has no pending release, note it and continue with the other.

## Steps

### Phase 1: Resolve repos

1. **Resolve both repo paths** per the `resolve-release-repos` block above. Confirm them back to the user before continuing.

### Phase 2: Find each pending release PR (run once per repo)

2. **Find the open `qa → $TIP` PR for the repo:**

   ```bash
   cd "$REPO_DIR"
   git fetch origin --prune
   gh pr list --base $TIP --head qa --state open --json number,url,title
   ```

   - 0 matches → don't assume `/release-prep` wasn't run for this repo. It may have ended in `investigate`/budget-timeout with auto-merge armed, then merged develop→qa later **without** opening the `qa → $TIP` PR. Disambiguate:

     ```bash
     cd "$REPO_DIR"
     git log origin/$TIP..origin/qa --oneline --no-merges
     ```

     - **non-empty** → the promotion already landed but the release PR is missing. Check whether new commits have landed on develop since the auto-merge:

       ```bash
       cd "$REPO_DIR"
       git log origin/qa..origin/develop --oneline --no-merges
       ```

       - **`qa..develop` empty** → re-run `/release-prep`; its step-3 shortcut detects the non-empty `$TIP..qa` diff and jumps straight to step 8 to open the `qa → $TIP` PR. Then re-run `/release`.
       - **`qa..develop` non-empty** → new commits landed on develop after the prior auto-merge. Re-running `/release-prep` will start a **new** develop→qa cycle, bundling the already-pending `$TIP..qa` commits with the new work. Confirm with the user before proceeding.
     - **empty** → this repo has nothing pending (or `/release-prep` wasn't run for it). Note it and skip this repo — continue with the other.
   - 1 match → this repo has a pending release; continue
   - 2+ matches → list them and ask the user which to release; if unsure, skip this repo with a message rather than guessing

   Collect the set of repos that have exactly one pending `qa → $TIP` PR — these are the repos this run will release. If **neither** repo has one, stop with a message (nothing is pending).

### Phase 3: Snapshot each release's contents before confirming (run once per repo)

3. **Capture the list of commits being released for the repo** — this must happen **before** the merge, since the merge commit will land on top and complicate post-merge parsing. It must also happen **before** the confirmation prompt in step 4 — the autogenerated PR title (e.g., `Release: qa → $TIP (date)`) is content-free, so the user needs to see the actual commit list to make an informed call. Capture the hash too, since not every subject ends with `(#<n>)`:

   ```bash
   cd "$REPO_DIR"
   git log origin/$TIP..origin/qa --no-merges --pretty=format:'%H %s'
   ```

   For each line, try the regex `\(#(\d+)\)$` on the subject. If it matches, you have the PR number. If it doesn't (older PRs, direct pushes, non-standard merge messages), recover the PR by commit hash via the commit-to-PRs association API:

   ```bash
   cd "$REPO_DIR"
   gh api repos/{owner}/{repo}/commits/<commit_hash>/pulls \
     --jq '.[0] | {number, title, body, branch: .head.ref}'
   ```

   Capture `branch` (the PR's head branch) too — together with the commit subject it's a primary ticket source in step 8. Use the commits-to-pulls endpoint, **not** `gh pr list --search '<hash>'` — `--search` is free-text against PR title/body/comments, so a bare hash only matches if someone manually pasted it into the PR text. The `commits/{sha}/pulls` endpoint uses the commit graph, which is what we actually want. `gh api` substitutes `{owner}` and `{repo}` from the cwd's git remote — that's why the defensive `cd` matters here.

   **Keep each commit's subject keyed to its PR** as you go — step 8 needs the union of all commit subjects per PR to find the ticket id, since it usually isn't in the PR title.

   If the endpoint returns an empty array (no PR ever opened for this commit), keep it as a "no-PR" entry — use `%s` (subject) as a fallback "title"; still scan that subject for a ticket tag. Mark it in the final report. Store the list (PR-matched + no-PR fallbacks), keyed by repo, in working memory — this is the source of truth for what's being released.

### Phase 4: Confirm and merge

4. **Confirm the release with the user**, surfacing the actual commit list captured in step 3 for **each** repo (not just the autogenerated PR titles):

   > About to release:
   >
   > **omni** — PR #<n> — `<url>`
   >   • `<subject 1>`
   >   • `<subject 2>`
   >   • ... (`<N>` commits, `<M>` with a ticket tag)
   >
   > **gp-ai-projects** — PR #<n> — `<url>`
   >   • `<subject 1>`
   >   • ... (`<N>` commits, `<M>` with a ticket tag)
   >
   > After merging, will wait 5 minutes for deploys, then print the `$RELEASE_PRODUCT_CHANNEL` message. Proceed? (`yes` / `no`)

   Show only the repos that have a pending release. For many commits (>10) in a repo, truncate that repo's displayed list (e.g., first 5 + `...and N more`) but include the full ticket-tag count so the user knows the scope. Wait for explicit `yes`. Anything else aborts — nothing has been merged yet at this point.

5. **Verify each snapshot is still current, then merge with a merge commit (run once per repo).** The confirmation in step 4 may have taken minutes; `qa` is a shared branch that a concurrent `/release-prep` (or a direct push) can move during that window. Merging without re-checking would silently ship commits the user never reviewed.

   Re-fetch and compare, per repo:

   ```bash
   cd "$REPO_DIR"
   git fetch origin --prune
   git log origin/$TIP..origin/qa --no-merges --pretty=format:'%H %s'
   ```

   Diff this output against that repo's step-3 snapshot. If they differ (any commits added or removed), **do not merge that repo** — record the skip and continue with the other repo (its snapshot may still match):

   > `qa` moved between confirmation and merge for <repo> (new commits arrived). Skipping <repo>; re-run `/release` to review its updated contents.

   **If at least one repo was skipped but at least one other still matches its snapshot, re-prompt before merging the survivor.** The user's step-4 `yes` authorized a specific joint set across both repos, not a partial release of one half — which matters for a coordinated cross-repo change (one repo's code shipping to prod while its paired repo is held back):

   > <skipped-repo> was skipped (its `qa` moved since you confirmed). Only <surviving-repo> would be released now — a partial release. Continue? (`yes` / `no`)

   Wait for explicit `yes`; anything else aborts (no merges have happened yet — re-run `/release` for a fresh joint confirmation). If every contributing repo's snapshot still matches (no skips), no re-prompt is needed — the step-4 confirmation already covers the merge.

   If a repo's snapshot matches (and, where a skip occurred, the user confirmed the partial release above), merge it:

   ```bash
   cd "$REPO_DIR"
   gh pr merge <pr_number> --merge
   ```

   The `cd` is repeated defensively — some agent runtimes reset cwd between tool calls, so don't rely on step 3's `cd` carrying over. On merge failure for a repo (not the snapshot-mismatch skip), record it and continue: that repo's step-3 snapshot is still valid (only the merge command failed), so its section of the message is accurate and the operator can paste it once they complete the merge manually. The printed message and the step 14 final report both carry the "do not post until the merge actually lands" warning for any such repo. Track which repos actually merged this run — only those, plus the merge-failed-but-snapshot-valid repos, contribute to the message.

5b. **gp-ai-projects only — deploy the control-plane Lambdas to prod.** Skip for omni. Run only if gp-ai-projects' `qa → prod` merged this run (step 5). In gp-ai-projects a merge auto-deploys the broker and runner, but the `dispatch`/`scheduler`/`task_reaper` Lambdas are zip-packaged by Terraform and need a manual `terraform apply`; do it here — before the deploy-settle wait — so prod is fully live before you post the notes. Full procedure and rationale: the **`terraform-deploy` skill** at `$REPO_DIR/.claude/skills/terraform-deploy.md`; the steps below mirror it. Requires `terraform` and an AWS CLI authenticated to the gp-ai-projects account.

   First wait for the prod image build (triggered by the merge) to finish so the runner image and the Lambdas land together. **Match the run to the merge commit's SHA** — a bare `--limit 1` would return the *prior* completed build on `prod` (already `completed`/`success`) before the new run is created, exiting the poll early and deploying the Lambdas against stale images:

   ```bash
   cd "$REPO_DIR"
   git fetch origin --prune   # gh pr merge updated the remote, not local refs
   EXPECTED_SHA=$(git rev-parse origin/prod)   # the merge commit just landed on prod
   gh run list --workflow build-pmf-engine.yml --branch prod --limit 5 \
     --json status,conclusion,headSha \
     | jq --arg sha "$EXPECTED_SHA" '.[] | select(.headSha == $sha) | {status, conclusion}'
   ```

   Poll until a run **for `$EXPECTED_SHA`** appears with `status` = `completed` (budget ~15 min); if that run's `conclusion` isn't `success`, stop and report — don't deploy the Lambdas on a failed build. Then apply in a throwaway worktree off `origin/prod` so the user's checkout is untouched (the apply zips `pmf_engine/.lambda_build` from the working tree, so it must be the released code):

   ```bash
   cd "$REPO_DIR"
   git fetch origin --prune
   git worktree remove --force .worktrees/release-cp-prod 2>/dev/null || true   # clear a leftover from a prior crashed/interrupted run — --force won't reuse a still-registered path
   git worktree prune
   git worktree add --force .worktrees/release-cp-prod origin/prod
   cd .worktrees/release-cp-prod
   bash pmf_engine/scripts/build_lambda_package.sh
   cd infrastructure/environments/prod/pmf-engine-control-plane
   eval "$(aws configure export-credentials --format env)"
   terraform init -input=false
   terraform plan -input=false -out=tfplan
   ```

   **Review the plan before applying** — expect `0 to add, 3 to change, 0 to destroy` (the three Lambdas' `source_code_hash` only), or `No changes` if prod was already applied (idempotent — safe to re-run). Anything else (IAM, security groups, S3, networking) means drift — **remove the worktree first** (`cd "$REPO_DIR" && git worktree remove --force .worktrees/release-cp-prod && git worktree prune`), then stop and surface it (a left-behind worktree blocks the next run's `git worktree add`). If the plan is clean, apply and then remove the worktree:

   ```bash
   cd "$REPO_DIR/.worktrees/release-cp-prod/infrastructure/environments/prod/pmf-engine-control-plane"
   eval "$(aws configure export-credentials --format env)"
   terraform apply -input=false tfplan
   ```

   Then remove the worktree — **always, even if `terraform apply` exited non-zero** (on failure, run this before recording the error; the pre-flight teardown above is the backstop, but don't leave the worktree dangling):

   ```bash
   cd "$REPO_DIR" && git worktree remove --force .worktrees/release-cp-prod && git worktree prune
   ```

   Record the result (applied / `No changes` / skipped / failed) for the step 14 report. A failure here means prod's control-plane code is **not** live even though the `qa → prod` PR merged — call it out so the notes aren't read as "fully shipped".

### Phase 5: Wait 5 minutes (once, after all merges)

6. **Sleep for 5 minutes** (the merge → prod deploy buffer), with countdown updates every minute. One wait covers both repos' deploys:

   ```
   Deploy buffer: 5:00 remaining...
   Deploy buffer: 4:00 remaining...
   ...
   ```

   Skip this wait entirely if **no** repo merged this run (every repo was a snapshot-mismatch skip or a merge failure) — there is nothing deploying. The wait is interruptible — if the user Ctrl-Cs, ask whether to skip the rest of the wait and proceed to Phase 6, or abort entirely. The merges in step 5 have already succeeded, so "abort entirely" cannot undo the releases — it only skips building and posting the release notes. On "abort entirely", jump to the step 14 final report and record that the merges succeeded but the wait and release-notes message were skipped — the notes were not posted. They cannot be regenerated by re-running `/release`: once a repo's merge has landed its `qa → $TIP` diff has collapsed, so step 3's snapshot is no longer recoverable from the branch. The releases themselves are complete, so the notes are informational — if they are still wanted, reconstruct the released commit list from the merge commit on each `$TIP` and build the message by hand.

### Phase 6: Build the #product-releases message

> Build the message from the repos that merged this run (plus any merge-failed-but-snapshot-valid repos — flagged "not yet live"). Run steps 7–10 **per contributing repo**, accumulating results keyed by repo, then write one summary (step 11) and format the combined message (step 12).

7. **Fetch each released PR's metadata** for the repo (for the matched-by-regex cases — hash-search cases from step 3 already returned metadata in the search response). For every PR number captured in step 3:

   ```bash
   cd "$REPO_DIR"
   gh pr view <pr_number> --json number,title,body,headRefName
   ```

   Capture `headRefName` (the branch — a primary ticket source).

8. **Extract ticket tags for each PR.** Scan the regex `(ENG|DATA|WEB|CAP|DT)-\d+` (case-insensitive, uppercase, dedupe) across the **union of four sources**, not just title/body:
   - PR `title`
   - PR `body`
   - PR head branch name (`headRefName` / `branch` from steps 3 and 7)
   - the subjects of every commit in `$TIP..qa` that maps to this PR (kept in step 3)

   **Why a prefix set, not just `ENG-`:** omni PRs are almost always `ENG-XXXX`, but gp-ai-projects branches also use `DATA-`, `WEB-`, `CAP-`, and `DT-` prefixes (e.g. `DATA-1261`, `WEB-4309`). Scanning only `ENG-` would silently drop the ticket for most gp-ai-projects PRs. The enumerated alternation avoids false positives a bare `[A-Z]+-\d+` would catch (`UTF-8`, `SHA-256`). If a new prefix shows up, add it to this regex. In the jq one-liner the alternation **must be a non-capturing group** (`(?:…)`): jq's `scan` returns the *captured group* rather than the full match when the group captures, so a capturing `(ENG|…)` would yield `ENG` instead of `ENG-10253` and break every ticket link.

   **Title/body alone is not enough** — in practice the ticket id most often lives only in the branch name (`ENG-10256-persist-primary-result`) or a commit subject (`chore: ENG-10253 overflow`), while the PR title is a generic summary. Scanning only title/body silently drops the ticket for the majority of PRs. After collecting per-PR, **dedupe the tags within the repo** — the same ticket may have been referenced by more than one PR; it appears once in that repo's notes. The same ticket appearing in **both** repos (an omni change and a gp-ai-projects change for one feature) is expected — it lists once per repo section.

   Per commit, accumulating tags into the PR keyed by `<pr_number>`:

   ```bash
   cd "$REPO_DIR"
   subj=$(git log -1 --pretty=%s "<commit_hash>")
   gh api repos/{owner}/{repo}/commits/<commit_hash>/pulls | jq -r --arg subj "$subj" '
     (.[0] // empty)
     | ([.title, (.body // ""), (.head.ref // ""), $subj] | join(" ")
        | [scan("(?:ENG|DATA|WEB|CAP|DT)-[0-9]+"; "i")] | map(ascii_upcase) | unique | join(","))'
   ```

9. **Look up each unique ticket tag in ClickUp** to get its title. All prefixes (`ENG`, `DATA`, `WEB`, `CAP`, `DT`) are custom ids in the same workspace, so the same call resolves any of them. Use an absolute path for `scripts/python` because earlier phases `cd`'d into a release repo; a relative `cd scripts/python` would resolve under `$REPO_DIR` and fail:

    ```bash
    cd "$RUNBOOKS_DIR/scripts/python" && uv run clickup_api.py GET task/<TAG> \
      custom_task_ids=true team_id=$CLICKUP_TEAM_ID
    ```

    Extract `name` from the response. If the lookup 404s, keep the tag in the message but mark its title as "(title lookup failed)" and surface in the final report.

10. **Collect fallback items for PRs with no ticket tag.** For each PR (in the repo) that yielded **zero** tags in step 8 (none in title, body, branch, or any commit subject), use the PR title (with the trailing `(#<n>)` stripped if `gh` included it). These appear as untagged bullets under that repo. A PR genuinely without a ticket (a chore/refactor) is a normal case, not an error.

11. **Write a one-paragraph, plain-language summary** of what shipped across **both** repos, to sit at the top of the message above the bullet list. This is the part a non-engineer actually reads — write it in a human voice, not as a list of ticket ids, and not split by repo.

    - **Group by epic/theme, not by ticket, and not by repo.** Use the ClickUp titles from step 9 (and the PR titles) to cluster related work across both repos. When several tickets belong to one initiative, name what the initiative does in one phrase rather than listing each ticket. (Example: instead of listing six mobile bug-fix tickets individually, say "a round of mobile and UI polish across onboarding and the dashboard.")
    - Lead with the largest/most user-visible theme, then the next, then fold the rest into a short "also" clause. Two to four sentences total. The reader does not care which repo a change came from — describe the user-facing effect.
    - Style: plain U.S. English, sentence case, no em dashes, no emoji, no internal jargon or ticket ids in the prose. The bullet list below it carries the ticket-level detail.

    If you can identify the parent Epic for a cluster (the tickets reference one, or the ClickUp titles share an obvious initiative like "Phase 1: Website & Domain"), name that Epic's goal directly.

12. **Format the single combined message** to match the layout used in `$RELEASE_PRODUCT_CHANNEL` — the summary paragraph first, a blank line, then a per-repo bullet list under a `*<repo>*` subheading:

    ```
    The following changes have just been released.

    <one-paragraph plain-language summary from step 11>

    *omni*
      •  ENG-XXXX: <ClickUp title>
      •  ENG-YYYY: <ClickUp title>
      •  <fallback PR title>

    *gp-ai-projects*
      •  DATA-XXXX: <ClickUp title>
      •  <fallback PR title>
    ```

    Ordering:
    - Repos in the order `omni` then `gp-ai-projects` (omit a repo's section if it contributed nothing this run).
    - Within a repo: tagged items in the order their first-referencing PR was merged (oldest first), matching what users saw in the `#devs-only` post; untagged fallback items at the end, also in merge order.
    - If a contributing repo's merge **failed** in step 5 (snapshot valid, merge command failed), append " — not yet live, hold until merged" to its `*<repo>*` subheading so the message can't be read as announcing a release that hasn't landed.

### Phase 7: Print and report

13. **Print the formatted message** between visible delimiters so it's easy to copy:

    ```
    ──────── COPY BELOW INTO #product-releases ────────
    The following changes have just been released.

    <summary paragraph>

    *omni*
      •  ENG-XXXX: ...
    ──────── END ────────
    ```

14. **Final report** — cover both repos:
    - Per repo, if the merge succeeded: Released — the merged `qa → $TIP` PR URL
    - Per repo, if skipped on snapshot mismatch in step 5 (qa moved between confirmation and merge): not released — user should re-run `/release` to review that repo's updated contents
    - Per repo, if there was no pending `qa → $TIP` PR: note it (nothing released for that repo)
    - gp-ai-projects only (step 5b): whether the prod control-plane Terraform was applied (Lambdas updated), reported `No changes` (already current), was skipped (omni / gp-ai-projects didn't merge this run), or failed (prod build not green, plan showed unexpected drift, or apply error). A skip/failure means the control-plane code is **not** live in prod even though the merge landed — flag it so the notes aren't read as fully shipped.
    - Any ticket tags whose ClickUp lookup failed
    - Any PRs that had no ticket tag (listed as fallback items in the message)
    - Any commits with no PR backing them (no `(#<n>)` suffix and `gh api .../commits/<hash>/pulls` returned `[]`) — these appeared as untagged fallback bullets
    - Per repo, if the merge in step 5 failed (not a snapshot-mismatch skip): a clear note, and a suggested manual recovery (e.g., "merge the `qa → $TIP` PR for <repo> from the GitHub UI, then — once the merge succeeds — paste that repo's section of the printed message, since the snapshot was taken before the merge and already includes the release's tickets"). Do NOT paste a repo's section as-is if its merge hasn't actually happened — it would announce unreleased changes (the message flags such sections "not yet live").

## Important Notes

- **Two repos: omni and gp-ai-projects.** Both are `develop → qa → <prod tip>`; omni's prod tip is `master`, gp-ai-projects' is `prod`. Loop Phases 2–4 over both, wait once (Phase 5), build one combined Phase 6 message. The repos are independent — one with no pending release (or a moved snapshot) does not block the other.
- **No state from `/release-prep`.** This command re-derives everything from each open PR + `qa..$TIP` diff. You can run it independently if you opened a `qa → $TIP` PR manually.
- **Snapshot before merge AND before confirmation.** Step 3 must happen before step 4 (confirmation needs the commit list to be informative) and obviously before step 5 (once merged, `qa..$TIP` collapses and the snapshot is lost).
- **Dedupe ticket tags within a repo; expect cross-repo duplicates.** The same ticket often spans more than one PR; list it once per repo. A ticket that touches both repos lists once under each repo section.
- **5-minute wait is fixed, not deploy-aware.** This is intentionally simple — it's a hand-wave for the prod deploy pipelines, not a verification. One wait covers both repos. If a deploy genuinely takes longer or shorter, edit the wait inline or interrupt with Ctrl-C.
- **gp-ai-projects needs a Terraform apply to prod (omni doesn't).** Merging `qa → prod` auto-deploys gp-ai-projects' broker + runner, but its `dispatch`/`scheduler`/`task_reaper` Lambdas are zip-packaged by Terraform — step 5b applies them to `prod` after the build lands, before the deploy wait. omni has no equivalent step. See the `terraform-deploy` skill in the gp-ai-projects repo.
- **Don't commit on the user's behalf.** The merges run through `gh pr merge`.

## Troubleshooting

| Failure | Fix |
|---------|-----|
| `gh pr list --base $TIP --head qa` returns nothing for a repo | Check `git log origin/$TIP..origin/qa` first (step 2). Non-empty → develop→qa already landed but the `qa → $TIP` PR was never opened (a `/release-prep` that ended in `investigate`/budget-timeout, then auto-merged); re-run `/release-prep` to open it. Empty → either `/release-prep` wasn't run for that repo or nothing is pending; skip it — don't construct a PR here. |
| Multiple open `qa → $TIP` PRs in a repo | A previous release was never closed. Ask the user which to merge, or close the stale one manually from the GitHub UI first. |
| Step 5 skips a repo with "`qa` moved between confirmation and merge" | A concurrent `/release-prep` or direct push landed on that repo's `qa` while the user was deliberating on step 4. The skip is intentional — the user authorized a specific commit set, not the new one. Re-run `/release` to surface the updated contents in a fresh confirmation. |
| ClickUp lookup returns 404 for a tag | Same as in `/release-prep`: verify `custom_task_ids=true` and `$CLICKUP_TEAM_ID`. If still 404, list the tag with no title and surface it in the final report. A brand-new prefix needs adding to step 8's regex before it's even scanned. |
| A merge succeeds but the deploy seems stuck | The 5-minute wait is a heuristic, not a verification. Check Vercel / CI / wherever the repo deploys (omni via Vercel + ECS; gp-ai-projects via ECR/ECS); if the deploy fails, the release notes are still accurate (the merge is what releases), just hold the message until ops confirms. |
| User Ctrl-C during the wait | Ask whether to skip the wait and post the message now, or abort entirely. Don't silently continue. |
| `gh pr merge` fails after confirmation for a repo | Don't paste that repo's section — it would announce unreleased changes (the message flags it "not yet live"). Resolve the merge in the GitHub UI; once it lands, the step-3 snapshot is still accurate, so paste that section then. |
| `gh api .../commits/<hash>/pulls` returns `[]` for a commit | No PR was ever opened for that commit (likely a direct push to develop). Step 3's no-PR fallback should have caught this — the entry appears as an untagged fallback bullet in the message and is surfaced in the final report. |

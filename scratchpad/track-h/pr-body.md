The Universal Judge's trigger: three ways to ask "is this branch better, worse
or the same as what it branches from?" for a named agent, and the guards that
make asking safe. [Design doc](https://goodparty.clickup.com/90132012119/v/dc/2ky4jq2q-20493/2ky4jq2q-140793).

`judge.yml` is the reusable half and owns every guard. `judge-request.yml`
(manual dispatch, plus a temporary `pull_request` path) and `judge-comment.yml`
(`/judge` on a PR) decide only *whether* someone may ask and *what* they asked
for, so there is one implementation of the guards rather than three.

## Why this is not just a workflow

A sweep spends real money on the org's Anthropic account: roughly $7 for one
chat agent, roughly $264 for `all`. The difference between those two is one
word in a PR comment. So the file is written as three guards, and most of the
review on it has been about whether each guard does what its comment says.

**Guard 1, the fork check**, runs before any checkout on every path. `omni` is
public and `issue_comment` fires from the default branch with a write token and
the repository's secrets, so a fork PR would mean running a stranger's code
with our credentials. `pull_request_target` is deliberately absent everywhere
in the judge.

**Guard 2, concurrency**, is keyed per PR at the *caller* workflow level, which
covers the whole run including the sweep — so a second request really does
cancel a sweep that is already spending, and it is reachable by a request that
spends nothing itself (a bare `/judge`, or a push). The job-level groups inside
`judge.yml` are a second layer for a caller added later that forgets, and the
comment there now says plainly that on their own they cannot cancel a spend:
they are split by job, so a second request's `plan` contends only with another
`plan`. Cancelling is not a refund either, and the comment says so.

The security pass found that this guard had turned into a weapon — see below.

**Guard 3, the estimate**, prices the plan per agent and posts it before the
sweep job is eligible to start.

## What the two review passes found, and what changed

**The member gate was an association check, not a permission check.** This is
the one that mattered. `author_association` in `[OWNER, MEMBER, COLLABORATOR]`
was described in the file as "the same set that can push to this repository".
It is not: GitHub defines `MEMBER` as "member of the organization that owns the
repository" and `COLLABORATOR` as "has been invited to collaborate", and
neither implies any permission level. The gate admitted any `thegoodparty`
member with no access to omni at all, and any outside collaborator at read or
triage — either of whom could comment `/judge all --live` on a same-repo PR and
spend ~$264, repeatably across open PRs because concurrency is per PR.

The association check stays as a free pre-filter that drops the whole internet
before a runner is assigned, and the false claim about it is gone. The decision
now comes from `repos/:repo/collaborators/:user/permission`, in the `parse`
job — no checkout, no secrets, and the narrowest token in the file. `admin`,
`maintain` and `write` pass; `read`, `triage` and no access at all do not. A
lookup that errors *denies*, because the honest reading of an unanswerable
permission check is "unknown", and unknown must not spend. Every denial is a
green step with a notice, not a red X.

One thing to know about that lookup: the REST docs list
`repos/:repo/collaborators/:user/permission` under **Metadata (read)**, which
comes along with any grant, so the `parse` job's `contents: read` should cover
it — but GitHub does not document whether `permissions: {}` keeps metadata, and
this is not a guard to leave resting on an inference. So it fails closed, the
`gh` HTTP status lands in the run log, and the notice says which line to widen
if it ever 403s for someone who really can push. The failure mode is "nobody
can start a sweep and the log says why", not "anybody can".

**The same flaw exists in the POC PR #2139.** Not fixed there — noting it so
its gate does not get copied forward.

**The estimate could under-report the bill it exists to prevent.** Pricing
re-parsed the CLI's human-readable plan with a regex; any row that did not
match was dropped from the total while the sweep still ran that agent, and the
only thing catching a typo was a `grep` for the CLI's prose. Both now read the
contract instead:

- the CLI's **exit code** decides whether the request was valid (it exits 1 on
  an id that is not in the registry);
- the priced row count is checked against the count in the plan's own header,
  so a format drift **refuses to report a total** rather than reporting a short
  one. The previous check only caught the case where *every* row failed to
  parse.

**An entry with no case list is listed but neither priced nor swept.** Every
registry entry currently has `cases: null`, which renders `NO CASE LIST YET`.
Pricing those at the full per-agent rate would put a number on a PR for work
that cannot happen — an agent with no case list has no inputs to compare. They
appear in the table as `none yet` / `not priced` so the gap stays visible, and
they are dropped from the list handed to the sweep. This resolves itself as the
case lists land; until then the sweep job cannot run, which is the correct
answer today.

**Two things failed red for doing nothing wrong.** A red X on a blameless PR
reads as "the judge is broken" and costs someone an afternoon — the file's own
stated principle, which it was violating twice:

- `/judge briefing_annotation`, the one blocked agent in the registry, produced
  a plan with zero rows and hit a `exit 1`. The CLI exits **0** for it,
  precisely because nothing about that request is wrong. It now skips with a
  notice and an empty `agents` output. The distinction that matters is kept:
  output the step cannot parse *at all* is still a failure.
- A malformed `/judge` from a member — `/judge --all`, a trailing comma — wrote
  `requested=false` and then `exit 1`, which is self-contradictory. It now
  declines, writes the usage line to the step summary, and exits 0. The
  rejected text no longer goes into the `::error::` annotation, since on this
  event it is attacker-controlled and a workflow command is line-oriented.

**`inputs.dry_run == false` read empty as "go live".** GitHub's `==` coerces to
numbers, so `'' == false` and `null == false` are both true. There was no live
exploit (the input was `type: boolean` with `default: true`) but the next caller
inherited the trap. The switch is now affirmative on every path — `live`,
default `false`, gated `inputs.live == true` — so an empty, null or garbled
value reads as "plan" and the failure mode is a sweep that did not happen.

**The `auto` path bypassed the agent-id validation.** The explicit path
validated against a regex; `auto` derived ids from `gh pr diff --name-only` and
wrote them straight to an output, then into a backtick span in a bot-authored
comment and into `--agents=`. A directory under
`packages/runbooks/experiments` with a backtick in its name would break out of
that span. It gets the same regex now, and the rejected value is not echoed.

**`sweep` inherited `pull-requests: write` it never uses.** Permissions are
workflow-level, which is how a job ends up holding what it never asked for —
and this is the job that runs the branch's own code with `ANTHROPIC_API_KEY`
and the Databricks credentials. It is now `contents: read` at the job. `plan`
states its own (`contents: read`, `pull-requests: write`, for the comment), and
`parse` in the comment workflow is `contents: read` only.

**Untrusted program stdout went verbatim into a public PR comment.** Three
backticks in the CLI's output would close the fence and let everything after it
render as markdown or HTML under the bot's name — and registry strings flow
through that output (`blockedReason` is free-form prose). The plan is now
fenced with seven backticks, every run of three or more inside is replaced, and
the whole thing is capped. For the sweep, the raw stdout is out of the summary
entirely: the verdict belongs to the report track, which writes it from the
judge's own records, and the trigger only owes a link to the run.

**Smaller:** `!cancelled() && needs.plan.result == 'success'` was exactly
`success()` with one `needs`, and its comment claimed a UI distinction that does
not exist — both gone. `plan.outputs.estimate_usd` was declared and never read;
the sweep summary reads it now. The estimate table's `cases` column is headed
`case list`, because it renders a filename and not a count. The sweep fails on
its first step when `ANTHROPIC_API_KEY` is absent, rather than minutes in and
several frames deep inside the SDK. `runner.temp` and `$RUNNER_TEMP` no longer
name the same path two ways — the estimate step publishes it as an output, once,
after the file exists.

## What the security re-review then found

Re-running the security check on the hardened files turned up one more real
escalation, in the concurrency block I had just adopted.

**Anyone on GitHub could cancel an in-flight paid sweep.** A workflow-level
concurrency group is evaluated when the run is *created*, which happens for
every `issue_comment: created` in the repository. The authorisation gate is a
job-level `if:`, evaluated later, when the job is about to start. So with the
group keyed only on the PR number, any account at all — no access, nothing
resembling `/judge` in the body, a bare "lgtm" — created a run that joined
`universal-judge-pr-<n>`, `cancel-in-progress` killed the live sweep mid-flight,
and then the run skipped green. Up to ~$264 of spend destroyed by a stranger,
repeatable at will, with no verdict to show for it. It also inverted the
guarantee the file claims for itself: the cross-request cancellation that makes
Guard 2 worth having was reachable by the whole internet rather than by a second
authorised request.

The group now carries the gate. A comment that is not a plausible request is
keyed on its own `run_id`, where it matches nothing and cancels nothing. The
real push-permission check cannot run at this layer — it needs a runner — so the
key rests on the association pre-filter plus the `/judge` prefix. The residual
is that an org member at read level can cancel a sweep, which is a far smaller
set than everyone, and no part of that set can *start* one.

**The `cases` column was the one unescaped value in the comment.** The row regex
constrains the agent id and the shape with capture groups, but `cases` is
`(.*)` — arbitrary CLI stdout — and the table is concatenated into the comment
*outside* the fence, where it renders as markdown under the bot's name. Now
escaped for the table delimiter, stripped of backticks and wrapped in a code
span, and capped. Not a live exploit (the string comes from our own registry and
GitHub sanitises comment HTML), but it was the exact hole the fence below it was
already closing.

**The comment upsert matched the marker regardless of author.** Anyone can post
`<!-- universal-judge-plan -->` on a public PR, and this job's token can edit any
user's comment — so the bot would have adopted a stranger's comment and kept
rewriting it. Now author first, marker second. `pr-preview-comment.yml` has the
same gap and is deliberately not touched here; worth a follow-up.

**Smaller, all accepted:** `deny()` now scrubs newlines the way `judge.yml`'s
`skip()` does, and tells a 404 ("not a collaborator") apart from any other
failure ("the lookup broke, and if this is happening to everyone it is the
token, not your access") — because omni is public, a total stranger comes back
`200 read` rather than 404, so the old single message would have misattributed a
token problem to everyone's access. `requested_by` is a `workflow_call` input
and is now validated as a GitHub login before the bot signs a comment with it.
The agent selector is length-bounded as well as shaped. `judge-request.yml`'s
concurrency group gained the `run_id` fallback its siblings document, so an empty
dispatched `pr_number` cannot collapse every dispatch into one shared group.

The review also confirmed, specifically, that the permission lookup's grant is
sufficient by the documented contract and that every one of its failure paths
denies; that the affirmative `live` boolean fails closed for empty, null and
garbled values under GitHub's numeric coercion; that no `${{ }}` appears inside
any `run:` body in any of the three files; and that no job holds more token scope
than it uses.

## What the code re-review found

One more thing that would have gone red after promising to spend, and a rule I
had written down backwards.

**The sweep invokes the CLI without `--dry-run`, which the skeleton rejects.**
`run()` throws `only --dry-run is implemented` for any argv lacking that flag
and the entry point turns it into exit 1. The comment beside the invocation
excused this as "the CLI skeleton ignores flags it does not know" — true of
*extra* flags, not of the *missing* one. Unreachable today only because no agent
has a case list; reachable the moment the first one lands, which is before the
runner track is due. At that point a `--live` request would post "**This is a
live sweep.** It starts now", pay for a checkout and a full workspace build, and
then go red — with the comment still claiming a sweep had started.

So the `cli` step now also reports whether the CLI can sweep at all, read out of
the source (the only other way to ask is to run it without `--dry-run`, which is
exactly what must not happen speculatively). The sweep job is gated on it, and
the verdict says "asked for a live sweep, and this branch cannot run one —
nothing will be spent" instead of promising one. The probe disappears when the
runner lands, along with the string it looks for.

**I had GitHub's `if:`/`success()` rule inverted, in two comments.** They said
"an explicit `if:` replaces the implicit `success()`". The documented rule is the
reverse: the default `success()` check applies *unless* the condition contains a
status function. So `needs.plan.result == 'success'` is redundant rather than
load-bearing — it was only doing work in the parent commit, which carried
`!cancelled()`. The inconsistency was the real tell: three steps in `plan` carry
bare `if:`s, and if my comment had been right they would have run after a failed
checkout, with `estimate` calling `npx tsx` into a tree with no `node_modules`.
The comments now state the rule correctly and say the explicit check is kept for
a reader, not because it holds anything up.

**The estimate's `agents` row named a wider set than the sweep would run.** The
row prints the selection; the sweep runs the priced subset, and the sweep's own
summary prints that subset — so "agents" named two different sets in two
summaries of one run. A `to sweep` row is now added whenever the two differ. The
table exists to make an accidental `all` visible; a row naming a wider list than
the run will use is the same failure pointing the other way.

**A fork PR could reach the reusable workflow, where the fork gate would never
run.** `pull_request` fires for forks, which caps the token read-only, and a
called workflow whose job requests `pull-requests: write` fails run setup before
any job starts. The considered green skip in `judge.yml` would have shown up as
an unexplained red X on an outside contributor's PR. The caller now declines the
fork case itself, comparing `head.repo.full_name` against `github.repository`;
`judge.yml`'s gate stays as the one covering the comment and dispatch paths,
where the token is not capped.

**`auto` was resolved after a workspace build it does not need.** The `select`
step uses `gh pr diff` and nothing else — no tree, no node — but sat after the
checkout and `setup-node-workspace`. On the judge's own build tracks the common
case is a PR touching no agent code, so every push paid `npm ci`, contracts,
nest-common, prisma generate and route-types to discover an empty list. `select`
now runs first and the build steps are gated on it finding something.

**Smaller:** `/judge` followed by a tab was silently not a request — no notice,
no summary, nothing in the log, which is the one failure mode this file
otherwise always explains. Tabs are normalised before the dispatch check.
`--live --live` shares a separator, so the single non-overlapping `sed` pass left
a stray `--live` that the allowlist then declined; the strip is looped. And the
two concurrency comments claimed the key formula was "identical" in the sibling
file, which it is not and now cannot be — so both state the invariant a new
caller has to preserve (resolve to `universal-judge-pr-<n>`) rather than a
textual identity no reader would re-derive.

## Three design points, stated plainly rather than implied

**The estimate is not an approval gate, and this PR does not claim it is.**
Splitting `plan` and `sweep` into two jobs guarantees the number is *posted*
before anything is spent. It does not guarantee anyone read it: on a `--live`
request both jobs are in the same run, so the estimate lands on the PR seconds
before the spend starts. The intended claim is **visibility**, and the comment
on Guard 3 now says exactly that.

If a human gate is wanted instead, the mechanism is `environment:` with required
reviewers on the `sweep` job — GitHub will hold the job until someone approves.
Nothing in this repository uses that yet (`verify-vercel-registrar-token.yml`
has a dispatch *input* named `environment`, which is a different thing), so
adopting it is a decision, not a copy. Worth taking before `all` is ever run
live.

**There is no cap on concurrent spend across PRs.** Concurrency is keyed per
PR, deliberately, so ten people running `/judge all --live` on ten different
PRs is ten sweeps with every guard satisfied — roughly $2,600. Every guard here
bounds *one* request; none bounds the fleet. Naming it rather than leaving it
implied: if that number is unacceptable, the bound has to be a repository-wide
concurrency group (which serialises sweeps and makes them slow) or a spend
ceiling outside GitHub.

**The `pull_request: branches: [universal-judge]` trigger comes off when the
integration branch merges.** It exists only so the guards, the ref resolution
and the estimate are exercised on real PRs while `issue_comment` and
`workflow_dispatch` cannot fire — GitHub only serves those from the default
branch. Tracked as a follow-up, not left as a comment to be noticed later.

## How this was verified, given the CLI is not here

`actionlint` 1.7.12 is clean on all three files. Since no `shellcheck` was
available, every `run:` block was extracted from the YAML programmatically and
`bash -n`'d (10 blocks), and the two that carry the logic were then executed
against the **real** wave-0 CLI in its worktree through an `npx` shim, plus
fixtures for the states the current registry cannot produce.

Confirmed by running it: a blocked-only agent skips green; an unknown id exits 1
off the exit code; a plan with case lists prices at exactly $7 + $35 + $13; a
header/row-count mismatch and a missing header both refuse to report a total;
`all` prices 20 rows with no drift; the real CLI is detected as plan-only and a
source without the skeleton string as sweep-capable. On the hostile side: a
`cases` value carrying `| evil | [click](…) <img onerror=…>` comes out with its
pipes escaped and backticks stripped inside a code span, so the table holds and
the payload is inert text; three-backtick runs in the plan are neutralised inside
a seven-backtick fence; a `requested_by` containing a newline and a forged
`## Approved by security` heading is rejected and credits nobody; `/judge
$(whoami)`, backticks and `all;rm -rf /` are all declined; a backtick in an
experiment directory name is rejected before it reaches an output; and the
permission gate denies at `read`, `triage`, none, 404 and 403, every one of them
green.

## What still cannot be exercised here

The CLI this shells out to lands in #2198 (`judge-wave0`) and is not on
`universal-judge` yet, so the `plan` job cannot run end to end on this branch.
The estimate step is written against that contract and verified against the real
CLI in that worktree: plan on stdout, first line `Universal Judge — plan (N
agents)`, rows `  <id>  [chat|background]  cases: <value>`, exit 0 for a valid
request including a blocked-only one, exit 1 for an unknown id. The temporary
"Check the judge CLI is on this branch" step warns instead of failing until then,
and it is marked for removal once #2198 merges — a check that cannot fire is a
check that hides the case it was written for.

`issue_comment` and `workflow_dispatch` also cannot fire until these files are on
`main`, which is a GitHub constraint and not something to work around.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

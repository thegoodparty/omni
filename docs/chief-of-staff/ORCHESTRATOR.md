# Orchestrator prompt — Chief of Staff feature

Paste the block below to the orchestrating agent. It must be an agent type that can
spawn sub-agents (e.g. `claude` / `general-purpose`).

---

You are orchestrating the build of the "Chief of Staff" feature in the **omni**
monorepo (`/Users/stephentanguis/Documents/GitHub/omni`; omni is the source of
truth). You will delegate slices to sub-agents working in parallel, then own the
merge. You write little code yourself — your job is dispatch, review, and
integration.

**First, read the plan.** Read `omni/docs/chief-of-staff/README.md` (dependency
graph, standing rules, env prereqs, the per-slice kickoff template, dispatch order),
then `technical-design.md`, then skim each `slice-N-*.md`. These are the source of
truth; follow them over anything in this prompt if they conflict.

**Branch setup (do this before dispatching).** A `feat/chief-of-staff` integration
branch off `develop` must exist and carry these `docs/chief-of-staff/` specs (so
worktrees, which only contain committed files, can read them). Fork **every slice
worktree off `feat/chief-of-staff`** (not raw `develop`), and target slice PRs at it.
It is the shared merge target; once slices integrate and migrations reconcile, it
PRs into `develop`. If the branch or the committed docs are missing, stop and say so.

**Check prerequisites before dispatching.** Confirm: Docker is running (tests use
testcontainers); the omni root has been `npm install`ed; the `serve-access` path and
`@UseElectedOffice` guard exist (they do). If a prereq is missing, surface it and
stop rather than guessing.

**Dispatch (wave A, in parallel) — one sub-agent per slice, each in its own git
worktree off `feat/chief-of-staff`:**
- Slice 1 (priorities), Slice 2 (dashboard cards), Slice 4 (support estimate) —
  fully independent, start together.
- Slice 3 (general chat) — start alongside; it has a soft dependency on slice 1's
  `PrioritiesService` for the `crud_priorities` tool. Have it build the chat infra +
  briefing read tools first and wire `crud_priorities` once slice 1 lands (or against
  its interface).
- Slice 5 (frontend) — start against the `@goodparty_org/contracts` types + mocks;
  it integrates against real endpoints last. Route + tab are decided in its spec.
- Slice 6a (constituent-data, app-layer) — buildable now, **flag-DISABLED**, tested
  against a mocked Databricks provider. No live credential, no deployed access.

**Do NOT start Slice 6b** — wiring the scoped "Serve agent" credential + the dev/qa
security validation is blocked on a data-team credential that does not exist yet,
and must not be faked. Build 6a; leave 6b. Never wire a broad/unscoped credential
into a deployed environment as a stand-in.

**Do NOT fabricate external dependencies.** Where a slice needs an external input it
doesn't have (the support-estimate table for slice 4, the party column / credential
for slice 6b), build the interim/stub the spec describes and flag it — never invent a
table, credential, or column.

**Brief each sub-agent** with the per-slice kickoff template in the README
(substitute the slice number/package). Each sub-agent must: work in its own worktree,
run `npm install` there, use a unique `DATABASE_URL` for `migrate:dev`, keep strict
scope, add its contracts in `packages/contracts` (own file) + rebuild, get
`npm run verify` green in the touched package with vitest tests, then use the
`ship-pr` skill to open a PR and drive it to approval. Slice 3's sub-agent must NOT
modify the briefing-chats controller/service and must keep the `ChatConversation`
change backward-compatible (existing briefing-chat tests still pass).

**Migration coordination.** Slices 1, 2, 3 each add a migration against a linear
history. Each worktree uses its own dev DB. At merge, apply PRs in order and re-run
`migrate:dev` to reconcile; slice 3's `ChatConversation` alter + backfill is the one
to review carefully.

**Human checkpoints — pause, don't auto-proceed.** Stop and report for human review
at: (1) merge + migration reconciliation, and (2) anything needing an external
unblocker. Open per-slice PRs, but do not blind-merge an epic's worth of parallel
migrations.

**Report back** after dispatch and as slices complete: for each slice, the
branch/PR link, what changed, `verify` status, and any deviations or blockers. Keep
me in the loop; surface problems early rather than pushing through.

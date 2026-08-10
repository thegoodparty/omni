# Automated prod promotion, single-trunk

> **Superseded (2026-08-10).** This is the original design for the standalone
> `promote.yml` gate. That gate starved under merge bursts (it pinned the pushed
> SHA and bailed on supersession, so a validated commit that was no longer the tip
> never promoted), and was replaced by the **release train** (`release.yml`): one
> serialized pipeline that deploys every service to dev, E2Es dev, then promotes
> the same commit to prod, coalescing a burst of merges to the latest commit. This
> document is kept for the decision history; the live reference is
> `docs/deployment.md` § The release train.

Status: superseded by the release train
Decision owner: Swain
Date: 2026-08-03

## Goal

Get to fully automated prod promotion. A merge to `main` that passes its
post-merge checks on dev should reach prod with no human action, on every
service, including the AI services currently living in `gp-ai-projects`.

Today prod releases are manual: a human promotes `develop -> qa -> master`
per the release runbook, and `gp-ai-projects` is promoted separately with its
own branch model and a hand-run Terraform `deploy.sh`. This eliminates both.

Proposed to the team as one effort. Delivered internally as three sequenced
phases so a stall in the hardest phase (the AI-services fold-in) never blocks
automated promotion of the rest of the platform.

## Target end state

Single trunk. One long-lived branch, `main` (renamed from `develop` during team
review). `qa` and `master` branches are gone, along with the `qa` environment
entirely. "What is in prod" stops being a
branch and becomes an outcome of the promotion workflow.

The path from merge to prod:

1. PR merges to `main`. Existing dev CI runs: each package's `Validate`, the
   per-service dev deploys, and the full Playwright `E2E` suite against the real
   dev deploy (this already runs post-merge on `main`, keyed to the commit's
   gp-api deploy, tested through the `dev.goodparty.org` alias).
2. A single new workflow, `promote.yml`, rides the same `push: main` event.
   It waits for that commit's full required-check set to go green, confirms the
   commit is actually serving on dev, then deploys that exact SHA to prod by
   calling the deploy primitives that already exist, with prod inputs.

No `qa`, no `master`, no promotion PR, no release runbook.

### Why the gate is the post-merge dev E2E, not the per-PR E2E

Per-PR previews test each PR in isolation against its own full-stack preview
stack. The merged state on `main` is a combination that no individual preview
run exercised, so PR convergence can introduce bugs that only appear post-merge.
The authoritative promotion gate is therefore the E2E that runs against the
merged `main` state on the dev deploy, which already exists.

Because the E2E already runs on every `main` push, the marginal cost of
promoting on green is near zero. The expensive part (spinning up the suite,
Clerk test users) is already paid by dev CI. That is why continuous,
promote-on-green is correct and batching / scheduled trains were solving a cost
problem that does not exist here.

## Architecture

### The promotion mechanism: one workflow, option A

`promote.yml` is the entire prod mechanism. It is triggered by the same
`push: main` event as the rest of CI (not by `workflow_run` off another
workflow, which disconnects the promotion from the commit and has silent
non-fire failure modes). It also accepts `workflow_dispatch` for manual
promotion with an optional SHA input.

Its jobs:

1. **Freeze check.** Read a repo variable (e.g. `PROMOTION_FROZEN`). If set,
   log a notice and stop. This is the kill switch for babysitting a risky
   change or halting during an incident without reverting the mechanism.
2. **Wait for green.** Poll this commit's required checks until all complete:
   `E2E`, plus every prod-bound service's dev deploy for the SHA. This is the
   existing `e2e-wait` polling pattern generalized from "wait for gp-api deploy"
   to "wait for the full set." Reuse its **superseded detection**: if a newer
   `main` commit has already replaced this one on the dev stack, bail cleanly
   and let the newer commit's promote run handle promotion. Confirm the SHA is
   live on dev via `GET /v1/version` before proceeding.
3. **Deploy to prod.** One small job per service that calls the existing
   composite actions (`pulumi-deploy`, `vercel-deploy`) with prod inputs and the
   promoted SHA. The images were already built and pushed to ECR (SHA-tagged,
   immutable) during the dev deploy, so prod is a redeploy of an existing
   artifact, not a rebuild.

Concurrency: a dedicated group (`promote-prod`, `cancel-in-progress: false`) so
two near-simultaneous promotions coalesce or queue instead of racing to deploy
prod. Combined with "bail if superseded," prod converges to the newest green
SHA.

Identity: authenticate as the existing `omni-automation` GitHub App, the same
identity `dependabot-merge.yml` already uses so its pushes trigger downstream
deploys. `promote.yml` is a generalization of that proven pattern (sweep on an
event, act only when green, act as the app), pointed at a new definition of
green.

### Deploy primitives: reuse composites, no reusable workflows

The deploy logic is already factored into composite actions under
`.github/actions/` (`pulumi-deploy`, `vercel-deploy`, `setup-node-workspace`).
`pulumi-deploy` installs Pulumi and runs an app-provided deploy command; a
backend prod deploy is `checkout(sha)` + `setup-node-workspace` + AWS OIDC +
`pulumi-deploy` with `npm run infra deploy prod`. Five steps.

We do **not** introduce reusable workflows (`workflow_call`). They would wrap
the composites in input-plumbing and wrapper-job ceremony for no benefit in a
repo that prefers WET over DRY. `promote.yml` calls the composites directly with
`env=prod`, exactly as the per-package workflows call them with `env=dev`.

### Net effect on the codebase

This is net-negative YAML. `promote.yml` is a single file (~150 lines). Against
that, removing `qa` and `master` lets us delete those refs from every
`branches:` list and rip out the per-branch env ladders
(`case "$ref" in qa) ... master) ...`) scattered across ~10 workflows, plus
retire the promotion runbook. We remove at least as much as we add and are left
with one branch, one promote file, and unchanged deploy primitives.

### Prod record and access control

We do not keep a `master` branch or a `prod` tag for bookkeeping. The record of
what was promoted is a GitHub Deployment: `promote.yml`'s final job records one
Deployment per successful promotion (environment `production`, at the promoted
SHA) via the API. That deployment history is the queryable "what is in prod" view,
and the daily release summary diffs it to report exactly what shipped.

Access control moves from "branch protection on `master`" to controlling who can
push to `main` and who can trigger the promote workflow (`workflow_dispatch`,
including the `force` break-glass) and toggle the freeze variable.

### Operational properties to accept

- **Promotion is not atomic across services.** If gp-api's prod deploy succeeds
  and election-api's fails mid-run, prod is left mixed (new gp-api, old
  election-api) until the next promotion or a manual re-run. Deploys are
  idempotent per SHA, so retry is safe, and expand/contract contract discipline
  keeps a mixed window serving. The promote run fails loudly and alerts.
- **Fully unattended, all hours.** With no `master` buffer, the dev gate is the
  only thing between a merge and prod, at 2am and on weekends. This raises the
  stakes on gate quality and on the discipline below.
- **`main` is always releasable, non-negotiable.** Incomplete work rides
  behind feature flags. This was implied by continuous promotion; removing
  `master` makes it load-bearing.

## Non-goals and consciously accepted risks

- **Migration backward-compatibility is NOT enforced in v1.** Forward-only plus
  no rollback plus migrate-on-deploy means a bad migration can leave prod on a
  schema the serving code cannot handle, and ECS image rollback does not revert
  a schema change. The correct fix is a hard expand/contract rule with
  enforcement. Swain has consciously chosen to defer this and ship the
  automation first. Documented here so it is a decision, not an oversight.
- **Rollback stays forward-only.** ECS deployment circuit breaker auto-reverts a
  crash-on-boot image. Anything that boots but misbehaves is fixed forward. No
  manual rollback path is built.
- **No unifying `gp-ai` onto Pulumi.** Its Terraform stays Terraform (see
  Phase 3). Converting IaC tools is out of scope.
- **The release-notes Slack post is not automated here.** The manual release
  flow posts a `#product-releases` summary of what shipped; automated promotion
  removes that human step, so a daily automation that posts the prod release
  summary to `#product-releases` is a deferred follow-up.

## Phases

### Phase 1: remove qa, collapse to single env-branch model

Make "promote" mean one hop before automating it.

- Strip `qa` from every workflow (`branches:` lists, `branches-ignore`, env
  ladders). Delete the `qa` branch.
- Tear down the qa environment: qa ECS services / Pulumi stacks, `qa.goodparty.org`
  Vercel aliases, qa Aurora, qa secrets (`GP_API_QA`, election-api qa), DNS.
  This is real infra teardown, not just YAML. Sequence: stop deploying to qa,
  verify nothing depends on it, `pulumi destroy` the qa stacks, remove secrets
  and DNS.

  **Done 2026-08-04.** Both omni Pulumi stacks (`gp-api-qa`, `election-api-qa`)
  and all ten gp-ai-projects qa Terraform roots were destroyed, along with the
  qa Vercel domains/env vars, DNS, ACM certs, and secrets. Two ordering
  constraints worth remembering if this is ever repeated: security-group
  cross-references, not `terraform_remote_state` reads, dictate teardown order
  (`broker` must precede `pmf-engine-control-plane`), and
  `pmf-engine-control-plane` looks up gp-api's `qa-Queue.fifo` **by name**, so
  destroying the gp-api stack first breaks its plan.

- Retire the `develop -> qa -> master` release runbook.
- Leave `master` in place for now; prod still deploys from `master` until
  Phase 2 cuts over. This keeps Phase 1 low-risk and independently shippable.

### Phase 2: the TS promotion train, remove master

Build `promote.yml` for the TypeScript services and cut prod over to it.

- Add `promote.yml` as specified above, covering the services that currently
  deploy to prod: gp-api, election-api, gp-webapp, candidate-sites (confirm
  gp-admin's env model, which is Clerk-org-switch based, during planning).
  Single-environment sites that already deploy only from `main` (styleguide,
  prototypes) do not participate in promotion.
- Move each service's prod deploy trigger off `push: master` and onto being
  invoked by `promote.yml` with the promoted SHA.
- Add the freeze variable and wire the check.
- Cut over, verify a real merge auto-promotes end to end, then delete the
  `master` branch and update branch protection so `main` is the protected
  trunk.

### Phase 3: fold gp-ai-projects into omni

Move the AI services in and extend the train to them.

- Relocate `gp-ai-projects` to `packages/gp-ai` as a uv-managed Python subtree,
  following the existing precedent of `packages/runbooks/scripts/python` (uv
  owns that subtree, npm owns the rest of the workspace). Bring the frozen
  contracts and the per-service Docker builds (broker, pmf_engine,
  campaign_plan, ddhq-matcher, engineer-agent, serve-analyze, clickup-bot).
- Migrate its branch model onto the single trunk: it currently uses
  `develop / qa / prod`; it loses `qa` (Phase 1 global) and `prod` in favor of
  the promote mechanism.
- Automate its Terraform. Today `infrastructure/deploy.sh` is run by hand. Add
  `terraform plan` on PRs touching `packages/gp-ai/infrastructure` (posted to
  the PR), `terraform apply` for dev on merge to `main`, and `terraform
apply` for prod inside `promote.yml`. Apply automation needs guardrails: plan
  visible on the PR, apply gated on merge, and destroy operations never
  automatic.
- Extend `promote.yml` to deploy the gp-ai services' prod images and run the
  prod Terraform apply for the promoted SHA.
- **Open question for planning:** the gp-ai services do not have a Playwright
  E2E equivalent, so their definition of "green on dev" for the promotion gate
  is different (build + dev deploy succeeded, possibly plus an eval gate). Nail
  this down in the Phase 3 plan.

## Success criteria

- A merge to `main` that passes dev checks results in an automatic prod
  deploy of the affected services with no human action.
- Exactly one long-lived branch (`main`); no `qa` or `master`; no qa env.
- gp-ai services deploy automatically (code and Terraform), dev on merge, prod
  via promotion, from within omni.
- The freeze switch halts promotion; `workflow_dispatch` performs a manual
  promotion.

## Open questions to resolve in planning

1. The exact required-check set `promote.yml` gates on per phase.
2. gp-admin's environment model and whether/how it is promoted.
3. gp-ai services' "green on dev" gate definition (Phase 3).
4. Where and when prod migrations run today in gp-api and election-api
   (informational, since enforcement is deferred).
5. Who may dispatch/freeze promotion.

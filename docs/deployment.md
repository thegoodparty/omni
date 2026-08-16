# Deployment and CI

## Branch -> environment model

Single trunk. One long-lived branch, `main` (the default branch).

| Branch | Environment | Notes                                                      |
| ------ | ----------- | ---------------------------------------------------------- |
| `main` | dev         | Every PR targets it; each push deploys dev and runs CI     |
| `main` | prod        | Same commit, promoted to prod automatically once dev green |

All PRs open against `main`. A push to `main` deploys the dev environment and runs
full CI (including the post-merge Playwright E2E against the dev deploy). Prod is
never pushed to directly; it is reached only by automated promotion of the same
commit once its dev checks pass. See [The release train](#the-release-train-releaseyml)
below. There is no `qa` or `master` branch and no manual promotion PR.

### Concurrency: never `cancel-in-progress: true`

Every workflow's concurrency group uses `cancel-in-progress: false`. Canceling a
started run can kill `pulumi up` mid-deploy, which orphans the stack's S3 state
lock and permanently fails every later deploy of that stack until someone runs
`pulumi cancel` by hand. Queued (not yet started) runs are still superseded by
newer ones within a concurrency group, so rapid pushes don't pile up — the
trade-off is only that an in-flight stale run finishes before the newest one
starts.

### Serialize deploys, not checks

The per-service **check** workflows are scoped **per PR only**. On `main` they key
off `github.run_id`, which is unique per run, so pushes to `main` never share a
group at workflow level. Lint, typecheck, and tests share nothing across commits,
so a workflow-level group on `main` bought no safety and cost real time: a second
merge sat fully idle — no checkout, no jobs — until the first commit's entire run
finished, then paid its own full cycle (~20 min, observed 2026-08-05). So checks
run per-commit, unqueued.

The **deploys** serialize, but in one place: the release train
([below](#the-release-train-releaseyml)). Its `release-train` concurrency group
runs one train at a time, so all the shared-state deploys (ECR tags, Pulumi
stacks, ECS services, Vercel aliases) happen inside a single serialized run
rather than in per-service deploy jobs racing each other. Coalescing is intentional
and lives there too: when commits land close together, the train finishes the one
in flight and then jumps to the newest queued commit (`main` is linear, so the
older commit's code is already in the newer tree).

## Frontends (Vercel)

gp-webapp, gp-admin, and candidate-sites deploy to Vercel imperatively via the
Vercel CLI (no git integration), driven by GitHub Actions and the shared
`.github/actions/vercel-deploy` composite action.

- Each app is its own Vercel project; the build uses `rootDirectory=packages/<app>`.
- The dev deploy (the train's dev stage on push to `main`) hits Vercel's
  **preview** target with environment-scoped env vars, then aliases the result to
  `dev.goodparty.org`.
- PR previews get a **deterministic alias** (e.g. `gp-ui-pr-123-...vercel.app`) so
  the URL is predictable per PR. These run in the per-service workflow on
  `pull_request`, not in the train.
- The prod deploy runs the same way but targets the production target; it is the
  train's prod stage for the same commit (see below), not a push to a prod branch.
- The **Storybook styleguide** (`packages/gp-webapp/styleguide`) is its own Vercel
  project (`VERCEL_PROJECT_ID_STYLEGUIDE`), served at `style.goodparty.org`. The
  train's `dev-styleguide` job deploys it on merges to `main` only
  (single-environment site): `vercel build` runs the project's configured
  `build-storybook` (`rootDirectory=packages/gp-webapp`,
  `outputDirectory=storybook-static`) on the runner, then deploys `--prebuilt` to
  the project's **production** target, which Vercel serves at its production
  domain. The project has no Git integration — CLI-only, like the others.
- The **prototypes app** (`packages/prototypes`) is its own Vercel project
  (`VERCEL_PROJECT_ID_PROTOTYPES`, `rootDirectory=packages/prototypes`), served at
  `prototypes.goodparty.org`. It is a single-environment, fully public Next.js app
  with no backend coupling (no gp-api, no election-api, no e2e). On merges to
  `main` the train's `dev-prototypes` job deploys it to the **production** target
  (single-environment); on PRs `prototypes.yml` deploys a preview with a
  deterministic alias (`prototypes-pr-<N>-good-party.vercel.app`). Both are guarded
  by `vars.VERCEL_PROJECT_ID_PROTOTYPES != ''` and no-op until that variable is set.

  **Manual prerequisites (one-time setup):**
  1. Create the Vercel project with `rootDirectory=packages/prototypes`.
  2. Set the `VERCEL_PROJECT_ID_PROTOTYPES` Actions variable in the repo (Settings
     → Secrets and variables → Actions → Variables).
  3. Add the `prototypes.goodparty.org` domain to the Vercel project and point the
     DNS record at Vercel.
  4. Confirm that deployment protection is OFF so the site is fully public.

- The build step runs with `NODE_OPTIONS: --max-old-space-size=6144`: `next
build` peaks near Node's default ~4GB heap and started OOMing intermittently
  on the runners (2026-06-12). The cap is per process and propagates to every
  worker the build spawns, so raise it cautiously — several workers at a
  bigger cap can trip the kernel OOM killer instead.
- A single workflow (`pr-preview-comment.yml`) upserts **one** unified preview
  comment on the PR listing every app; every app's deploy job runs on every PR,
  so all the URLs resolve.

### Full-stack PR previews (gp-webapp <-> gp-api)

CI workflows have no path filters: every PR runs every package's validate job,
gp-api deploys a per-PR preview stack, gp-webapp deploys a per-PR preview, and
the Playwright e2e always runs against that full-stack pair — so the e2e always
exercises the exact full-stack version proposed in the PR.

- `NEXT_PUBLIC_API_BASE` is baked at build time, so the deploy job overrides it
  (via the `api-base` input on `vercel-deploy`) to the deterministic per-PR backend
  `https://pr-<N>.preview.goodparty.org` on every PR.
- Coordinating the two independent workflows: a dedicated `e2e-wait` gate job
  polls gp-api's existing Deploy job (via the Actions API, scoped to the gp-api
  run for this commit) and waits for it to finish, proceeding on success and
  failing fast otherwise. This beats a blind timer, since gp-api's
  validate+build+ECS path is much slower than the webapp deploy. pulumi waits for
  ECS steady state, so a successful Deploy job means the new tasks are serving.
  The gp-api run is keyed to the source commit (PR head, or the pushed commit),
  which on a PR differs from `github.sha` (the merge commit) that the image is
  tagged with. The gate is a separate job so the parallel test shards don't each
  repeat the multi-minute poll.
- gp-api also exposes its deployed commit at `GET /v1/version` (`{ commit }`), set
  from the `GIT_SHA` build arg. After the status clears, `e2e-wait` confirms the
  edge is serving the expected `github.sha` via that endpoint (liveness alone is
  not enough on branch builds, where dev is always up on the prior commit).
- The suite itself is sharded across runners: `e2e-shard` fans the Playwright
  tests over a 4-way matrix (`--shard=n/4 --reporter=blob`), and the `E2E`
  summary job merges the per-shard blob reports into one HTML report +
  `results.json`, publishes to S3, comments on the PR, and is the single required
  status check (red iff any shard failed). `E2E` keeps that exact name because the
  `main` ruleset gates on it. This is the pre-merge E2E against the PR's own
  full-stack preview; after merge the release train runs a second E2E against dev
  before promoting the commit to prod (see below).
- election-api is not part of this yet (the webapp does not call it directly and it
  has no preview stack).

## Backends (Docker + ECR + Pulumi -> ECS Fargate)

gp-api and election-api build a production Docker image, push to ECR
(tagged with the commit SHA), and deploy to ECS Fargate via Pulumi. A push to
`main` runs the release train, whose dev stage deploys the dev environment and
whose prod stage promotes the same image (see below), not a push to a prod branch.
Both stages call the same composite deploy action, only with different env inputs.

people-api's repo package and `.github/workflows/people-api.yml` pipeline were
removed once gp-api absorbed direct people-db access (`packages/gp-api/src/peopleDb/`).
The people-api ECS service and its Aurora cluster remain deployed as a frozen,
manually decommissioned service pending teardown — see
`packages/gp-api/src/peopleDb/AGENTS.md`.

- ECR tags are **immutable**. Deploy jobs check whether the SHA's tag already
  exists and skip the build/push if so — this is what makes re-running a deploy
  job possible after the image was pushed (same SHA, same source, same image).
- Per-PR **preview stacks** are ephemeral; stale ones are cleaned up
  (`gp-api-cleanup-preview.yml`).
- `gp-api-infrastructure-diffs.yml` posts a Pulumi diff on infra-touching PRs.
- CI must run `prisma generate` before the Docker build or the image fails at
  runtime with missing native engines.
- Infra detail and the `npm run infra <diff|deploy> <env>` wrapper:
  `packages/gp-api/deploy/AGENTS.md`.

## The release train (release.yml)

Prod is reached only by the release train, never by a direct push. `release.yml`
rides the `push: main` event and runs one **serialized** pipeline per commit:
deploy every service to dev, run E2E against dev, then promote the same commit to
prod. It is the whole post-merge deploy path — per-service workflows on `main`
run only their checks and image builds; the train owns the shared-env deploys,
the E2E, and the promotion.

Serialization is the point. The `release-train` concurrency group runs one train
at a time (`cancel-in-progress: false`) and GitHub keeps only the latest queued
run, so a burst of merges queues to a single waiting run and the train always
finishes a commit before jumping to the newest waiting one. Because every dev
deploy happens inside one run, `main` cannot move underneath a deploy or the E2E:
one fixed SHA flows dev -> E2E -> prod. That is what removes the deploy/E2E/promote
races the old per-push topology hit under load (a validated commit could be built
and green on dev yet never promoted because it was no longer the tip).

The stages:

1. **`await-checks`.** Waits for this commit's per-service check workflows
   (gp-api, election-api, gp-webapp, gp-admin, candidate-sites,
   publish-experiments, gp-ai) to go green on dev. A red check stops the train
   for that SHA; a later merge forms the next train.
2. **Dev stage.** Deploys every service to dev at the SHA (backends build +
   push the SHA-tagged image then Pulumi/Terraform apply; frontends deploy to
   Vercel and alias `dev.goodparty.org`).
3. **E2E stage.** Confirms `gp-api-dev` is serving the SHA (the serialized deploy
   just put it there and nothing else can move dev mid-run), then runs the
   Playwright suite sharded 4 ways against `dev.goodparty.org`. There is no
   `e2e-wait` poll here — the dev deploys are `needs`, so they are already done.
4. **Prod stage.** Deploys the **same** SHA to prod via the same composite
   actions with prod inputs (same images, prod env). Backends repoint prod at the
   image the dev stage already built; `packages/gp-ai` applies its prod Terraform
   roots pinned to the SHA-tagged images — nothing is rebuilt.
5. **`finalize`.** Records a GitHub **Deployment** (environment `production`) at
   the promoted SHA, once every prod deploy succeeded. That deployment history is
   the source of truth for "what is in prod" and is what the daily release summary
   (`post_release_summary.py`) reads.

### gp-ai specifics

The Python AI services deploy by Terraform apply, not by repointing a service at
an image, so their dev and prod stages look slightly different from the
TypeScript ones:

- **Applies run in parallel, not in dependency order.** The roots read each
  other's `terraform_remote_state` and that graph is _cyclic_
  (`broker` ↔ `pmf-engine-control-plane` ↔ `pmf-engine-fargate`), so no
  topological order exists. Ordering would be false comfort.
- **A convergence pass follows.** Every root is re-planned after the applies and
  must come back clean. That is what catches a stale cross-root read — an apply
  that consumed a value another apply then changed.
- **Deploy verification is a hard gate.** A successful apply does _not_ prove the
  code is running: broker sets `deployment_circuit_breaker { rollback = true }`,
  so a crash-on-boot image is rolled back, the service settles on the _previous_
  revision, and the apply still reports success.
  `ci-verify-deployed.sh` reads the actually-deployed state — broker's `PRIMARY`
  deployment plus `rolloutState == COMPLETED`, and the newest `ACTIVE` revision
  for the RunTask families — and fails the stage if anything is not on the SHA.
- **Image build stays in `gp-ai.yml`.** Its `build` matrix produces the
  SHA-tagged images (a check the train waits on); the train's dev/prod stages
  only apply Terraform pinned to those tags. A `prod-gp-ai-images` guard verifies
  the full five-image set exists before the prod apply and refuses a partial set.
- **Every main commit builds every gp-ai image**, even unchanged services.
  Terraform pins `<service>-<sha>`, so a service without an image at that commit
  would point at a tag that was never pushed. Unchanged services are cache hits.

Details worth knowing:

- **Freeze switch.** `vars.PROMOTION_FROZEN=true` holds prod: the dev stage and
  E2E still run, only the prod stage is skipped. This is also how the train is
  cut over safely — merge with it frozen, watch one full dev + E2E cycle run
  serialized without touching prod, then flip the variable.
- **Manual trigger.** `workflow_dispatch` runs the train on demand; an optional
  `sha` input targets a specific commit.
- **Break glass (`force`).** `workflow_dispatch` with `force=true` skips the
  checks gate, the E2E, **and** the freeze switch, and promotes the target SHA
  straight to prod (loud warning in the run; write access required). Use it when
  the pipeline itself is broken or a hotfix can't wait. It only works if the SHA's
  images were already built — if the dev _build_ failed there is nothing to
  promote, so that case is fix-forward. First resort for a flaky pipeline is to
  re-run the failed check, not force.
- **Forward-only.** There is no manual rollback. A crash-on-boot image is reverted
  automatically by the ECS deployment circuit breaker; to move forward, land a fix
  on `main` and let the next train promote it.

## CI layout

Workflows live in `.github/workflows/`, one per package; every package's
workflow runs on every PR (no path filters, except the infra-diffs workflow).
The primary validate job is named **"Validate"** across all
packages. Shared steps are factored into `.github/actions/` (setup-node-workspace,
vercel-deploy, pulumi-deploy).

### Dependency caching

`setup-node-workspace` caches the root workspace install under a single
app-independent key (`workspace-node-modules-v3-...`). Do not scope that key per
app: `npm ci` at the root installs every workspace, so the tree is identical for
every caller, and the per-app copies we used to write were ~890MB each. GitHub
caps a repo at 10GB and evicts LRU, so nine duplicates plus per-PR scopes kept
the base-branch entries evicted and left most jobs doing a cold 2m install. The
same reasoning applies to the Prisma clients and package `dist/` output the
cache incidentally picks up: the steps that produce them run unconditionally, so
they are never load-bearing on a hit.

`~/.npm` is cached separately, and only saved by a job that actually ran
`npm ci`. Cache keys are immutable, so a job that saves an empty `~/.npm` poisons
that lockfile hash until the lockfile changes.

## Dependency updates (Dependabot)

Policy: **security updates only** — no version-bump PRs. Version updates are
disabled in `.github/dependabot.yml` (`open-pull-requests-limit: 0`); security
PRs are driven by Dependabot alerts (enabled in repo settings) and target
`main` (`--base main`).

Security PRs merge themselves: the `dependabot-merge.yml` workflow sweeps every
30 minutes and squash-merges any Dependabot PR that is approved (delegate
reviews every PR), has all checks green, and whose last commit is at least 24
hours old. A commit pushed by anyone other than Dependabot disqualifies the PR
from auto-merge. Merges authenticate as the `omni-automation` GitHub App
(`AUTOMATION_APP_ID` var + `AUTOMATION_APP_PRIVATE_KEY` secret) so the merge
push triggers the dev deploy workflows like any other merge. Auto-merge stops
at `main`; from there a security fix reaches prod through automated promotion
like any other commit.

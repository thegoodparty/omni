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
- The build step runs with `NODE_OPTIONS: --max-old-space-size=6144`: `next
build` peaks near Node's default ~4GB heap and started OOMing intermittently
  on the runners (2026-06-12). The cap is per process and propagates to every
  worker the build spawns, so raise it cautiously — several workers at a
  bigger cap can trip the kernel OOM killer instead.
- The deploy step runs `vercel deploy --prebuilt --archive=tgz`: Vercel's
  `api-upload-paid` quota counts **uploaded files**, not deploys, and caps the
  account at 40,000 per 24h. A Next.js `.vercel/output` is tens of thousands of
  files (each `.func` bundle carries its own traced `node_modules`), so the
  parallel-agent PR volume exhausted the account-wide quota on 2026-08-25 and
  every preview deploy in the repo failed. `--archive=tgz` uploads the output as
  one compressed file, making each deploy cost ~1 against the quota. It changes
  only the upload transport, so preview and prod both use it.
- The action retries its network-only calls 3 times with backoff: the CLI
  install, `vercel pull`, `vercel deploy` of the prebuilt output, and
  `vercel alias set`. Each is safe to repeat. `vercel build` is not retried:
  it runs locally and fails for code, token or heap reasons.
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
  tests over a 6-way matrix, balanced by duration rather than Playwright's
  count-based `--shard`. Each shard lists the suite and runs the `file:line`
  slice `e2e-tests/scripts/plan-shards.mjs` assigns it from the last run's
  durations, which the `E2E` job records to the Actions cache
  (`e2e-durations-v1-*`; a PR reads its own latest, else main's). The `E2E`
  summary job merges the per-shard blob reports into one HTML report +
  `results.json`, publishes to S3, comments on the PR, and is the single required
  status check (red iff any shard failed). `E2E` keeps that exact name because the
  `main` ruleset gates on it. This is the pre-merge E2E against the PR's own
  full-stack preview; after merge the release train runs a second E2E against dev
  before promoting the commit to prod (see below).

## Backends (Docker + ECR + Pulumi -> ECS Fargate)

gp-api builds a production Docker image, pushes it to ECR
(tagged with the commit SHA), and deploys to ECS Fargate via Pulumi. A push to
`main` runs the release train, whose dev stage deploys the dev environment and
whose prod stage promotes the same image (see below), not a push to a prod branch.
Both stages call the same composite deploy action, only with different env inputs.

- ECR tags are **immutable**. Deploy jobs check whether the SHA's tag already
  exists and skip the build/push if so — this is what makes re-running a deploy
  job possible after the image was pushed (same SHA, same source, same image).
- Per-PR **preview stacks** are ephemeral; stale ones are cleaned up
  (`gp-api-cleanup-preview.yml`). Stale means the PR is closed or has been idle
  for `PREVIEW_IDLE_DAYS` days (repo variable, default 21); pushing a commit to
  an open PR brings its preview back.
- PR preview deploys and their teardown assume `github-actions-preview-deploy`
  (owned by `thegoodparty/ops`, ARN written in both workflows), never the
  admin deploy role. It is trusted by `pull_request` runs only, reaches
  `gp-pr-*`/`pr-*`-named or preview-tagged resources, reads only `GP_API_DEV`,
  and can create a role only with the preview permissions boundary. A preview
  that needs a new kind of AWS resource needs that role widened in ops first.
  The scheduled cleanup runs from `main` and keeps `vars.AWS_ROLE_ARN`.
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

A push that only changes `docs/**` or root-level `*.md` files starts no
release, because it deploys nothing. The next push that changes code releases
everything since the last release. Markdown under `packages/` is not skipped:
runbooks and prompts there are read at runtime.

Serialization is the point. The `release-train` concurrency group runs one train
at a time (`cancel-in-progress: false`) and GitHub keeps only the latest queued
run, so a burst of merges queues to a single waiting run and the train always
finishes a commit before jumping to the newest waiting one. Because every dev
deploy happens inside one run, `main` cannot move underneath a deploy or the E2E:
one fixed SHA flows dev -> E2E -> prod. That is what removes the deploy/E2E/promote
races the old per-push topology hit under load (a validated commit could be built
and green on dev yet never promoted because it was no longer the tip).

Find the phase that died before triaging a red run: a failed `Dev <service>`
job **skips** the E2E shards, so the run's red gate job is named `E2E` even when
nothing e2e-related ran. Cancelled runs are the train coalescing a merge burst,
not failures.

The stages:

1. **`await-checks`.** Waits for this commit's per-service check workflows
   (gp-api, gp-webapp, gp-admin, candidate-sites,
   publish-experiments, gp-ai) to go green on dev. A red check stops the train
   for that SHA; a later merge forms the next train. When `main` has already
   moved past the SHA, the run first waits for the newer commit's runs of the
   red checks. If they all pass there, the run cancels itself instead of
   failing, because the newer commit fixed the problem and a merge burst
   should not raise a false alert. If any fails there too, the run fails.
   The cancel happens before any deploy starts, so it cannot strand a Pulumi
   lock.
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

### Credentials and the `production` environment

A job that runs only from `main` (push, schedule or dispatch) and holds a
credential that can change production declares the `production` GitHub
environment, with `deployment: false` so it stays out of the deployment history
`finalize` writes. Today that is the train's six Vercel deploy jobs (dev and
prod alike, since `VERCEL_TOKEN` can deploy every target), `dependabot-merge.yml`
and `sync.yml`. A secret that only those jobs read can live in the environment
rather than at repo scope, where (once the environment is limited to `main`)
a pull request run cannot read it.

Two things to check before adding the environment to a job. It changes the
job's OIDC subject from `ref:refs/heads/main` to `environment:production`, so
every role or federation policy the job authenticates to must accept that
subject (the judge sweep role and the Databricks federation policy in
`analytics-governance.yml` are pinned to the ref and do not). And a secret the
job reads must not also be read on a pull request, or moving it breaks that run.

PR preview deploys read `VERCEL_PREVIEW_TOKEN`, falling back to `VERCEL_TOKEN`
while the preview token is unset.

### Base images

Every Dockerfile `FROM`, and the buildx builder image, pulls from ECR Public
(`public.ecr.aws/docker/library/<image>:<tag>`), never Docker Hub. Anonymous
pulls from either are limited per IP, and shared GitHub runners kept failing
with `429 Too Many Requests`. Logged-in ECR Public pulls are limited per AWS
account, so every job that builds an image logs in to ECR Public first
(`aws-actions/amazon-ecr-login` with `registry-type: public`). Main runs log
in with `vars.AWS_ROLE_ARN`. On a pull request, a job whose only AWS call is
that login (gp-ai's image build, gp-api's test shards pulling the testcontainers
Postgres image) assumes the read-only plan role (`vars.AWS_PLAN_ROLE_ARN`)
instead, which can mint that login token and nothing more (granted in
`thegoodparty/ops`). Local builds need no login.

A logged-in pull can still fail on the network, so the train retries the pulls
it controls. It pre-pulls the buildx builder image with retries; buildx falls
back to that local copy when its own one-shot pull fails. Pulumi and Terraform applies are never retried: they hold state
locks, and a retry on top of a half-applied run is not idempotent (see
[Concurrency](#concurrency-never-cancel-in-progress-true)).

### Analytics guard

`.github/workflows/analytics-guard.yml` runs `governance_guard.py` (DATA-2432) on every
PR, with no path filter, and posts or updates one PR comment naming the exact fix. The
workflow's top-level `env:` sets `GOVERNANCE_GUARD_MODE` (`block` | `warn` | `off`),
whether a blocking finding fails the check or only warns, and `GOVERNANCE_GUARD_ALERT`,
who gets cc'd in the comment when the guard itself errors. Changing either is a one-line
PR; that PR runs against its own edited workflow, so the guard never blocks the change
that turns it down. The job never fails a
PR for a mechanical reason: a failed uv setup or `uv sync` makes the guard report that it
could not run and skips the runbooks suite with a warning, a comment-posting failure only
warns, and `off` prints a warning and checks nothing. The full report (or the error)
always goes to the job summary too, because the comment is capped at 60,000 characters.
OKR legs come from the vendored sem copy at the PR's merge base, not the PR's own copy. A
stacked PR whose base branch was deleted (because the PR under it merged) is compared
against the base commit GitHub recorded on the PR, fetched by SHA, instead of erroring out
unchecked. The
runbooks suite (only when `packages/runbooks` changed) runs in the same job; its guard
replay tests fail, rather than skip, when the Actions checkout is missing the history
they replay against, since a skipped acceptance test would otherwise read as a pass.

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

`~/.cache/prisma` is cached per Prisma version and generate script, because
`prisma generate` downloads the schemas' musl `binaryTargets` there whenever
the restored `node_modules` lacks them, and a dropped connection mid-download
crashes the CLI. It is saved only when a generate actually put a musl engine in
it, for the same immutable-key reason. Generate itself retries three times with
backoff for the cache-miss path.

## Dependency updates (Dependabot)

Policy for npm: **security updates only** — no version-bump PRs. Version
updates are disabled in `.github/dependabot.yml` (`open-pull-requests-limit:
0`); security PRs are driven by Dependabot alerts (enabled in repo settings) and
target `main` (`--base main`). Docker base images and GitHub Actions do get
version updates; the comments in `.github/dependabot.yml` say why and how.

Every third-party `uses:` is pinned to a full commit SHA with its tag as a
trailing comment (`actions/checkout@<sha> # v5`), so a moved tag cannot change
what CI runs. Pin a new one the same way: resolve the tag with
`gh api repos/<owner>/<repo>/commits/<tag> --jq .sha`. Dependabot's weekly
`github-actions` PR moves the SHA and the comment together. Local `./` actions
are not pinned.

Dependabot PRs merge themselves, whatever the ecosystem: the
`dependabot-merge.yml` workflow sweeps every 30 minutes and squash-merges any
Dependabot PR that is approved (delegate reviews every PR), has all checks
green, and whose last commit is at least 24 hours old. A commit pushed by anyone other than Dependabot disqualifies the PR
from auto-merge. Merges authenticate as the `omni-automation` GitHub App
(`AUTOMATION_APP_ID` var + `AUTOMATION_APP_PRIVATE_KEY` secret) so the merge
push triggers the dev deploy workflows like any other merge. Auto-merge stops
at `main`; from there a security fix reaches prod through automated promotion
like any other commit.

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
commit once its dev checks pass. See [Automated promotion](#automated-promotion-promoteyml)
below. There is no `qa` or `master` branch and no manual promotion PR.

### Concurrency: never `cancel-in-progress: true`

Every workflow's concurrency group uses `cancel-in-progress: false`. Canceling a
started run can kill `pulumi up` mid-deploy, which orphans the stack's S3 state
lock and permanently fails every later deploy of that stack until someone runs
`pulumi cancel` by hand. Queued (not yet started) runs are still superseded by
newer ones within a concurrency group, so rapid pushes don't pile up — the
trade-off is only that an in-flight stale run finishes before the newest one
starts.

## Frontends (Vercel)

gp-webapp, gp-admin, and candidate-sites deploy to Vercel imperatively via the
Vercel CLI (no git integration), driven by GitHub Actions and the shared
`.github/actions/vercel-deploy` composite action.

- Each app is its own Vercel project; the build uses `rootDirectory=packages/<app>`.
- The dev deploy (on push to `main`) hits Vercel's **preview** target with
  environment-scoped env vars, then aliases the result to `dev.goodparty.org`.
- PR previews get a **deterministic alias** (e.g. `gp-ui-pr-123-...vercel.app`) so
  the URL is predictable per PR.
- The prod deploy runs the same way but targets the production target; it is driven
  by automated promotion of the same commit (see below), not a push to a prod branch.
- The **Storybook styleguide** (`packages/gp-webapp/styleguide`) is its own Vercel
  project (`VERCEL_PROJECT_ID_STYLEGUIDE`), served at `style.goodparty.org`. The
  `deploy-styleguide` job in `gp-webapp.yml` deploys it on merges to `main`
  only (single-environment site): `vercel build` runs the project's configured
  `build-storybook` (`rootDirectory=packages/gp-webapp`,
  `outputDirectory=storybook-static`) on the runner, then deploys `--prebuilt` to
  the project's **production** target, which Vercel serves at its production
  domain. The project has no Git integration — CLI-only, like the others.
- The **prototypes app** (`packages/prototypes`) is its own Vercel project
  (`VERCEL_PROJECT_ID_PROTOTYPES`, `rootDirectory=packages/prototypes`), served at
  `prototypes.goodparty.org`. It is a single-environment, fully public Next.js app
  with no backend coupling (no gp-api, no election-api, no e2e). The
  `prototypes.yml` workflow deploys it: on merges to `main` it deploys to the
  **production** target; on PRs it deploys a preview with a deterministic alias
  (`prototypes-pr-<N>-good-party.vercel.app`). The deploy job is guarded by
  `vars.VERCEL_PROJECT_ID_PROTOTYPES != ''` and no-ops until that variable is set.

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
  `main` ruleset gates on it, and automated promotion waits on the same check
  before shipping the commit to prod.
- election-api is not part of this yet (the webapp does not call it directly and it
  has no preview stack).

## Backends (Docker + ECR + Pulumi -> ECS Fargate)

gp-api and election-api build a production Docker image, push to ECR
(tagged with the commit SHA), and deploy to ECS Fargate via Pulumi. A push to
`main` deploys the dev environment; the prod deploy of the same image is driven by
automated promotion (`promote.yml`, see below), not by a push to a prod branch.
Both paths call the same composite deploy action, only with different env inputs.

people-api's repo package and `.github/workflows/people-api.yml` pipeline were
removed once gp-api absorbed direct people-db access (`packages/gp-api/src/peopleDb/`).
The people-api ECS service and its Aurora cluster remain deployed as a frozen,
manually decommissioned service during the `USE_LOCAL_PEOPLE_DB` rollout — see
`packages/gp-api/src/peopleDb/CLAUDE.md`.

- ECR tags are **immutable**. Deploy jobs check whether the SHA's tag already
  exists and skip the build/push if so — this is what makes re-running a deploy
  job possible after the image was pushed (same SHA, same source, same image).
- Per-PR **preview stacks** are ephemeral; stale ones are cleaned up
  (`gp-api-cleanup-preview.yml`).
- `gp-api-infrastructure-diffs.yml` posts a Pulumi diff on infra-touching PRs.
- CI must run `prisma generate` before the Docker build or the image fails at
  runtime with missing native engines.
- Infra detail and the `npm run infra <diff|deploy> <env>` wrapper:
  `packages/gp-api/deploy/CLAUDE.md`.

## Automated promotion (promote.yml)

Prod is reached only by promotion, never by a direct push. The `promote.yml`
workflow rides the `push: main` event and promotes commits that are proven good on
dev:

1. It waits for that commit's full set of required checks (E2E plus every deploy) to
   go green on dev.
2. It confirms the commit is actually serving on dev via `GET /v1/version`
   (`{ commit }`), so promotion follows real deployed state, not just check status.
3. It then deploys the **same** commit to prod by calling the existing composite
   deploy actions with prod inputs (same images, same SHA, prod env).

Details worth knowing:

- **Runs as the `omni-automation` GitHub App** (`AUTOMATION_APP_ID` var +
  `AUTOMATION_APP_PRIVATE_KEY` secret), the same identity Dependabot auto-merge uses.
- **Freeze switch.** A repo variable gates promotion; flip it to hold prod while
  still landing work on `main` and deploying dev.
- **Manual trigger.** `workflow_dispatch` can promote on demand (e.g. after
  unfreezing, or to re-run a promotion).
- **Forward-only.** There is no manual rollback. A crash-on-boot image is reverted
  automatically by the ECS deployment circuit breaker; to move forward, land a fix
  on `main` and let it promote.

## CI layout

Workflows live in `.github/workflows/`, one per package; every package's
workflow runs on every PR (no path filters, except the infra-diffs workflow).
The primary validate job is named **"Validate"** across all
packages. Shared steps are factored into `.github/actions/` (setup-node-workspace,
vercel-deploy, pulumi-deploy).

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

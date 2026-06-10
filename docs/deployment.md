# Deployment and CI

## Branch -> environment model

| Branch    | Environment | Notes                             |
| --------- | ----------- | --------------------------------- |
| `develop` | dev         | Integration branch; PRs target it |
| `qa`      | qa          | people-api has no qa env          |
| `master`  | prod        |                                   |

PRs open against `develop`. Promotion is by merging `develop -> qa -> master`.
PR-triggered workflows (validation and preview deploys) only run on PRs targeting
`develop` — promotion PRs against `qa`/`master` don't re-run PR CI; those branches
are covered by their push-triggered deploys.

## Frontends (Vercel)

gp-webapp, gp-admin, and candidate-sites deploy to Vercel imperatively via the
Vercel CLI (no git integration), driven by GitHub Actions and the shared
`.github/actions/vercel-deploy` composite action.

- Each app is its own Vercel project; the build uses `rootDirectory=packages/<app>`.
- Env deploys (develop/qa) hit Vercel's **preview** target with branch-scoped env
  vars, then alias the result to a stable domain (e.g. `dev.goodparty.org`).
- PR previews get a **deterministic alias** (e.g. `gp-ui-pr-123-...vercel.app`) so
  the URL is predictable per PR.
- `prod` deploys to the production target.
- A single workflow (`pr-preview-comment.yml`) upserts **one** unified preview
  comment on the PR listing every app; a URL only resolves if that app's deploy
  job runs for the PR.

### Full-stack PR previews (gp-webapp <-> gp-api)

When a PR (or a develop push) touches `packages/gp-api` or `packages/contracts`,
the gp-webapp build and its Playwright e2e run against that change's gp-api stack
instead of shared dev, so the e2e exercises the full-stack version proposed in the
PR. The gp-webapp workflow is path-triggered on gp-api/contracts too, and a
`changes` job sets `gp_api`.

- `NEXT_PUBLIC_API_BASE` is baked at build time, so the deploy job overrides it
  (via the `api-base` input on `vercel-deploy`) to the deterministic per-PR backend
  `https://pr-<N>.preview.goodparty.org`. Webapp-only PRs keep the dev default.
- Coordinating the two independent workflows: the e2e job polls gp-api's existing
  Deploy job (via the Actions API, scoped to the gp-api run for this commit) and
  waits for it to finish, proceeding on success and failing fast otherwise. This
  beats a blind timer, since gp-api's validate+build+ECS path is much slower than
  the webapp deploy. pulumi waits for ECS steady state, so a successful Deploy job
  means the new tasks are serving. The gp-api run is keyed to the source commit
  (PR head, or the pushed commit), which on a PR differs from `github.sha` (the
  merge commit) that the image is tagged with.
- gp-api also exposes its deployed commit at `GET /v1/version` (`{ commit }`), set
  from the `GIT_SHA` build arg. After the status clears, the e2e confirms the edge
  is serving the expected `github.sha` via that endpoint (liveness alone is not
  enough on branch builds, where dev is always up on the prior commit).
- election-api is not part of this yet (the webapp does not call it directly and it
  has no preview stack).

## Backends (Docker + ECR + Pulumi -> ECS Fargate)

gp-api, election-api, and people-api build a production Docker image, push to ECR
(tagged with the commit SHA), and deploy to ECS Fargate via Pulumi.

- Per-PR **preview stacks** are ephemeral; stale ones are cleaned up
  (`gp-api-cleanup-preview.yml`).
- `gp-api-infrastructure-diffs.yml` posts a Pulumi diff on infra-touching PRs.
- CI must run `prisma generate` before the Docker build or the image fails at
  runtime with missing native engines.
- Infra detail and the `npm run infra <diff|deploy> <env>` wrapper:
  `packages/gp-api/deploy/CLAUDE.md`.

## CI layout

Workflows live in `.github/workflows/`, one per package, path-filtered so only
affected apps run. The primary validate job is named **"Validate"** across all
packages. Shared steps are factored into `.github/actions/` (setup-node-workspace,
vercel-deploy, pulumi-deploy).

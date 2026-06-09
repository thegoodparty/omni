# Deployment and CI

## Branch -> environment model

| Branch    | Environment | Notes                          |
| --------- | ----------- | ------------------------------ |
| `develop` | dev         | Integration branch; PRs target it |
| `qa`      | qa          | people-api has no qa env       |
| `master`  | prod        |                                |

PRs open against `develop`. Promotion is by merging `develop -> qa -> master`.

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
  comment on the PR covering all affected apps.

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

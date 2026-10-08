# Deploy

Pulumi (TypeScript) infrastructure-as-code, the production Dockerfile, and the `infra-cli.ts` wrapper used by the `npm run infra` commands. Targets these environments: `preview` (per-PR), `dev` (deployed on push to `main`, the single long-lived branch), and `prod`. A push to `main` deploys dev; `prod` is reached only by the release train (`release.yml`) — it deploys the commit to dev, runs the E2E, then promotes the same commit to prod. It is forward-only (ECS circuit breaker auto-reverts a crash-on-boot; there is no manual rollback). There is no manual promotion.

## Key files

| Path                                        | Purpose                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------- |
| `index.ts`                                  | Pulumi program entry — wires VPC, service, asset bucket, Grafana resources           |
| `Pulumi.yaml`                               | Stack metadata (`name: gp-api`, `runtime: nodejs`)                                   |
| `infra-cli.ts`                              | yargs-based CLI wrapping `pulumi`; `npm run infra <diff                              | deploy> <env>` shells out to this |
| `Dockerfile`                                | Production image build (Node 22 Alpine, multi-copy with prebuilt `dist/`)            |
| `docker-entrypoint.sh`                      | Container bootstrap (env validation, migration check, app start; preview also seeds and runs `node dist/content/syncContent.cli.js`) |
| `components/service.ts`                     | ECS Fargate service + ALB target group                                               |
| `components/vpc.ts`                         | VPC selection (existing VPC, hardcoded subnets/SGs)                                  |
| `components/assets-bucket.ts`               | S3 bucket for user uploads                                                           |
| `components/assets-router.ts`               | CloudFront fronting the assets bucket                                                |
| `components/campaign-plan-shares-bucket.ts` | Private bucket for shared campaign-plan PDFs (per env; preview reuses dev)           |
| `components/robocall-audio-bucket.ts`       | Private bucket for recorded robocall audio (per env; preview reuses dev; 90-day object expiry, CORS POST for presigned-POST upload) |
| `components/sitemaps-bucket.ts`             | Public-read `gp-marketing-sitemaps` bucket + the GitHub OIDC role gp-marketing's hourly sitemap workflow publishes with (prod stack only, one global bucket) |
| `components/grafana.ts`                     | Grafana data sources, dashboards, contact points                                     |
| `components/alerting/` + `alerts.ts`        | Grafana alert rules and routing                                                      |
| `pulumi/`                                   | `node_modules` for Pulumi's runtime (separate dependency tree)                       |
| `components/preview-shared-cluster.ts`      | Shared preview Aurora cluster (`gp-api-preview-shared-db`); created by the dev stack |
| `components/preview-shared-alb.ts`          | Shared preview ALB (`gp-api-previews`) + `*.preview.goodparty.org`; created by the dev stack |

## Patterns

- **Environment is a literal union** (`'preview' \| 'dev' \| 'prod'`) narrowed from `pulumi.Config().require('environment')`. The `select<T>(values)` helper in `index.ts` is the canonical way to choose per-env values — use it instead of `if/else` chains.
- **Preview stacks are ephemeral**: `prNumber` is required for `preview`, and stack name is `pr-${prNumber}`. They are torn down two ways: `gp-api-teardown-preview.yml` destroys a PR's stack on `pull_request: closed`, and `gp-api-cleanup-preview.yml` sweeps any dangling ones every 3 hours. `find-stale-preview-stacks.ts` treats a stack as stale when its PR is not open or has had no activity (`updated_at`) for `PREVIEW_IDLE_DAYS` days (repo variable, default 21); the sweep comments on a still-open PR it retires, and the next push recreates the preview. Both share the `destroy-preview-stack` composite action, which runs `pulumi cancel` first — a runner killed mid-deploy leaves a state lock that otherwise makes `pulumi destroy` fail and strands the stack's ALB.
- **Pulumi config secrets** come from SSM via `infra-cli.ts` (`PULUMI_CONFIG_PASSPHRASE`, `GRAFANA_AUTH`, `GRAFANA_SM_ACCESS_TOKEN`). The CLI fetches them per-run; nothing is committed.
- **App secrets are enumerated, not declared.** `index.ts` reads `GP_API_<ENV>` from Secrets Manager and wires every key it finds into the task definition's `secrets` block as `valueFrom`, so adding one needs no change in this directory — the key only has to exist in the blob, and the value never enters Pulumi state. The four `E2E_*` test-account keys are the exception: dev skips them and preview maps them to `ADMIN_EMAIL`/`ADMIN_PASSWORD`/`CANDIDATE_EMAIL`/`CANDIDATE_PASSWORD` (falling back to the runner's env, with a warning, while they are absent from the blob). Never add a secret value as Pulumi config or a stack output. Full flow (and why you don't need AWS access for it): `docs/secrets.md`.
- **All environments authenticate via the ECS task role** — no task carries static AWS keys. The AWS SDK's default credential chain resolves to the task role in every deployed task, so a task-role grant in `index.ts` is sufficient on its own. (Prod used to carry the legacy `gp-api` IAM user's static creds, which shadowed the task role and caused the 2026-07-29 contacts outage; those creds and the user were retired.)
- **Docker image is tagged with `imageUri`** passed in from CI; `index.ts` reads it via `pulumi.Config()`. Local builds aren't deployable — push through the workflow.
- **Preview deploys are tuned for wall time.** The PR job runs `nest build` without `npm run build`'s `tsc --noEmit` (the Checks job type-checks the same commit), runs `pulumi up --skip-preview`, and relies on the `Dockerfile` keeping the `npm ci` layer keyed on manifests alone, with only `COPY --link` after it. Putting a `RUN` or a workspace `dist/` copy above or after that layer brings back a full reinstall or a 600MB layer download on most builds.
- **`npm run infra deploy <env>` is invoked by CI, not by hand.** A push to `main` runs `infra deploy dev`; `infra deploy prod` runs only from the release train's prod stage (`release.yml`, freeze-switch gated, with a manual `workflow_dispatch` fallback) once the commit is green on dev — never from a branch push. `npm run infra diff <env>` stays useful locally for previewing a change.
- **Observability lives here, not just in app code.** Grafana dashboards/alerts are defined in `components/grafana.ts` and `components/alerting/`. App-side metric naming must line up with these.

## Shared preview ALB (`components/preview-shared-alb.ts`)

Every PR preview routes through one ALB, `gp-api-previews`. A preview stack creates only a target group and a host-header rule on its HTTPS listener (priority = PR number), and `*.preview.goodparty.org` resolves to it, so a new PR provisions no ALB and no DNS record. A per-PR ALB cost ~3 minutes to provision plus ~2 for its new record to resolve, on every new PR.

- The **dev stack** owns it, the same as the shared preview cluster, so it deploys with `main`.
- If the ALB is missing (before the first dev deploy that creates it), `index.ts` falls back to a per-PR ALB and DNS record, so previews keep deploying.
- An ALB holds 100 listener rules by default, so ~100 concurrent previews is the ceiling before a quota raise. The stale-stack sweep keeps the count well under that.

## Shared preview cluster (`components/preview-shared-cluster.ts`)

The persistent Aurora PostgreSQL Serverless v2 cluster (`gp-api-preview-shared-db`) that all PR previews share is provisioned by the **dev stack** — `index.ts` calls `createPreviewSharedCluster(...)` when `environment === 'dev'`, so it deploys automatically with `main` (the dev deploy). Per-PR databases (`gpdb_pr_<n>`) are created on it by the preview entrypoint (`docker-entrypoint.sh`), which then runs `prisma migrate deploy` + seed against the fresh database; the per-PR stacks reference the cluster by identifier via `aws.rds.getCluster` and never provision their own.

`deletionProtection` is on and `masterPassword` is under `ignoreChanges` — a rotated `GP_API_DEV.DB_PASSWORD` must not `ModifyDBCluster` the live cluster and break every connected preview.

### Preview connection strategy

Preview services run with `connection_limit=5` (set by `IS_PREVIEW` in `docker-entrypoint.sh`). Dev/prod keep the standard `connection_limit=20`. Each preview container opens **two** pools against the shared instance — Prisma via `DATABASE_URL` (`connection_limit=5`) and `PollResponsesDownloadService`'s own `pg.Pool` (`max=5`) — so the per-preview budget is ~10 connections. Against the ~100-connection ceiling of a 0.5-ACU instance that is ~10 concurrent previews before the ceiling; Aurora auto-scales above 0.5 ACU as load grows.
**Scaling levers if connection pressure is real:**

1. Raise `minCapacity` in the cluster's `serverlessv2ScalingConfiguration` (in `components/preview-shared-cluster.ts`; reduces cold-start connection drops).
2. Add an RDS Proxy in front of the cluster (multiplexes connections; the proxy endpoint replaces `DB_HOST` for previews).
3. Lower `connection_limit` further, or raise it if the 5-per-service cap proves too tight for single-preview load.

## Gotchas

- VPC ID, subnet IDs, security group IDs, and the hosted zone are **hardcoded** in `index.ts`. They reference the existing AWS account and aren't created by Pulumi. Don't try to make them dynamic.
- `pulumi/` has its own `node_modules` — don't `npm install` inside `deploy/`. Pulumi resolves from there at runtime.
- `Dockerfile` copies `node_modules/.prisma` from the build host. CI must run `prisma generate` before the docker build, or the image will fail at runtime with missing native engines.
- `infra deploy preview` requires `prNumber`; running it without one will throw on `config.require`.
- **The deploy wait is a budget, and the health check spends most of it.** `waitForSteadyState: true` plus `customTimeouts` (10m) means Pulumi fails the deploy if ECS does not stabilize in time, and `interval * healthyThreshold` (10s preview, 30s dev, 2m prod) is on the critical path of every handover. Preview alone runs `deploymentMinimumHealthyPercent: 0` with no deregistration delay, so its old task stops while the new one boots; it is briefly unreachable mid-deploy, which is fine because the webapp E2E waits for this deploy to finish. Preview deploys used to fail this wait by seconds against the old 5m/60s pairing. Raising the interval or lowering the timeout re-opens that failure, and `healthCheckGracePeriodSeconds` (300) must stay above the slowest boot, which is a first-boot preview doing ensure-database + `migrate deploy` + seed.
- **A timed-out preview deploy needs a new commit, not a re-run.** When the wait above is exhausted, Pulumi has already updated its resource spec, and `deploymentCircuitBreaker.rollback` is false, so the service never rolls over (on preview, with its 0% floor, nothing is serving at all). Re-running the job is then a no-op that reports success: `pulumi up` diffs against its own spec, finds nothing to change, and exits 0 while the service is still on the old image. Because the ECR tag is `github.sha`, only a new commit produces a new image tag and so a genuinely new task definition. The `Verify the preview is serving this commit` step in `gp-api.yml` exists to catch exactly this — without it the divergence stays silent here and reappears ~20m later as a gp-webapp `E2E Wait` failure pointing at a deploy that reported green (PR #1455, 2026-08-26, cost roughly an hour of re-runs that could not have worked).

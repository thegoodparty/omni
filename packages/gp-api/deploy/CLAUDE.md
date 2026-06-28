# Deploy

Pulumi (TypeScript) infrastructure-as-code, the production Dockerfile, and the `infra-cli.ts` wrapper used by the `npm run infra` commands. Targets four environments: `preview` (per-PR), `dev` (`develop` branch), `qa`, `prod`.

## Key files

| Path                                        | Purpose                                                                    |
| ------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------- |
| `index.ts`                                  | Pulumi program entry — wires VPC, service, asset bucket, Grafana resources |
| `Pulumi.yaml`                               | Stack metadata (`name: gp-api`, `runtime: nodejs`)                         |
| `infra-cli.ts`                              | yargs-based CLI wrapping `pulumi`; `npm run infra <diff                    | deploy> <env>` shells out to this |
| `Dockerfile`                                | Production image build (Node 22 Alpine, multi-copy with prebuilt `dist/`)  |
| `docker-entrypoint.sh`                      | Container bootstrap (env validation, migration check, app start)           |
| `components/service.ts`                     | ECS Fargate service + ALB target group                                     |
| `components/vpc.ts`                         | VPC selection (existing VPC, hardcoded subnets/SGs)                        |
| `components/assets-bucket.ts`               | S3 bucket for user uploads                                                 |
| `components/assets-router.ts`               | CloudFront fronting the assets bucket                                      |
| `components/campaign-plan-shares-bucket.ts` | Private bucket for shared campaign-plan PDFs (per env; preview reuses dev) |
| `components/grafana.ts`                     | Grafana data sources, dashboards, contact points                           |
| `components/alerting/` + `alerts.ts`        | Grafana alert rules and routing                                            |
| `pulumi/`                                   | `node_modules` for Pulumi's runtime (separate dependency tree)             |
| `preview-shared/Pulumi.yaml`                | Stack metadata for the persistent shared preview Aurora cluster            |
| `preview-shared/index.ts`                   | Pulumi program — provisions `gp-api-preview-shared` cluster + instance     |

## Patterns

- **Environment is a literal union** (`'preview' \| 'dev' \| 'qa' \| 'prod'`) narrowed from `pulumi.Config().require('environment')`. The `select<T>(values)` helper in `index.ts` is the canonical way to choose per-env values — use it instead of `if/else` chains.
- **Preview stacks are ephemeral**: `prNumber` is required for `preview`, and stack name is `pr-${prNumber}`. They are torn down two ways: `gp-api-teardown-preview.yml` destroys a PR's stack on `pull_request: closed`, and `gp-api-cleanup-preview.yml` sweeps any dangling ones (those with no open PR, found by `find-stale-preview-stacks.ts`) every 3 hours. Both share the `destroy-preview-stack` composite action, which runs `pulumi cancel` first — a runner killed mid-deploy leaves a state lock that otherwise makes `pulumi destroy` fail and strands the stack's ALB.
- **Pulumi config secrets** come from SSM via `infra-cli.ts` (`PULUMI_CONFIG_PASSPHRASE`, `GRAFANA_AUTH`, `GRAFANA_SM_ACCESS_TOKEN`). The CLI fetches them per-run; nothing is committed.
- **Docker image is tagged with `imageUri`** passed in from CI; `index.ts` reads it via `pulumi.Config()`. Local builds aren't deployable — push through the workflow.
- **Observability lives here, not just in app code.** Grafana dashboards/alerts are defined in `components/grafana.ts` and `components/alerting/`. App-side metric naming must line up with these.

## Shared preview cluster (`preview-shared/`)

`preview-shared/` is a **standalone Pulumi stack** (`gp-api-preview-shared`) with its own lifecycle — it is never touched by per-PR or develop deploys. It provisions one persistent Aurora PostgreSQL Serverless v2 cluster that all PR previews share. Per-PR databases (`gpdb_pr_<n>`) are created at preview-stack deploy time (ticket 1.2) against this cluster.

Apply it once, out-of-band:

```bash
cd packages/gp-api/deploy/preview-shared
# The S3 state backend uses an AWS SDK that does not read the aws-login
# credential_process, so export resolved creds into the environment first.
eval "$(aws configure export-credentials --format env)"
export AWS_REGION=us-west-2
pulumi login s3://goodparty-iac-state
pulumi stack select gp-api-preview-shared --create
PULUMI_CONFIG_PASSPHRASE=<value-from-ssm:pulumi-state-config-passphrase> pulumi up
```

Do **not** wire `preview-shared/` into `infra-cli.ts` — it has no `environment` config and no `imageUri`. Run raw `pulumi` commands against it.

### Template database (`gpdb_preview_template`)

`gpdb_preview_template` is a persistent, fully migrated + seeded database on the shared cluster, kept current by `.github/workflows/gp-api-refresh-preview-template.yml`. The per-PR create step in `docker-entrypoint.sh` copies it via `CREATE DATABASE gpdb_pr_<n> TEMPLATE gpdb_preview_template`, so a per-PR preview skips `migrate deploy` + seed (the slow steps) and instead clones a ready database — that is the build-time win this phase exists for. `migrate deploy` still runs on startup, but on a current template the clone already has every migration applied, so it is a fast no-op; it stays as a safety net for the window where the template is one migration behind.

The refresh workflow runs on `push` to `develop` that touches `packages/gp-api/prisma/**` or `packages/gp-api/seed/**` (so the template tracks schema/seed changes), plus `workflow_dispatch`. The template does not exist until the workflow has run once, so its **first creation is a manual `workflow_dispatch`**. Like the cleanup workflow's `drop-orphaned-dbs` job, it resolves the cluster endpoint then runs `scripts/refresh-preview-template.ts` in-VPC via `aws ecs run-task` on the dev task def (the GitHub runner is not in the VPC). A failed refresh fires a Slack alert — a stale template would copy old schema/seed into every new preview.

**ECS command overrides require the entrypoint passthrough.** The DB-maintenance tasks (this refresh, plus `drop-preview-db` / `drop-orphaned-preview-dbs`) run by overriding the container `command` on `aws ecs run-task`. The image's `ENTRYPOINT` is exec-form with no `CMD`, so `docker-entrypoint.sh` must `exec "$@"` when given args, otherwise the override is silently ignored and the container runs the full app-start flow instead of the script. That passthrough is the first thing the entrypoint does (before the env guards, which these tasks don't satisfy); the service task definition sets no command, so normal startup is untouched.

**Drop-and-recreate-empty design.** Each refresh drops `gpdb_preview_template` and recreates it empty, then runs `migrate deploy` + seed against the fresh DB. This is deliberate: `seed/seed.ts` is **not** idempotent (`seedOffices`/`seedEcanvasserDemoAccount` do blind `create`s against unique columns — `Organization.slug` PK, `Ecanvasser.campaignId` unique — and the factory seeds compound on every re-run), so it cannot be re-run in place against a persistent DB. Recreating empty makes the template seed exactly like a fresh per-PR `gpdb_pr_<n>` does, which is the only seed path proven to work. The script terminates any backends and runs `DROP DATABASE`/`CREATE DATABASE` on a plain (non-transaction) client, since neither can run inside a transaction.

**No long-lived connections.** Postgres rejects `CREATE DATABASE ... TEMPLATE` while any session is connected to the source, so nothing must hold an open connection to `gpdb_preview_template`. The refresh script terminates lingering backends after seeding, and no app ever points its `DATABASE_URL` at the template. **Note for 10552:** because this drop-and-recreate briefly drops the template during a refresh, the per-PR `CREATE DATABASE ... TEMPLATE` must tolerate a transient template-missing window — the entrypoint's create-db retry loop already covers this.

### Preview connection strategy

Preview services run with `connection_limit=5` (set by `IS_PREVIEW` in `docker-entrypoint.sh`). Dev/qa/prod keep the standard `connection_limit=20`. Each preview container opens **two** pools against the shared instance — Prisma via `DATABASE_URL` (`connection_limit=5`) and `PollResponsesDownloadService`'s own `pg.Pool` (`max=5`) — so the per-preview budget is ~10 connections. Against the ~100-connection ceiling of a 0.5-ACU instance that is ~10 concurrent previews before the ceiling; Aurora auto-scales above 0.5 ACU as load grows and the connections alarm fires at 80, but rely on more than ~10 simultaneous open previews only once the alarm has a live SNS action. (`VoterDatabaseService`'s pool hits a separate voter cluster and is not part of this budget.)

CloudWatch alarms in `preview-shared/index.ts` watch:

- `DatabaseConnections >= 80` (instance-level, `DBInstanceIdentifier`) — 3 consecutive 1-minute periods
- `ServerlessDatabaseCapacity >= 56 ACU` (cluster-level, `DBClusterIdentifier`; 87.5% of maxCapacity=64) — 3 consecutive 1-minute periods

Both alarms notify Slack via the `gp-api-preview-shared-alarms` SNS topic, subscribed to the `shared-slack-notifier` Lambda (the same path the `*-failures-*` topics use). That Lambda already grants invoke to every topic in the account (`sns:...:*`), so no extra `lambda.Permission` is needed.

**Scaling levers if connection pressure is real:**

1. Raise `minCapacity` in `rdsCluster.serverlessv2ScalingConfiguration` (reduces cold-start connection drops).
2. Add an RDS Proxy in front of the cluster (multiplexes connections; the proxy endpoint replaces `DB_HOST` for previews).
3. Lower `connection_limit` further, or raise it if the 5-per-service cap proves too tight for single-preview load.

## Gotchas

- VPC ID, subnet IDs, security group IDs, and the hosted zone are **hardcoded** in `index.ts`. They reference the existing AWS account and aren't created by Pulumi. Don't try to make them dynamic.
- `pulumi/` has its own `node_modules` — don't `npm install` inside `deploy/`. Pulumi resolves from there at runtime.
- `Dockerfile` copies `node_modules/.prisma` from the build host. CI must run `prisma generate` before the docker build, or the image will fail at runtime with missing native engines.
- `infra deploy preview` requires `prNumber`; running it without one will throw on `config.require`.

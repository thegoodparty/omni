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

### Preview connection strategy

Preview services run with `connection_limit=5` (set by `IS_PREVIEW` in `docker-entrypoint.sh`). Dev/qa/prod keep the standard `connection_limit=20`. The 0.5-ACU Aurora Serverless v2 instance supports roughly 100 max connections; 5 per service keeps 25 concurrent previews within ~125 connections — acceptable given Aurora auto-scales, and the alarm fires before saturation.

CloudWatch alarms in `preview-shared/index.ts` watch:

- `DatabaseConnections >= 80` (instance-level, `DBInstanceIdentifier`) — 3 consecutive 1-minute periods
- `ServerlessDatabaseCapacity >= 56 ACU` (87.5% of maxCapacity=64) — 3 consecutive 1-minute periods

**`alarmActions` is currently empty** — no SNS topic exists in this account yet. Ops follow-up: create an SNS topic, subscribe it to Slack or a Lambda forwarder, then add the ARN to `alarmActions` in both alarms and re-apply the `preview-shared` stack.

**Scaling levers if connection pressure is real:**

1. Raise `minCapacity` in `rdsCluster.serverlessv2ScalingConfiguration` (reduces cold-start connection drops).
2. Add an RDS Proxy in front of the cluster (multiplexes connections; the proxy endpoint replaces `DB_HOST` for previews).
3. Lower `connection_limit` further, or raise it if the 5-per-service cap proves too tight for single-preview load.

## Gotchas

- VPC ID, subnet IDs, security group IDs, and the hosted zone are **hardcoded** in `index.ts`. They reference the existing AWS account and aren't created by Pulumi. Don't try to make them dynamic.
- `pulumi/` has its own `node_modules` — don't `npm install` inside `deploy/`. Pulumi resolves from there at runtime.
- `Dockerfile` copies `node_modules/.prisma` from the build host. CI must run `prisma generate` before the docker build, or the image will fail at runtime with missing native engines.
- `infra deploy preview` requires `prNumber`; running it without one will throw on `config.require`.

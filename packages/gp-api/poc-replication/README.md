# gp-api Postgres to Databricks replication POC

POC only. Nothing here is deployed by CI, and the whole stack is destroyed when the POC ends.

The long-term goal is a general mirror of gp-api's Postgres tables in Databricks. This POC tests three ways to get there, each on its own branch built on this one:

- A. Lakehouse Federation: Databricks queries Postgres live through a foreign catalog. No copy.
- B. Lakeflow Connect: the managed PostgreSQL CDC connector (gateway plus ingestion pipeline) mirrors tables into Delta.
- C. AWS DMS: CDC to Kinesis Data Streams, a Lambda, Databricks Zerobus Ingest, then Delta, with a current-state view per table.

Each path is judged on seconds of freshness and on reliability with near-zero upkeep: Aurora failover, Postgres upgrades, Prisma migrations, network blips, and no unbounded WAL growth.

Everything runs against a dedicated POC Aurora cluster, not gp-api's dev or prod database, so no POC step can reboot or reconfigure a shared database. The cluster gets gp-api's real schema from its own Prisma migrations, plus a `replication_probe` table for benchmarks. It holds synthetic data only.

## Layout

| Path                                             | What                                                                                                 |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `Pulumi.yaml`, `index.ts`                        | Standalone Pulumi project `gp-api-poc-replication`. Separate from `../deploy`.                       |
| `sql/001_replication_probe.sql`                  | The benchmark table. Applied by hand with psql (step 4).                                             |
| `sql/002_replication_probe_add_column.sql`       | The extra migration the schema-change drill applies. Not applied by hand.                            |
| `bench/bench.ts`                                 | The benchmark every path runs. Standalone: imports only `pg` and `zod`, nothing from the gp-api app. |
| `sql/<path>/`, `databricks/<path>/`, `<path>.ts` | Added by each path branch (`federation`, `lakeflow`, `dms`).                                         |

## What the base stack creates

`pulumi up` with no path flags creates:

- A cluster parameter group (`aurora-postgresql17`) with `rds.logical_replication = 1`.
- A security group allowing 5432 from the OpenVPN server's security group (engineers on the VPN) and from the Databricks peering CIDR (classic compute). Egress is open.
- A subnet group over the existing private subnets. The VPC and subnets are looked up; nothing in the VPC is created or changed.
- Aurora PostgreSQL Serverless v2 cluster `gp-poc-replication-db`, latest 17.x, 0.5 to 2 ACU, one writer `gp-poc-replication-writer`, database `gp_api_poc`, master user `poc_admin` with an RDS-managed password in Secrets Manager. Deletion protection is off and no final snapshot is taken.
- An SNS topic `gp-poc-replication-alarms` and three CloudWatch alarms on the writer: `OldestReplicationSlotLag` (over 1 GiB), `ReplicationSlotDiskUsage` and `TransactionLogsDiskUsage` (over 5 GiB). Aurora keeps WAL for a stalled slot without limit, so these are the early warning.

Config keys (all optional): `vpcId`, `privateSubnetIds`, `vpnSecurityGroupId`, `databricksPeeringCidr`, `engineVersion`, `slotLagAlarmBytes`, `walDiskAlarmBytes`, `alarmEmail`.

## Adding a path

Each path branch adds, and touches nothing else in the base:

- Pulumi: a `<path>.ts` next to `index.ts`, called from `index.ts` behind a boolean config flag (`enableFederation`, `enableLakeflow`, `enableDms`, each `false` by default), adding its outputs to `outputs`. Extra ingress goes in separate `aws.vpc.SecurityGroupIngressRule` resources on `securityGroup`.
- Setup SQL in `sql/<path>/` (publications, replication roles, replica identity), Databricks definitions in `databricks/<path>/`.
- Its section below (A, B or C): steps with owners and exact commands, the bench `--target` for the path, expected freshness, risks, results and teardown.
- Mirror target: the whole `public` schema of `gp_api_poc`, or a documented table list, into `goodparty_data_catalog.gp_api_mirror_<path>`. Federation's target is a foreign catalog instead.

## Who does what

| Role                       | Does                                                                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| AWS admin                  | `pulumi up` and `pulumi destroy`, anything in AWS (VPC endpoint services, DMS, Kinesis, Lambda, IAM).                                          |
| DB admin                   | Connects with the master secret, applies the Prisma migrations and `sql/`, creates replication roles. Can be the same person as the AWS admin. |
| Databricks workspace admin | Connections, foreign catalogs, Lakeflow gateways and pipelines, service principals, grants, the `gp_api_mirror_*` schemas.                     |
| Databricks account admin   | Network connectivity configurations (NCC) and private endpoint rules for serverless.                                                           |
| Engineer                   | Runs the benchmark. Needs the VPN, a connection string from the DB admin (or read access to the master secret), and a Databricks token.        |

## Base setup

Run every command from `packages/gp-api/poc-replication` unless noted. Run `npm ci` at the repo root first; the program uses the `@pulumi/*` packages already in `packages/gp-api/node_modules`, so there is no separate install.

### 1. Create the stack (AWS admin)

Same backend and passphrase as `../deploy` (see `../deploy/infra-cli.ts`), under its own project name, so it cannot touch the gp-api stacks.

```bash
pulumi login s3://goodparty-iac-state
export PULUMI_CONFIG_PASSPHRASE="$(aws ssm get-parameter --name pulumi-state-config-passphrase \
  --with-decryption --query Parameter.Value --output text)"
pulumi stack select poc --create
pulumi config set-all --path \
  --plaintext aws:region=us-west-2 \
  --plaintext aws:defaultTags.tags.Environment=dev \
  --plaintext aws:defaultTags.tags.Project=gp-api-poc-replication
pulumi config set alarmEmail <your-email>   # optional
pulumi preview
pulumi up
```

Creating the cluster takes about 10 to 15 minutes.

### 2. Connection strings and logical replication check (DB admin)

Build the connection strings from the managed secret without printing them. Node needs the RDS CA bundle because it does not trust the RDS CA. `POC_REPLICATION_DATABASE_URL` is for psql and the benchmark; `POC_REPLICATION_PRISMA_URL` is the same database in Prisma's SSL parameter format.

```bash
curl -sSo /tmp/rds-global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
HOST=$(pulumi stack output writerEndpoint)
SECRET_ARN=$(pulumi stack output masterSecretArn)
SECRET=$(aws secretsmanager get-secret-value --secret-id "$SECRET_ARN" --query SecretString --output text)
url() { echo "$SECRET" | HOST="$HOST" python3 -c '
import json, os, sys, urllib.parse as u
s = json.load(sys.stdin)
print("postgresql://" + u.quote(s["username"], safe="") + ":" + u.quote(s["password"], safe="")
      + "@" + os.environ["HOST"] + ":5432/gp_api_poc?" + sys.argv[1])' "$1"; }
export POC_REPLICATION_DATABASE_URL="$(url 'sslmode=verify-full&sslrootcert=/tmp/rds-global-bundle.pem')"
export POC_REPLICATION_PRISMA_URL="$(url 'sslmode=require&sslcert=/tmp/rds-global-bundle.pem&sslaccept=strict')"
unset SECRET
psql "$POC_REPLICATION_DATABASE_URL" -c 'SHOW rds.logical_replication' -c 'SHOW wal_level'
```

Expect `on` and `logical`. If not, reboot the writer once (`aws rds reboot-db-instance --db-instance-identifier gp-poc-replication-writer`); this only touches the POC cluster.

### 3. Apply gp-api's schema (DB admin)

The mirror is tested against gp-api's real tables, created by gp-api's own migrations. From `packages/gp-api`:

```bash
DATABASE_URL="$POC_REPLICATION_PRISMA_URL" npx prisma migrate deploy
```

Rerun it whenever `main` gains migrations you want to test against; that is also the Prisma-migration upkeep test for each path. The tables start empty. The benchmark's `--table campaign` modes create synthetic campaigns (with a synthetic user and organization each) when needed.

### 4. Create the probe table (DB admin)

```bash
psql "$POC_REPLICATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/001_replication_probe.sql
```

`replication_probe` has `id` (bigint identity primary key), `payload` (text; the benchmark writes 8 KB of random base64 so it is stored out of line in TOAST), `doc` (jsonb) and `updated_at` (timestamptz). The file is idempotent.

## Benchmark (engineer)

Run from `packages/gp-api`, on the VPN, with `POC_REPLICATION_DATABASE_URL` exported (step 2). Databricks access comes from `PEOPLE_DATABRICKS_WAREHOUSE_ID` (the Starter warehouse, `18583d8b081c6486`) and `PEOPLE_DATABRICKS_API_KEY` (a personal token), in `.env` or the shell. The bench refuses to run against a database without `replication_probe`, so it cannot write to gp-api's own database by mistake.

```bash
BENCH="npx tsx --env-file=.env poc-replication/bench/bench.ts --target <catalog.schema>"

# Burst: 20 inserts, one transaction each, then poll until each is visible
$BENCH --mode insert --count 20 --check

# Updates to existing rows (jsonb and updated_at change, the TOASTed payload does not)
$BENCH --mode update --count 20 --rows 10 --check

# Deletes of the oldest rows (each must already be in the target)
$BENCH --mode delete --count 10 --check

# A real gp-api table: large jsonb updates to campaign.data
$BENCH --mode insert --table campaign --count 10
$BENCH --mode update --table campaign --count 50 --rows 10 --check

# Soak: 2 ops/sec for 30 minutes, polling throughout
$BENCH --mode update --soak --rate 2 --minutes 30 --check

# Correctness only: source and target agree (polls until they do or timeout)
$BENCH --mode check
$BENCH --mode check --table campaign

# Schema-change drill (see below)
$BENCH --mode schema-drill --timeout-s 1800

# Dry run: Postgres side only, no Databricks, no --target needed
npx tsx --env-file=.env poc-replication/bench/bench.ts --mode insert --count 5 --dry-run
```

| Flag                            | Default             | Meaning                                                                                                                                                                                              |
| ------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--mode`                        | `insert`            | `insert`, `update`, `delete`, `check` or `schema-drill`.                                                                                                                                             |
| `--table`                       | `replication_probe` | Source table: `replication_probe` or `campaign`. Campaign modes only touch rows whose slug starts with `poc-bench-`; delete removes the bench user, which cascades to its organization and campaign. |
| `--target`                      | none                | Databricks `catalog.schema` holding the mirrored tables. Required unless `--dry-run`.                                                                                                                |
| `--target-table`                | same as `--table`   | Table or view name inside `--target`, for paths whose current-state table is named differently (path C's view).                                                                                      |
| `--count`                       | `20`                | Operations in a burst (one at a time, one transaction each).                                                                                                                                         |
| `--soak`, `--rate`, `--minutes` | off, `1`, `10`      | Soak instead: `rate` operations per second for `minutes`, on a fixed schedule.                                                                                                                       |
| `--rows`                        | `20`                | Update modes cycle through this many existing rows.                                                                                                                                                  |
| `--payload-kb`                  | `8`                 | Size of `payload` (and of the campaign blob).                                                                                                                                                        |
| `--poll-ms`                     | `250`               | Target poll interval.                                                                                                                                                                                |
| `--timeout-s`                   | `900`               | Per operation for lag; total for `check` and `schema-drill`.                                                                                                                                         |
| `--check`                       | off                 | Run the correctness check after the operations.                                                                                                                                                      |
| `--dry-run`                     | off                 | Postgres side only.                                                                                                                                                                                  |

It prints progress to stderr and one JSON summary to stdout; redirect it into a results file per run.

- `lagMs` (`p50`, `p95`, `max`) runs from the write's commit returning to the poll that saw it in the target, so it includes up to one poll round trip. `pollRttMs` reports that round trip: about 0.5 to 1 s on a warm Starter warehouse, 8 to 10 s cold. The first query warms it.
- Visible means: insert, the id is in the target; update, the target's `updated_at` is at or past the written one; delete, the id is gone. Delete runs first confirm each picked row is in the target (`notInTargetBeforeDelete`).
- `notSeenWithinTimeout`, `opFailures` and `pollFailures` are the reliability counts.
- `check` compares row count, an md5 over every `id:updated_at` (microseconds) pair in id order, and for `replication_probe` the total payload length, which catches TOAST values that arrive as null. `matched` and `timeToMatchMs` say whether and when the target caught up.
- `databricksTimezone` is recorded because a mirrored `timestamp without time zone` (every Prisma `DateTime`, such as `campaign.updated_at`) lands as `TIMESTAMP_NTZ` and is compared through the session time zone. Expect `Etc/UTC`; anything else shifts campaign comparisons.

### Schema-change drill

`--mode schema-drill` applies `sql/002_replication_probe_add_column.sql` (adds `drill_note text` to `replication_probe`), inserts one row and updates one existing row with a `drill_note` value, then polls the target. The summary's `timeline` records, in ms after the migration: `rowsVisibleMs` (both writes arrived, through the old columns), `columnVisibleMs` (the target resolves `drill_note`), `valuesVisibleMs` (the values arrived), and each distinct error with its time. `null` means it never happened within `--timeout-s`.

Also record by hand what the path did: pipeline or task status, whether it needed a full refresh or reload, and any manual step. The column add is idempotent, so the drill shows a fresh schema change only once per cluster.

## A. Lakehouse Federation

Bench target: the foreign catalog's `public` schema.

Added by the path A branch.

## B. Lakeflow Connect PostgreSQL CDC

Bench target: `goodparty_data_catalog.gp_api_mirror_lakeflow`.

Added by the path B branch.

## C. DMS to Kinesis to Zerobus

Bench target: `goodparty_data_catalog.gp_api_mirror_dms`, with `--target-table` set to each table's current-state view.

Added by the path C branch.

## Teardown

1. Each path's teardown, in reverse order (C, B, A). Stop every replication consumer (DMS task, Lakeflow gateway and pipeline) and drop its replication slot before the cluster goes.
2. AWS admin: `pulumi destroy`, then `pulumi stack rm poc`.
3. Databricks workspace admin: drop the `gp_api_mirror_*` schemas and any foreign catalog the paths created.

## Verified so far

- `npx tsc -p tsconfig.deploy.json` covers this program and the bench; it passes.
- The Pulumi program runs to completion under Pulumi mocks (a throwaway harness, not committed): every resource and output resolves. `pulumi preview` and `pulumi up` against AWS have not been run.
- On local Postgres 16 (not 17, and not Aurora): `prisma migrate deploy` applies every gp-api migration to an empty database, `sql/001_replication_probe.sql` applies twice cleanly, and the payload is stored out of line in TOAST.
- The bench's Postgres side in dry run: every mode on both tables, burst and soak, and the guard against a database without `replication_probe`.
- The bench's Databricks side against small synthetic Delta tables (`TIMESTAMP` and `TIMESTAMP_NTZ`), with a script copying changes in by hand to stand in for replication: insert, update, delete and soak lag, `--target-table` through a view, check matching and mismatch, and the drill timeline (column error, then column, then values). The tables were dropped afterward.
- Not verified: anything on Aurora, the Prisma SSL parameters against RDS, and every path.

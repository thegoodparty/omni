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

Bench target: `goodparty_data_catalog.gp_api_mirror_dms`. Each current-state view has its source table's name, so `--target-table` is not needed.

### How it works

Aurora logical slot, then a DMS Serverless replication (full load plus CDC), then the Kinesis stream `gp-poc-replication-dms` (on-demand), then the Lambda `gp-poc-replication-dms-consumer`, then Zerobus Ingest, then the Delta table `dms_cdc_change`, then one view per mirrored table.

Mirrored tables: `replication_probe`, `campaign` (the real gp-api table the bench updates) and `replication_canary`. The list, with each table's primary key, is `lambda/dms-zerobus/mirroredTables.ts`; DMS selects those tables, the consumer maps them and the view generator reads it. Mirroring the whole `public` schema is the same mechanism with a longer list.

- **Raw changes.** The consumer writes every load, insert, update and delete as one row in `dms_cdc_change`: source table, primary key (JSON array), operation, ordering key, commit timestamp, LSN (stream position), transaction id, the row image as JSON text, the Kinesis sequence number and the ingest time. The table's schema never changes when Postgres does, so a Prisma migration cannot break Zerobus.
- **Ordering.** DMS adds `$AR_H_CHANGE_SEQ`, `$AR_H_COMMIT_TIMESTAMP` and `$AR_H_STREAM_POSITION` to every record through table-mapping transformation rules. The change sequence is "a unique incrementing number from the source database that consists of a timestamp and an auto incrementing number", 35 digits ([DMS header columns](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Tasks.CustomizingTasks.TableMapping.SelectionTransformation.Expressions.html)). The consumer stores `seq` = `1` plus that number left-padded to 40 digits, and `0` for full-load rows, which DMS sends before the changes cached during the load. A CDC record without a change sequence is rejected (`MalformedRecords`), never guessed.
- **Current-state views.** `databricks/dms/generate-views.ts` reads each table's columns and primary key from Postgres and writes `CREATE OR REPLACE VIEW gp_api_mirror_dms.<table>`: group the table's changes by primary key, keep the values of the highest `seq` (`max_by`), drop keys whose latest change is a delete, and cast each column from the JSON to its Databricks type (`timestamptz` to `TIMESTAMP`, `timestamp` to `TIMESTAMP_NTZ`, integers, booleans and so on; everything else, including `jsonb`, as `STRING`). The generated SQL for the three tables is in `databricks/dms/views/`. Each view also has `_dms_ingested_at`, the time the latest change reached the consumer.
- **TOAST.** Values over about 2 KB are stored out of line, and an UPDATE that does not touch one does not put it in the WAL's new tuple. `sql/dms/002_replica_identity_full.sql` sets REPLICA IDENTITY FULL on each mirrored table, so the old tuple carries every value. On local PostgreSQL 17, test_decoding (the plugin DMS uses) then prints the full old value under `old-key:` and still prints `unchanged-toast-datum` in the new tuple. DMS's before image does not help: it "does not contain columns with LOB data types", and DMS treats `text` and `jsonb` as LOBs ([Kinesis target](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Target.Kinesis.html)). So the consumer drops that placeholder from an update's row image and lists the column in `unchanged_toast`, and the views treat any TOASTable column missing from an update's image as unchanged, taking it from the newest change that had it. If DMS sends a null instead, the views keep the null; the bench's `--check` catches that through `payloadChars` (see the TOAST drill).
- **Deletes and key changes.** A delete is a change row like any other. The replication sends a primary-key-only before image, so an update that changes a primary key becomes a delete of the old key plus the new row.
- **Duplicates.** Kinesis, Lambda and Zerobus are all at least once. A duplicate change has the same `seq` and the same image, so the views return the same rows.
- **Reloads.** A reload sends every row again as full load, which sorts below the old CDC changes, and a row deleted while the pipeline was broken would never go away. So a reload starts with a row in `dms_cdc_reload`; the views ignore changes ingested before the latest reload of their table (see "C reload").
- **Truncate and DDL.** Neither changes the raw table. A truncate fires the `truncate` alarm and needs a reload. DDL fires the `ddl` alarm and needs the views regenerated.

### What `enableDms=true` adds

On top of the base stack (`dms.ts`):

- The Kinesis stream (on-demand, 24 h retention).
- A Kinesis interface VPC endpoint with private DNS, plus its security group (443 from the VPC). DMS 3.4.7 and later in a private subnet only reaches Kinesis this way, and Serverless always needs it ([DMS Serverless limitations](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Serverless.Limitations.html)). Skip it with `dmsCreateKinesisVpcEndpoint=false` if the VPC already has one.
- The DMS security group, a 5432 rule on the cluster security group from it, the DMS subnet group, the source endpoint (`aurora-postgresql`, test_decoding, WAL heartbeat every minute, DDL capture, DDL and heartbeat objects in the `awsdms` schema, fail on LOB truncation), the Kinesis target endpoint (JSON, nulls included, DDL, control and transaction details included) and its IAM role.
- The DMS Serverless replication config `gp-poc-replication-dms`, 1 to 2 DCU, full load and CDC, limited LOB mode at 256 KB, pk-only before image, not started until `dmsStartReplication=true`.
- `dms-vpc-role` and `dms-cloudwatch-logs-role`, only with `dmsCreateServiceRoles=true`. DMS needs these exact names once per account.
- The secret `gp-poc-replication-zerobus-sp` with no value. A human puts the service principal's OAuth client id and secret in it.
- The consumer Lambda (Node.js 22, outside the VPC) and its Kinesis event source mapping (batch 100, 1 s batching window, from `TRIM_HORIZON`).
- The canary Lambda `gp-poc-replication-dms-canary` (in the VPC) and a once-a-minute schedule. It upserts `replication_canary` row 1 with `written_at = now()` using the master secret, and the consumer reports how long that change took from Postgres to the Zerobus ack. Turn it off with `dmsCanaryEnabled=false`.
- Eleven alarms on the base SNS topic, listed under "Failure modes and detection".

Config keys for this path: `enableDms`, `dmsSourcePassword` (secret, required), `dmsSourceUsername` (default `dms_repl`), `dmsStartReplication`, `dmsCreateServiceRoles`, `dmsCreateKinesisVpcEndpoint`, `dmsCanaryEnabled`, `dmsMaxCapacityUnits` (default 2), `dmsLobMaxSizeKb` (default 256), `zerobusEndpoint`, `databricksWorkspaceUrl`, `zerobusTableName`. The last three default to this workspace (`3578414625112071`, us-west-2) and `goodparty_data_catalog.gp_api_mirror_dms.dms_cdc_change`.

### Steps

Base setup steps 1 to 4 first. Run commands from `packages/gp-api/poc-replication` unless noted.

#### C1. Databricks target (engineer with CREATE SCHEMA, then Databricks workspace admin)

1. The schema, `dms_cdc_change`, `dms_cdc_reload` and the three views already exist, empty (created by the path C author with `databricks/dms/001_change_tables.sql` and `databricks/dms/views/*.sql`; re-running them is safe). Never drop and recreate `dms_cdc_change` once the consumer runs.
2. Workspace admin: Settings, Identity and access, Service principals, Add new: `gp-poc-replication-zerobus`. Keep the Workspace access entitlement on; Zerobus needs it. Generate an OAuth secret and hand the client id (the Application ID) and secret to the AWS admin for step C6 through a password manager, not chat.
3. Schema owner (swain@) or workspace admin: run `databricks/dms/002_grant_service_principal.sql` with `<application-id>` replaced.

#### C2. Account checks (AWS admin)

```bash
aws iam get-role --role-name dms-vpc-role --query Role.Arn
aws iam get-role --role-name dms-cloudwatch-logs-role --query Role.Arn
aws ec2 describe-vpc-endpoints --filters Name=vpc-id,Values=vpc-0763fa52c32ebcf6a \
  Name=service-name,Values=com.amazonaws.us-west-2.kinesis-streams --query 'VpcEndpoints[].VpcEndpointId'
```

- If either role is missing: `pulumi config set dmsCreateServiceRoles true`.
- If a Kinesis endpoint already exists: `pulumi config set dmsCreateKinesisVpcEndpoint false`.
- Agree to the VPC-wide private DNS change (see "Risks") before going on.

#### C3. Source tables and DMS login (DB admin)

With `POC_REPLICATION_DATABASE_URL` from base step 2. The password goes from one variable into Postgres and into the Pulumi secret, and is never printed.

```bash
psql "$POC_REPLICATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/dms/001_replication_canary.sql
psql "$POC_REPLICATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/dms/002_replica_identity_full.sql
export DMS_SOURCE_PASSWORD="$(openssl rand -hex 24)"
psql "$POC_REPLICATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/dms/003_dms_source_role.sql
printf %s "$DMS_SOURCE_PASSWORD" | pulumi config set --secret dmsSourcePassword
unset DMS_SOURCE_PASSWORD
```

`002` prints the replica identity of each table; expect `full` three times. `003` needs psql 15 or newer. `Pulumi.poc.yaml` holds the encrypted password and is gitignored here.

#### C4. Build the Lambda bundles (AWS admin or engineer)

```bash
./lambda/dms-zerobus/build.sh
```

It bundles both handlers with esbuild and installs the Zerobus SDK's linux-x64 build next to the consumer. `pulumi up` refuses to run with `enableDms=true` until `lambda/dms-zerobus/dist/` exists.

#### C5. Create the path C resources (AWS admin)

```bash
pulumi config set enableDms true
pulumi preview
pulumi up
```

The replication is created but not started. The canary starts writing once a minute; those changes wait in the slot's WAL until the replication starts, and the canary row arrives with the full load.

#### C6. Put the service principal in the secret (AWS admin)

```bash
read -rs ZEROBUS_CLIENT_ID && read -rs ZEROBUS_CLIENT_SECRET && export ZEROBUS_CLIENT_ID ZEROBUS_CLIENT_SECRET
python3 -c 'import json, os; print(json.dumps({"client_id": os.environ["ZEROBUS_CLIENT_ID"], "client_secret": os.environ["ZEROBUS_CLIENT_SECRET"]}))' \
  | aws secretsmanager put-secret-value --secret-id "$(pulumi stack output zerobusSecretArn)" --secret-string file:///dev/stdin
unset ZEROBUS_CLIENT_ID ZEROBUS_CLIENT_SECRET
```

#### C7. Start the replication (AWS admin)

```bash
pulumi config set dmsStartReplication true
pulumi up
aws dms describe-replications \
  --filters Name=replication-config-arn,Values="$(pulumi stack output dmsReplicationConfigArn)" \
  --query 'Replications[0].{status: Status, stop: StopReason, failures: FailureMessages}'
```

Serverless goes through testing connection, fetching metadata, calculating capacity and provisioning before `running`. That can take 10 to 20 minutes. If it fails, read the log group starting with `dms-serverless-replication-`.

#### C8. Check the pipeline end to end (AWS admin, then engineer)

```bash
# The DMS metric dimension the alarms assume (should list ReplicationConfigId = this output)
pulumi stack output dmsReplicationConfigId
aws cloudwatch list-metrics --namespace AWS/DMS --metric-name CDCLatencySource

# Canary lag, Postgres commit to Zerobus ack, last hour
aws cloudwatch get-metric-statistics --namespace GpPocReplication/Dms --metric-name CanaryLagMs \
  --dimensions Name=Pipeline,Value=dms-zerobus --statistics Average Maximum --period 300 \
  --start-time "$(date -u -v-1H +%FT%TZ 2>/dev/null || date -u -d '-1 hour' +%FT%TZ)" --end-time "$(date -u +%FT%TZ)"

# Consumer log lines (DDL, truncates, skipped records, Zerobus failures)
aws logs tail /aws/lambda/gp-poc-replication-dms-consumer --since 1h
```

If `list-metrics` shows a different dimension, change `ReplicationConfigId` in `dms.ts` and `pulumi up`. The three `AWS/DMS` alarms stay in INSUFFICIENT_DATA until it matches.

In Databricks (engineer). The first query is the end-to-end freshness the bench measures, for the canary; the second is the first real DMS record, which the unit tests only model from the docs:

```sql
SELECT written_at, _dms_ingested_at, current_timestamp() - written_at AS age
FROM goodparty_data_catalog.gp_api_mirror_dms.replication_canary;

SELECT op, seq, change_seq, stream_position, commit_ts, unchanged_toast, left(row_image, 300)
FROM goodparty_data_catalog.gp_api_mirror_dms.dms_cdc_change
ORDER BY ingested_at DESC LIMIT 20;
```

Check that `change_seq` is 35 digits and grows, and that `commit_ts` is the real commit time. If DMS names or shapes anything differently from the unit tests, fix `dmsRecord.ts` and its test before benchmarking.

#### C9. Benchmark (engineer)

From `packages/gp-api`, as in "Benchmark" above:

```bash
BENCH="npx tsx --env-file=.env poc-replication/bench/bench.ts --target goodparty_data_catalog.gp_api_mirror_dms"
$BENCH --mode insert --count 3 --timeout-s 120   # warms the warehouse
$BENCH --mode insert --count 20 --check
$BENCH --mode update --count 20 --rows 10 --check
$BENCH --mode delete --count 10 --check
$BENCH --mode insert --table campaign --count 10
$BENCH --mode update --table campaign --count 50 --rows 10 --check
$BENCH --mode update --soak --rate 2 --minutes 30 --check
$BENCH --mode update --soak --rate 10 --minutes 10 --check
```

A pass is p95 lag in single-digit seconds, zero `notSeenWithinTimeout`, `opFailures` and `pollFailures`, and `check.matched` true on every run. Leave the canary running for a day or more and count `canary-missing` alarms; that is the near-zero-upkeep test.

#### C reload

Needed after a lost slot, a truncate, a column rename or retype, or a replication that was deprovisioned. Serverless cannot restart from a custom CDC start point, so the only way back is a new full load ([DMS Serverless limitations](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Serverless.Limitations.html)).

1. AWS admin: stop the replication if it is still running (`aws dms stop-replication --replication-config-arn "$(pulumi stack output dmsReplicationConfigArn)"`) and wait until the consumer's `IteratorAge` is back to zero, so no change from before the reload is still in flight.
2. Engineer: mark every mirrored table in Databricks.

```sql
INSERT INTO goodparty_data_catalog.gp_api_mirror_dms.dms_cdc_reload
SELECT t, current_timestamp() FROM VALUES ('replication_probe'), ('campaign'), ('replication_canary') AS v(t);
```

3. AWS admin: restart with a full load.

```bash
aws dms start-replication --replication-config-arn "$(pulumi stack output dmsReplicationConfigArn)" \
  --start-replication-type reload-target
```

From the marker until the full load lands, the views show only what has been reloaded so far. That gap is the cost of this path's recovery.

### Drills

Run each one with a soak going in another terminal (`$BENCH --mode update --soak --rate 2 --minutes 30 --check`) and record: the soak's `notSeenWithinTimeout` and lag, `check.matched` afterwards, how long `canary-missing` fired, the replication status, whether DMS resumed on its own or needed a reload, and `SELECT slot_name, active, pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) FROM pg_replication_slots` before and after.

1. **Failover (AWS admin).** The base cluster has one instance, so add a reader for the drill and remove it after. The open question is whether DMS's logical slot survives an Aurora failover (eval: unverified). If it does not, DMS fails or starts over, and the fix is "C reload".

   ```bash
   aws rds create-db-instance --db-instance-identifier gp-poc-replication-reader \
     --db-cluster-identifier gp-poc-replication-db --engine aurora-postgresql --db-instance-class db.serverless
   aws rds wait db-instance-available --db-instance-identifier gp-poc-replication-reader
   aws rds failover-db-cluster --db-cluster-identifier gp-poc-replication-db \
     --target-db-instance-identifier gp-poc-replication-reader
   # after recording: fail back, then remove the reader
   aws rds failover-db-cluster --db-cluster-identifier gp-poc-replication-db \
     --target-db-instance-identifier gp-poc-replication-writer
   aws rds delete-db-instance --db-instance-identifier gp-poc-replication-reader
   ```

   The base alarms watch the writer instance by identifier, so they follow `gp-poc-replication-writer`, not the role.

2. **Writer reboot (AWS admin).** `aws rds reboot-db-instance --db-instance-identifier gp-poc-replication-writer`. Expect `canary-errors` while it is down and DMS to reconnect to the same slot.

3. **Schema change through a migration (engineer, then DB admin).**
   - Timeline: `$BENCH --mode schema-drill --timeout-s 1800`. The bench applies `sql/002_replication_probe_add_column.sql` the way a migration does. Path C never needs a pipeline change for it: the new column is in the row image from the first change DMS sends after the DDL (if DMS sends it at all without a reload, which is what this drill answers). The view only resolves `drill_note` once it is regenerated, so as soon as the `ddl` alarm fires (or right away, in a second terminal):

     ```bash
     npx tsx --env-file=.env poc-replication/databricks/dms/generate-views.ts --table replication_probe --apply
     ```

     `columnVisibleMs` is then the time to regenerate, and `valuesVisibleMs` should equal it. Until then the values are queryable as `row_image:['drill_note']` in `dms_cdc_change`.

   - Real Prisma migration: DMS's DDL capture installs a database event trigger that runs inside every migration. Prove `prisma migrate deploy` still works with it by applying a throwaway migration, then regenerate the campaign view:

     ```bash
     M=prisma/schema/migrations/29990101000000_poc_replication_drill
     mkdir -p "$M" && echo 'ALTER TABLE "campaign" ADD COLUMN "poc_drill_note" TEXT;' > "$M/migration.sql"
     DATABASE_URL="$POC_REPLICATION_PRISMA_URL" npx prisma migrate deploy
     rm -r "$M"
     npx tsx --env-file=.env poc-replication/databricks/dms/generate-views.ts --table campaign --apply
     $BENCH --mode update --table campaign --count 20 --rows 10 --check
     ```

   - Also run base step 3 whenever `main` gains migrations; every `ddl` alarm is one more view regeneration.

4. **Network cut (AWS admin).** Three cuts, one at a time, each for 10 minutes, then restore with `pulumi up`:
   - Aurora from DMS: `aws ec2 revoke-security-group-ingress --group-id "$(pulumi stack output securityGroupId)" --security-group-rule-ids "$(aws ec2 describe-security-group-rules --filters Name=group-id,Values="$(pulumi stack output securityGroupId)" --query "SecurityGroupRules[?ReferencedGroupInfo.GroupId=='$(pulumi stack output dmsSecurityGroupId)'].SecurityGroupRuleId" --output text)"`. Slot lag grows; DMS retries, then fails. Record whether it resumes after the restore or needs `aws dms start-replication ... --start-replication-type resume-processing`.
   - DMS to Kinesis: `aws iam delete-role-policy --role-name gp-poc-replication-dms-kinesis --policy-name gp-poc-replication-dms-kinesis-put`. This is the "RUNNING but delivering nothing" case; `canary-missing` must fire either way.
   - Lambda to Zerobus: put a wrong client secret in the Zerobus secret (step C6), wait for `consumer-errors` and `consumer-iterator-age`, put the right one back. Kinesis keeps the records for 24 h, so nothing is lost if it is fixed in time.

5. **TOAST (engineer).** `$BENCH --mode update --count 50 --rows 10 --check` changes `doc` and `updated_at` and never `payload`, which is 8 KB and out of line. `check.payloadChars` must match. If it does not, DMS sent unchanged TOAST values as null; look at `unchanged_toast` and the updates' `row_image` in `dms_cdc_change` to see which form DMS used. Large values: `UPDATE replication_probe SET payload = repeat('x', 200000) WHERE id = (SELECT min(id) FROM replication_probe)` is over 256 KB as DMS counts it (two bytes per character), so the replication must fail rather than truncate.

6. **Reload (engineer and AWS admin).** Delete a probe row and update another while the replication is stopped (`aws dms stop-replication ...`), then follow "C reload" and run `$BENCH --mode check`. It should match only because of the marker.

### Failure modes and detection

Every alarm goes to the `gp-poc-replication-alarms` topic. The three slot alarms come from the base stack.

| Failure mode                                    | How it shows up                                                                                                                                 | Alarm                                                                                                                                                                          |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DMS RUNNING but idle                            | Status `running`, no canary changes reach Zerobus, slot lag grows.                                                                              | `gp-poc-replication-dms-canary-missing` (no canary in 10 min, missing data counts as breaching), `-cdc-latency-source`, `-cdc-latency-target`, base `OldestReplicationSlotLag` |
| Replication failed or stopped                   | `describe-replications` shows `failed` or `stopped`; the canary stops.                                                                          | `-canary-missing`                                                                                                                                                              |
| Slow but working                                | Canary changes take over 30 s to the Zerobus ack. Compare `CDCLatencySource`, `CDCLatencyTarget` and Lambda `IteratorAge` to find the slow hop. | `-canary-lag`                                                                                                                                                                  |
| Unchanged TOAST arrives as null                 | Views show null for a value that is set in Postgres. Not detectable in the consumer.                                                            | None; the bench `--check` (`payloadChars`) and drill 5                                                                                                                         |
| Value over the LOB limit                        | The replication fails instead of truncating.                                                                                                    | `-canary-missing`                                                                                                                                                              |
| DDL on a mirrored table                         | Control record; views lack the new column until regenerated. Renames and retypes leave old rows wrong until a reload.                           | `-ddl`                                                                                                                                                                         |
| Truncate                                        | Views keep the old rows.                                                                                                                        | `-truncate`                                                                                                                                                                    |
| Slot lost (failover, restart instead of resume) | DMS fails or starts a fresh full load; changes in between are gone.                                                                             | `-canary-missing`, then "C reload"                                                                                                                                             |
| Slot left behind                                | A stopped or deleted replication's slot keeps WAL forever, and Aurora blocks major version upgrades while logical slots exist.                  | base `OldestReplicationSlotLag`, `ReplicationSlotDiskUsage`, `TransactionLogsDiskUsage`                                                                                        |
| Writer restart or failover                      | Canary inserts fail while the writer is down; DMS must reconnect.                                                                               | `-canary-errors`, then `-canary-missing` if DMS does not recover                                                                                                               |
| Zerobus or service principal failure            | The consumer throws, Lambda retries the batch, iterator age grows. Records expire after 24 h.                                                   | `-consumer-errors`, `-consumer-iterator-age`                                                                                                                                   |
| Records the consumer cannot map                 | No primary key, no change sequence, not JSON. Logged with the Kinesis sequence number and skipped.                                              | `-malformed-records`                                                                                                                                                           |
| DMS Serverless out of memory                    | `CapacityUtilization` at its maximum, then a failed replication.                                                                                | `-capacity`                                                                                                                                                                    |

### Expected freshness

About 7 to 12 s from Postgres commit to a row the bench can see, if everything is healthy. This is an estimate; nothing here has run in AWS.

| Hop                          | Expected                                     | Source                                                                                                                                                                                                              |
| ---------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Slot to DMS to Kinesis       | 1 to a few s                                 | No published number. The eval rates DMS "seconds possible". `CDCLatencySource` and `CDCLatencyTarget` measure it.                                                                                                   |
| Kinesis to Lambda            | up to 1 s poll, plus the 1 s batching window | [Lambda with Kinesis](https://docs.aws.amazon.com/lambda/latest/dg/with-kinesis.html): each shard is polled once per second.                                                                                        |
| Zerobus ack                  | about 150 ms                                 | [Zerobus quotas](https://docs.databricks.com/aws/en/ingestion/zerobus-quotas): "Time to durability approximately 150 ms".                                                                                           |
| Zerobus ack to queryable row | about 5 s                                    | Same page: "Time to table approximately 5 seconds".                                                                                                                                                                 |
| View query                   | about 1 s warm                               | Measured on the Starter warehouse with a few hundred changes. It scans the table's whole change history, so it slows as `dms_cdc_change` grows; past the POC, materialize it (the AUTO CDC alternative below does). |

### Risks

- **DMS reports RUNNING while delivering nothing.** The eval's main complaint about DMS ([AWS re:Post](https://repost.aws/questions/QUvRp8u8gqSxWSF7yxoLmjOQ/dms-replicate-cdc-data-from-aurora-postgresql-serverless-to-amazon-kinesis-data-streams)). The canary exists for this.
- **The Kinesis VPC endpoint changes a shared network.** The VPC is gp-api's shared dev and prod VPC. Private DNS sends every Kinesis API call in it through the endpoint. Nothing in this repo calls Kinesis today, and the endpoint admits 443 from the whole VPC, but the AWS admin must agree to it. [DMS VPC endpoints](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_VPC_Endpoints.html) explains why it is required.
- **TOAST.** Handled for the placeholder and for a missing column; not for a null. REPLICA IDENTITY FULL puts the old value in the WAL, but whether DMS uses it is unverified, and FULL costs extra WAL on every update ([DMS PostgreSQL source](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Source.PostgreSQL.html)). A migration that recreates a mirrored table resets its replica identity; re-run `sql/dms/002_replica_identity_full.sql`.
- **LOB limits.** DMS maps `text` and `jsonb` to NCLOB at two bytes per character, and Kinesis targets have no full LOB mode and cap LOBs at 1 MB ([Kinesis target](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Target.Kinesis.html)). A larger `campaign.data` cannot be mirrored this way at all.
- **No custom CDC start point on Serverless.** Lost slot means a full reload and a gap. A deprovisioned replication loses its table metadata ([DMS Serverless limitations](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Serverless.Limitations.html)).
- **Aurora keeps WAL for a stalled slot without limit** (eval). The base slot alarms cover this, and the heartbeat keeps an idle slot moving.
- **Six moving parts:** the slot, DMS, Kinesis, the Lambda, the Zerobus service principal secret and the views (regenerated after every migration that touches a mirrored table). That is the opposite of near-zero upkeep, so the soak and the day-long canary matter more than the burst.
- **Zerobus cannot follow a recreated or renamed target table.** Unflushed data is deleted after 28 days ([Zerobus concepts](https://docs.databricks.com/aws/en/ingestion/zerobus-concepts), [Zerobus quotas](https://docs.databricks.com/aws/en/ingestion/zerobus-quotas)).
- **Change sequence format.** The ordering relies on `$AR_H_CHANGE_SEQ` being numeric, at most 40 digits, and in commit order for changes to the same row. Documented, but not seen on a real record yet (step C8).
- **Large integers.** DMS 3.5.1 and later may write big `bigint` values in scientific notation to streaming targets ([DMS release notes](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_ReleaseNotes.html)); the views' `CAST` would then fail. The POC's ids are small. The Kinesis setting `UseLargeIntegerValue` fixes it but is not in the `@pulumi/aws` version gp-api uses.
- **The DMS metric dimension comes from community code.** AWS documents the Serverless metric names but not their dimension. The alarms use `ReplicationConfigId = <account>:<resource id>`, taken from a [working Terraform setup](https://github.com/Dozuki/CloudPrem-Infra/blob/1c651d7c9990be9760d87208dde6702e90d9bf5a/terraform/physical/monitoring.tf). Step C8 checks it.
- **Timestamp time zone.** The views read DMS timestamps with no zone as UTC (DMS says it normalizes `timestamptz` to UTC). `TIMESTAMP_NTZ` columns are compared through the session time zone, as in the base bench.

### Alternative: Kinesis straight into a Databricks AUTO CDC pipeline

Instead of the Lambda, Zerobus and the views, a Lakeflow declarative pipeline reads the Kinesis stream itself ([read_kinesis](https://docs.databricks.com/aws/en/sql/language-manual/functions/read_kinesis)) and applies the changes with AUTO CDC ([AUTO CDC INTO](https://docs.databricks.com/aws/en/ldp/developer/ldp-sql-ref-apply-changes-into), [AUTO CDC APIs](https://docs.databricks.com/aws/en/ldp/cdc)). Sketch, not tested:

```sql
CREATE OR REFRESH STREAMING TABLE dms_kinesis AS
SELECT parse_json(CAST(data AS STRING)) AS msg, approximateArrivalTimestamp AS arrived_at
FROM STREAM read_kinesis(
  streamName => 'gp-poc-replication-dms', region => 'us-west-2',
  serviceCredential => 'gp-poc-replication-kinesis', initialPosition => 'trim_horizon');

CREATE OR REFRESH STREAMING TABLE replication_probe;

CREATE FLOW replication_probe_cdc AS AUTO CDC INTO replication_probe
FROM (
  SELECT
    CAST(msg:data.id::string AS BIGINT) AS id,
    nullif(msg:data.payload::string, 'unchanged-toast-datum') AS payload,
    msg:data.doc::string AS doc,
    CAST(concat(msg:data.updated_at::string, '+00:00') AS TIMESTAMP) AS updated_at,
    msg:metadata.operation::string AS op,
    CASE WHEN msg:metadata.operation::string = 'load' THEN '0'
         ELSE concat('1', lpad(msg:data._dms_change_seq::string, 40, '0')) END AS seq
  FROM STREAM(dms_kinesis)
  WHERE msg:metadata['record-type']::string = 'data'
    AND msg:metadata['table-name']::string = 'replication_probe'
)
KEYS (id)
IGNORE NULL UPDATES ON (payload)
APPLY AS DELETE WHEN op = 'delete'
SEQUENCE BY seq
COLUMNS * EXCEPT (op, seq)
STORED AS SCD TYPE 1;
```

|                            | Lambda, Zerobus and views (built here)                | Kinesis into AUTO CDC                                                                                             |
| -------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Moving parts after Kinesis | Lambda, Zerobus secret, views                         | One pipeline                                                                                                      |
| Current state              | A view over every change, computed per query          | A materialized streaming table, maintained by the pipeline; out-of-order changes and deletes handled by AUTO CDC  |
| Freshness                  | Zerobus "about 5 s" to table                          | Seconds only in continuous mode; a triggered pipeline is as fresh as its schedule                                 |
| Cost                       | Lambda and Zerobus per use                            | An always-on pipeline cluster in continuous mode                                                                  |
| TOAST                      | Missing column carried forward; legitimate nulls kept | `IGNORE NULL UPDATES ON (...)` keeps old values, but also ignores a real update to null in those columns          |
| Schema change              | Raw table never changes; regenerate a view            | Change the flow's column list and restart the pipeline                                                            |
| Access                     | Zerobus service principal                             | A Databricks service credential (an IAM role Databricks assumes to read Kinesis): AWS admin plus Databricks admin |
| History                    | Raw changes kept in `dms_cdc_change`                  | Add `STORED AS SCD TYPE 2`, or keep `dms_kinesis`                                                                 |

If path C wins on freshness but the views get slow or the Lambda is a burden, this is the next thing to try. It reuses everything up to Kinesis.

### Path C teardown

1. AWS admin: stop the replication, then remove the path C resources. Deleting the replication config should drop the slot DMS created.

   ```bash
   aws dms stop-replication --replication-config-arn "$(pulumi stack output dmsReplicationConfigArn)"
   pulumi config set dmsStartReplication false
   pulumi config set enableDms false
   pulumi up
   ```

2. DB admin, only if the cluster stays up for another path: check that no slot is left and remove the DMS objects.

   ```sql
   SELECT slot_name, active FROM pg_replication_slots;
   -- SELECT pg_drop_replication_slot('<slot_name>');  -- for any DMS slot still listed
   DROP EVENT TRIGGER IF EXISTS awsdms_intercept_ddl;
   DROP SCHEMA IF EXISTS awsdms CASCADE;
   DROP OWNED BY dms_repl;
   DROP ROLE IF EXISTS dms_repl;
   DROP TABLE IF EXISTS replication_canary;
   ALTER TABLE replication_probe REPLICA IDENTITY DEFAULT;
   ALTER TABLE campaign REPLICA IDENTITY DEFAULT;
   ```

3. Databricks workspace admin: delete the `gp-poc-replication-zerobus` service principal and run `DROP SCHEMA goodparty_data_catalog.gp_api_mirror_dms CASCADE`.

### Path C: verified and not verified

Verified without AWS:

- `npx tsc -p tsconfig.deploy.json` covers `dms.ts`, the Lambda handlers and `generate-views.ts`; it passes.
- Under Pulumi mocks (a throwaway harness, not committed), `enableDms=true` creates 58 resources (12 base plus 46 for path C) and resolves every output, including the alarm dimension and the table mappings. With the flag off it is the base's 12.
- `lambda/dms-zerobus/dmsRecord.test.ts` (21 tests, run by gp-api's vitest) maps synthetic DMS Kinesis payloads: CDC insert, full-load row, delete, string primary key, update with the unchanged-TOAST placeholder, a primary key change, the campaign table, truncate, DDL and other control records, an unmirrored table, missing change sequence, missing primary key and non-JSON. It also checks the ordering key and folds shuffled, duplicated changes into the expected current state.
- On local PostgreSQL 17 (`postgres:17`, `wal_level=logical`, not Aurora): all gp-api migrations apply, `sql/dms/001` and `002` apply twice, `003` applies twice with stand-in `rds_*` roles and refuses to run without `DMS_SOURCE_PASSWORD`, and its login can read the tables and create objects in `awsdms`. test_decoding prints `unchanged-toast-datum` for an untouched TOASTed column with and without REPLICA IDENTITY FULL, and the full old value under `old-key:` with it.
- The generated views compile on the Starter warehouse against the real `dms_cdc_change` table.
- End to end with a local stand-in for DMS, Kinesis and Zerobus (a script, not committed, that reads a test_decoding slot on that local database, shapes each change like a DMS Kinesis record, runs the real `mapDmsKinesisData` and inserts the change rows with SQL): the unchanged base bench matched on every run. Insert 20, update 20 (20 unchanged-TOAST placeholders carried forward; `payloadChars` matched), delete 5, campaign insert 10, update 20 and delete 3, and a 2-minute soak at 2 updates/s (240 seen, 0 missed). Doubling every raw row still matched. After dropping changes from the slot, the check failed, a reload without the marker still failed, and a reload with the marker matched. The schema drill: rows visible at 3.2 s, the missing-column error, then column and values together at 26.3 s, right after `generate-views.ts --apply` ran at 25 s. Lag there (about 3 to 7 s) measures the stand-in, not DMS.
- `build.sh` output runs in the AWS Lambda Node.js 22 image (`public.ecr.aws/lambda/nodejs:22`, linux/amd64): the Zerobus native module loads at init, a batch of DDL, unmirrored, truncate and malformed records returns success with the expected log lines and metrics, and a batch with a change reaches Secrets Manager (and fails there, with fake credentials, so Lambda would retry it).
- The `dms_cdc_change` and `dms_cdc_reload` tables and the three views exist in `goodparty_data_catalog.gp_api_mirror_dms`, empty.

Not verified: anything in AWS; a real DMS Kinesis record (field names, the change sequence and how DMS sends unchanged TOAST values all come from the docs); whether added columns flow without a reload; a Zerobus write with a service principal (a user OAuth token is rejected with "Invalid token audience"); the DMS Serverless metric dimension; Aurora failover with a logical slot; the AUTO CDC sketch.

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

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

Bench target: `goodparty_data_catalog.gp_api_mirror_lakeflow` (the mirror tables as landed). `goodparty_data_catalog.gp_api_mirror_lakeflow_read` (typed views, B.7) also works and adds the view's overhead to each poll.

An ingestion gateway (classic compute, always on) reads the `lakeflow_gp_api_poc` logical replication slot and stages changes in a volume. A serverless ingestion pipeline, run every 5 minutes by a job, applies them to one streaming table per source table in `gp_api_mirror_lakeflow` (SCD type 1: current state, deletes applied). The publication is `FOR ALL TABLES` and the pipeline ingests the whole `public` schema, so the mirror is every gp-api table plus `replication_probe`, about 125 tables (Databricks recommends 250 or fewer per pipeline).

Lakeflow does not land every type the way Postgres has it ([type mapping](https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/postgresql-reference)):

| Postgres                              | Lands as    | What reads need                                                                                                                             |
| ------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `uuid`                                | `BINARY`    | Convert to text. gp-api has no `uuid` columns today (Prisma ids are `text`), but any new one gets the conversion in the read views.         |
| `timestamp` (every Prisma `DateTime`) | `STRING`    | `CAST(col AS TIMESTAMP_NTZ)`. Not `TIMESTAMP_NTZ` as the base bench notes assume; the bench's `CAST(updated_at AS TIMESTAMP)` handles both. |
| `timestamptz`                         | `TIMESTAMP` | Nothing.                                                                                                                                    |
| `jsonb`, arrays, enums                | `STRING`    | Parse with `:` paths, `from_json`, or leave as text.                                                                                        |

The read views in `gp_api_mirror_lakeflow_read` (one per table, same name) turn `uuid` back into lowercase uuid text and `timestamp` into `TIMESTAMP_NTZ`, and pass every other column through. Point anything that wants Postgres-like types at that schema. The read pattern for a `uuid` column `c`, if you query the mirror directly:

```sql
CASE WHEN octet_length(c) = 16
  THEN lower(concat_ws('-', substr(hex(c), 1, 8), substr(hex(c), 9, 4), substr(hex(c), 13, 4),
    substr(hex(c), 17, 4), substr(hex(c), 21, 12)))
  ELSE lower(CAST(c AS STRING)) END
```

It handles 16 raw bytes, the uuid text stored as bytes, and `STRING`, whichever actually lands. Comparing a raw `BINARY` column with uuid text finds nothing.

Files:

| Path                                  | What                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lakeflow.ts` (flag `enableLakeflow`) | An empty Secrets Manager secret for the replication user, optional extra ingress CIDRs (`lakeflowGatewayCidrs`), and an optional failover reader with its own copy of the three slot and WAL alarms (`lakeflowFailoverReader`).                                                                                                                 |
| `sql/lakeflow/001_source_setup.sql`   | Replication user `lakeflow_replication`, grants (current and future tables), `REPLICA IDENTITY FULL` on every table, publication `lakeflow_gp_api_poc` `FOR ALL TABLES`, `pgoutput` slot `lakeflow_gp_api_poc`. Re-runnable.                                                                                                                    |
| `sql/lakeflow/002_read_views.sql`     | Prints the read view DDL from the Postgres catalog, one statement per line.                                                                                                                                                                                                                                                                     |
| `sql/lakeflow/teardown.sql`           | Drops the slot, publication, grants and user.                                                                                                                                                                                                                                                                                                   |
| `databricks/lakeflow/`                | Bundle: schemas `gp_api_mirror_lakeflow` and `gp_api_mirror_lakeflow_read` (`dbt-users` get `USE SCHEMA` and `SELECT`), gateway, ingestion pipeline over schema `public` (SCD type 1, auto full refresh on, at most once an hour per table), 5-minute job, event logs, failure emails. The continuous variant is commented out in the pipeline. |

Bundles cannot create Unity Catalog connections (the bundle schema has no `connections` resource), so B.5 creates it with the CLI.

### B.1 Enroll and check rights (Databricks workspace admin)

- The PostgreSQL connector is in Public Preview and needs enrollment through the Databricks account team ([pipeline docs](https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/postgresql-pipeline)). Confirm "PostgreSQL" shows under Data Ingestion > Databricks connectors.
- Whoever deploys needs `CREATE CONNECTION` on the metastore, `CREATE SCHEMA` on `goodparty_data_catalog`, and unrestricted cluster creation (the gateway runs on classic compute). Serverless must be on for the workspace (it is; the Starter warehouse is serverless).
- Install Databricks CLI 0.276 or later and log in to `https://dbc-3d8ca484-79f3.cloud.databricks.com`.

### B.2 Confirm the gateway can reach the cluster (AWS admin and Databricks account admin)

The gateway runs on classic compute, so serverless NCC and private endpoint rules do not apply. What the repo shows: the gp-api VPC (`vpc-0763fa52c32ebcf6a`, 10.0.0.0/16) has peering connection `pcx-013299c506ffd3395` to 172.16.0.0/16, its private subnets route 172.16.0.0/16 over it (`../deploy/components/vpc.ts`, commit `328a05cb75` "add databricks peering route to private subnets"), and the gp-api databases allow 5432 from 172.16.0.0/16 as "databricks via vpc peering". That points to a customer-managed workspace VPC peered to ours. Nobody has confirmed it from the Databricks side, which needs account admin rights.

Option 1, expected: the workspace VPC is the 172.16.0.0/16 side of that peering. Nothing new is needed; the POC cluster sits in the same private subnets and the base security group already allows 172.16.0.0/16. Check:

```bash
# Databricks account admin: the workspace's network config and its VPC
databricks account workspaces list -o json | jq '.[] | select(.deployment_name == "dbc-3d8ca484-79f3") | {workspace_id, network_id}'
databricks account networks get <network_id> -o json | jq '{vpc_id, subnet_ids, security_group_ids}'

# AWS admin: the peering is active and the other side is that VPC
aws ec2 describe-vpc-peering-connections --vpc-peering-connection-ids pcx-013299c506ffd3395 \
  --query 'VpcPeeringConnections[0].{status: Status.Code, requester: RequesterVpcInfo, accepter: AccepterVpcInfo}'
# The workspace VPC routes back to 10.0.0.0/16 (or at least the private subnets) over the peering
aws ec2 describe-route-tables --filters Name=vpc-id,Values=<workspace vpc id> \
  --query "RouteTables[].Routes[?VpcPeeringConnectionId=='pcx-013299c506ffd3395']"
```

If the workspace subnets are outside 172.16.0.0/16, add them: `pulumi config set --path 'lakeflowGatewayCidrs[0]' <cidr>`.

Option 2: the workspace uses a Databricks-managed VPC, or a VPC not peered to ours. The gateway then has no private route to the cluster. Peer that VPC with the gp-api VPC (AWS admin), add the route to the private subnets through `extraRoutes` in `../deploy/components/vpc.ts` (those route tables declare their routes inline, so a route added from this stack would be removed by the next gp-api deploy), add the return route on the Databricks side, then set `lakeflowGatewayCidrs`. That changes the shared gp-api stack, so it needs its own reviewed PR; this POC does not make it. Making the cluster public is not an option.

The end-to-end check is the gateway's event log in B.6: a connection timeout there means the network is wrong.

### B.3 Turn on the path (AWS admin)

```bash
pulumi config set enableLakeflow true
pulumi up
```

This adds the empty secret `gp-poc-replication-lakeflow-replication-user` (output `lakeflowReplicationSecretArn`). Pulumi never holds its value.

### B.4 Source setup (DB admin)

After base steps 3 and 4, with `POC_REPLICATION_DATABASE_URL` exported as in base step 2 (master user). Needs psql 15 or later and `jq`. The password goes from `openssl` into the secret and into psql through an environment variable, so it never appears on screen.

```bash
SECRET=$(pulumi stack output lakeflowReplicationSecretArn)
export LAKEFLOW_REPLICATION_PASSWORD="$(openssl rand -hex 24)"
jq -cn --arg p "$LAKEFLOW_REPLICATION_PASSWORD" '{username: "lakeflow_replication", password: $p}' \
  | aws secretsmanager put-secret-value --secret-id "$SECRET" --secret-string file:///dev/stdin --query VersionId
psql "$POC_REPLICATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/lakeflow/001_source_setup.sql
unset LAKEFLOW_REPLICATION_PASSWORD
```

The seven `GRANT SELECT ON pg_catalog...` lines end with "no privileges were granted" warnings on Aurora; that is expected (those catalogs are readable by everyone already). The closing queries should show `rds_replication = t` and `tables_without_select = 0`, the publication with `puballtables = t` and every table, `replica_identity_other = 0`, the slot with `plugin = pgoutput` and `active = f`, and `max_slot_wal_keep_size`.

If `CREATE PUBLICATION ... FOR ALL TABLES` is refused (community Postgres needs superuser for it; the RDS docs show the master user running it), create it from an explicit list instead, then re-run the file (it skips the existing publication). New tables then need `ALTER PUBLICATION lakeflow_gp_api_poc ADD TABLE ...`:

```bash
psql "$POC_REPLICATION_DATABASE_URL" -v ON_ERROR_STOP=1 -At -c "SELECT 'CREATE PUBLICATION lakeflow_gp_api_poc FOR TABLE '
  || string_agg(format('public.%I', tablename), ', ' ORDER BY tablename) FROM pg_tables WHERE schemaname = 'public'" \
  | psql "$POC_REPLICATION_DATABASE_URL" -v ON_ERROR_STOP=1
```

Databricks recommends a finite `max_slot_wal_keep_size` so a stalled slot cannot fill the disk ([source setup](https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/postgresql-source-setup)). The base parameter group does not set it, and whether Aurora accepts it is unverified. To check (AWS admin):

```bash
aws rds describe-db-cluster-parameters --db-cluster-parameter-group-name gp-poc-replication-params \
  --query "Parameters[?ParameterName=='max_slot_wal_keep_size'].{value: ParameterValue, modifiable: IsModifiable}"
```

If it is modifiable, setting it is a base change (the parameter group lives in `index.ts`), and an exceeded limit invalidates the slot, which forces a full refresh. Until then the CloudWatch alarms are the only guard.

To re-run the file later (after migrations that add tables) without changing the password, load the current one from the secret:

```bash
export LAKEFLOW_REPLICATION_PASSWORD="$(aws secretsmanager get-secret-value --secret-id "$(pulumi stack output lakeflowReplicationSecretArn)" \
  --query SecretString --output text | jq -r .password)"
psql "$POC_REPLICATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/lakeflow/001_source_setup.sql
unset LAKEFLOW_REPLICATION_PASSWORD
```

To rotate the password, re-run the first block, then paste the new password into the connection in Catalog Explorer.

### B.5 Create the Unity Catalog connection (Databricks workspace admin, with read access to the secret)

Neither Node nor the gateway's JVM trusts the RDS CA, so the connection carries the RDS us-west-2 CA bundle ([TLS validation](https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/tls-server-certificate-validation)).

```bash
curl -sSo /tmp/rds-us-west-2-bundle.pem https://truststore.pki.rds.amazonaws.com/us-west-2/us-west-2-bundle.pem
HOST=$(pulumi stack output writerEndpoint)
SECRET=$(pulumi stack output lakeflowReplicationSecretArn)
(
  umask 077
  aws secretsmanager get-secret-value --secret-id "$SECRET" --query SecretString --output text \
    | jq --arg host "$HOST" --rawfile ca /tmp/rds-us-west-2-bundle.pem '{
        name: "gp_api_poc_lakeflow",
        connection_type: "POSTGRESQL",
        comment: "gp-api replication POC (path B). Delete after the POC.",
        options: {host: $host, port: "5432", database: "gp_api_poc",
                  user: .username, password: .password, userProvidedServerCertificate: $ca}}' \
    > /tmp/lakeflow-connection.json
  databricks connections create --json @/tmp/lakeflow-connection.json -o json | jq '{name, connection_type, owner}'
  rm -f /tmp/lakeflow-connection.json
)
```

`writerEndpoint` is the cluster endpoint, so after a failover it follows the new writer. If the gateway later fails with `PKIX path building failed`, the multi-certificate bundle was not accepted. Replace it with the single CA the cluster uses (`aws rds describe-db-instances --db-instance-identifier gp-poc-replication-writer --query 'DBInstances[0].CACertificateIdentifier'`, then that certificate from the same bundle) by editing the connection in Catalog Explorer.

### B.6 Deploy the bundle and start it (Databricks workspace admin)

```bash
cd databricks/lakeflow
databricks bundle validate
databricks bundle deploy
databricks bundle run lakeflow_gateway --no-wait
```

The gateway provisions a VM and takes a few minutes to start. Watch it in the UI (Jobs & Pipelines > `gp-api-mirror-lakeflow-gateway`) or in its event log:

```sql
SELECT timestamp, level, message FROM goodparty_data_catalog.gp_api_mirror_lakeflow.gateway_event_log
ORDER BY timestamp DESC LIMIT 50
```

Once it is running and the slot shows `active = t` in Postgres, run the first ingestion by hand (the job then runs it every 5 minutes; runs before the gateway is ready can fail with "Timeout while waiting for table token"). The first runs snapshot all 125 tables; with the POC's small tables that should take one or two runs.

```bash
databricks bundle run lakeflow_ingestion
```

### B.7 Create the read views (Databricks workspace admin or engineer with `CREATE` on the read schema)

After the first ingestion run has created the mirror tables. From `packages/gp-api/poc-replication`, with `POC_REPLICATION_DATABASE_URL` exported:

```bash
psql "$POC_REPLICATION_DATABASE_URL" -At -v ON_ERROR_STOP=1 -f sql/lakeflow/002_read_views.sql > /tmp/lakeflow-read-views.sql
while IFS= read -r statement; do
  jq -n --arg s "$statement" '{warehouse_id: "18583d8b081c6486", statement: $s, wait_timeout: "50s"}' > /tmp/lakeflow-view.json
  databricks api post /api/2.0/sql/statements --json @/tmp/lakeflow-view.json | jq -r '.status.state + " " + (.status.error.message // "")'
done < /tmp/lakeflow-read-views.sql
```

`18583d8b081c6486` is the Serverless Starter Warehouse. Every line should print `SUCCEEDED`. The views use `WITH SCHEMA EVOLUTION`, so a column added to a mirror table shows up in its view without this step; re-run it after migrations that add tables or `uuid` or `timestamp` columns.

### B.8 Check the mirror (engineer)

```bash
psql "$POC_REPLICATION_DATABASE_URL" -c 'SELECT count(*) FROM replication_probe' -c 'SELECT count(*) FROM campaign'
```

```sql
SHOW TABLES IN goodparty_data_catalog.gp_api_mirror_lakeflow;
DESCRIBE TABLE goodparty_data_catalog.gp_api_mirror_lakeflow.campaign;
SELECT count(*) FROM goodparty_data_catalog.gp_api_mirror_lakeflow.replication_probe;
```

Counts should match once the next run finishes. Record the actual types of `campaign.updated_at` and of `replication_probe.doc` in the `DESCRIBE` output, and any extra columns Lakeflow adds.

### B.9 Benchmark (engineer)

Warm the Starter warehouse first. With minutes of lag, poll every 1 to 2 seconds rather than 250 ms; the resolution does not matter at this scale and the warehouse does less work. From `packages/gp-api`:

```bash
BENCH="npx tsx --env-file=.env poc-replication/bench/bench.ts --target goodparty_data_catalog.gp_api_mirror_lakeflow --timeout-s 1200"

# Bursts (lag is mostly the wait for the next 5-minute run)
$BENCH --mode insert --count 20 --poll-ms 1000 --check
$BENCH --mode update --count 20 --rows 10 --poll-ms 1000 --check
$BENCH --mode delete --count 10 --poll-ms 1000 --check
$BENCH --mode insert --table campaign --count 10 --poll-ms 1000
$BENCH --mode update --table campaign --count 20 --rows 10 --poll-ms 1000 --check

# Soak: one update every 5 s for an hour, which covers 12 scheduled runs
$BENCH --mode update --soak --rate 0.2 --minutes 60 --poll-ms 2000 --check

# Overnight reliability: one update a minute for 12 hours
$BENCH --mode update --soak --rate 0.0167 --minutes 720 --poll-ms 5000 --check

# The same check through the read views
npx tsx --env-file=.env poc-replication/bench/bench.ts --mode check --table campaign \
  --target goodparty_data_catalog.gp_api_mirror_lakeflow_read
```

The update modes leave `payload` unchanged, so with `REPLICA IDENTITY FULL` the new row arrives with `payload` marked "unchanged TOAST" and the full value only in the old row. `check`'s payload length total catches a connector that writes that as null.

Record `lagMs` p50, p95 and max, `notSeenWithinTimeout`, `pollFailures`, `check.matched`, and the job's run durations:

```sql
SELECT origin.update_id,
  min(timestamp) AS started,
  max(timestamp) AS ended,
  max_by(details:update_progress.state, timestamp) AS last_state
FROM goodparty_data_catalog.gp_api_mirror_lakeflow.ingestion_event_log
WHERE event_type IN ('create_update', 'update_progress')
GROUP BY origin.update_id ORDER BY started DESC LIMIT 30
```

If Databricks enables continuous mode for PostgreSQL, uncomment `continuous: true` in `resources/lakeflow_postgres.yml`, set the job's `pause_status` to `PAUSED`, `databricks bundle deploy`, and run the same benchmarks.

### B.10 Drills

Run each after a clean soak, with a soak running across it so the bench counts what was lost or late. Record for each: the slot before and after, every gateway and ingestion error (query in B.11), whether anything needed a manual step or a full refresh, the bench summary, and `retained_wal` at its peak. Slot state:

```sql
SELECT aurora_db_instance_identifier() AS instance;
SELECT slot_name, active, wal_status, restart_lsn, confirmed_flush_lsn,
  pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained_wal
FROM pg_replication_slots WHERE slot_name = 'lakeflow_gp_api_poc';
```

The soak for all of them:

```bash
$BENCH --mode update --soak --rate 0.5 --minutes 40 --poll-ms 2000 --timeout-s 1800 --check
```

Some writes fail during a failover or reboot; that is expected and counted in `opFailures`.

#### Failover (AWS admin and engineer)

This settles the disputed point in the replication evaluation: Databricks says a failover loses the slot and forces a full refresh of every table ([limitations](https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/postgresql-limits), "Replication"), while Aurora keeps state on a shared cluster volume.

1. AWS admin adds a reader that can take over:

   ```bash
   pulumi config set lakeflowFailoverReader true
   pulumi up
   ```

2. Engineer records the slot, then starts the soak.
3. About 10 minutes in, the AWS admin fails over:

   ```bash
   aws rds failover-db-cluster --db-cluster-identifier gp-poc-replication-db \
     --target-db-instance-identifier gp-poc-replication-reader
   aws rds wait db-instance-available --db-instance-identifier gp-poc-replication-reader
   aws rds describe-db-clusters --db-cluster-identifier gp-poc-replication-db \
     --query 'DBClusters[0].DBClusterMembers[].{id: DBInstanceIdentifier, writer: IsClusterWriter}'
   ```

4. Engineer records the slot again through the cluster endpoint (now on the new writer) and watches both event logs for 15 minutes.
5. Read the result:

   | What you see                                                                                                        | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                      |
   | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | Slot listed on the new writer, gateway reconnects, soak ends with `notSeenWithinTimeout` 0 and `check.matched` true | The slot survives an Aurora failover; the Databricks limitation does not apply here.                                                                                                                                                                                                                                                                                                                                         |
   | Slot listed, but the gateway errors (for example an LSN or "replication slot ... is active" error)                  | Partial. Record the error and whether a gateway restart (`databricks bundle run lakeflow_gateway --restart --no-wait`) clears it.                                                                                                                                                                                                                                                                                            |
   | Slot missing, gateway or ingestion fails with "slot not found"                                                      | Full refresh forced. Recover and time it: recreate the slot as poc_admin (`SET ROLE lakeflow_replication; SELECT pg_create_logical_replication_slot('lakeflow_gp_api_poc', 'pgoutput'); RESET ROLE;`), `databricks bundle run lakeflow_gateway --restart --no-wait`, then `databricks bundle run lakeflow_ingestion --full-refresh-all` from `databricks/lakeflow`. Run `--mode check` on both tables to look for lost rows. |

After a failover the reader is the writer. Leave `lakeflowFailoverReader` on until `pulumi destroy`, or fail back first: turning it off would delete the current writer. The base alarms watch `gp-poc-replication-writer` and the path's copies watch `gp-poc-replication-reader`, so one set always covers the current writer.

#### Writer reboot (AWS admin and engineer)

Same procedure with a plain reboot of whichever instance is the writer:

```bash
aws rds reboot-db-instance --db-instance-identifier gp-poc-replication-writer
```

The slot should survive a reboot; if it does not, that is worse news than the failover result. A minor version upgrade is the same kind of restart and can be drilled the same way (`aws rds modify-db-cluster --db-cluster-identifier gp-poc-replication-db --engine-version <next 17.x> --apply-immediately`). A major version upgrade needs every logical slot dropped first ([Aurora major upgrades](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/USER_UpgradeDBInstance.PostgreSQL.MajorVersion.html)), so it always means a full refresh; there is nothing to drill.

#### Schema change through a Prisma-style migration (DB admin and engineer)

Without inline DDL tracking, which Databricks has on hold, the connector detects a schema change and the affected table needs a full refresh ([limitations](https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/postgresql-limits), "Schema evolution"). The pipeline has auto full refresh on, so it should do that refresh itself in its retry run. These drills find out whether it does, and how long the table is stale or missing meanwhile.

1. Column add, with the bench's drill (applies `sql/002_replication_probe_add_column.sql`, the shape of a Prisma `ALTER TABLE ... ADD COLUMN`):

   ```bash
   $BENCH --mode schema-drill --timeout-s 3600 --poll-ms 2000
   ```

   Record the `timeline`, then look for the schema change and any full refresh in the ingestion event log (B.11). If nothing heals it within an hour, refresh the table by hand and time that:

   ```bash
   cd databricks/lakeflow && databricks bundle run lakeflow_ingestion --full-refresh replication_probe --restart
   ```

2. New table, the most common Prisma migration. As poc_admin, with psql:

   ```sql
   CREATE TABLE "lakeflow_drill_table" (
     "id" TEXT NOT NULL,
     "note" TEXT,
     "data" JSONB NOT NULL DEFAULT '{}',
     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "lakeflow_drill_table_pkey" PRIMARY KEY ("id")
   );
   INSERT INTO lakeflow_drill_table (id, note) VALUES ('drill-1', 'synthetic');
   ```

   The publication (`FOR ALL TABLES`) and the replication user's `SELECT` (default privileges) cover it at once; its replica identity starts as `DEFAULT`. Poll `SELECT * FROM goodparty_data_catalog.gp_api_mirror_lakeflow.lakeflow_drill_table` and record when it appears. The gateway looks for new tables only every few hours (up to 6, per [maintenance](https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/postgresql-maintenance)); if it has not appeared after 30 minutes, restart the gateway (`databricks bundle run lakeflow_gateway --restart --no-wait`) and time it again. Then re-run `sql/lakeflow/001_source_setup.sql` as in B.4 (sets `FULL`) and B.7 (adds its view).

3. Column rename (Prisma emits `ALTER TABLE ... RENAME COLUMN` for `@map` changes), which Databricks lists as needing a full refresh even with inline DDL:

   ```sql
   ALTER TABLE lakeflow_drill_table RENAME COLUMN note TO note_text;
   UPDATE lakeflow_drill_table SET note_text = 'renamed' WHERE id = 'drill-1';
   ```

   Record whether auto full refresh picks it up and what the mirror table looks like after. Clean up with `DROP TABLE lakeflow_drill_table` in Postgres; Lakeflow does not drop the destination table, so drop it too.

4. Real migrations: whenever `main` gains migrations, run base step 3 again, then `sql/lakeflow/001_source_setup.sql` as in B.4 and B.7, and record what the pipeline did with each change.

#### Network cut (DB admin, or AWS admin for the closer version)

1. DB-level cut, no AWS access needed. As poc_admin:

   ```sql
   ALTER ROLE lakeflow_replication NOLOGIN;
   SELECT pg_terminate_backend(active_pid) FROM pg_replication_slots
   WHERE slot_name = 'lakeflow_gp_api_poc' AND active_pid IS NOT NULL;
   ```

   Leave it 15 minutes, then `ALTER ROLE lakeflow_replication LOGIN;`. Record whether the gateway retries and recovers by itself, or fails and needs a restart, and how long the mirror takes to catch up.

2. Network-level cut (AWS admin). Remove the ingress rule the gateway uses, then kill the open connection, because security groups do not cut connections that are already tracked:

   ```bash
   SG=$(pulumi stack output securityGroupId)
   RULE=$(aws ec2 describe-security-group-rules --filters Name=group-id,Values="$SG" \
     --query "SecurityGroupRules[?CidrIpv4=='172.16.0.0/16'].SecurityGroupRuleId" --output text)
   aws ec2 revoke-security-group-ingress --group-id "$SG" --security-group-rule-ids "$RULE"
   ```

   Then the same `pg_terminate_backend` as above. Reconnects now time out instead of failing to log in. After 15 minutes, restore the rule with `pulumi up --refresh`.

3. Long outage, to see WAL build up and the alarm fire. Lower the threshold first (`pulumi config set slotLagAlarmBytes 104857600 && pulumi up`), run the DB-level cut for 2 hours under `$BENCH --mode update --soak --rate 2 --minutes 150 --poll-ms 5000 --timeout-s 9000 --check`, and record `retained_wal` every 15 minutes and when `gp-poc-replication-OldestReplicationSlotLag` fired. Restore the threshold after.

### B.11 Failure modes and detection

| Failure mode                                                                                       | How you detect it                                                                                          | Fix                                                                                                                |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Gateway stopped or crashed, WAL piles up (Aurora keeps WAL for a stalled slot without limit)       | Slot `active = f`; `OldestReplicationSlotLag` and `TransactionLogsDiskUsage` alarms; gateway failure email | `databricks bundle run lakeflow_gateway --restart --no-wait`                                                       |
| Slot lost (failover per Databricks, manual drop, major upgrade, `max_slot_wal_keep_size` exceeded) | "slot not found" in the event logs; slot missing from `pg_replication_slots`                               | Recreate and full refresh (failover drill, last row)                                                               |
| Schema change (add, rename or retype a column)                                                     | Schema change errors in the ingestion event log; that table stops updating                                 | Auto full refresh should handle it; otherwise refresh the table by hand (schema drill, step 1)                     |
| New table not mirrored                                                                             | Missing from `SHOW TABLES`; up to 6 hours before the gateway notices                                       | Restart the gateway; re-run `001_source_setup.sql` (B.4) and B.7                                                   |
| Ingestion runs failing or skipped                                                                  | Job failure emails; soak `notSeenWithinTimeout` above 0; run table in B.9                                  | Read the update's errors in the ingestion event log                                                                |
| Silent staleness                                                                                   | `--mode check` stops matching; a low-rate soak left running is the canary                                  | Check both pipelines are running                                                                                   |
| No successful run for 25 days (staged CDC files are deleted after 25 to 30 days)                   | Run table in B.9                                                                                           | Full refresh ([maintenance](https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/postgresql-maintenance)) |
| TOAST values arriving as null                                                                      | `check.target.payloadChars` below the source                                                               | Confirm `REPLICA IDENTITY FULL` on the table (re-run `001_source_setup.sql` as in B.4), then full refresh it       |
| TLS or network                                                                                     | `PKIX path building failed` or connection timeouts in the gateway event log                                | B.5 and B.2                                                                                                        |
| Cost                                                                                               | `system.billing.usage` for the gateway cluster and the pipeline                                            | Turn it off when the test is done                                                                                  |

Errors and warnings across both pipelines:

```sql
SELECT timestamp, origin.pipeline_name, level, message
FROM goodparty_data_catalog.gp_api_mirror_lakeflow.gateway_event_log WHERE level IN ('WARN', 'ERROR')
UNION ALL
SELECT timestamp, origin.pipeline_name, level, message
FROM goodparty_data_catalog.gp_api_mirror_lakeflow.ingestion_event_log WHERE level IN ('WARN', 'ERROR')
ORDER BY timestamp DESC LIMIT 100
```

Slot lag in Postgres ([maintenance](https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/postgresql-maintenance)):

```sql
SELECT slot_name, active, wal_status,
  pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained_wal,
  pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn)) AS pending_wal
FROM pg_replication_slots WHERE slot_name = 'lakeflow_gp_api_poc'
```

### B.12 Expected freshness and risks

Expected freshness: minutes, not seconds. Databricks recommends at least 5 minutes between ingestion runs because serverless compute takes time to start, and does not support continuous mode for the PostgreSQL ingestion pipeline ([FAQ](https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/postgresql-faq)). A change waits for the next run (0 to 5 minutes) plus that run's duration, so expect p50 around 4 to 6 minutes and max around 10. Continuous mode, where it exists (SQL Server, MySQL and Oracle, Beta), applies changes "typically within a few minutes" ([continuous mode](https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/continuous-integrated-cdc)), so even that would not reach seconds.

Risks:

- Public Preview, enrollment required ([pipeline](https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/postgresql-pipeline)).
- The gateway must run continuously on classic compute, or WAL builds up on the source ([FAQ](https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/postgresql-faq)). Rough cost: an m5.2xlarge driver and an m5.large worker around the clock, plus DBUs and 288 serverless runs a day; the replication evaluation estimated $400 to $1,200 a month. Not measured.
- Slot loss forces a full refresh of every table: failover per Databricks (the failover drill tests it on Aurora), major version upgrades ([Aurora](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/USER_UpgradeDBInstance.PostgreSQL.MajorVersion.html)), manual drops ([limitations](https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/postgresql-limits)).
- Most schema changes need a full refresh of the table while inline DDL tracking is on hold ([source setup](https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/postgresql-source-setup)). Auto full refresh may make that hands-off, at the cost of the table being reloaded; unverified.
- New tables take up to 6 hours to appear unless the gateway is restarted, and need `REPLICA IDENTITY FULL` set by hand ([maintenance](https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/postgresql-maintenance)).
- `REPLICA IDENTITY FULL` on every table makes each update and delete write the whole old row to WAL. On gp-api's dev or prod database that would be a raw-SQL migration and more WAL; Databricks asks for it on any table with TOASTable columns ([source setup](https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/postgresql-source-setup)).
- `experiment_run` has no primary key, so the connector keys it on all its columns ([FAQ](https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/postgresql-faq)). Updates to it are worth checking in the mirror.
- Every Prisma `DateTime` lands as a string and every `uuid` as binary; readers use the read views or cast ([reference](https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/postgresql-reference)).
- Aurora does not cap WAL kept for a stalled slot; the CloudWatch alarms are the only guard while `max_slot_wal_keep_size` is unset.
- Deleting the pipeline does not drop the slot ([FAQ](https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/postgresql-faq)); teardown below does.

### B.13 Teardown

1. Databricks workspace admin:

   ```bash
   cd databricks/lakeflow
   databricks bundle destroy
   databricks connections delete gp_api_poc_lakeflow
   ```

   If a schema is not dropped because it still holds tables or views: `DROP SCHEMA goodparty_data_catalog.gp_api_mirror_lakeflow_read CASCADE`, then the same for `gp_api_mirror_lakeflow`.

2. DB admin, if the cluster stays up for other paths (the gateway must be gone first, or the slot is still active):

   ```bash
   psql "$POC_REPLICATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/lakeflow/teardown.sql
   ```

3. AWS admin: `pulumi config set enableLakeflow false && pulumi up` (see the note under the failover drill about the reader), or go straight to the base teardown.

### B.14 Verified for path B, and what is not

Verified without AWS or admin rights:

- On local PostgreSQL 17 (`wal_level = logical`, not Aurora) after `prisma migrate deploy` and `001_replication_probe.sql`, with a stand-in `rds_replication` role and the replication user given `REPLICATION` (Aurora grants that through `rds_replication`): `sql/lakeflow/001_source_setup.sql` refuses to run without a password, then creates the user, grants, `REPLICA IDENTITY FULL` on all 125 tables, the publication (`FOR ALL TABLES`, 125 tables) and the `pgoutput` slot; it re-runs cleanly. It ran as a superuser, so the `FOR ALL TABLES` permission question on Aurora is still open. The replication user logs in and reads every table.
- Decoding the slot with `pgoutput` after bench writes in dry run: inserts, updates and deletes for `replication_probe`, `user`, `organization` and `campaign`. Updates to `replication_probe` carry the full old row (8,192-byte payload) and mark the unchanged payload in the new row as unchanged TOAST.
- A Prisma-shaped `CREATE TABLE` joins the publication and is readable by the replication user at once, starts with replica identity `DEFAULT`, and gets `FULL` when `001_source_setup.sql` re-runs.
- `sql/lakeflow/002_read_views.sql` prints one view per published table (127 with the drill tables). On the Starter warehouse, in a throwaway `gp_api_mirror_lakeflow_check` schema with tables shaped as the type mapping says Lakeflow lands them: the uuid views return the right uuid text for 16-byte `BINARY`, text `BINARY` and uppercase `STRING`, while the raw 16-byte `BINARY` column finds nothing; `timestamp` strings become `TIMESTAMP_NTZ` and `infinity` becomes null; a column added to a mirror table shows up in its view (`WITH SCHEMA EVOLUTION`). The schemas were dropped afterwards.
- The base bench's `--mode check` against those tables, raw and through the views, for `replication_probe` and `campaign` (with `updated_at` as a string, as Lakeflow lands it): all four matched. Session time zone `Etc/UTC`.
- `databricks bundle validate` passes (CLI v1.7.0) with `source_type: POSTGRESQL`, the schema-level object and `auto_full_refresh_policy`.
- `tsc -p tsconfig.deploy.json`, and the Pulumi program under mocks: 12 resources with the flag off, 13 with `enableLakeflow`, 19 with the failover reader and two gateway CIDRs, and `lakeflowFailoverReader` alone adds nothing.

Not verified, needs an admin:

- Enrollment, the connection, the bundle deploy, the gateway, and any real ingestion.
- Network reachability from the gateway (B.2).
- `FOR ALL TABLES` and `max_slot_wal_keep_size` on Aurora.
- Whether the connection accepts the multi-certificate RDS bundle.
- The actual Delta types Lakeflow writes, any extra columns it adds, and how it applies unchanged TOAST values.
- Whether auto full refresh heals schema changes, and everything else in B.9 and B.10.

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

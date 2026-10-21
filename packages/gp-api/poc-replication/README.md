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
| `--mode`                        | `insert`            | `insert`, `update`, `delete`, `check`, `schema-drill` or `query` (path A, see its section).                                                                                                          |
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

Bench target: `--target gp_api_pg_poc.public`, the foreign catalog's `public` schema.

Databricks reads the POC database live through a Unity Catalog foreign catalog, `gp_api_pg_poc`, over the whole `gp_api_poc` database: every gp-api table plus `replication_probe`. Nothing is copied, so there is no replication slot, no pipeline and no mirror table to keep in sync. The questions for this path are different from B and C: what every query costs, and what happens to reads when Aurora or the network path is down.

### What `enableFederation=true` adds

Serverless SQL warehouses (the Starter warehouse is serverless) can't use the VPC peering, so they reach Aurora through the private connectivity setup in [Configure private connectivity to resources in your VPC](https://docs.databricks.com/aws/en/security/network/serverless-network-security/pl-to-internal-network). `federation.ts` creates:

- An internal NLB `gp-poc-repl-federation` in the private subnets, listening on 5432. Cross-zone load balancing is on, because the Databricks endpoint can land in either AZ while Aurora is in one. Its security group has PrivateLink inbound rule enforcement off, as the Databricks page requires.
- A TCP target group with IP targets. NLB targets can't be DNS names, and Aurora doesn't keep instance IPs stable, so Pulumi registers no targets itself (see IP sync below).
- A VPC endpoint service on that NLB. Acceptance is required, and the only allowed principal is the Databricks serverless role `arn:aws:iam::565502421330:role/private-connectivity-role-us-west-2`. Override it with the `databricksPrivateConnectivityRoleArn` config key.
- An ingress rule on the database security group from the NLB security group.
- The IP-sync Lambda `gp-poc-replication-fed-ip-sync`, its role, log group and two triggers, plus a one-off invocation during `pulumi up`.
- Two alarms on the base SNS topic: `gp-poc-replication-fed-HealthyHostCount` (the NLB has no healthy Aurora target for 2 minutes) and `gp-poc-replication-fed-ip-sync-Errors` (the Lambda failed in the last 5 minutes).

The connection host, and the domain in the NCC rule, is the cluster's reader endpoint (`federationDomainName`). With only the writer instance, the reader endpoint connects to the writer ([Aurora reader endpoint](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Endpoints.Reader.html)).

| Output                          | Used for                                           |
| ------------------------------- | -------------------------------------------------- |
| `federationEndpointServiceName` | The NCC private endpoint rule's `endpoint_service` |
| `federationEndpointServiceId`   | Accepting the Databricks endpoint connection       |
| `federationDomainName`          | The rule's domain name and the connection host     |
| `federationTargetGroupArn`      | Checking target health                             |
| `federationIpSyncFunctionName`  | Invoking the IP sync by hand and reading its logs  |
| `federationFirstSyncResult`     | What the sync registered during `pulumi up` (JSON) |

### IP sync: keeping the NLB target current

Resolving the reader endpoint once per `pulumi up` and registering that IP would pin the target at deploy time. Aurora moves an instance's IP on failover and on some maintenance, and Databricks says so for RDS directly: "RDS does not provide stable IPs. In this case, the RDS IP changes each time the failover occurs" (same Databricks page). A pinned target stays wrong until someone runs `pulumi up`, and every federated read fails until then.

The Lambda follows the AWS pattern that page links to ([Access Amazon RDS across VPCs using AWS PrivateLink and Network Load Balancer](https://aws.amazon.com/blogs/database/access-amazon-rds-across-vpcs-using-aws-privatelink-and-network-load-balancer/)):

- It resolves the reader endpoint, compares the A records with the registered targets, registers new IPs first and then deregisters old ones. It throws, and changes nothing, if the name resolves to no addresses.
- It runs every minute (EventBridge schedule) and on every RDS instance or cluster event for this cluster, such as failover, reboot, stop and start.
- It runs outside the VPC. RDS endpoint names resolve publicly to the private IPs, and the ELB API is public, so it needs no NAT or VPC endpoint.
- Pulumi owns the target group but not its targets, so a later `pulumi up` can't put back a stale IP.

Expected recovery after an IP change: the RDS event, or at most one minute, for the sync, plus about 20 seconds for the NLB health check (2 checks, 10 seconds apart). The remaining risks:

- **More than one reader.** With two or more readers, the reader endpoint returns one reader per lookup and rotates, so the sync would flip between them. Before adding a second reader, change the Lambda to register each reader's instance endpoint (from `DescribeDBClusters`) instead. The POC runs one instance, and the failover drill adds exactly one reader.
- **The Lambda itself.** If it fails or loses its permissions, targets go stale on the next IP change. That is why the `ip-sync-Errors` alarm exists, and `HealthyHostCount` catches a stale target either way.

### Steps

Base steps 1 to 4 come first. Run commands from `packages/gp-api/poc-replication` unless noted.

**A1. Turn on the path (AWS admin).**

```bash
pulumi stack select poc
pulumi config set enableFederation true
pulumi up
pulumi stack output federationFirstSyncResult   # "added" holds the writer's IP
aws elbv2 describe-target-health --target-group-arn "$(pulumi stack output federationTargetGroupArn)" \
  --query 'TargetHealthDescriptions[].[Target.Id,TargetHealth.State]' --output text
```

Expect one target, `healthy` within about 30 seconds.

**A2. Create the read-only login (DB admin).** With `POC_REPLICATION_DATABASE_URL` exported as in base step 2, run this with psql 15 or newer, connected as `poc_admin`. The password is never echoed.

```bash
export FEDERATION_PASSWORD="$(openssl rand -base64 32 | tr -d '/+=')"
psql "$POC_REPLICATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/federation/001_federation_reader.sql
```

`databricks_federation` gets `SELECT` on every table in `public` and, through default privileges, on every table `poc_admin` creates later, which covers future `prisma migrate deploy` runs. Its session is read-only, with `statement_timeout = 30s`, `idle_in_transaction_session_timeout = 60s` and `CONNECTION LIMIT 40`, so a burst of federated queries can't use up Aurora's connections. Keep the shell open for A5. If someone else is the workspace admin, hand the password over in 1Password, never in Slack or a ticket.

**A3. Add the private endpoint rule (Databricks account admin).** You need a CLI profile for `https://accounts.cloud.databricks.com` with the account id.

```bash
ENDPOINT_SERVICE=$(pulumi stack output federationEndpointServiceName) \
DOMAIN_NAME=$(pulumi stack output federationDomainName) \
DATABRICKS_ACCOUNT_PROFILE=<account profile> \
./databricks/federation/ncc.sh
```

It creates and attaches an NCC only if the workspace has none and never replaces an attached one, because a workspace has one NCC and replacing it would drop its other rules. It prints `NCC_ID`, `RULE_ID`, `VPC_ENDPOINT_ID` and `connection_state=PENDING`. Keep the ids for teardown. A rule not accepted within 14 days expires.

**A4. Accept the endpoint (AWS admin).**

```bash
aws ec2 accept-vpc-endpoint-connections \
  --service-id "$(pulumi stack output federationEndpointServiceId)" \
  --vpc-endpoint-ids <VPC_ENDPOINT_ID from A3>
```

Then the account admin re-runs `ncc.sh` (it is idempotent) until it prints `connection_state=ESTABLISHED`, which takes a few minutes.

**A5. Create the connection and foreign catalog (Databricks workspace admin).** In the shell from A2, or with `FEDERATION_PASSWORD` set from 1Password:

```bash
DOMAIN_NAME=$(pulumi stack output federationDomainName) ./databricks/federation/catalog.sh
```

It stores the login in secret scope `gp-api-poc-replication`, creates connection `gp_api_pg_poc` (type `postgresql`, the RDS RSA2048 G1 root CA as `userProvidedServerCertificate`), creates foreign catalog `gp_api_pg_poc` over database `gp_api_poc`, grants `USE CATALOG`, `USE SCHEMA` and `SELECT` to `swain@goodparty.org` (override with `ENGINEER`) and to the `gp_api` service principal, refreshes `public`, and counts `replication_probe` and `campaign`.

- A timeout right after `ESTABLISHED`: wait about 10 minutes and re-run. New serverless compute picks up NCC changes; the delay is unverified.
- A certificate or hostname error: the connection verifies the hostname (`sslmode=verify-full`, per the [PostgreSQL federation page](https://docs.databricks.com/aws/en/query-federation/postgresql)), and whether Aurora's certificate names the reader endpoint is unverified. Drop the connection and catalog (teardown step 1), add `sslmode 'verify-ca'` to the connection options in `catalog.sh`, and re-run. That keeps chain validation and drops only the name check.

**A6. Create the Delta schema for the query bench (engineer).** `dbt-users` has `CREATE SCHEMA` on `goodparty_data_catalog`.

```sql
CREATE SCHEMA IF NOT EXISTS goodparty_data_catalog.gp_api_mirror_federation
COMMENT 'gp-api replication POC path A: Delta copies for the federation query bench. Drop after the POC.';
```

**A7. Check pushdown (engineer).** In the SQL editor on the Starter warehouse:

```sql
EXPLAIN FORMATTED SELECT count(*) FROM gp_api_pg_poc.public.campaign WHERE id >= 100;
```

The query sent to Postgres should carry `id >= 100` in its WHERE. Filters, projections, limits and standard aggregates push down; joins to a Delta table don't, and window functions never do ([supported pushdowns](https://docs.databricks.com/aws/en/query-federation/postgresql)). The query bench records the matching plan lines for its own queries in `plans`.

### Run the bench (engineer)

From `packages/gp-api`, set up as in the base benchmark section. Warm the warehouse with any query first.

```bash
BENCH="npx tsx --env-file=.env poc-replication/bench/bench.ts --target gp_api_pg_poc.public"

# Freshness. Expect lag p50 about equal to pollRttMs p50, and notSeenWithinTimeout 0.
$BENCH --mode insert --count 20 --timeout-s 60 --check
$BENCH --mode update --count 20 --rows 10 --timeout-s 60 --check
$BENCH --mode delete --count 10 --timeout-s 60 --check
$BENCH --mode insert --table campaign --count 10 --timeout-s 60
$BENCH --mode update --table campaign --count 50 --rows 10 --timeout-s 60 --check

# Soak: 2 ops/sec for 30 minutes. Watch pollFailures and lag max.
$BENCH --mode update --soak --rate 2 --minutes 30 --timeout-s 60 --check

# Schema change (see the drills below)
$BENCH --mode schema-drill --timeout-s 300

# Query cost: the same filtered count and join on the federated table and on a Delta copy
$BENCH --mode query --table campaign --compare-target goodparty_data_catalog.gp_api_mirror_federation \
  --seed-rows 20000 --runs 10
$BENCH --mode query --compare-target goodparty_data_catalog.gp_api_mirror_federation \
  --seed-rows 50000 --payload-kb 1 --runs 10
```

Run the freshness and `--check` runs before seeding large tables. The probe check sums `length(payload)`, and string functions push down only in filters, so it is expected to pull every payload through federation.

`--mode query` flags (other modes ignore them):

| Flag               | Default   | Meaning                                                                                                                                      |
| ------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `--compare-target` | none      | Delta `catalog.schema` for the copy. Must be a `gp_api_mirror_*` schema, because the bench replaces `<table>` and `query_bench_dim` in it.   |
| `--runs`           | `5`       | Rounds. Each round runs every query on both sides.                                                                                           |
| `--seed-rows`      | `0`       | Rows to add to `--table` in Postgres first, in batches of 5,000 (campaigns come with a bench user and organization each). Adds on every run. |
| `--dim-rows`       | `1000000` | Rows in the synthetic Delta table the join uses (at least the source's max id).                                                              |

What it does:

1. Seeds, then reads the row count and the 90th percentile id (`cutoffId`) from Postgres, so the filtered count selects the newest 10% of rows.
2. Replaces `<compare-target>.<table>` with a Delta copy of `id, updated_at` from the federated table (`copyMs`), and `<compare-target>.query_bench_dim` with `id, bucket` (`id % 100`) over `range(1, dimRows)`, a stand-in for a large Delta table such as the vendor people table.
3. Runs `EXPLAIN FORMATTED` on the federated queries and keeps the scan and pushdown lines (`plans`).
4. For `--runs` rounds, runs `filteredCount` (`count(*) WHERE id >= cutoffId`) and `join` (`query_bench_dim` filtered to 10% of buckets, joined on `id` to the table filtered to `id >= cutoffId`) on both sides. Every statement carries a unique literal, so the Delta side can't answer from the result cache. Federated queries never use it ([limitations](https://docs.databricks.com/aws/en/query-federation/database-federation#limitations)).

Output, under `query`: `results["<query>:federated"]` and `results["<query>:delta"]`, each with `firstMs` (the first run, which may include connection setup and metadata refresh), `ms` (`p50`, `p95`, `max` over the remaining runs), `values`, `failures`, `firstError`, and `firstFailureAtMs` and `lastFailureAtMs` (ms after the first round), which give the outage window during a drill. `valuesMatch` says whether both sides returned the same count. Compare `ms.p50` between sides; the difference is the federation overhead per query.

### Drills

Run each while a bench runs in a second terminal, and save both outputs. For read outages, use a long query run: `$BENCH --mode query --table campaign --compare-target goodparty_data_catalog.gp_api_mirror_federation --runs 300 --timeout-s 60`. For write and read together, use `$BENCH --mode insert --soak --rate 1 --minutes 15 --timeout-s 300` with stderr saved, since its progress lines and `poll failed` lines are timestamped by `t=`. Record for each drill: when reads failed and recovered, the first error, whether anything needed a manual step, and the Lambda's log (`aws logs tail /aws/lambda/gp-poc-replication-fed-ip-sync --since 30m`).

**Failover (AWS admin).** A one-instance cluster has nothing to fail over to, so add a reader first. Adding it also moves the reader endpoint to the new instance, which is a first IP change for the sync to follow.

```bash
aws rds create-db-instance --db-cluster-identifier gp-poc-replication-db \
  --db-instance-identifier gp-poc-replication-drill-reader \
  --db-instance-class db.serverless --engine aurora-postgresql
aws rds wait db-instance-available --db-instance-identifier gp-poc-replication-drill-reader
aws elbv2 describe-target-health --target-group-arn "$(pulumi stack output federationTargetGroupArn)" \
  --query 'TargetHealthDescriptions[].[Target.Id,TargetHealth.State]' --output text
dig +short "$(pulumi stack output federationDomainName)"

# Start the benches, then:
aws rds failover-db-cluster --db-cluster-identifier gp-poc-replication-db \
  --target-db-instance-identifier gp-poc-replication-drill-reader
# After recovery, fail back and remove the reader (it isn't in Pulumi, and pulumi destroy fails while it exists):
aws rds failover-db-cluster --db-cluster-identifier gp-poc-replication-db \
  --target-db-instance-identifier gp-poc-replication-writer
aws rds delete-db-instance --db-instance-identifier gp-poc-replication-drill-reader
```

Expected: reads fail from the failover until the sync re-points the target and the health check passes, which should be under about 1.5 minutes. Anything longer, or a target that stays wrong, is a sync bug. While the reader exists, reads go to a replica, which is usually "much less than 100 milliseconds" behind the writer ([Aurora replication](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Replication.html)).

**Writer reboot (AWS admin).**

```bash
aws rds reboot-db-instance --db-instance-identifier gp-poc-replication-writer
```

Expected: reads and writes fail for the reboot, then recover by themselves. The IP normally stays the same, so the sync should log no change.

**Schema change through Prisma-style migrations (DB admin, then engineer).**

1. Added column: `$BENCH --mode schema-drill --timeout-s 300` applies `sql/002_replication_probe_add_column.sql`. Expected: `columnVisibleMs` and `valuesVisibleMs` on the first poll after the migration, with no errors, because Unity Catalog refreshes foreign table metadata at query time ([refresh metadata](https://docs.databricks.com/aws/en/query-federation/database-federation)).
2. New table: `psql "$POC_REPLICATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/federation/002_drill_new_table.sql` (what Prisma generates for a new model), then in Databricks `SELECT * FROM gp_api_pg_poc.public.poc_federation_drill`. Expected: one row, with no `GRANT` (default privileges from A2) and no `REFRESH`. If the table isn't found, run `REFRESH FOREIGN SCHEMA gp_api_pg_poc.public` and record that a refresh is needed.
3. Rename and retype: `psql ... -f sql/federation/003_drill_rename_and_retype.sql`, then `SELECT label FROM gp_api_pg_poc.public.poc_federation_drill` and `SELECT title, created_at FROM ...`. Expected: the first fails loudly with an unresolved column error, the second works, and `created_at` is still a `TIMESTAMP`. Nothing is corrupted, but any saved query or view that used the old name breaks until it's edited.
4. Real migrations: after pulling `main`, rerun base step 3 (`prisma migrate deploy`), then `$BENCH --mode check --table campaign`. Nothing on the Databricks side should need a change.
5. Clean up: `psql "$POC_REPLICATION_DATABASE_URL" -c 'DROP TABLE poc_federation_drill'`.

**Network cut (AWS admin).** Remove the NLB-to-Aurora rule, watch reads fail, then restore it with `pulumi up`:

```bash
SG=$(pulumi stack output securityGroupId)
RULE=$(aws ec2 describe-security-group-rules --filters Name=group-id,Values="$SG" \
  --query "SecurityGroupRules[?Description=='databricks serverless via privatelink nlb'].SecurityGroupRuleId" --output text)
aws ec2 revoke-security-group-ingress --group-id "$SG" --security-group-rule-ids "$RULE"
# wait 3 minutes
pulumi up
```

This shows how long a read hangs before it fails: the bench's 30 s statement wait, the JDBC connect timeout or the NLB. `HealthyHostCount` should alarm within about 2 minutes. Two quicker variants: login refused (DB admin: `ALTER ROLE databricks_federation NOLOGIN;`, then `LOGIN;`), and cluster stop and start (`aws rds stop-db-cluster --db-cluster-identifier gp-poc-replication-db`, then `start-db-cluster`), after which the target health check above must show the address `dig` returns.

### Failure modes and how you'd see them

| Failure mode                                                                                                       | How you'd see it                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Aurora, the NLB or PrivateLink is down, so every federated read fails                                              | `fed-HealthyHostCount` alarm; `pollFailures` and query `failures` in the bench; failed statements in Databricks query history                   |
| Aurora moved to a new IP and the sync didn't follow                                                                | `fed-HealthyHostCount`; `describe-target-health` disagrees with `dig`; the Lambda log shows no `added`                                          |
| The IP-sync Lambda is failing (permissions, throttling, DNS)                                                       | `fed-ip-sync-Errors` alarm; errors in `/aws/lambda/gp-poc-replication-fed-ip-sync`                                                              |
| Private endpoint not established, rejected or expired                                                              | `ncc.sh` shows a `connection_state` other than `ESTABLISHED`; reads time out on connect                                                         |
| A filter isn't pushed down, so a read copies the whole table                                                       | `plans` in the query bench or `EXPLAIN FORMATTED` (A7); federated `ms` grows with table size, not result size                                   |
| Aurora overloaded by reads (no result cache, every read is a Postgres query)                                       | CloudWatch `DatabaseConnections`, `ACUUtilization` and `CPUUtilization` on the writer; `too many connections for role` once 40 is reached       |
| A slow Postgres query hits the role's 30 s statement timeout                                                       | `canceling statement due to statement timeout` in `firstError` or query history                                                                 |
| A large result overwhelms one executor ("returns the result to one Databricks executor task over a single stream") | Out-of-memory or very slow federated scans ([limitations](https://docs.databricks.com/aws/en/query-federation/database-federation#limitations)) |
| A migration renames or drops a column                                                                              | Queries naming it fail with an unresolved column error (drill 3)                                                                                |
| Credentials rotated in Postgres but not in the connection                                                          | Auth errors on every read. Re-run A2, then drop and recreate the connection (teardown step 1, then A5)                                          |

Federation creates no replication slot, so the base slot-lag and WAL alarms should stay quiet for this path. A major Postgres upgrade is a read outage while it runs and needs nothing rebuilt afterward (unverified).

### Expected freshness and main risks

**Freshness: live.** A committed row is visible to the next federated query that starts after the commit, because each query reads Postgres directly ([query federation](https://docs.databricks.com/aws/en/query-federation/)). The bench should report lag of about one poll round trip, and that round trip is the per-query cost. With a reader instance, add the replica lag (usually well under 100 ms). The open number is query latency, not staleness.

Risks:

- **Availability coupling.** Reads depend on Aurora, the NLB, PrivateLink, the NCC and the IP sync all being up. There is no copy to fall back to ([limitations](https://docs.databricks.com/aws/en/query-federation/database-federation#limitations); `replication-eval.md`).
- **Cost on every query.** No result cache, and joins to Delta tables run in Databricks after fetching the federated side's filtered rows, so latency and Aurora load grow with how much each query reads ([supported pushdowns](https://docs.databricks.com/aws/en/query-federation/postgresql)). It only suits selective queries.
- **Unstable target IPs.** Handled by the IP sync above, which is new code to own. Its gaps are the multi-reader case and its own failures.
- **Vendor guidance.** Databricks recommends Lakeflow Connect over query federation when "performance on higher data volumes and lower latency are priorities" ([connect to external databases](https://docs.databricks.com/aws/en/query-federation/)).
- **TLS hostname.** Unverified whether Aurora's certificate names the reader endpoint; the fallback is `verify-ca` (A5).
- **Cost.** Databricks charges networking for serverless traffic to customer resources (same private connectivity page), plus the NLB, endpoint hours, and about 44,000 Lambda runs a month (well inside the free tier).

### Follow-up: mirror plus live tail (Dan's idea)

From the 2026-10-20 Data Jamboree: keep a mirror for bulk reads and federate only the rows changed since the mirror's latest `updated_at`. Reads would be as fresh as federation while Aurora serves only the recent tail.

```sql
WITH tail AS (
  SELECT * FROM gp_api_pg_poc.public.campaign
  WHERE updated_at > TIMESTAMP'<mirror high-water mark minus a safety margin>'
)
SELECT * FROM tail
UNION ALL
SELECT m.* FROM <mirror>.campaign m LEFT ANTI JOIN tail t ON t.id = m.id
```

The mirror can be path B or C, or a scheduled copy over this foreign catalog (Databricks recommends federation as the source for materialized views, same page as refresh metadata). Before building it, check:

- **The watermark must be a literal.** A watermark from a subquery is unlikely to push down, which would turn the tail into a full table read. Compute it in a separate step and confirm with `EXPLAIN FORMATTED`.
- **Every table needs an `updated_at` that every write sets,** plus an index on it. Prisma's `@updatedAt` is set by the Prisma client, not by raw SQL.
- **Hard deletes are invisible to the tail.** A deleted row stays in the mirror until the next refresh unless the table soft-deletes.
- **Late commits.** A transaction that commits after the mirror's snapshot can carry an `updated_at` older than the watermark. The safety margin must exceed the longest write transaction, and the tail wins on duplicate ids.
- **Availability is still coupled.** If Aurora is down, the tail fails, so the read path needs a mirror-only fallback.

Prototype: add a `tail` query to `--mode query` with the watermark as a parameter and compare it with `filteredCount`.

### Teardown, path A

1. **Databricks workspace admin.**
   ```sql
   DROP CATALOG IF EXISTS gp_api_pg_poc CASCADE;
   DROP CONNECTION IF EXISTS gp_api_pg_poc;
   DROP SCHEMA IF EXISTS goodparty_data_catalog.gp_api_mirror_federation CASCADE;
   ```
   Then `databricks secrets delete-scope gp-api-poc-replication`.
2. **Databricks account admin.** `databricks account network-connectivity delete-private-endpoint-rule <NCC_ID> <RULE_ID>`. If `ncc.sh` created the NCC, it stays attached with no rules, which has no effect.
3. **AWS admin.** Delete `gp-poc-replication-drill-reader` if the failover drill left it, then `pulumi config set enableFederation false && pulumi up`, or the full teardown below.
4. **DB admin,** only if the cluster stays: `DROP OWNED BY databricks_federation; DROP ROLE databricks_federation;`

### Path A: verified and not verified

Verified without AWS or admin rights:

- **Type checks.** `tsc -p tsconfig.deploy.json` passes with `federation.ts` and the bench changes.
- **Pulumi mocks** (a throwaway harness, not committed). With `enableFederation=true` the program creates 33 resources and every output resolves. With the flag off it is unchanged at 12.
- **IP-sync handler,** run locally with Node 22 and the real AWS SDK against a fake ELB endpoint. It registered the two addresses a real DNS name resolves to, deregistered a stale IP, did nothing on a second run, and threw without changes on an unresolvable name. It also follows CNAMEs, which the reader endpoint is.
- **SQL on local Postgres 17** (not Aurora), after all gp-api migrations:
  - `001_federation_reader.sql` applies twice, and exits 3 when `FEDERATION_PASSWORD` is unset
  - the role reads `campaign` and `replication_probe`, INSERT and CREATE TABLE fail as read-only, `statement_timeout` is `30s` and the connection limit is 40
  - a table created afterward by `poc_admin` (`002_drill_new_table.sql`) is readable with no new grant
  - `003_drill_rename_and_retype.sql` applies twice, and the old column name then fails
- **Databricks SQL.** `EXPLAIN CREATE CONNECTION` with the script's options got as far as looking up the not-yet-created secret, so the options parse. `EXPLAIN REFRESH FOREIGN SCHEMA` parses. Both scripts pass `shellcheck`.
- **Query bench against a Delta stand-in for the foreign catalog** (`gp_api_mirror_federation_standin`), on the Starter warehouse, for both tables: seeding (12,000 probe rows at 8 KB, 6,000 campaigns), the cutoff, the Delta copy and dim table, plans, 4 rounds, matching values on both sides, and the guards on `--compare-target`. Both sides were Delta, so its numbers say nothing about federation. The stand-in and copy schemas were dropped afterward.

Needs an admin, unverified:

- **Nothing is applied.** No `pulumi preview` or `pulumi up`, no NLB, endpoint service, Lambda, NCC rule, connection or foreign catalog exists.
- **The network path.** Whether serverless reaches the NLB at all, the Databricks endpoint's AZs, and cross-zone routing.
- **TLS.** Whether the connection accepts the RDS root CA and whether the reader endpoint is on Aurora's certificate.
- **The IP sync on AWS.** Its IAM policy, the RDS event pattern, that the reader endpoint resolves from a Lambda outside the VPC, and the recovery times in the drills.
- **Pushdown and every number.** Freshness, query latency, the federation overhead against Delta, and every drill result.

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

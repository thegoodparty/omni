# Import contacts replication POC

POC only. Nothing here is deployed by CI, and the whole stack is destroyed when the POC ends.

The import contacts change log moves from a Delta table to Postgres. These POCs test three ways to get that log from Postgres into Databricks, judged on seconds of freshness and on reliability with near-zero upkeep:

- A. Lakehouse Federation: Databricks queries the Postgres table live through a foreign catalog.
- B. Lakeflow Connect: the managed PostgreSQL CDC connector (gateway plus ingestion pipeline) mirrors the table into Delta.
- C. AWS DMS: CDC to Kinesis Data Streams, a Lambda, Databricks Zerobus Ingest, then a Delta table.

The log lives in a dedicated Aurora cluster, not gp-api's dev or prod database, so no POC step can reboot or reconfigure a shared database.

## Layout

| Path | What |
| --- | --- |
| `Pulumi.yaml`, `index.ts` | Standalone Pulumi project `gp-api-poc-replication`. Separate from `../deploy`. |
| `sql/001_org_contact_event.sql` | The change log table. Applied by hand with psql (step 3). |
| `sql/` (more files) | Path-specific SQL (publications, replication roles), added by each path. |
| `databricks/` | Path-specific Databricks definitions (catalogs, bundles, target tables), added by each path. |
| `lambda/dms-zerobus/` | Path C Lambdas: the Kinesis consumer that writes to Zerobus, the canary, their `build.sh` and the DMS record mapping test. |
| `../src/pocOrgLayer/freshness.cli.ts` | The freshness benchmark every path runs. |

## What the base stack creates

`pulumi up` with no path flags creates:

- A cluster parameter group (`aurora-postgresql17`) with `rds.logical_replication = 1`.
- A security group allowing 5432 from the OpenVPN server's security group (engineers on the VPN) and from the Databricks peering CIDR (classic compute). Egress is open. Paths add their own ingress rules as separate `aws.vpc.SecurityGroupIngressRule` resources.
- A subnet group over the existing private subnets (looked up in the existing VPC; nothing in the VPC is created or changed).
- Aurora PostgreSQL Serverless v2 cluster `gp-poc-replication-db`, latest 17.x, 0.5 to 2 ACU, one writer `gp-poc-replication-writer`, database `poc_org_layer`, master user `poc_admin` with an RDS-managed password in Secrets Manager. Deletion protection is off and no final snapshot is taken.
- An SNS topic `gp-poc-replication-alarms` and three CloudWatch alarms on the writer: `OldestReplicationSlotLag` (over 1 GiB), `ReplicationSlotDiskUsage` and `TransactionLogsDiskUsage` (over 5 GiB). Aurora keeps WAL for a stalled slot without limit, so these are the early warning.

Config keys (all optional): `vpcId`, `privateSubnetIds`, `vpnSecurityGroupId`, `databricksPeeringCidr`, `engineVersion`, `slotLagAlarmBytes`, `walDiskAlarmBytes`, `alarmEmail`.

Path flags, each `false` by default: `enableFederation` (A), `enableLakeflow` (B), `enableDms` (C). Each path PR adds its resources behind its own flag.

## Who does what

| Role | Does |
| --- | --- |
| AWS admin | `pulumi up` and `pulumi destroy`, anything in AWS (VPC endpoint services, DMS, Kinesis, Lambda, IAM). |
| DB admin | Connects with the master secret, applies `sql/`, creates replication roles. Can be the same person as the AWS admin. |
| Databricks workspace admin | Connections, foreign catalogs, Lakeflow gateways and pipelines, service principals, grants. |
| Databricks account admin | Network connectivity configurations (NCC) and private endpoint rules for serverless. |
| Engineer | Runs gp-api locally and the freshness benchmark. Needs the VPN and read access to the master secret, or a connection string from the DB admin. |

## Steps

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

### 2. Check logical replication is on (DB admin)

Build a connection string from the managed secret without printing it. The RDS CA bundle is needed because Node does not trust the RDS CA.

```bash
curl -sSo /tmp/rds-global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
HOST=$(pulumi stack output writerEndpoint)
SECRET_ARN=$(pulumi stack output masterSecretArn)
export POC_ORG_LAYER_DATABASE_URL="$(aws secretsmanager get-secret-value --secret-id "$SECRET_ARN" \
  --query SecretString --output text | HOST="$HOST" python3 -c '
import json, os, sys, urllib.parse as u
s = json.load(sys.stdin)
user = u.quote(s["username"], safe="")
password = u.quote(s["password"], safe="")
print("postgresql://" + user + ":" + password + "@" + os.environ["HOST"] + ":5432/poc_org_layer"
      + "?sslmode=verify-full&sslrootcert=/tmp/rds-global-bundle.pem")')"
psql "$POC_ORG_LAYER_DATABASE_URL" -c 'SHOW rds.logical_replication' -c 'SHOW wal_level'
```

Expect `on` and `logical`. If not, reboot the writer once (`aws rds reboot-db-instance --db-instance-identifier gp-poc-replication-writer`); this only touches the POC cluster.

### 3. Create the change log table (DB admin)

```bash
psql "$POC_ORG_LAYER_DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/001_org_contact_event.sql
```

The file is idempotent.

### 4. Path A: Lakehouse Federation

Read source: the foreign table, `POC_ORG_LAYER_LOG_SOURCE=<foreign catalog>.public.org_contact_event`.

Steps, owners and commands: added by the path A PR.

### 5. Path B: Lakeflow Connect PostgreSQL CDC

Read source: the Lakeflow destination table, `POC_ORG_LAYER_LOG_SOURCE=goodparty_data_catalog.poc_import_contacts_<...>.org_contact_event`.

Steps, owners and commands: added by the path B PR.

### 6. Path C: DMS to Kinesis to Zerobus

Read source: the Zerobus-fed Delta table, `POC_ORG_LAYER_LOG_SOURCE=goodparty_data_catalog.poc_import_contacts_dms.org_contact_event`.

The flow: Aurora logical slot, then a DMS Serverless replication (full load plus CDC, `org_contact_event` only), then the Kinesis stream `gp-poc-replication-dms` (on-demand), then the Lambda `gp-poc-replication-dms-consumer`, then Zerobus Ingest, then the Delta table above. The consumer only appends. It drops updates, deletes and truncates, and logs and counts each one. Delivery is at least once, so an `event_id` can land twice. The person view only uses `max` and `max_by` over the log, so duplicates do not change what it returns (checked on the Starter warehouse with a tripled log).

`enableDms=true` adds, on top of the base stack:

- The Kinesis stream (on-demand, 24 h retention).
- A Kinesis interface VPC endpoint with private DNS, plus its security group (443 from the VPC). DMS 3.4.7 and later in a private subnet only reaches Kinesis this way. Skip it with `dmsCreateKinesisVpcEndpoint=false` if the VPC already has one.
- The DMS security group, a 5432 rule on the cluster security group from it, the DMS subnet group, the source endpoint (`aurora-postgresql`, `test_decoding`, WAL heartbeat every minute, DDL capture, fail on LOB truncation), the Kinesis target endpoint (JSON, nulls included, DDL and control records included) and its IAM role.
- The DMS Serverless replication config `gp-poc-replication-dms`, 1 to 2 DCU, not started until `dmsStartReplication=true`.
- `dms-vpc-role` and `dms-cloudwatch-logs-role`, only with `dmsCreateServiceRoles=true`. DMS needs these exact names once per account.
- The secret `gp-poc-replication-zerobus-sp` with no value. A human puts the service principal's OAuth client id and secret in it.
- The consumer Lambda (Node.js 22, outside the VPC) and its Kinesis event source mapping (batch 100, 1 s batching window, from `TRIM_HORIZON`).
- The canary Lambda `gp-poc-replication-dms-canary` (in the VPC) and a once-a-minute schedule. It inserts one row with `org_slug = 'poc-dms-canary'` and `source = 'canary'` using the master secret. The consumer reports how long canary rows took from Postgres to the Zerobus ack. Turn it off with `dmsCanaryEnabled=false`.
- Eleven alarms on the base SNS topic, listed under "What to watch for".

Config keys for this path: `enableDms`, `dmsSourcePassword` (secret, required), `dmsSourceUsername` (default `dms_repl`), `dmsStartReplication`, `dmsCreateServiceRoles`, `dmsCreateKinesisVpcEndpoint`, `dmsCanaryEnabled`, `dmsMaxCapacityUnits` (default 2), `zerobusEndpoint`, `databricksWorkspaceUrl`, `zerobusTableName`. The last three default to this workspace (`3578414625112071`, us-west-2) and the table above.

#### Expected freshness

About 7 to 12 s from Postgres commit to a row the benchmark can see, if everything is healthy. This is an estimate; nothing here has run in AWS. The parts:

| Hop | Expected | Source |
| --- | --- | --- |
| Slot to DMS to Kinesis | 1 to a few s | No published number. The eval rates DMS "seconds possible". `CDCLatencySource` and `CDCLatencyTarget` measure it. |
| Kinesis to Lambda | up to 1 s poll, plus the 1 s batching window | [Lambda with Kinesis](https://docs.aws.amazon.com/lambda/latest/dg/with-kinesis.html): each shard is polled once per second. |
| Zerobus ack | about 150 ms | [Zerobus quotas](https://docs.databricks.com/aws/en/ingestion/zerobus-quotas): "Time to durability approximately 150 ms". |
| Zerobus ack to queryable row | about 5 s | Same page: "Time to table approximately 5 seconds". |
| Benchmark poll | about 0.5 s warm | Foundation measurement on the Starter warehouse. |

#### Main risks

- **DMS reports RUNNING while delivering nothing.** This is the eval's main complaint about DMS ([AWS re:Post](https://repost.aws/questions/QUvRp8u8gqSxWSF7yxoLmjOQ/dms-replicate-cdc-data-from-aurora-postgresql-serverless-to-amazon-kinesis-data-streams)). The canary exists for this. Without a steady write, an idle log and a stalled pipeline look the same.
- **The Kinesis VPC endpoint changes a shared network.** The VPC is gp-api's shared dev and prod VPC. Private DNS sends every Kinesis API call in it through the endpoint. Nothing in this repo calls Kinesis today, and the endpoint admits 443 from the whole VPC, but the AWS admin must agree to it. [DMS VPC endpoints](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_VPC_Endpoints.html) explains why it is required.
- **No custom CDC start point on Serverless.** If the slot is lost (failover, cleanup), the only way back is a fresh full load, which re-sends every row. Duplicates are harmless to the view, but the gap before the restart is not. A replication stopped for 48 h is deprovisioned and loses its metadata. Source: [DMS Serverless limitations](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Serverless.Limitations.html).
- **TEXT columns are LOBs to DMS.** DMS maps PostgreSQL `TEXT` to NCLOB. Kinesis targets have no full LOB mode and cap LOBs at 1 MB. Limited LOB mode is on with `LobMaxSize` 64 KB, and the source endpoint fails the task rather than truncate. Sources: [PostgreSQL source data types](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Source.PostgreSQL.html#CHAP_Source-PostgreSQL-DataTypes), [Kinesis target limitations](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Target.Kinesis.html).
- **Aurora keeps WAL for a stalled slot without limit** (eval). The base stack's slot alarms cover this.
- **Five moving parts to keep alive:** the slot, DMS, Kinesis, the Lambda and the Zerobus service principal secret. That is the opposite of near-zero upkeep, so the soak test matters more than the burst.
- **Zerobus cannot follow a recreated or renamed target table.** Unflushed data is deleted after 28 days. Never drop and recreate the Delta table while the consumer runs. Sources: [Zerobus concepts](https://docs.databricks.com/aws/en/ingestion/zerobus-concepts), [Zerobus quotas](https://docs.databricks.com/aws/en/ingestion/zerobus-quotas).
- **The DMS metric dimension comes from community code.** AWS documents the Serverless metric names but not their dimension. The alarms use `ReplicationConfigId = <account>:<resource id>`, taken from a [working Terraform setup](https://github.com/Dozuki/CloudPrem-Infra/blob/1c651d7c9990be9760d87208dde6702e90d9bf5a/terraform/physical/monitoring.tf). Step C8 checks it.
- **Timestamp time zone.** The consumer reads DMS timestamps with no zone as UTC. If DMS shifts `timestamptz` to another zone, `created_at` moves by the same amount for every row. The view's ordering is unaffected, but absolute times would be off.

#### C1. Zerobus service principal (Databricks workspace admin)

The target table already exists (created by the path C author with `databricks/zerobus/001_org_contact_event.sql`; re-running it is safe).

1. Settings, Identity and access, Service principals, Add new: `gp-poc-replication-zerobus`. Keep the Workspace access entitlement on; Zerobus needs it.
2. Generate an OAuth secret. Hand the client id (the Application ID) and secret to the AWS admin for step C6 through a password manager, not chat.
3. Run `databricks/zerobus/002_grant_service_principal.sql` with `<application-id>` replaced. The schema owner (swain@) can run it too.

#### C2. Account checks (AWS admin)

```bash
aws iam get-role --role-name dms-vpc-role --query Role.Arn
aws iam get-role --role-name dms-cloudwatch-logs-role --query Role.Arn
aws ec2 describe-vpc-endpoints --filters Name=vpc-id,Values=vpc-0763fa52c32ebcf6a \
  Name=service-name,Values=com.amazonaws.us-west-2.kinesis-streams --query 'VpcEndpoints[].VpcEndpointId'
```

- If either role is missing: `pulumi config set dmsCreateServiceRoles true`.
- If a Kinesis endpoint already exists: `pulumi config set dmsCreateKinesisVpcEndpoint false`.
- Agree to the VPC-wide private DNS change (see Main risks) before going on.

#### C3. DMS login (DB admin)

With `POC_ORG_LAYER_DATABASE_URL` from step 2. The password goes from one variable into Postgres and into the Pulumi secret, and is never printed.

```bash
export DMS_SOURCE_PASSWORD="$(openssl rand -hex 24)"
psql "$POC_ORG_LAYER_DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/002_dms_source_role.sql
printf %s "$DMS_SOURCE_PASSWORD" | pulumi config set --secret dmsSourcePassword
unset DMS_SOURCE_PASSWORD
```

Needs psql 15 or newer. Don't commit `Pulumi.poc.yaml`; it holds the encrypted value.

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

The replication is created but not started. The canary starts writing a row a minute; those rows wait in Postgres and arrive with the full load.

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

# Consumer log lines (ignored changes, DDL, skipped records, Zerobus failures)
aws logs tail /aws/lambda/gp-poc-replication-dms-consumer --since 1h
```

If `list-metrics` shows a different dimension, change `ReplicationConfigId` in `index.ts` and `pulumi up`. The three `AWS/DMS` alarms stay in INSUFFICIENT_DATA until it matches.

In Databricks (engineer):

```sql
SELECT count(*) AS canary_rows, max(created_at) AS latest
FROM goodparty_data_catalog.poc_import_contacts_dms.org_contact_event
WHERE org_slug = 'poc-dms-canary';

-- At-least-once check: event ids that landed more than once
SELECT count(*) AS duplicated_event_ids FROM (
  SELECT event_id FROM goodparty_data_catalog.poc_import_contacts_dms.org_contact_event
  GROUP BY event_id HAVING count(*) > 1
);
```

#### C9. Point gp-api at it and run the benchmark (engineer)

Run gp-api as in "Run gp-api locally" below with:

```bash
POC_ORG_LAYER_STORE=postgres
POC_ORG_LAYER_LOG_SOURCE=goodparty_data_catalog.poc_import_contacts_dms.org_contact_event
```

Benchmark, in `packages/gp-api` with `POC_ORG_LAYER_DATABASE_URL` set:

```bash
export POC_ORG_LAYER_LOG_SOURCE=goodparty_data_catalog.poc_import_contacts_dms.org_contact_event
# Warm the warehouse, then a small and a larger burst
npx tsx --env-file=.env src/pocOrgLayer/freshness.cli.ts --count 3 --timeout-s 120
npx tsx --env-file=.env src/pocOrgLayer/freshness.cli.ts --count 20 --timeout-s 120
npx tsx --env-file=.env src/pocOrgLayer/freshness.cli.ts --count 200 --timeout-s 300
# Soak: steady load for the reliability counts
npx tsx --env-file=.env src/pocOrgLayer/freshness.cli.ts --soak --rate 2 --minutes 30 --timeout-s 300
npx tsx --env-file=.env src/pocOrgLayer/freshness.cli.ts --soak --rate 10 --minutes 10 --timeout-s 300
```

A pass is p95 lag in single-digit seconds, and zero `notSeenWithinTimeout`, `insertFailures` and `pollFailures` through the soak. Leave the canary running for a day or more and count `canary-missing` alarms; that is the near-zero-upkeep test.

#### What to watch for (path C)

Every alarm below goes to the `gp-poc-replication-alarms` topic. The three slot alarms come from the base stack.

| Failure mode | How it shows up | Alarm | How to provoke it on the POC |
| --- | --- | --- | --- |
| DMS RUNNING but idle | Status `running`, but no canary rows reach Zerobus. `CDCLatencySource` may also climb, and the slot lag grows. | `gp-poc-replication-dms-canary-missing` (no canary in 10 min, missing data counts as breaching), `-cdc-latency-source`, `-cdc-latency-target`, base `OldestReplicationSlotLag` | Take away DMS's Kinesis write access: `aws iam delete-role-policy --role-name gp-poc-replication-dms-kinesis --policy-name gp-poc-replication-dms-kinesis-put`. DMS either keeps running with write errors or fails; the canary alarm should fire either way. Restore with `pulumi up`. |
| Replication failed or stopped | `describe-replications` shows `failed` or `stopped`, and the canary stops arriving. | `-canary-missing` | `aws dms stop-replication --replication-config-arn "$(pulumi stack output dmsReplicationConfigArn)"`. Resume with `aws dms start-replication --replication-config-arn ... --start-replication-type resume-processing`. |
| TOAST | Values over about 2 KB are stored out of line. On an UPDATE that leaves them unchanged, DMS sends them as null or leaves them out. The log is append-only, so inserts always carry the full value and the consumer drops every update. A value over `LobMaxSize` (64 KB) fails the task instead of being truncated. | `-ignored-changes` (any update, delete or truncate), `-canary-missing` (task failed on truncation) | `INSERT` a row with `value = repeat('x', 5000)`, then `UPDATE org_contact_event SET source = source WHERE event_id = '<that id>'`. Expect one `dms change ignored` log line and the alarm. For truncation, insert `repeat('x', 40000)` and expect the replication to fail. |
| DDL on the log table | DMS sends a control record. The consumer drops columns the Delta table does not have, and Zerobus never evolves the table. Per the eval, added columns may need a reload. | `-ddl` | `ALTER TABLE org_contact_event ADD COLUMN poc_note text`, insert a row, check it still lands. Then drop the column. |
| Slot cleanup | A slot left behind after a stop or delete keeps WAL forever. Aurora blocks major version upgrades while logical slots exist. | base `OldestReplicationSlotLag`, `ReplicationSlotDiskUsage`, `TransactionLogsDiskUsage` | `SELECT slot_name, active, pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) FROM pg_replication_slots;` after stopping the replication. |
| Writer restart or failover | Canary inserts fail while the writer is down. DMS must reconnect to the same slot. Whether Aurora keeps the slot across a failover is unverified (eval). If it is lost, Serverless can only restart with a new full load. | `-canary-errors`, then `-canary-missing` if DMS does not recover | `aws rds reboot-db-instance --db-instance-identifier gp-poc-replication-writer` (POC cluster only; there is no reader, so a reboot stands in for failover). |
| Zerobus or service principal failure | The consumer throws, Lambda retries the batch, and the iterator age grows. Records expire after 24 h. | `-consumer-errors`, `-consumer-iterator-age` | Put a wrong client secret in the secret, wait for a canary, then restore it. |
| Records the consumer cannot map | Missing NOT NULL column, bad timestamp, not JSON. Logged with the Kinesis sequence number and skipped. | `-malformed-records` | Not expected. Read the record by sequence number within 24 h. |
| DMS Serverless out of memory | `CapacityUtilization` at its maximum, then a failed replication. | `-capacity` | Raise `dmsMaxCapacityUnits`. |
| Slow but working | Canary rows take over 30 s. | `-canary-lag` | Compare `CDCLatencySource`, `CDCLatencyTarget` and Lambda `IteratorAge` to find the slow hop. |

#### Path C teardown

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
   DROP FUNCTION IF EXISTS public.awsdms_intercept_ddl();
   DROP TABLE IF EXISTS public.awsdms_ddl_audit;
   -- \dt public.awsdms* lists any heartbeat objects; drop them too
   DROP OWNED BY dms_repl;
   DROP ROLE IF EXISTS dms_repl;
   ```

3. Databricks workspace admin: delete the `gp-poc-replication-zerobus` service principal and run `DROP SCHEMA goodparty_data_catalog.poc_import_contacts_dms CASCADE`.

## Run gp-api locally against the POC cluster (engineer)

Connect to the VPN. Then, in `packages/gp-api`, with `POC_ORG_LAYER_DATABASE_URL` exported as in step 2:

```bash
EDB=$(grep -E '^ELECTION_DATABASE_URL=' .env.example | cut -d= -f2- | tr -d '"')
GP_API_MACHINE_SECRET=ak_local_placeholder ROBOCALL_AUDIO_BUCKET=robocall-audio-dev \
ELECTION_DATABASE_URL="$EDB" PORT=3100 NODE_OPTIONS=--max-old-space-size=6144 \
POC_ORG_LAYER_ENABLED=true \
POC_ORG_LAYER_STORE=postgres \
POC_ORG_LAYER_LOG_SOURCE=<the path's read source> \
npx nest start
```

| Env var | Meaning |
| --- | --- |
| `POC_ORG_LAYER_ENABLED` | `true` turns the org layer on: people reads go through the per-org person view. Off by default. |
| `POC_ORG_LAYER_STORE` | Where the write routes append events. `delta` (default) is the Delta log, `postgres` is `org_contact_event` in `POC_ORG_LAYER_DATABASE_URL`. Import matching and staging stay in Databricks either way; with `postgres`, commit reads the match results from the staging tables and inserts all events in one statement. |
| `POC_ORG_LAYER_DATABASE_URL` | Postgres connection string for the change log. Required with `POC_ORG_LAYER_STORE=postgres` and by the freshness benchmark. |
| `POC_ORG_LAYER_LOG_SOURCE` | The fully qualified Databricks table the person view reads the log from. Default `goodparty_data_catalog.poc_import_contacts.org_contact_event` (the Delta log). Parts may be backticked. |

With `POC_ORG_LAYER_STORE=postgres` and the default read source, writes land in Postgres but reads never see them. That is expected until a path's read source is set.

## Freshness benchmark (engineer)

In `packages/gp-api`, with `POC_ORG_LAYER_DATABASE_URL` and `POC_ORG_LAYER_LOG_SOURCE` set. Databricks access comes from `PEOPLE_DATABRICKS_WAREHOUSE_ID` and `PEOPLE_DATABRICKS_API_KEY` in `.env` (Starter warehouse).

```bash
# Burst: 20 events, one transaction each, then poll until each is visible
npx tsx --env-file=.env src/pocOrgLayer/freshness.cli.ts --count 20

# Soak: 2 events/sec for 10 minutes, polling throughout
npx tsx --env-file=.env src/pocOrgLayer/freshness.cli.ts --soak --rate 2 --minutes 10

# Dry run: Postgres inserts only, no Databricks
npx tsx --env-file=.env src/pocOrgLayer/freshness.cli.ts --count 5 --dry-run
```

Options: `--poll-ms` (default 250), `--timeout-s` per event (default 900), `--org-slug` (default `poc-freshness-bench`), `--source` (overrides `POC_ORG_LAYER_LOG_SOURCE`).

It prints one JSON summary. `lagMs` (p50, p95, max) runs from the INSERT returning to the poll that saw the row returning, so it includes up to one poll round trip; `pollRttMs` reports that round trip (about 0.5 s on a warm Starter warehouse, 8 to 10 s on a cold one, so warm it first). `notSeenWithinTimeout`, `insertFailures` and `pollFailures` are the reliability counts. Bench events use `source = 'bench'` and their own org slug, so they never show in a real org's view.

## Teardown

1. Each path's teardown section, in reverse order (C, B, A). Stop each replication consumer (DMS task, Lakeflow gateway and pipeline) before the cluster goes.
2. AWS admin: `pulumi destroy` then `pulumi stack rm poc`.
3. Databricks workspace admin: drop the `poc_import_contacts_*` schemas each path created.

## Verified so far

- `tsc -p tsconfig.deploy.json` covers this program; it passes.
- The program runs to completion under Pulumi mocks (a throwaway harness, not committed): all resources and outputs resolve. `pulumi preview` against AWS has not been run.
- `sql/001_org_contact_event.sql` applies cleanly (twice) on local Postgres 16.
- gp-api with `POC_ORG_LAYER_STORE=postgres` against local Postgres: field set, remove, restore, import commit (new, matched and ambiguous rows) and the cross-org commit guard all write the expected rows to Postgres and nothing to the Delta log.
- The freshness benchmark's insert side (dry run, burst and soak) and its polling side (against the Delta log, with events copied in by hand to stand in for replication).

Path C, without AWS:

- The mocked run with `enableDms=true` creates 58 resources (12 base plus 46 for path C) and resolves every output, including the `ReplicationConfigId` alarm dimension. `tsc -p tsconfig.deploy.json` type-checks the Lambda handlers too.
- `lambda/dms-zerobus/dmsRecord.test.ts` (run by gp-api's vitest) maps synthetic DMS Kinesis payloads: CDC insert, full-load row with nulls left out, integer sent as a string, updates with an unchanged TOAST value sent as null or left out, delete, truncate, DDL and create-table control records, another table, and malformed payloads. It also covers the timestamp formats.
- `build.sh` output runs in the AWS Lambda Node.js 22 image (`public.ecr.aws/lambda/nodejs:22`, linux/amd64): the Zerobus native module loads, a batch of update, delete and DDL records returns success with the expected log lines and EMF metrics, and a batch with an insert reaches Secrets Manager. The SDK in that image also reached this workspace's Zerobus endpoint and got the expected 401 for a fake client.
- The local type slice of the Zerobus SDK in `consumer.ts` type-checks against the real `@databricks/zerobus-ingest-sdk` 1.4.0 declarations.
- `sql/002_dms_source_role.sql` applies twice on local Postgres 17 (with stand-in `rds_*` roles), refuses to run without `DMS_SOURCE_PASSWORD`, and the login it creates can read the log. The canary's INSERT works on the same table.
- The target schema and table exist in Databricks (`databricks/zerobus/001_org_contact_event.sql`), and the freshness benchmark polls it with no poll failures.
- Not verified: anything in AWS, a real DMS Kinesis message (field names come from the DMS docs), a Zerobus write with a service principal (a user OAuth token is rejected with "Invalid token audience"), and the DMS Serverless metric dimension.

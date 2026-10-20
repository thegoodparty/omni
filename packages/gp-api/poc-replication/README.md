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
| `../src/pocOrgLayer/freshness.cli.ts` | The freshness benchmark every path runs. |

## What the base stack creates

`pulumi up` with no path flags creates:

- A cluster parameter group (`aurora-postgresql17`) with `rds.logical_replication = 1`.
- A security group allowing 5432 from the OpenVPN server's security group (engineers on the VPN) and from the Databricks peering CIDR (classic compute). Egress is open. Paths add their own ingress rules as separate `aws.vpc.SecurityGroupIngressRule` resources.
- A subnet group over the existing private subnets (looked up in the existing VPC; nothing in the VPC is created or changed).
- Aurora PostgreSQL Serverless v2 cluster `gp-poc-replication-db`, latest 17.x, 0.5 to 2 ACU, one writer `gp-poc-replication-writer`, database `poc_org_layer`, master user `poc_admin` with an RDS-managed password in Secrets Manager. Deletion protection is off and no final snapshot is taken.
- An SNS topic `gp-poc-replication-alarms` and three CloudWatch alarms on the writer: `OldestReplicationSlotLag` (over 1 GiB), `ReplicationSlotDiskUsage` and `TransactionLogsDiskUsage` (over 5 GiB). Aurora keeps WAL for a stalled slot without limit, so these are the early warning.

Config keys (all optional): `vpcId`, `privateSubnetIds`, `vpnSecurityGroupId`, `databricksPeeringCidr`, `engineVersion`, `slotLagAlarmBytes`, `walDiskAlarmBytes`, `alarmEmail`. Path B adds `lakeflowGatewayCidrs` and `lakeflowFailoverReader` (step 5).

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

Read source: `POC_ORG_LAYER_LOG_SOURCE=goodparty_data_catalog.poc_import_contacts_lakeflow.org_contact_event_log`.

An ingestion gateway (classic compute, always on) reads the `lakeflow_org_contact_event` logical replication slot and stages changes in a volume. A serverless ingestion pipeline, run every 5 minutes by a job, applies them to the streaming table `goodparty_data_catalog.poc_import_contacts_lakeflow.org_contact_event`. The read source is a view over that table, because Lakeflow lands PostgreSQL `uuid` as `BINARY` ([type mapping](https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/postgresql-reference)) and the person view and the benchmark compare `event_id` with uuid text. Against a raw `BINARY` column the benchmark sees nothing and times out.

Files:

| Path | What |
| --- | --- |
| `sql/002_lakeflow_replication.sql` | Replication user `lakeflow_replication`, grants, `REPLICA IDENTITY FULL`, publication and `pgoutput` slot, both named `lakeflow_org_contact_event` (publication covers the change log only). Re-runnable. |
| `databricks/lakeflow/databricks.yml`, `resources/lakeflow_postgres.yml` | Bundle: schema `poc_import_contacts_lakeflow` (`dbt-users` get `USE SCHEMA` and `SELECT`), gateway, ingestion pipeline (SCD type 1), 5-minute job, event log tables, failure emails. The continuous variant is commented out in the pipeline. |
| `databricks/lakeflow/read_source_view.sql` | The read source view. |
| `index.ts`, flag `enableLakeflow` | A Secrets Manager secret for the replication user, optional extra ingress CIDRs (`lakeflowGatewayCidrs`), optional reader instance for the failover test (`lakeflowFailoverReader`). |

Bundles cannot create Unity Catalog connections (the CLI's bundle schema has no `connections` resource), so step 5.5 creates it with the CLI.

#### 5.1 Enroll and check rights (Databricks workspace admin)

- The PostgreSQL connector is in Public Preview and needs enrollment through the Databricks account team ([docs](https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/postgresql-pipeline)). Confirm "PostgreSQL" shows under Data Ingestion > Databricks connectors.
- Whoever deploys needs `CREATE CONNECTION` on the metastore, `CREATE SCHEMA` on `goodparty_data_catalog`, and unrestricted cluster creation (the gateway runs on classic compute). Serverless must be on for the workspace (it is; the Starter warehouse is serverless).
- Install Databricks CLI 0.276 or later and log in to `https://dbc-3d8ca484-79f3.cloud.databricks.com`.

#### 5.2 Confirm the gateway can reach the cluster (AWS admin and Databricks account admin)

The gateway runs on classic compute, so serverless NCC and private endpoint rules do not apply. What the repo shows: the gp-api VPC (`vpc-0763fa52c32ebcf6a`, 10.0.0.0/16) has peering connection `pcx-013299c506ffd3395` to 172.16.0.0/16, its private subnets route 172.16.0.0/16 over it (`../deploy/components/vpc.ts`, commit `328a05cb75` "add databricks peering route to private subnets"), and the gp-api and preview databases allow 5432 from 172.16.0.0/16 as "databricks via vpc peering". That points to a customer-managed workspace VPC peered to ours. It has not been confirmed from the Databricks side, which needs account admin rights.

Option 1, expected: the workspace VPC is the 172.16.0.0/16 side of that peering. Nothing new is needed. The POC cluster sits in the same private subnets, and the base security group already allows 172.16.0.0/16. Check:

```bash
# Databricks account admin: the workspace's network config and its VPC
databricks account workspaces list -o json | jq '.[] | select(.deployment_name == "dbc-3d8ca484-79f3") | {workspace_id, network_id}'
databricks account networks get <network_id> -o json | jq '{vpc_id, subnet_ids, security_group_ids}'

# AWS admin: the peering is active and the other side is that VPC
aws ec2 describe-vpc-peering-connections --vpc-peering-connection-ids pcx-013299c506ffd3395 \
  --query 'VpcPeeringConnections[0].{status: Status.Code, requester: RequesterVpcInfo, accepter: AccepterVpcInfo}'
# The workspace VPC routes back to 10.0.0.0/16 (or at least 10.0.4.0/22 and 10.0.12.0/22) over the peering
aws ec2 describe-route-tables --filters Name=vpc-id,Values=<workspace vpc id> \
  --query "RouteTables[].Routes[?VpcPeeringConnectionId=='pcx-013299c506ffd3395']"
```

If the workspace's subnets are outside 172.16.0.0/16, add them: `pulumi config set --path 'lakeflowGatewayCidrs[0]' <cidr>`.

Option 2: the workspace uses a Databricks-managed VPC, or a VPC not peered to ours. The gateway then has no private route to the cluster. Peer that VPC with the gp-api VPC (AWS admin), add the route to the private subnets through `extraRoutes` in `../deploy/components/vpc.ts` (those route tables declare their routes inline, so a route added from this stack would be removed by the next gp-api deploy), add the return route on the Databricks side, then set `lakeflowGatewayCidrs`. That changes the shared gp-api stack, so it needs its own reviewed PR; this POC does not make it. Making the cluster public is not an option: it sits in private subnets.

The end-to-end check is the gateway's event log in step 5.6: a connection timeout there means the network is wrong.

#### 5.3 Turn on the path (AWS admin)

```bash
pulumi config set enableLakeflow true
pulumi up
```

This adds the empty secret `gp-poc-replication-lakeflow-replication-user` (output `lakeflowReplicationSecretArn`). Pulumi never holds its value.

#### 5.4 Source setup (DB admin)

After steps 2 and 3, with `POC_ORG_LAYER_DATABASE_URL` exported as in step 2 (master user). Needs psql 15 or later and `jq`. The password goes from `openssl` into the secret and psql through environment variables and stdin, so it never appears on screen.

```bash
SECRET=$(pulumi stack output lakeflowReplicationSecretArn)
export LAKEFLOW_REPLICATION_PASSWORD="$(openssl rand -hex 24)"
jq -cn --arg p "$LAKEFLOW_REPLICATION_PASSWORD" '{username: "lakeflow_replication", password: $p}' \
  | aws secretsmanager put-secret-value --secret-id "$SECRET" --secret-string file:///dev/stdin --query VersionId
psql "$POC_ORG_LAYER_DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/002_lakeflow_replication.sql
unset LAKEFLOW_REPLICATION_PASSWORD
```

The seven `GRANT SELECT ON pg_catalog...` lines end with "no privileges were granted" warnings; that is expected (those catalogs are readable by everyone already). The last four queries should show `rds_replication = t`, `can_select = t`, the publication with only `public.org_contact_event`, `relreplident = f`, and the slot with `plugin = pgoutput`, `active = f`.

To rotate the password, re-run the block, then paste the new password into the connection in Catalog Explorer.

#### 5.5 Create the Unity Catalog connection (Databricks workspace admin, with read access to the secret)

Neither Node nor the gateway's JVM trusts the RDS CA, so the connection carries the RDS us-west-2 CA bundle ([TLS validation](https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/tls-server-certificate-validation)).

```bash
curl -sSo /tmp/rds-us-west-2-bundle.pem https://truststore.pki.rds.amazonaws.com/us-west-2/us-west-2-bundle.pem
HOST=$(pulumi stack output writerEndpoint)
SECRET=$(pulumi stack output lakeflowReplicationSecretArn)
(
  umask 077
  aws secretsmanager get-secret-value --secret-id "$SECRET" --query SecretString --output text \
    | jq --arg host "$HOST" --rawfile ca /tmp/rds-us-west-2-bundle.pem '{
        name: "poc_import_contacts_pg",
        connection_type: "POSTGRESQL",
        comment: "Import contacts replication POC (path B). Delete after the POC.",
        options: {host: $host, port: "5432", database: "poc_org_layer",
                  user: .username, password: .password, userProvidedServerCertificate: $ca}}' \
    > /tmp/lakeflow-connection.json
  databricks connections create --json @/tmp/lakeflow-connection.json -o json | jq '{name, connection_type, owner}'
  rm -f /tmp/lakeflow-connection.json
)
```

If the gateway later fails with `PKIX path building failed`, the multi-certificate bundle was not accepted. Replace it with the single CA the cluster uses (`aws rds describe-db-instances --db-instance-identifier gp-poc-replication-writer --query 'DBInstances[0].CACertificateIdentifier'`, then that certificate from the same bundle) by editing the connection in Catalog Explorer.

#### 5.6 Deploy the bundle and start it (Databricks workspace admin)

```bash
cd databricks/lakeflow
databricks bundle validate
databricks bundle deploy
databricks bundle run lakeflow_gateway --no-wait
```

The gateway provisions a VM and takes a few minutes to start. Watch it in the UI (Jobs & Pipelines > `poc-import-contacts-lakeflow-gateway`) or in its event log:

```sql
SELECT timestamp, level, message FROM goodparty_data_catalog.poc_import_contacts_lakeflow.gateway_event_log
ORDER BY timestamp DESC LIMIT 50
```

Once it is running and the slot shows `active = t` in Postgres, run the first ingestion by hand (the job then runs it every 5 minutes; runs before the gateway is ready can fail with "Timeout while waiting for table token"):

```bash
databricks bundle run lakeflow_ingestion
```

Then create the read source view, once, after the mirror table exists:

```bash
jq -n --rawfile s read_source_view.sql '{warehouse_id: "18583d8b081c6486", statement: $s, wait_timeout: "50s"}' > /tmp/lakeflow-view.json
databricks api post /api/2.0/sql/statements --json @/tmp/lakeflow-view.json | jq .status
```

`18583d8b081c6486` is the Serverless Starter Warehouse.

#### 5.7 Check the mirror (engineer)

```bash
psql "$POC_ORG_LAYER_DATABASE_URL" -c 'SELECT count(*), max(created_at) FROM org_contact_event'
```

```sql
SELECT count(*), max(created_at) FROM goodparty_data_catalog.poc_import_contacts_lakeflow.org_contact_event_log;
DESCRIBE TABLE goodparty_data_catalog.poc_import_contacts_lakeflow.org_contact_event;
```

Counts should match once the next run finishes. Note the actual type of `event_id` in the `DESCRIBE` output (the docs say `BINARY`; the view handles 16 raw bytes, text bytes and `STRING`).

#### 5.8 Point gp-api at it (engineer)

Run gp-api as in [Run gp-api locally](#run-gp-api-locally-against-the-poc-cluster-engineer) with:

```bash
POC_ORG_LAYER_ENABLED=true
POC_ORG_LAYER_STORE=postgres
POC_ORG_LAYER_LOG_SOURCE=goodparty_data_catalog.poc_import_contacts_lakeflow.org_contact_event_log
```

Writes land in Postgres immediately. Reads show them after the next ingestion run, so expect an edit to take minutes to appear in lists and counts.

#### 5.9 Freshness benchmark and soak (engineer)

Warm the Starter warehouse first. With minutes of lag, poll every 1 to 2 seconds rather than 250 ms; the resolution does not matter at this scale and the warehouse does less work.

```bash
export POC_ORG_LAYER_LOG_SOURCE=goodparty_data_catalog.poc_import_contacts_lakeflow.org_contact_event_log

# Burst: 20 events, default 900 s per-event timeout
npx tsx --env-file=.env src/pocOrgLayer/freshness.cli.ts --count 20 --poll-ms 1000

# Soak: one event every 5 s for an hour, which covers 12 scheduled runs
npx tsx --env-file=.env src/pocOrgLayer/freshness.cli.ts --soak --rate 0.2 --minutes 60 --poll-ms 2000

# Overnight reliability: one event a minute for 12 hours
npx tsx --env-file=.env src/pocOrgLayer/freshness.cli.ts --soak --rate 0.0167 --minutes 720 --poll-ms 5000
```

Record `lagMs` p50, p95 and max, `notSeenWithinTimeout`, `pollFailures`, and the job's run durations:

```sql
SELECT origin.update_id,
  min(timestamp) AS started,
  max(timestamp) AS ended,
  max_by(details:update_progress.state, timestamp) AS last_state
FROM goodparty_data_catalog.poc_import_contacts_lakeflow.ingestion_event_log
WHERE event_type IN ('create_update', 'update_progress')
GROUP BY origin.update_id ORDER BY started DESC LIMIT 30
```

If Databricks enables continuous mode for PostgreSQL, uncomment the three lines in `resources/lakeflow_postgres.yml`, set the job's `pause_status` to `PAUSED`, `databricks bundle deploy`, and run the same benchmark.

#### 5.10 Failover test (AWS admin and engineer)

This settles the disputed point in the replication evaluation: Databricks says a failover loses the slot and forces a full refresh of every table ([limitations](https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/postgresql-limits), "Replication"), while Aurora keeps state on a shared cluster volume and PostgreSQL 17 adds failover slots. Run it after a clean soak.

1. AWS admin adds a reader that can take over:

   ```bash
   pulumi config set lakeflowFailoverReader true
   pulumi up
   ```

2. Engineer records the slot before the failover:

   ```sql
   SELECT aurora_db_instance_identifier() AS writer;
   SELECT slot_name, active, failover, synced, wal_status, restart_lsn, confirmed_flush_lsn
   FROM pg_replication_slots WHERE slot_name = 'lakeflow_org_contact_event';
   ```

3. Engineer starts a soak that spans the failover. Some inserts will fail during the switch; that is expected and counted:

   ```bash
   npx tsx --env-file=.env src/pocOrgLayer/freshness.cli.ts --soak --rate 0.5 --minutes 40 --poll-ms 2000 --timeout-s 1800
   ```

4. About 10 minutes in, the AWS admin fails over:

   ```bash
   aws rds failover-db-cluster --db-cluster-identifier gp-poc-replication-db \
     --target-db-instance-identifier gp-poc-replication-reader
   aws rds wait db-instance-available --db-instance-identifier gp-poc-replication-reader
   aws rds describe-db-clusters --db-cluster-identifier gp-poc-replication-db \
     --query 'DBClusters[0].DBClusterMembers[].{id: DBInstanceIdentifier, writer: IsClusterWriter}'
   ```

5. Engineer repeats the step 2 queries through the cluster endpoint (now on the new writer) and watches both event logs for 15 minutes.

6. Read the result:

   | What you see | Meaning |
   | --- | --- |
   | Slot listed on the new writer, gateway reconnects, soak ends with `notSeenWithinTimeout` 0 | The slot survives an Aurora failover; the Databricks limitation does not apply here. |
   | Slot listed, but the gateway errors (for example an LSN or "replication slot ... is active" error) | Partial. Record the error and whether a gateway restart (`databricks bundle run lakeflow_gateway --restart --no-wait`) clears it. |
   | Slot missing, gateway or ingestion fails with "slot not found" | Full refresh forced. Recover and time it: recreate the slot as poc_admin (`SET ROLE lakeflow_replication; SELECT pg_create_logical_replication_slot('lakeflow_org_contact_event', 'pgoutput'); RESET ROLE;`), `databricks bundle run lakeflow_gateway --restart --no-wait`, then `databricks pipelines start-update <ingestion pipeline id> --full-refresh`. Compare counts as in 5.7 to check for lost events. |

7. Repeat once with a plain writer reboot (`aws rds reboot-db-instance --db-instance-identifier <current writer>`). The slot should survive a reboot; if it does not, that is worse news than the failover result.

8. Write the outcome into `replication-eval.md` and the PR.

After a failover the reader is the writer. Leave `lakeflowFailoverReader` on until `pulumi destroy`, or fail back first: turning it off would delete the current writer. The three base alarms watch `gp-poc-replication-writer` by instance name, so after a failover they watch the reader; check `pg_replication_slots` directly instead.

#### 5.11 What to watch

| Failure mode | How you detect it | Fix |
| --- | --- | --- |
| Gateway stopped or crashed, WAL piles up (Aurora keeps WAL for a stalled slot without limit) | Slot `active = f`; `OldestReplicationSlotLag` and `TransactionLogsDiskUsage` alarms; gateway failure email | `databricks bundle run lakeflow_gateway --restart --no-wait` |
| Slot lost (failover, manual drop, major version upgrade) | "slot not found" in the event logs; slot missing from `pg_replication_slots` | Recreate the slot and full refresh (5.10, step 6, last row) |
| Schema change on `org_contact_event` (add, rename or retype a column) | `NON_INCREMENTAL_SCHEMA_CHANGE` or `INCOMPATIBLE_SCHEMA_CHANGE` in the ingestion event log | Full refresh. Inline DDL tracking would handle added columns but is on hold ([source setup](https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/postgresql-source-setup)) |
| Ingestion runs failing or skipped | Job failure emails; soak `notSeenWithinTimeout` above 0; run table in 5.9 | Read the update's errors in the ingestion event log |
| Silent staleness | Postgres `max(created_at)` ahead of the view's by more than about 10 minutes; a low-rate soak left running is the canary | Check both pipelines are running |
| No successful run for 25 days (staged CDC files are deleted after 25 to 30 days) | Run table in 5.9 | Full refresh ([maintenance](https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/postgresql-maintenance)) |
| TLS or network | `PKIX path building failed` or connection timeouts in the gateway event log | Steps 5.5 and 5.2 |
| Cost | `system.billing.usage` for the gateway cluster and the pipeline | Turn it off when the test is done |

Errors and warnings across both pipelines:

```sql
SELECT timestamp, origin.pipeline_name, level, message
FROM goodparty_data_catalog.poc_import_contacts_lakeflow.gateway_event_log WHERE level IN ('WARN', 'ERROR')
UNION ALL
SELECT timestamp, origin.pipeline_name, level, message
FROM goodparty_data_catalog.poc_import_contacts_lakeflow.ingestion_event_log WHERE level IN ('WARN', 'ERROR')
ORDER BY timestamp DESC LIMIT 100
```

Slot lag in Postgres ([maintenance](https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/postgresql-maintenance)):

```sql
SELECT slot_name, active, wal_status,
  pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained_wal,
  pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn)) AS pending_wal
FROM pg_replication_slots WHERE slot_name = 'lakeflow_org_contact_event'
```

#### 5.12 Expected freshness and main risks

Expected freshness: minutes, not seconds. Databricks recommends at least 5 minutes between ingestion runs because serverless compute takes time to start, and does not support continuous mode for the PostgreSQL ingestion pipeline ([FAQ](https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/postgresql-faq)). An event waits for the next run (0 to 5 minutes) plus that run's duration, so expect p50 around 4 to 6 minutes and max around 10. Continuous mode, where it exists (SQL Server, MySQL, Oracle, Beta), applies changes "typically within a few minutes" ([continuous mode](https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/continuous-integrated-cdc)), so even that would not reach seconds.

Main risks:

- Public Preview, enrollment required ([pipeline](https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/postgresql-pipeline)).
- The gateway must run continuously on classic compute, or WAL builds up on the source ([FAQ](https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/postgresql-faq)). Rough cost: an m5.2xlarge driver and m5.large worker around the clock, plus DBUs and 288 serverless runs a day; the evaluation estimated $400 to $1,200 a month.
- Slot loss forces a full refresh of every table: failover per Databricks (step 5.10 tests it on Aurora), major version upgrades, manual drops ([limitations](https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/postgresql-limits)).
- Most schema changes force a full refresh while inline DDL tracking is on hold ([limitations](https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/postgresql-limits)).
- Aurora does not cap WAL kept for a stalled slot; the CloudWatch alarms are the only guard (`max_slot_wal_keep_size` is recommended by Databricks but is not set here).
- Deleting the pipeline does not drop the slot ([FAQ](https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/postgresql-faq)); teardown below does.

#### 5.13 Teardown

1. Databricks workspace admin:

   ```bash
   cd databricks/lakeflow
   databricks bundle destroy
   databricks connections delete poc_import_contacts_pg
   ```

   If the schema is not dropped because it still holds tables: `DROP SCHEMA goodparty_data_catalog.poc_import_contacts_lakeflow CASCADE`.

2. DB admin, if the cluster stays up for other paths (the gateway must be gone first, or the slot is still active):

   ```sql
   SET ROLE lakeflow_replication;
   SELECT pg_drop_replication_slot(slot_name) FROM pg_replication_slots
   WHERE slot_name = 'lakeflow_org_contact_event';
   RESET ROLE;
   DROP PUBLICATION IF EXISTS lakeflow_org_contact_event;
   REVOKE ALL ON TABLE public.org_contact_event FROM lakeflow_replication;
   REVOKE USAGE ON SCHEMA public FROM lakeflow_replication;
   REVOKE CONNECT ON DATABASE poc_org_layer FROM lakeflow_replication;
   DROP ROLE IF EXISTS lakeflow_replication;
   ```

3. AWS admin: `pulumi config set enableLakeflow false && pulumi up` (see the failover note in 5.10 about the reader), or go straight to the base teardown.

#### 5.14 Verified for path B, and what is not

Verified without AWS or admin rights:

- `sql/002_lakeflow_replication.sql` on a throwaway PostgreSQL 17 (`wal_level = logical`) as a non-superuser table owner, with a stand-in `rds_replication` role: refuses to run without the password, then creates the role, grants, `REPLICA IDENTITY FULL`, publication and `pgoutput` slot; re-runs cleanly. The replication user logs in with the password and reads the table. `pgoutput` on the slot emitted the benchmark's 3 inserts and nothing for an unpublished table. The 5.13 teardown SQL removes everything. Locally, slot creation needed the `REPLICATION` attribute, which Aurora grants through `rds_replication`.
- `databricks bundle validate` passes (CLI v1.7.0) and keeps `source_type: POSTGRESQL`.
- The read source view on synthetic tables in `poc_import_contacts` with `event_id` as 16-byte `BINARY`, text `BINARY` and `STRING`: the benchmark's query finds the right ids in all three. The same query on the raw 16-byte `BINARY` table finds nothing.
- The freshness benchmark end to end against local PostgreSQL 17 and that view, with a script copying rows into the `BINARY` table in place of Lakeflow: 3 of 3 seen.
- `personViewSql` with the view as the log source over a synthetic base table: 3 org people and 2 vendor people, as expected.
- `tsc -p tsconfig.deploy.json`, and the Pulumi program under mocks with `enableLakeflow` on and off.

Not verified, needs an admin:

- Enrollment, the connection, the bundle deploy, the gateway, and any real ingestion.
- Network reachability from the gateway (step 5.2).
- Whether the connection accepts the multi-certificate RDS bundle.
- The actual Delta type of `event_id`, and any extra columns Lakeflow adds.
- Everything in 5.9 and 5.10.

### 6. Path C: DMS to Kinesis to Zerobus

Read source: the Zerobus-fed Delta table, `POC_ORG_LAYER_LOG_SOURCE=goodparty_data_catalog.poc_import_contacts_<...>.org_contact_event`.

Steps, owners and commands: added by the path C PR.

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

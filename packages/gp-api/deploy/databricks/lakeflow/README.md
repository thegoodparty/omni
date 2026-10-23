# gp-api Postgres mirror (Lakeflow Connect)

Lakeflow Connect reads gp-api's Aurora change stream (database `gpdb`, schema
`public`) and keeps a copy of every table in Databricks, a few minutes behind.

| Env  | Aurora cluster   | Mirror                                     |
| ---- | ---------------- | ------------------------------------------ |
| dev  | `gp-api-db`      | `goodparty_data_catalog.gp_api_mirror_dev` |
| prod | `gp-api-db-prod` | `goodparty_data_catalog.gp_api_mirror`     |

A gateway (classic compute, always on) reads the replication slot and stages
changes. The ingestion pipeline (serverless) applies them; the PostgreSQL
connector cannot run it continuously, so a loop job runs it back to back.
Freshness is one pipeline run plus the wait for the next, a few minutes.

| Piece                                                                     | Where                                                                                               | Applied by              |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------- |
| `rds.logical_replication=1` cluster parameter group                       | `deploy/index.ts` (`logicalReplication`)                                                            | Pulumi, on merge        |
| Publication, `databricks_lakeflow` role, replica identity, trigger        | `prisma/schema/migrations/20261025120000_add_databricks_lakeflow_publication`                       | `prisma migrate deploy` |
| Role password, replication slot                                           | steps 3 and 7                                                                                       | DB admin                |
| Unity Catalog connection `gp_api_<env>_lakeflow`                          | `create-connection.sh`                                                                              | Databricks admin        |
| Service principal, schemas, secret scopes, grants, gateway, pipeline, job | [thegoodparty/gp-terraform-dataplatform](https://github.com/thegoodparty/gp-terraform-dataplatform) | Terraform               |

The 5432 ingress from the Databricks workspace VPC (172.16.0.0/16, peering
`pcx-013299c506ffd3395`) already exists on both clusters' security groups
("databricks via vpc peering" in `deploy/index.ts`).

## Owners

- **AWS admin**: reboots the writer in the RDS console.
- **DB admin**: connects to `gpdb` as the master user `gpuser` over the VPN.
  `$ADMIN_URL` below is that connection string. Needs psql 15 or later.
- **Databricks admin**: workspace admin with `CREATE CONNECTION` on the
  metastore and write access to the `gp-api-lakeflow-<env>` secret scopes.
  Databricks CLI, logged in.
- **Terraform owner**: merges and applies gp-terraform-dataplatform.

## Setup

Do dev end to end, then repeat every step with `prod` for `dev`.

Before you start, the Databricks account team or support enrolls the
workspace in the PostgreSQL connector preview (PostgreSQL shows under Data
Ingestion) and enables inline DDL tracking, so new columns flow without a
table re-copy. Then the DB admin runs their
`lakeflow_pg_ddl_change_tracking.sql` in `gpdb`
([source setup](https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/postgresql-source-setup)).
The migration's event trigger adds its audit table to the publication.

### 1. Merge this PR (engineer)

Merging attaches the parameter group to **both** the dev and prod clusters
and runs the migration. Previews are untouched. `rds.logical_replication` is
static, so nothing changes until each writer reboots. No slot exists yet, so
Aurora keeps no change log for Lakeflow. After the reboot,
`REPLICA IDENTITY FULL` makes every update and delete log the whole old row,
so expect more WAL.

### 2. Reboot the writer (AWS admin, then DB admin)

In the RDS console, open the cluster and check that its writer shows
`pending-reboot` for the cluster parameter group (`gp-api-db-params`, or
`gp-api-db-prod-params`). Reboot the writer in its maintenance window. Each
cluster has a single instance, so gp-api loses its database for about a
minute.

| Cluster          | Maintenance window (UTC) |
| ---------------- | ------------------------ |
| `gp-api-db`      | Saturday 06:30 to 07:00  |
| `gp-api-db-prod` | Tuesday 12:26 to 12:56   |

Then the DB admin checks the source:

```bash
psql "$ADMIN_URL" -c 'SHOW wal_level' \
  -c "SELECT count(*) AS published FROM pg_publication_tables WHERE pubname = 'databricks_lakeflow'" \
  -c "SELECT count(*) AS tables FROM pg_tables WHERE schemaname = 'public'" \
  -c "SELECT slot_name FROM pg_replication_slots"
```

Expect `logical`, `published` = `tables` and no slots.

### 3. Give the role a password (DB admin)

The migration creates `databricks_lakeflow` without a login. Generate a long
random password and hand it to the Databricks admin through a shared password
manager entry, never chat or a ticket. Paste it at the silent prompt:

```bash
read -rs LAKEFLOW_PASSWORD && export LAKEFLOW_PASSWORD
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 <<'SQL'
\getenv pw LAKEFLOW_PASSWORD
ALTER ROLE databricks_lakeflow LOGIN PASSWORD :'pw';
SQL
unset LAKEFLOW_PASSWORD
```

### 4. Apply Terraform, first pass (Terraform owner)

Merge and deploy the gp-terraform-dataplatform PR (branch
`feat/gp-api-lakeflow-mirror`). It creates `sp_gp_api_mirror`, the mirror
schemas, the `gp-api-lakeflow-<env>` secret scopes (empty), the readers group
and the schema grants. No gateway yet.

### 5. Store the password (Databricks admin)

Paste the same password at the silent prompt:

```bash
read -rs LAKEFLOW_PASSWORD
printf %s "$LAKEFLOW_PASSWORD" | databricks secrets put-secret gp-api-lakeflow-dev postgres-password
unset LAKEFLOW_PASSWORD
```

### 6. Create the connection (Databricks admin)

From this folder:

```bash
./create-connection.sh dev
```

Expect `"state": "SUCCEEDED"`. It creates `gp_api_dev_lakeflow`, with the RDS
us-west-2 CA bundle and the password resolved from the secret inside
Databricks. `DATABRICKS_WAREHOUSE_ID` overrides the Starter warehouse it runs
on.

To rotate the password, repeat steps 3 and 5, then `DROP CONNECTION
gp_api_dev_lakeflow` and run this step again. The connection copies the secret
when it is created.

### 7. Create the slot, then apply Terraform again (DB admin, then Terraform owner)

Do this in one sitting. The slot keeps every change from the moment it exists
until the gateway reads it.

```bash
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 \
  -c "SELECT pg_create_logical_replication_slot('databricks_lakeflow', 'pgoutput')"
```

If that is refused for lack of replication rights, run
`GRANT rds_replication TO CURRENT_USER` first. Slots have no owner, so the
gateway can read one the master user created.

Right away, open a one-line PR in gp-terraform-dataplatform that adds `"dev"`
to `gp_api_mirror_connected_envs`, then merge and deploy it. That apply
grants the service principal `USE CONNECTION` and creates
`gp-api-mirror-dev-gateway` (it starts on creation),
`gp-api-mirror-dev-ingestion` and the unpaused
`gp-api-mirror-dev-ingestion-loop` job.

Check that the slot shows `active = t`
(`SELECT slot_name, active FROM pg_replication_slots`). The first ingestion
runs can fail with "Timeout while waiting for table token" while the gateway
is still snapshotting. The loop retries on its own.

### 8. Access (Terraform owner)

The mirror holds users' personal data. Readers get access only through the
readers group in gp-terraform-dataplatform (`gp_api_mirror_readers` for prod,
and its dev counterpart). Add members there, not with ad hoc grants.

## Operations

The commands below need pipeline IDs:

```bash
ENV=dev
GATEWAY_ID=$(databricks pipelines list-pipelines --filter "name LIKE 'gp-api-mirror-$ENV-gateway'" -o json | jq -r '.[0].pipeline_id')
INGESTION_ID=$(databricks pipelines list-pipelines --filter "name LIKE 'gp-api-mirror-$ENV-ingestion'" -o json | jq -r '.[0].pipeline_id')
```

**New tables** need nothing. The migration's event trigger sets
`REPLICA IDENTITY FULL` on every table created in `public` and adds it to the
publication. The gateway looks for new tables every few hours (up to 6). To
pick one up sooner, restart the gateway:
`databricks pipelines stop "$GATEWAY_ID" && databricks pipelines start-update "$GATEWAY_ID"`.

**Columns.** With inline DDL tracking on, added columns flow by themselves.
Renaming or retyping a column, or changing a primary key, needs a full refresh
of that table. Auto full refresh (on, at most once an hour per table) does it.

**Full refresh by hand.** The loop job keeps an update running, so stop it
first. The loop then logs one failed run and carries on. If `start-update`
says an update is already active, the loop started one first; stop and try
again.

```bash
databricks pipelines stop "$INGESTION_ID"
databricks pipelines start-update "$INGESTION_ID" --json '{"full_refresh_selection": ["campaign", "user"]}'   # selected tables
databricks pipelines start-update "$INGESTION_ID" --full-refresh                                             # everything
```

Refresh everything after the slot is lost or recreated, or after 25 days
without a successful run (staged changes are deleted after 25 to 30 days).

**`DateTime` columns are `STRING`.** Prisma `DateTime` columns land as
`STRING` in the mirror. Cast them when you need timestamps, for example
`CAST(created_at AS TIMESTAMP)`.

**Slot and change-log size.** Nothing alerts on these yet, so check them by
hand, daily at first. Automated alerting is a follow-up once the Grafana
CloudWatch data source is fixed. In Postgres:

```sql
SELECT slot_name, active, wal_status,
  pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn)) AS pending
FROM pg_replication_slots;
```

Expect `active = t` and `pending` in megabytes, not gigabytes. In the AWS
console (CloudWatch, `AWS/RDS`, by `DBClusterIdentifier`), watch
`OldestReplicationSlotLag`, `ReplicationSlotDiskUsage` and
`TransactionLogsDiskUsage` on the writer. Steady growth means the slot is not
being read.

**Lag.** In Databricks, the latest runs of the ingestion pipeline:

```sql
SELECT origin.update_id, min(timestamp) AS started, max(timestamp) AS ended,
  max_by(details:update_progress.state, timestamp) AS state
FROM goodparty_data_catalog.gp_api_mirror_dev.ingestion_event_log
WHERE event_type IN ('create_update', 'update_progress')
GROUP BY 1 ORDER BY started DESC LIMIT 20;
```

Errors: the same tables (`gateway_event_log`, `ingestion_event_log`),
`WHERE level IN ('WARN', 'ERROR')`.

## Failure modes

| Failure                                                                    | Detected by                                                                | Fix                                                                                                            |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Gateway stopped; Aurora keeps change log for the unread slot without limit | Gateway not running; slot `active = f` or growing size in the manual check | Restart the gateway (Operations). If retiring the mirror, drop the slot                                        |
| Ingestion runs failing                                                     | Failed runs on the loop job and the ingestion pipeline                     | Read `ingestion_event_log` errors                                                                              |
| Slot lost (failover per Databricks docs, manual drop, major upgrade)       | "slot not found" in the event logs; slot missing in Postgres               | Recreate the slot (step 7), restart the gateway, full refresh everything                                       |
| Rename, retype or primary key change                                       | Schema change in `ingestion_event_log`                                     | Auto full refresh; by hand if it has not run within the hour                                                   |
| Table created by a role other than `gpuser`                                | `WARNING ... was not added to publication` when it is created              | `ALTER TABLE ... REPLICA IDENTITY FULL` and `ALTER PUBLICATION databricks_lakeflow ADD TABLE ...` as its owner |
| TLS or network                                                             | `PKIX path building failed` or timeouts in `gateway_event_log`             | Check the connection's certificate (step 6) and the 172.16.0.0/16 ingress                                      |

A major Postgres upgrade needs every logical slot dropped first, a parameter
group in the new family (`aurora-postgresql17`) in `deploy/index.ts`, then the
slot recreated and a full refresh of everything.

## Teardown

1. Terraform owner: remove the env from `gp_api_mirror_connected_envs` in
   gp-terraform-dataplatform and apply. That removes the gateway, pipeline,
   loop job and connection grant. Lakeflow does not drop destination tables.

2. Databricks admin:

   ```bash
   databricks api post /api/2.0/sql/statements --json '{"warehouse_id":"18583d8b081c6486","statement":"DROP CONNECTION gp_api_dev_lakeflow","wait_timeout":"30s"}'
   ```

3. DB admin, after the gateway is gone (an active slot cannot be dropped). The
   slot is the step that matters: while it exists, Aurora keeps change log for
   it.

   ```bash
   psql "$ADMIN_URL" -v ON_ERROR_STOP=1 \
     -c "SELECT pg_drop_replication_slot('databricks_lakeflow')" \
     -c 'ALTER ROLE databricks_lakeflow NOLOGIN PASSWORD NULL'
   ```

   The publication, role, grants and event trigger are migration-owned; remove
   them with a new migration if the mirror is retired for good.

4. AWS admin: set the env to `false` in `logicalReplication` in
   `deploy/index.ts`, merge, and reboot the writer in its window.

To retire the mirror for good, also remove the schemas, secret scopes, readers
group and service principal from gp-terraform-dataplatform.

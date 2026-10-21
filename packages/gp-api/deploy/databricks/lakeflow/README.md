# gp-api Postgres mirror (Lakeflow Connect)

Lakeflow Connect reads gp-api's Aurora change stream (database `gpdb`, schema
`public`) and keeps a copy of every table in Databricks, a few minutes behind.

| Env  | Aurora cluster   | Mirror                                     |
| ---- | ---------------- | ------------------------------------------ |
| dev  | `gp-api-db`      | `goodparty_data_catalog.gp_api_mirror_dev` |
| prod | `gp-api-db-prod` | `goodparty_data_catalog.gp_api_mirror`     |

A gateway (classic compute, always on) reads the replication slot and stages
changes. The ingestion pipeline (serverless) applies them; the PostgreSQL
connector cannot run it continuously, so the `ingestion_loop` job runs it back
to back. Freshness is one pipeline run plus the wait for the next, a few
minutes. Timestamps without time zone (every Prisma `DateTime`) land as
strings.

| Piece                                                              | Where                                                                         | Applied by                  |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------- | --------------------------- |
| `rds.logical_replication=1` cluster parameter group                | `deploy/index.ts` (`logicalReplication`)                                      | Pulumi, on merge            |
| Slot and WAL alerts, both clusters                                 | `deploy/components/alerting/lakeflow-replication-alerts.ts`                   | Pulumi prod stack (Grafana) |
| Publication, `databricks_lakeflow` role, replica identity, trigger | `prisma/schema/migrations/20261021120000_add_databricks_lakeflow_publication` | `prisma migrate deploy`     |
| Replication slot                                                   | step 5                                                                        | DB admin                    |
| Unity Catalog connection                                           | `create-connection.sh`                                                        | Databricks admin            |
| Schema, gateway, pipeline, loop job                                | this bundle                                                                   | Databricks admin            |

The 5432 ingress from the Databricks workspace VPC (172.16.0.0/16, peering
`pcx-013299c506ffd3395`) already exists on both clusters' security groups
("databricks via vpc peering" in `deploy/index.ts`).

## What merging does

Merging attaches the new parameter group to **both** the dev and prod
clusters. Previews are untouched. `rds.logical_replication` is static, so
nothing changes until each cluster's writer next reboots or fails over. Don't
wait for an unplanned failover. Reboot each writer on purpose in its
maintenance window (step 1):

| Cluster          | Maintenance window (UTC) |
| ---------------- | ------------------------ |
| `gp-api-db`      | Saturday 06:30 to 07:00  |
| `gp-api-db-prod` | Tuesday 12:26 to 12:56   |

Turning logical replication on creates no slot. No slot exists until step 5,
so Aurora retains no change log for Lakeflow before the gateway starts. After
the reboot, `REPLICA IDENTITY FULL` makes every update and delete log the whole
old row, so expect more WAL. To turn it off, set `prod` (or `dev`) to `false`
in `logicalReplication` and reboot again. Drop the slot first (teardown).

## Owners

- **AWS admin**: reboots the writer. AWS CLI with RDS write access.
- **DB admin**: connects to `gpdb` as the master user `gpuser` over the VPN.
  `$ADMIN_URL` below is that connection string. Needs psql 15 or later.
- **Databricks admin**: workspace admin with `CREATE CONNECTION` on the
  metastore, `CREATE SCHEMA` on `goodparty_data_catalog` and unrestricted
  cluster creation. Databricks CLI 0.276 or later, logged in.
- **Databricks account team or support**: enrollment and feature flags.

## Setup

Do dev end to end, then repeat every step with `prod` for `dev`.

### 0. Enrollment (Databricks admin with the account team and support)

- The PostgreSQL connector is Public Preview and needs enrollment. Confirm
  PostgreSQL shows under Data Ingestion.
- Ask support to enable inline DDL tracking, so new columns flow without a
  table re-copy. Then the DB admin runs their
  `lakeflow_pg_ddl_change_tracking.sql` in `gpdb`
  ([source setup](https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/postgresql-source-setup)).
  The migration's event trigger adds its audit table to the publication.

### 1. Turn on logical replication (AWS admin)

After the merge has deployed, in the maintenance window:

```bash
CLUSTER=gp-api-db   # gp-api-db-prod for prod
aws rds describe-db-clusters --db-cluster-identifier "$CLUSTER" \
  --query 'DBClusters[0].{group: DBClusterParameterGroup, members: DBClusterMembers[].{id: DBInstanceIdentifier, writer: IsClusterWriter, status: DBClusterParameterGroupStatus}}'
```

Expect `group` = `gp-api-db-params` (`gp-api-db-prod-params`) and the writer's
`status` = `pending-reboot`. Then reboot it. Each cluster has a single
instance, so gp-api loses its database for about a minute:

```bash
WRITER=$(aws rds describe-db-clusters --db-cluster-identifier "$CLUSTER" \
  --query 'DBClusters[0].DBClusterMembers[?IsClusterWriter].DBInstanceIdentifier' --output text)
aws rds reboot-db-instance --db-instance-identifier "$WRITER"
aws rds wait db-instance-available --db-instance-identifier "$WRITER"
```

### 2. Check the source (DB admin)

```bash
psql "$ADMIN_URL" -c 'SHOW rds.logical_replication' -c 'SHOW wal_level' \
  -c "SELECT count(*) AS published FROM pg_publication_tables WHERE pubname = 'databricks_lakeflow'" \
  -c "SELECT count(*) AS tables FROM pg_tables WHERE schemaname = 'public'" \
  -c "SELECT count(*) AS not_full FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relreplident <> 'f'" \
  -c "SELECT slot_name FROM pg_replication_slots"
```

Expect `on`, `logical`, `published` = `tables`, `not_full` = 0 and no slots.

### 3. Replication password (DB admin and Databricks admin)

The migration creates `databricks_lakeflow` without a login or password. Give
it both, and store the password only in a Databricks secret. The value never
appears on screen or in a file.

```bash
databricks secrets create-scope gp-api-lakeflow-dev     # once per env
export LAKEFLOW_PASSWORD="$(openssl rand -hex 24)"
printf %s "$LAKEFLOW_PASSWORD" | databricks secrets put-secret gp-api-lakeflow-dev postgres-password
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 <<'SQL'
\getenv pw LAKEFLOW_PASSWORD
ALTER ROLE databricks_lakeflow LOGIN PASSWORD :'pw';
SQL
unset LAKEFLOW_PASSWORD
```

To rotate, run it again, then step 4 with `DROP CONNECTION` first. The
connection copies the secret when it is created.

### 4. Create the connection (Databricks admin)

From this folder:

```bash
./create-connection.sh dev
```

Expect `"state": "SUCCEEDED"`. It creates `gp_api_dev_lakeflow`, with the RDS
us-west-2 CA bundle and the password resolved from the secret inside
Databricks. `DATABRICKS_WAREHOUSE_ID` overrides the Starter warehouse it runs
on.

### 5. Create the slot, then start the gateway at once (DB admin, then Databricks admin)

The slot keeps every change from the moment it exists until the gateway reads
it, so create it only when the gateway is minutes away:

```bash
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 \
  -c "SELECT pg_create_logical_replication_slot('databricks_lakeflow', 'pgoutput')"
```

If that is refused for lack of replication rights, run
`GRANT rds_replication TO CURRENT_USER` first. Slots have no owner, so the
gateway can read one the master user created.

Then, from this folder:

```bash
databricks bundle deploy -t dev --var ingestion_job_pause_status=PAUSED
databricks bundle run -t dev gateway --no-wait
```

Wait until the slot shows `active = t`
(`SELECT slot_name, active FROM pg_replication_slots`), then take the first
snapshot by hand and unpause the loop:

```bash
databricks bundle run -t dev ingestion
databricks bundle deploy -t dev
```

The first run can fail with "Timeout while waiting for table token" while the
gateway is still snapshotting. Run it again.

### 6. Access (Databricks admin)

The mirror holds users' personal data. Nothing is granted by default. Grant
`USE SCHEMA` and `SELECT` on the mirror schema to the specific service principal
or group that needs it, not to a broad group:

```sql
GRANT USE SCHEMA, SELECT ON SCHEMA goodparty_data_catalog.gp_api_mirror_dev TO `<principal>`;
```

## Operations

**New tables** need nothing. The migration's event trigger sets
`REPLICA IDENTITY FULL` on every table created in `public` and adds it to the
publication. The gateway looks for new tables every few hours (up to 6). To pick
one up sooner: `databricks bundle run -t dev gateway --restart --no-wait`.

**Columns.** With inline DDL tracking on, added columns flow by themselves.
Renaming or retyping a column, or changing a primary key, needs a full refresh
of that table. Auto full refresh (on, at most once an hour per table) does it.

**Full refresh by hand.** The loop job keeps a run going, so `--restart` cancels
it. The loop then logs one failed run and carries on.

```bash
databricks bundle run -t dev ingestion --restart --full-refresh campaign,user   # selected tables
databricks bundle run -t dev ingestion --restart --full-refresh-all             # everything
```

Refresh everything after the slot is lost or recreated, or after 25 days
without a successful run (staged changes are deleted after 25 to 30 days).

**Lag.** In Postgres:

```sql
SELECT slot_name, active, wal_status,
  pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn)) AS pending
FROM pg_replication_slots;
```

In Databricks, the latest runs of the ingestion pipeline:

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

| Failure                                                                    | Detected by                                                                                                          | Fix                                                                                                            |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Gateway stopped; Aurora keeps change log for the unread slot without limit | `lakeflow-<env>-slot-lag`, `-slot-disk`, `-wal-disk` alerts in #dev-alerts; gateway failure email; slot `active = f` | `databricks bundle run -t <env> gateway --restart --no-wait`. If retiring the mirror, drop the slot            |
| Ingestion runs failing                                                     | Job and pipeline failure emails                                                                                      | Read `ingestion_event_log` errors                                                                              |
| Slot lost (failover per Databricks docs, manual drop, major upgrade)       | "slot not found" in the event logs; slot missing in Postgres                                                         | Recreate the slot (step 5), restart the gateway, full refresh everything                                       |
| Rename, retype or primary key change                                       | Schema change in `ingestion_event_log`                                                                               | Auto full refresh; by hand if it has not run within the hour                                                   |
| Table created by a role other than `gpuser`                                | `WARNING ... was not added to publication` when it is created                                                        | `ALTER TABLE ... REPLICA IDENTITY FULL` and `ALTER PUBLICATION databricks_lakeflow ADD TABLE ...` as its owner |
| TLS or network                                                             | `PKIX path building failed` or timeouts in `gateway_event_log`                                                       | Check the connection's certificate (step 4) and the 172.16.0.0/16 ingress                                      |

A major Postgres upgrade needs every logical slot dropped first, a parameter
group in the new family (`aurora-postgresql17`) in `deploy/index.ts`, then the
slot recreated and a full refresh of everything.

## Teardown

1. Databricks admin, from this folder:

   ```bash
   databricks bundle destroy -t dev
   databricks api post /api/2.0/sql/statements --json '{"warehouse_id":"18583d8b081c6486","statement":"DROP CONNECTION gp_api_dev_lakeflow","wait_timeout":"30s"}'
   databricks secrets delete-scope gp-api-lakeflow-dev
   ```

   Lakeflow does not drop destination tables. If `destroy` leaves the schema,
   `DROP SCHEMA goodparty_data_catalog.gp_api_mirror_dev CASCADE`.

2. DB admin, after the gateway is gone (an active slot cannot be dropped). The
   slot is the step that matters: while it exists, Aurora keeps change log for
   it.

   ```bash
   psql "$ADMIN_URL" -v ON_ERROR_STOP=1 \
     -c "SELECT pg_drop_replication_slot('databricks_lakeflow')" \
     -c 'ALTER ROLE databricks_lakeflow NOLOGIN PASSWORD NULL'
   ```

   The publication, role, grants and event trigger are migration-owned; remove
   them with a new migration if the mirror is retired for good.

3. AWS admin: set the env to `false` in `logicalReplication` in
   `deploy/index.ts`, merge, and reboot the writer in its window.

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

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

Config keys (all optional): `vpcId`, `privateSubnetIds`, `vpnSecurityGroupId`, `databricksPeeringCidr`, `engineVersion`, `slotLagAlarmBytes`, `walDiskAlarmBytes`, `alarmEmail`, and for path A `databricksPrivateConnectivityRoleArn`.

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

Databricks reads `org_contact_event` live from Aurora through a Unity Catalog foreign catalog. Nothing is copied, so there is no replication slot, no pipeline and no mirror table.

Read source: `POC_ORG_LAYER_LOG_SOURCE=poc_import_contacts_pg.public.org_contact_event`.

**Expected freshness: live.** A committed row is visible to the next federated query that starts after the commit, because each query reads Postgres directly ([query federation](https://docs.databricks.com/aws/en/query-federation/)). The freshness benchmark should report lag of about one poll round trip. The open questions are different from paths B and C:

- **Per-query overhead.** Every people read through the person view now makes a Postgres round trip through PrivateLink, and federated queries never use the result cache.
- **Pushdown.** The `org_slug = ...` filter must run in Postgres.
- **Availability.** What happens to people reads when Aurora or the network path is down.

#### What `enableFederation=true` adds

Serverless SQL warehouses can't use the VPC peering, so they reach Aurora through the private connectivity setup in [Configure private connectivity to resources in your VPC](https://docs.databricks.com/aws/en/security/network/serverless-network-security/pl-to-internal-network). It has four parts:

- An internal NLB `gp-poc-repl-federation` in the private subnets, listening on 5432. Cross-zone load balancing is on, because the Databricks endpoint can land in either AZ while Aurora is in one. Its security group has PrivateLink inbound rule enforcement off, as the Databricks docs require.
- A TCP target group whose one IP target is the address the cluster reader endpoint resolves to when `pulumi up` runs. NLB targets can't be DNS names. With only a writer instance, the reader endpoint resolves to the writer.
- A VPC endpoint service on that NLB. Acceptance is required, and the only allowed principal is the Databricks serverless role `arn:aws:iam::565502421330:role/private-connectivity-role-us-west-2`. Override it with the `databricksPrivateConnectivityRoleArn` config key.
- An ingress rule on the database security group from the NLB security group, and a `gp-poc-replication-fed-HealthyHostCount` alarm on the existing SNS topic. The alarm fires when the NLB has no healthy Aurora target for 2 minutes.

Outputs:

| Output | Used for |
| --- | --- |
| `federationEndpointServiceName` | The NCC private endpoint rule's `endpoint_service` |
| `federationEndpointServiceId` | Accepting the Databricks endpoint connection |
| `federationDomainName` | The rule's domain name and the connection host |
| `federationNlbTargetIp` | Checking for IP drift (see below) |

`sql/002_federation_reader.sql` creates `databricks_federation`, a Postgres login with these limits:

- `SELECT` on `org_contact_event` only
- `default_transaction_read_only = on`
- `statement_timeout = 30s`
- `CONNECTION LIMIT 40`, so a burst of federated queries can't use up Aurora's connections

`databricks/federation/ncc.sh` adds the private endpoint rule to the workspace's network connectivity configuration (NCC). It creates and attaches an NCC only if the workspace has none, and never replaces one that is attached.

`databricks/federation/catalog.sh` does the rest on the Databricks side:

- stores the login in secret scope `poc-import-contacts`
- creates connection `poc_import_contacts_pg` (type `postgresql`, credentials from the scope, the RDS RSA2048 G1 root CA passed as `userProvidedServerCertificate`)
- creates foreign catalog `poc_import_contacts_pg` over database `poc_org_layer`
- grants `USE CATALOG`, `USE SCHEMA` and `SELECT` to `swain@goodparty.org` and to the `gp_api` service principal (application id `e967b22e-3ec1-491e-8074-9e3dadeab666`)
- refreshes the table metadata and runs a count

#### Steps

Steps 1 to 3 come first. Run commands from `packages/gp-api/poc-replication`.

**4.1 Turn on the path (AWS admin).**

```bash
pulumi stack select poc
pulumi config set enableFederation true
pulumi up
pulumi stack output federationEndpointServiceName
pulumi stack output federationDomainName
```

**4.2 Create the read-only login (DB admin).** With `POC_ORG_LAYER_DATABASE_URL` exported as in step 2, run this with psql 15 or newer. The password is never echoed.

```bash
export FEDERATION_PASSWORD="$(openssl rand -base64 32 | tr -d '/+=')"
psql "$POC_ORG_LAYER_DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/002_federation_reader.sql
```

Keep that shell open for 4.5. If someone else is the workspace admin, hand the password over in 1Password, never in Slack or a ticket.

**4.3 Add the private endpoint rule (Databricks account admin).** You need a CLI profile for `https://accounts.cloud.databricks.com` with the account id.

```bash
ENDPOINT_SERVICE=$(pulumi stack output federationEndpointServiceName) \
DOMAIN_NAME=$(pulumi stack output federationDomainName) \
DATABRICKS_ACCOUNT_PROFILE=<account profile> \
./databricks/federation/ncc.sh
```

It prints `NCC_ID`, `RULE_ID`, `VPC_ENDPOINT_ID` and `connection_state=PENDING`. Keep the ids for teardown. If the rule isn't accepted within 14 days it expires.

**4.4 Accept the endpoint (AWS admin).**

```bash
aws ec2 accept-vpc-endpoint-connections \
  --service-id "$(pulumi stack output federationEndpointServiceId)" \
  --vpc-endpoint-ids <VPC_ENDPOINT_ID from 4.3>
```

Then the account admin re-runs `ncc.sh` (it's idempotent) until it prints `connection_state=ESTABLISHED`. That takes a few minutes.

**4.5 Create the connection and foreign catalog (Databricks workspace admin).** In the shell from 4.2, or with `FEDERATION_PASSWORD` set from 1Password:

```bash
DOMAIN_NAME=$(pulumi stack output federationDomainName) ./databricks/federation/catalog.sh
```

It ends with the count query and `POC_ORG_LAYER_LOG_SOURCE=poc_import_contacts_pg.public.org_contact_event`.

- If the count fails with a timeout right after `ESTABLISHED`, wait about 10 minutes and run it again. New serverless compute picks up the NCC change; the delay is unverified.
- If it fails with a certificate error, the warehouse doesn't accept the CA. As a POC-only fallback, an admin can run `DROP CATALOG poc_import_contacts_pg CASCADE` and `DROP CONNECTION poc_import_contacts_pg`, change the script's `userProvidedServerCertificate` line to `trustServerCertificate 'true'`, and run it again.

**4.6 Check pushdown (engineer).** In the SQL editor on the Starter warehouse:

```sql
EXPLAIN FORMATTED
SELECT person_id, max_by(value, created_at) AS v
FROM poc_import_contacts_pg.public.org_contact_event
WHERE org_slug = 'poc-view-bench'
GROUP BY person_id
```

The query Databricks sends to Postgres should carry `org_slug = 'poc-view-bench'` in its WHERE. That is the only predicate the person view needs pushed down. `max_by ... FILTER` and the GROUP BY stay in Databricks, because only standard aggregates push down and the person view's aggregates aren't standard. The freshness tool's `--view-count --explain` prints the matching plan lines for the real person view.

To see what actually reached Postgres and how long it took there (DB admin):

```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
SELECT calls, round(mean_exec_time::numeric, 2) AS mean_ms, query
FROM pg_stat_statements WHERE query ILIKE '%org_contact_event%' ORDER BY calls DESC LIMIT 10;
```

A query with no `org_slug` in it means the filter wasn't pushed, and every read is copying the whole log.

#### Point gp-api at it (engineer)

Use the "Run gp-api locally" section below with:

```bash
POC_ORG_LAYER_ENABLED=true
POC_ORG_LAYER_STORE=postgres
POC_ORG_LAYER_DATABASE_URL=<from step 2>
POC_ORG_LAYER_LOG_SOURCE=poc_import_contacts_pg.public.org_contact_event
```

Writes go to Aurora, and the next people read sees them. A personal token in `PEOPLE_DATABRICKS_API_KEY` reads as swain@. `PEOPLE_DATABRICKS_CLIENT_ID` and `PEOPLE_DATABRICKS_CLIENT_SECRET` read as `gp_api`. Both are granted.

Query federation settings that matter here:

- **Result cache.** Federated queries never use the result cache or disk cache ([limitations](https://docs.databricks.com/aws/en/query-federation/database-federation#limitations)). The Delta POC's roughly 1.2 s cache hits don't apply, but neither does the "a write busts the cache" penalty.
- **Concurrency.** Connections are throttled only by the warehouse's concurrent query limit, with no per-connection limit across warehouses (same page). Aurora's protection is the role's `CONNECTION LIMIT 40` and the 2 ACU ceiling.
- **Metadata.** Unity Catalog refreshes foreign table metadata at query time ([refresh metadata](https://docs.databricks.com/aws/en/query-federation/database-federation)). `catalog.sh` refreshes once up front. A column rename on the Postgres side fails reads loudly rather than corrupting them.
- **`fetchSize`.** By default the connector fetches the whole result in one go. For orgs with very large logs, `FROM <table> WITH ('fetchSize' 100000)` streams it in batches ([performance](https://docs.databricks.com/aws/en/query-federation/performance-recommendations)). It isn't needed at POC sizes.
- **Join pushdown (Public Preview toggle).** Doesn't apply. The person view joins Aurora rows to the Delta vendor table, and a join across sources can't be pushed down.
- **Serverless network policy.** Domains in a private endpoint rule are allowlisted automatically.

#### Benchmarks (engineer)

In `packages/gp-api`, with `POC_ORG_LAYER_DATABASE_URL` and `POC_ORG_LAYER_LOG_SOURCE=poc_import_contacts_pg.public.org_contact_event` exported. Warm the warehouse first (any query), and run each benchmark twice.

```bash
# Freshness burst. Expect lag p50 about equal to pollRttMs p50, and 0 notSeenWithinTimeout.
npx tsx --env-file=.env src/pocOrgLayer/freshness.cli.ts --count 50 --timeout-s 60

# Soak: 2 writes/sec for 30 minutes. Watch pollFailures and the max lag.
npx tsx --env-file=.env src/pocOrgLayer/freshness.cli.ts --soak --rate 2 --minutes 30 --timeout-s 60

# Read overhead: the same 600 synthetic people go into Postgres and the Delta log,
# then 10 rounds of person-view counts and bare log scans over each, plus the bare vendor table.
npx tsx --env-file=.env src/pocOrgLayer/freshness.cli.ts --view-count \
  --org-slug poc-view-bench --seed-people 600 --runs 10 --explain

# Same at a larger org (15,000 events per read)
npx tsx --env-file=.env src/pocOrgLayer/freshness.cli.ts --view-count \
  --org-slug poc-view-bench --seed-people 5000 --runs 10
```

How `--view-count` works:

- It runs on the Houghton City constituents scope by default (`--dataset`, `--state`, `--district-type`, `--district-name`).
- `--seed-people` only accepts org slugs that start with `poc-`. It replaces that org's earlier rows in both stores.
- Each query carries a unique literal, so the Delta side can't answer from the result cache either.
- Compare `results["personView:poc_import_contacts_pg..."].ms` with `results["personView:goodparty_data_catalog.poc_import_contacts.org_contact_event"].ms`. The `logScan:` rows isolate the cost of reading the log alone.
- Both person-view counts should equal `baseTable` plus the seeded people.

For end-to-end numbers, repeat the read table from the Delta POC report against gp-api with this read source: list, search, count, detail and stats, distinct and after a write.

#### Test what happens when Aurora is unreachable

With gp-api running on the federated source, run each of these. During each one, run `--view-count --runs 3` and one `GET /v1/contacts`. Record `failureMs`, `firstError` and the HTTP status and time. Expect every people read with the flag on to fail; with the flag off, nothing should change.

1. **Login refused (DB admin, quick).** Run `ALTER ROLE databricks_federation NOLOGIN;`, test, then `ALTER ROLE databricks_federation LOGIN;`.
2. **Network path cut (AWS admin).** Remove the NLB-to-Aurora rule, test, then put it back with `pulumi up`:
   ```bash
   SG=$(pulumi stack output securityGroupId)
   RULE=$(aws ec2 describe-security-group-rules --filters Name=group-id,Values="$SG" \
     --query "SecurityGroupRules[?Description=='databricks serverless via privatelink nlb'].SecurityGroupRuleId" --output text)
   aws ec2 revoke-security-group-ingress --group-id "$SG" --security-group-rule-ids "$RULE"
   ```
   This one shows how long a read hangs before it fails: the 50 s statement wait, the JDBC connect timeout or the NLB.
3. **Cluster stopped (AWS admin).** Run `aws rds stop-db-cluster --db-cluster-identifier gp-poc-replication-db`, test, then `aws rds start-db-cluster ...`. After it starts, compare `dig +short "$(pulumi stack output federationDomainName)"` with `pulumi stack output federationNlbTargetIp`. If they differ, reads stay broken until `pulumi up` re-points the target. That is the IP drift risk below.

#### What to watch for

From `replication-eval.md` ("every query hits Aurora; reads fail if Aurora or the network is down"; "only suits selective queries"), plus what this setup adds:

| Failure mode | How you'd see it |
| --- | --- |
| Aurora, the NLB or PrivateLink is down, so people reads fail | `gp-poc-replication-fed-HealthyHostCount` alarm; gp-api 5xx on contacts routes; `pollFailures` and `failures` in the tool; failed statements in Databricks query history |
| Aurora IP drift: after a failover, stop/start or some maintenance, the reader endpoint moves to a new IP and the NLB target is stale ([Databricks note on RDS IPs](https://docs.databricks.com/aws/en/security/network/serverless-network-security/pl-to-internal-network)) | Same alarm; `dig` disagrees with `federationNlbTargetIp`. The fix here is `pulumi up`. Production would need the AWS IP-sync Lambda pattern that page links to. |
| Private endpoint not established, rejected or expired | `ncc.sh` shows `connection_state` other than `ESTABLISHED`; reads time out on connect |
| Filter not pushed down, so each read copies the whole log | `EXPLAIN FORMATTED` (4.6); `pg_stat_statements` shows the query without `org_slug`; `logScan` time grows with the total log size, not the org's |
| Aurora overloaded by reads (no result cache, and each people read is a Postgres query) | CloudWatch `DatabaseConnections`, `ACUUtilization`, `CPUUtilization` on `gp-poc-replication-writer`; `too many connections for role` errors once the limit of 40 is hit |
| Slow Postgres query hits the role's 30 s statement timeout | `canceling statement due to statement timeout` in `firstError` or the gp-api logs |
| Credentials rotated in Postgres but not in the connection | Auth errors on every read. Re-run 4.2, then tear down and redo 4.5. |

#### Main risks

- **Availability coupling.** People reads with the flag on depend on Aurora, the NLB, PrivateLink and the NCC being up. There is no mirror to fall back to ([query federation limitations](https://docs.databricks.com/aws/en/query-federation/database-federation#limitations); `replication-eval.md`).
- **Read cost on every query.** No result cache, and all non-standard aggregates run in Databricks after fetching the org's rows. Read latency grows with the size of an org's log, and Aurora takes load from every people read ([limitations](https://docs.databricks.com/aws/en/query-federation/database-federation#limitations); [PostgreSQL pushdowns](https://docs.databricks.com/aws/en/query-federation/postgresql)).
- **Stable target IPs.** NLB targets are IPs and Aurora doesn't keep them stable, so near-zero upkeep needs an IP-sync job ([Databricks private connectivity](https://docs.databricks.com/aws/en/security/network/serverless-network-security/pl-to-internal-network)).
- **Vendor guidance.** Databricks recommends Lakeflow Connect over query federation when "performance on higher data volumes and lower latency are priorities" ([connect to external databases](https://docs.databricks.com/aws/en/query-federation/)).
- **Cost.** Databricks charges networking for serverless-to-customer PrivateLink traffic, plus about $16 a month for the NLB, plus endpoint hours (same private connectivity page).

#### Teardown, path A

1. **Databricks workspace admin.**
   ```sql
   DROP CATALOG IF EXISTS poc_import_contacts_pg CASCADE;
   DROP CONNECTION IF EXISTS poc_import_contacts_pg;
   ```
   Then `databricks secrets delete-scope poc-import-contacts`. Also delete the bench rows from the Delta log: `DELETE FROM goodparty_data_catalog.poc_import_contacts.org_contact_event WHERE org_slug = 'poc-view-bench'`.
2. **Databricks account admin.** `databricks account network-connectivity delete-private-endpoint-rule <NCC_ID> <RULE_ID>`. If `ncc.sh` created the NCC, it stays attached with no rules, which has no effect.
3. **AWS admin.** `pulumi config set enableFederation false && pulumi up`, or the full teardown below.
4. **DB admin,** only if the cluster stays. `DROP OWNED BY databricks_federation; DROP ROLE databricks_federation;`

#### Path A: verified and not verified

Verified without AWS or admin rights:

- **Type checks.** `tsc -p tsconfig.deploy.json` passes.
- **Pulumi mocks.** The program runs under mocks with `enableFederation=true`: 21 resources, and every output resolves (target IP from a mocked DNS lookup). With the flag off it is unchanged at 12 resources.
- **`sql/002_federation_reader.sql` on local Postgres 16:**
  - it applies twice
  - it fails with exit 3 when `FEDERATION_PASSWORD` is unset
  - the role can read the table, INSERT and CREATE TABLE fail as read-only, and `transaction_read_only` and `statement_timeout` show `on` and `30s`
- **Databricks SQL in `catalog.sh`:** `CREATE CONNECTION` parses under `EXPLAIN`. It got as far as looking up the not-yet-created secret, so the `secret()` and `userProvidedServerCertificate` options are accepted. `GRANT ... ON CATALOG` to the service principal and `REFRESH FOREIGN TABLE` also parse.
- **Scripts.** Both are clean under `shellcheck`, and `run_sql` was exercised on the Starter warehouse.
- **Freshness tool `--view-count` against the Delta log on both sides** (the foreign catalog doesn't exist yet): seeded 120 people into local Postgres and the Delta log, re-seeding replaced them, and the counts were right (4,407 base, 4,527 view, 360 log events). A missing source is reported per variant, not as a crash. The burst mode still polls after the refactor.

Needs an admin, unverified:

- **Not applied anywhere.** `pulumi preview` and `pulumi up` have not run. No NLB, endpoint service, NCC rule, connection or foreign catalog exists.
- **Whether serverless reaches the NLB at all:** the Databricks endpoint's AZs and cross-zone routing.
- **TLS.** Whether the connection accepts the RDS root CA as `userProvidedServerCertificate`, and whether the reader endpoint name is on Aurora's certificate.
- **The `uuid` type.** It isn't in Databricks' PostgreSQL type mapping table. `event_id` is expected to arrive as a string, which the freshness poll relies on.
- **Pushdown of `org_slug`, `pg_stat_statements` and timings.** Whether `org_slug` is pushed, whether `pg_stat_statements` is preloaded on Aurora 17, and every latency and failure-mode number.

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

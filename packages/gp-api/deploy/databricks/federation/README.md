# gp-api Postgres in Databricks (Lakehouse Federation)

Databricks queries gp-api's Aurora database (`gpdb`, schema `public`) live
through a Unity Catalog connection and a foreign catalog. Nothing is copied:
every query runs against Postgres, as the read-only role
`databricks_federation`.

| Env  | Aurora cluster   | Connection    | Foreign catalog |
| ---- | ---------------- | ------------- | --------------- |
| dev  | `gp-api-db`      | `gp_api_dev`  | `gp_api_pg_dev` |
| prod | `gp-api-db-prod` | `gp_api_prod` | `gp_api_pg`     |

Federated queries run on serverless compute, which cannot use the workspace's
VPC peering, and PrivateLink to serverless is not on our Databricks plan. So
the path is public but allowlisted:

```
Databricks serverless (us-west-2)
  -> internet-facing NLB gp-api-db-<env>-federation, port 5432, open only to
     Databricks' published us-west-2 outbound ranges
  -> RDS Proxy gp-api-db-<env>-federation (private subnets)
  -> Aurora writer
```

The NLB passes TCP through; TLS runs end to end between Databricks and the
proxy. The proxy follows the writer across failovers, and its endpoint IPs,
which the NLB targets, are static for the life of the endpoint. Pulumi looks
them up on every deploy.

| Piece                                                                         | Where                                                                                               | Applied by                |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------- |
| `databricks_federation` role, grants, guardrails                              | `prisma/schema/migrations/20261026120000_add_databricks_federation_role`                            | `prisma migrate deploy`   |
| NLB, RDS Proxy, empty proxy secret (dev and prod stacks only)                 | `deploy/components/databricks-federation.ts`                                                        | Pulumi, on deploy         |
| Role password and `LOGIN`                                                     | step 2                                                                                              | DB admin                  |
| Credentials in the proxy secret and in secret scope `gp-api-federation-<env>` | step 3                                                                                              | AWS and Databricks admins |
| Connection `gp_api_<env>`                                                     | `create-connection.sh`, step 4                                                                      | Databricks admin          |
| Secret scopes, foreign catalogs, readers groups, grants                       | [thegoodparty/gp-terraform-dataplatform](https://github.com/thegoodparty/gp-terraform-dataplatform) | Terraform                 |

The role can only read: `SELECT` on every table in `public` (including ones
later migrations create), every transaction read-only, a 60-second
statement timeout and at most 20 connections.

## Security

The NLB's security group allows 5432 only from Databricks' us-west-2
serverless outbound ranges. Those ranges are shared by every Databricks
customer's serverless compute in the region, so the allowlist keeps out the
rest of the internet, not other Databricks tenants. What protects the data
past the NLB is TLS (the proxy requires it), the password, and the role
itself: read-only, 60-second statements, 20 connections.

### Updating the ranges

The ranges live in `DATABRICKS_SERVERLESS_OUTBOUND_CIDRS` in
`deploy/components/databricks-federation.ts`, read from
https://www.databricks.com/networking/v1/ip-ranges.json. To check them:

```bash
curl -fsS https://www.databricks.com/networking/v1/ip-ranges.json | jq -r '.prefixes[]
  | select(.platform == "aws" and .region == "us-west-2" and .type == "outbound")
  | .ipv4Prefixes[]'
```

If they differ, replace the list and the date in its comment, and merge. A
range Databricks adds that is missing here shows up as connection timeouts
from some queries.

## TLS

RDS Proxy presents an ACM certificate, which chains to the Amazon Trust
Services roots, not the RDS CA
([RDS Proxy TLS](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-proxy.howitworks.html#rds-proxy-security.tls)).
The certificate names the proxy's `*.proxy-….rds.amazonaws.com` host, not the
NLB's, and Databricks verifies the hostname by default (`sslmode=verify-full`),
which would fail. So the connection sets `sslmode` to `verify-ca`, which
"validate[s] the certificate chain without hostname verification"
([PostgreSQL federation](https://docs.databricks.com/aws/en/query-federation/postgresql)),
and carries the Amazon root CAs as `userProvidedServerCertificate`.

## Cost

RDS Proxy on Aurora Serverless v2 costs $0.015 per ACU-hour with an 8-ACU
minimum: about $88 a month per cluster at today's usage. It scales with the
database's ACUs, so a busier cluster costs more. The NLB adds its own hourly
charge.

## Owners

- **Engineer**: merges this repo's PR and the Terraform one.
- **DB admin**: connects to `gpdb` as the master user `gpuser` over the VPN.
- **AWS admin**: can write Secrets Manager secrets in the gp-api account.
- **Databricks admin**: workspace admin who is a metastore admin or holds
  `CREATE CONNECTION` on the metastore. Databricks CLI, logged in.
- **Terraform owner**: merges and deploys gp-terraform-dataplatform (Deploy
  needs a gp-dataeng approval).

## Setup

Do dev end to end, then repeat every step for prod (`prod`, `gp_api_prod`,
`gp-api-federation-prod`).

Before you start, the gp-terraform-dataplatform federation PR is merged and
deployed with `gp_api_federation_envs` empty. That creates the secret scopes
and the readers groups.

### 1. Deploy omni (engineer)

Merging this PR deploys dev; prod follows on the release train. The deploy
runs the migration (role without a login) and creates the NLB, the proxy and
its empty secret. Then get the NLB's DNS name (stack output
`databricksFederationHost`) and check its targets (`gp-engineer` is enough):

```bash
ENV=dev
aws elbv2 describe-load-balancers --names gp-api-db-$ENV-federation \
  --query 'LoadBalancers[0].DNSName' --output text
aws elbv2 describe-target-health --target-group-arn "$(aws elbv2 describe-target-groups \
  --names gp-api-db-$ENV-federation --query 'TargetGroups[0].TargetGroupArn' --output text)" \
  --query 'TargetHealthDescriptions[].[Target.Id,TargetHealth.State]' --output text
```

Expect two `healthy` targets, the proxy's endpoint IPs. The proxy's own
target stays unavailable until step 3.

### 2. Give the role a password (DB admin)

Generate a long random password in 1Password and share the item with the
AWS and Databricks admins; never send it in chat or a ticket. In psql,
connected to `gpdb` as `gpuser`:

```sql
\password databricks_federation
ALTER ROLE databricks_federation LOGIN;
```

`\password` prompts for it, so it never lands in your shell history or the
server log.

### 3. Store the credentials (AWS admin, then Databricks admin)

The same password goes to two places. Paste it at the silent prompt each time.

The proxy logs in to Aurora with the secret (AWS admin):

```bash
read -rs FEDERATION_PASSWORD
printf %s "$FEDERATION_PASSWORD" | jq -Rs '{username: "databricks_federation", password: .}' |
  aws secretsmanager put-secret-value --secret-id gp-api-db-dev-federation-proxy --secret-string file:///dev/stdin
unset FEDERATION_PASSWORD
aws rds describe-db-proxy-targets --db-proxy-name gp-api-db-dev-federation \
  --query 'Targets[].[Type,TargetHealth.State,TargetHealth.Reason]' --output text
```

Within a few minutes the `RDS_INSTANCE` target shows `AVAILABLE`.

Databricks logs in to the proxy with the secret scope (Databricks admin):

```bash
read -rs FEDERATION_PASSWORD
printf %s "$FEDERATION_PASSWORD" | databricks secrets put-secret gp-api-federation-dev postgres-password
unset FEDERATION_PASSWORD
```

### 4. Create the connection (Databricks admin)

From this folder, with step 1's DNS name:

```bash
./create-connection.sh dev gp-api-db-dev-federation-....elb.us-west-2.amazonaws.com
```

It creates `gp_api_dev` through the SQL Statement API on the Starter
warehouse (`DATABRICKS_WAREHOUSE_ID` overrides it), with the password
resolved from the secret inside Databricks, `sslmode` `verify-ca` and the
Amazon root CAs (see TLS). Then it makes the `github-action` service
principal (application id `a04e9e24-aac3-4308-9a65-d88fa34e444f`, override
with `CONNECTION_OWNER`) the owner. That is the identity that applies
gp-terraform-dataplatform: as owner it can grant on the connection and build
the foreign catalog on it, whoever ran this script. Metastore admins can
still manage it. It ends with `gp_api_dev is owned by a04e9e24-...`.
Re-running it only fixes the owner.

### 5. Turn the env on in Terraform (engineer, then Terraform owner)

In gp-terraform-dataplatform, add the env once its connection exists:

```hcl
gp_api_federation_envs = ["dev"]
```

Merge and run Deploy. It adds the foreign catalog, its grants and the
connection grants.

### 6. Test (anyone in the readers group)

In the SQL editor on a serverless SQL warehouse (Serverless Starter
Warehouse):

```sql
SELECT count(*) FROM gp_api_pg_dev.public.campaign;
```

### 7. Access

The catalog holds users' personal data. People get it only through the
readers groups `gp_api_pg_dev_readers` and `gp_api_pg_readers`, assigned in
the account console. gp-api's service principal (`gp_api`) reads both
catalogs through Terraform grants. Don't grant on the catalog by hand.

## Rotating the password

Repeat steps 2 and 3, then a metastore admin updates the password on
`gp_api_<env>` in Catalog Explorer. The connection copied the secret when it
was created, so the new secret alone changes nothing.

## Failure modes

| Symptom                                                 | Likely cause                                                                 | Fix                                                                                                               |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Connection timeout                                      | Databricks changed its ranges, or the NLB has no healthy target              | Check the ranges (Updating the ranges) and the target health (step 1)                                             |
| `password authentication failed`                        | The proxy secret, the Databricks secret and the role disagree, or no `LOGIN` | Steps 2 and 3, then Rotating the password. The proxy targets' `Reason` (step 3) says which side failed            |
| Certificate or hostname error                           | Connection lacks `sslmode` `verify-ca` or the Amazon root CAs                | Drop and recreate it with `create-connection.sh`                                                                  |
| `canceling statement due to statement timeout`          | Query ran over 60 seconds in Postgres                                        | Filter on indexed columns so it pushes down, or copy the rows to Delta once. Raising the limit is a new migration |
| `too many connections for role "databricks_federation"` | More than 20 concurrent federated scans                                      | Wait, or run fewer concurrent queries                                                                             |
| `cannot execute ... in a read-only transaction`         | A write through the catalog                                                  | By design                                                                                                         |
| `Connection ... already exists` from the script         | It exists and you have no privilege on it, so it looked missing              | Ask a metastore admin to check its owner is `github-action`                                                       |

## Teardown

1. Engineer and Terraform owner: remove the env from `gp_api_federation_envs`
   and Deploy. That drops the foreign catalog and its grants.
2. Metastore admin: `DROP CONNECTION gp_api_dev`, and
   `databricks secrets delete-secret gp-api-federation-dev postgres-password`.
3. DB admin: `ALTER ROLE databricks_federation NOLOGIN PASSWORD NULL;`
4. Engineer: set the env to `undefined` in `databricksFederationName` in
   `deploy/index.ts` and merge. The deploy deletes the NLB, the proxy and its
   secret. The role and grants are migration-owned; drop them with a new
   migration if federation is retired for good.

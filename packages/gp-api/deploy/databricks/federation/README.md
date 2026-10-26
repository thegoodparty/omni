# gp-api Postgres in Databricks (Lakehouse Federation)

Databricks queries gp-api's Aurora database (`gpdb`, schema `public`) live
through a Unity Catalog connection and a foreign catalog. Nothing is copied:
every query runs against Postgres, as the read-only role
`databricks_federation`.

| Env  | Aurora cluster endpoint                                           | Connection    | Foreign catalog |
| ---- | ----------------------------------------------------------------- | ------------- | --------------- |
| dev  | `gp-api-db.cluster-cmb1uukjsfbe.us-west-2.rds.amazonaws.com`      | `gp_api_dev`  | `gp_api_pg_dev` |
| prod | `gp-api-db-prod.cluster-cmb1uukjsfbe.us-west-2.rds.amazonaws.com` | `gp_api_prod` | `gp_api_pg`     |

Federated queries run on serverless compute, which cannot use the workspace's
VPC peering. They reach Aurora over PrivateLink: a private endpoint rule on
the workspace's network connectivity configuration (NCC) connects to a VPC
endpoint service, in front of an internal NLB that forwards to the Aurora
writer.

| Piece                                                                       | Where                                                                                               | Applied by              |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------- |
| `databricks_federation` role, grants, guardrails                            | `prisma/schema/migrations/20261026120000_add_databricks_federation_role`                            | `prisma migrate deploy` |
| NLB, VPC endpoint service, IP-sync Lambda (dev and prod stacks only)        | `deploy/components/databricks-federation.ts`                                                        | Pulumi, on deploy       |
| Role password and `LOGIN`                                                   | step 2                                                                                              | DB admin                |
| Password in secret scope `gp-api-federation-<env>`, key `postgres-password` | step 3                                                                                              | Databricks admin        |
| Connection `gp_api_<env>`                                                   | `create-connection.sh`, step 4                                                                      | Databricks admin        |
| Secret scopes, NCC rule, foreign catalogs, readers groups, grants           | [thegoodparty/gp-terraform-dataplatform](https://github.com/thegoodparty/gp-terraform-dataplatform) | Terraform               |

The role can only read: `SELECT` on every table in `public` (including ones
later migrations create), every transaction read-only, a 60-second
statement timeout and at most 20 connections.

The IP-sync Lambda (`gp-api-db-<env>-federation-ip-sync`) runs every minute.
It resolves the cluster endpoint and re-registers the NLB's target when the
writer's IP has changed (failover, host replacement), logging one line per
change. Pulumi never registers targets itself.

The endpoint service accepts connections without approval, from the
Databricks serverless role for us-west-2 only. That role is shared by every
Databricks customer in the region, so check the connections now and then
(Operations); the Postgres password is what keeps anyone else out.

## Owners

- **Engineer**: merges this repo's PR and the Terraform one.
- **DB admin**: connects to `gpdb` as the master user `gpuser` over the VPN.
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
runs the migration (role without a login) and creates the NLB, endpoint
service and Lambda. Within a minute, check that the target is healthy and
get the endpoint service name (`gp-engineer` profile is enough):

```bash
ENV=dev
aws elbv2 describe-target-health --target-group-arn "$(aws elbv2 describe-target-groups \
  --names gp-api-db-$ENV-federation --query 'TargetGroups[0].TargetGroupArn' --output text)" \
  --query 'TargetHealthDescriptions[].[Target.Id,TargetHealth.State]' --output text
aws ec2 describe-vpc-endpoint-service-configurations \
  --filters Name=tag:Name,Values=gp-api-db-$ENV-federation \
  --query 'ServiceConfigurations[0].ServiceName' --output text
```

Expect one `healthy` target and `com.amazonaws.vpce.us-west-2.vpce-svc-...`.
The same name is the stack output `databricksEndpointServiceName`.

### 2. Give the role a password (DB admin)

Generate a long random password in 1Password and share the item with the
Databricks admin; never send it in chat or a ticket. In psql, connected to
`gpdb` as `gpuser`:

```sql
\password databricks_federation
ALTER ROLE databricks_federation LOGIN;
```

`\password` prompts for it, so it never lands in your shell history or the
server log.

### 3. Store the password (Databricks admin)

Paste it at the silent prompt:

```bash
read -rs FEDERATION_PASSWORD
printf %s "$FEDERATION_PASSWORD" | databricks secrets put-secret gp-api-federation-dev postgres-password
unset FEDERATION_PASSWORD
```

### 4. Create the connection (Databricks admin)

From this folder:

```bash
./create-connection.sh dev
```

It creates `gp_api_dev` through the SQL Statement API on the Starter
warehouse (`DATABRICKS_WAREHOUSE_ID` overrides it), with the password
resolved from the secret inside Databricks and the RDS us-west-2 CA bundle.
Then it makes the `github-action` service principal (application id
`a04e9e24-aac3-4308-9a65-d88fa34e444f`, override with `CONNECTION_OWNER`)
the owner. That is the identity that applies gp-terraform-dataplatform: as
owner it can grant on the connection and build the foreign catalog on it,
whoever ran this script. Metastore admins can still manage it. It ends with
`gp_api_dev is owned by a04e9e24-...`. Re-running it only fixes the owner.

Or in Catalog Explorer: Catalog, Add, Create a connection.

| Field                         | Value                                                                                   |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| Connection name               | `gp_api_dev`                                                                            |
| Connection type               | PostgreSQL                                                                              |
| Host                          | the dev cluster endpoint in the table above                                             |
| Port                          | `5432`                                                                                  |
| User                          | `databricks_federation`                                                                 |
| Password                      | the password from step 2                                                                |
| userProvidedServerCertificate | the contents of https://truststore.pki.rds.amazonaws.com/us-west-2/us-west-2-bundle.pem |

Click Create connection and stop there: skip the wizard's catalog page,
Terraform creates the catalog. Then open the connection and set its owner
to `github-action`.

### 5. Turn the env on in Terraform (engineer, then Terraform owner)

In gp-terraform-dataplatform, add the env with step 1's service name:

```hcl
gp_api_federation_envs = {
  dev = "com.amazonaws.vpce.us-west-2.vpce-svc-..."
}
```

Merge and run Deploy. It adds the NCC private endpoint rule (domain: the
cluster endpoint), the foreign catalog, its grants and the connection grants.
The endpoint service accepts the rule's endpoint by itself.

### 6. Test (anyone in the readers group)

In the SQL editor on a serverless SQL warehouse (Serverless Starter
Warehouse):

```sql
SELECT count(*) FROM gp_api_pg_dev.public.campaign;
```

New serverless compute can take about 10 minutes to pick up a new NCC rule;
a timeout right after the Deploy usually means wait and retry.

### 7. Access

The catalog holds users' personal data. People get it only through the
readers groups `gp_api_pg_dev_readers` and `gp_api_pg_readers`, assigned in
the account console. gp-api's service principal (`gp_api`) reads both
catalogs through Terraform grants. Don't grant on the catalog by hand.

## Operations

Unexpected endpoints on the service (expect one, Databricks'):

```bash
aws ec2 describe-vpc-endpoint-connections \
  --filters Name=service-id,Values="$(aws ec2 describe-vpc-endpoint-service-configurations \
    --filters Name=tag:Name,Values=gp-api-db-dev-federation \
    --query 'ServiceConfigurations[0].ServiceId' --output text)" \
  --query 'VpcEndpointConnections[].[VpcEndpointId,VpcEndpointOwner,VpcEndpointState]' --output text
```

An AWS admin rejects a stranger with `aws ec2 reject-vpc-endpoint-connections`.

**Rotating the password.** Repeat steps 2 and 3, then a metastore admin
updates the password on `gp_api_<env>` in Catalog Explorer. The connection
copied the secret when it was created, so the new secret alone changes
nothing.

## Failure modes

| Symptom                                                 | Likely cause                                                             | Fix                                                                                                                                                                                               |
| ------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connection refused or timeout                           | NCC rule not `ESTABLISHED`, endpoint not available, or no healthy target | Check the rule in the account console (Security, Network connectivity configurations), the endpoint state (Operations) and the target health (step 1)                                             |
| Target `unhealthy` with an old IP (stale IP)            | Writer moved and the Lambda has not caught up or is failing              | Read `/aws/lambda/gp-api-db-<env>-federation-ip-sync` in CloudWatch. Besides Lambda's own START and REPORT lines, a run logs one line only when it changes the target. Errors there are the cause |
| `password authentication failed`                        | Password in the connection differs from the role's, or no `LOGIN`        | Steps 2 and 3, then Rotating the password                                                                                                                                                         |
| `canceling statement due to statement timeout`          | Query ran over 60 seconds in Postgres                                    | Filter on indexed columns so it pushes down, or copy the rows to Delta once. Raising the limit is a new migration                                                                                 |
| `too many connections for role "databricks_federation"` | More than 20 concurrent federated scans                                  | Wait, or run fewer concurrent queries                                                                                                                                                             |
| `cannot execute ... in a read-only transaction`         | A write through the catalog                                              | By design                                                                                                                                                                                         |
| `Connection ... already exists` from the script         | It exists and you have no privilege on it, so it looked missing          | Ask a metastore admin to check its owner is `github-action`                                                                                                                                       |
| Certificate or hostname error                           | Connection host is not the cluster endpoint, or the CA is missing        | Recreate the connection with the exact values in step 4                                                                                                                                           |

## Teardown

1. Engineer and Terraform owner: remove the env from `gp_api_federation_envs`
   and Deploy. That drops the foreign catalog, its grants and the NCC rule,
   which deletes the endpoint.
2. Metastore admin: `DROP CONNECTION gp_api_dev`, and
   `databricks secrets delete-secret gp-api-federation-dev postgres-password`.
3. DB admin: `ALTER ROLE databricks_federation NOLOGIN PASSWORD NULL;`
4. Engineer: set the env to `undefined` in `databricksFederationName` in
   `deploy/index.ts` and merge. The deploy deletes the NLB, endpoint service
   and Lambda. The role and grants are migration-owned; drop them with a new
   migration if federation is retired for good.

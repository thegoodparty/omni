---
name: aws-cost-analysis
description: Investigate GoodParty's AWS spend and cost-allocation tag hygiene — what a project costs, why a chunk of spend is untagged, and how to drill a service down to usage type. Use when the user asks where AWS money is going, wants a per-project or per-environment cost breakdown, is chasing untagged/unattributed spend, or is auditing whether resources carry the right Project/Environment tags. Grounded in commands that actually work against our account.
---

# Analyze GoodParty AWS costs

GoodParty runs one AWS account (`333022194791`). Cost investigation happens through
the **Cost Explorer API** (`aws ce ...`), broken down by two activated cost-allocation
tags — **`Project`** and **`Environment`**. This skill is the institutional knowledge
for running that investigation and for chasing down why a chunk of spend is untagged.

## Access

- SSO profile: **`gp-admin`** — account `333022194791`, `AdministratorAccess`.
- Resources live mostly in **`us-west-2`**, some in `us-east-2` (GitHub runners) and
  `us-east-1`.
- **Cost Explorer is `us-east-1`-only.** Every `aws ce` call must pass
  `--profile gp-admin --region us-east-1`, no matter where the resources live. Resource-
  inspection calls (`ec2`, `s3api`, `rds`, `ecs`, `ecr`) use the resource's own region.

## The two cost-allocation tags

Both are **activated** cost-allocation tags, so they work in Cost Explorer `--group-by TAG`
and in `--filter`.

- **`Project`** — values in use: `gp-api`, `election-api`, `people-api`, `ai-projects`,
  `campaign-plan`, `campaign-plan-service`, `pmf-engine`, `broker`, `ops`, `gpvpn`,
  `databricks`, `ddhq-matcher`, `gp-people-loader`, `serve-analyze`, `engineer-agent`.
- **`Environment`** — values: `dev`, `qa`, `prod`, `preview`.

**Activation is not retroactive.** A cost-allocation tag only attributes spend from the
date it was activated forward. Ours were activated in **July 2026**, so tagged buckets
only start showing data then — earlier months read as untagged. Don't treat pre-July
untagged spend as a tagging bug.

## Core command patterns

The `End` date is **exclusive** in every `aws ce` call.

**Daily spend by project:**

```bash
aws ce get-cost-and-usage --profile gp-admin --region us-east-1 \
  --time-period Start=2026-07-01,End=2026-07-09 \
  --granularity DAILY --metrics UnblendedCost \
  --group-by '[{"Type":"TAG","Key":"Project"}]'
```

Swap `Key":"Project"` for `Key":"Environment"`, or `--granularity MONTHLY`, as needed.

**Untagged spend only, by service** — the empty-string value (`""`) selects resources
with no `Project` tag. This is how you find what's leaking out of the attribution:

```bash
aws ce get-cost-and-usage --profile gp-admin --region us-east-1 \
  --time-period Start=2026-07-01,End=2026-07-09 \
  --granularity MONTHLY --metrics UnblendedCost \
  --filter '{"Tags":{"Key":"Project","Values":[""],"MatchOptions":["EQUALS"]}}' \
  --group-by '[{"Type":"DIMENSION","Key":"SERVICE"}]'
```

**Drill a service down by usage type** — once you know a service is expensive, filter to
it and group by `USAGE_TYPE` to see what inside it costs money:

```bash
aws ce get-cost-and-usage --profile gp-admin --region us-east-1 \
  --time-period Start=2026-07-01,End=2026-07-09 \
  --granularity MONTHLY --metrics UnblendedCost \
  --filter '{"Dimensions":{"Key":"SERVICE","Values":["Amazon Relational Database Service"]}}' \
  --group-by '[{"Type":"DIMENSION","Key":"USAGE_TYPE"}]'
```

## What is inherently untaggable (don't chase these as "missing tags")

Some spend has no meaningful `Project` owner. Before filing a tag-hygiene bug, rule these out:

- **Account-level services** — AWS Config, Security Hub, GuardDuty, and most CloudWatch
  are account-wide, not per-project. They can't carry a Project tag.
- **Public IPv4 address charges** — these attach to ELB- and NAT-managed ENIs that AWS
  owns; there's no resource of ours to tag. (Public IPs live on ENIs, not on your
  instance — see resource inspection below.)
- **ECS Fargate task cost** — only carries a `Project` tag if the service or task
  definition sets **`propagateTags`** correctly. A task with wrong/absent propagation
  shows as untagged even though the code is one of our projects.
- **EC2 launched by Databricks** — carries **Databricks' own** tags, not our `Project`
  tag. To attribute it, set a custom cluster tag inside Databricks; you can't fix it
  from the AWS side.

## Resource-tag inspection (finding WHY something is untagged)

When untagged spend traces to a taggable resource, inspect the resource's tags directly
(in the resource's own region):

- `aws ec2 describe-addresses` — Elastic IP tags.
- `aws ec2 describe-network-interfaces` — public IPs live on ENIs; inspect the ENI.
- `aws s3api get-bucket-tagging --bucket <name>`
- `aws rds describe-db-clusters --query 'DBClusters[].TagList'`
- `aws ecr list-tags-for-resource --resource-arn <arn>`
- `aws ecs describe-services --cluster <c> --services <s> --include TAGS`

## Investigation flow

1. **Frame the question** as project, environment, service, or untagged. Pick the
   `--group-by` / `--filter` that matches.
2. **Get the breakdown** with a daily or monthly `get-cost-and-usage`.
3. **If a big slice is untagged**, run the untagged-by-service query, then decide per
   service whether it's inherently untaggable (above) or a real tag gap.
4. **For a real gap**, inspect the resource's tags to confirm, then fix at the source
   (task-def `propagateTags`, Databricks cluster tag, or the resource's tag set).
5. **To explain an expensive service**, filter to it and group by `USAGE_TYPE`.

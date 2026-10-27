---
title: Databricks serverless reaches gp-api Aurora through an allowlisted public NLB and an RDS Proxy
status: active
decided_by: [swain]
date: 2026-10-26
code: ['#3270']
scope:
  - packages/gp-api/deploy/components/databricks-federation.ts
  - packages/gp-api/deploy/databricks/federation/**
supersedes: []
superseded_by:
---

# Databricks serverless reaches gp-api Aurora through an allowlisted public NLB and an RDS Proxy

## Decision

Databricks reads gp-api's dev and prod Aurora live through Lakehouse
Federation. Serverless compute connects to an internet-facing NLB whose
security group admits port 5432 only from Databricks' published us-west-2
serverless outbound ranges. The NLB forwards TCP to an RDS Proxy in the
private subnets, which follows the writer across failovers. TLS runs from
Databricks to the proxy, checked against the Amazon root CAs with
`sslmode` `verify-ca`, and the read-only `databricks_federation` role is
the last gate.

## Context

Contact importing needs Databricks to query gp-api's tables. Federated
queries run on serverless compute, which cannot use the workspace's VPC
peering to Aurora. An NLB can only target IPs, and Aurora moves the
writer's IP on failover; the proxy's endpoint IPs are static for the
endpoint's life. The allowlisted ranges are shared by every Databricks
customer's serverless compute in the region, so they keep out the internet
at large but not other Databricks tenants. The proxy certificate names the
proxy's host, not the NLB's, so the hostname cannot be verified.

## Alternatives rejected

- **Lakeflow Connect CDC mirror (#3083).** On hold: a replication slot,
  WAL growth and a pipeline to run, for data that can be read live.
- **PrivateLink through a Databricks network connectivity configuration.**
  The private route Databricks documents, but not available on our plan.
- **NLB straight to the writer, with a Lambda re-registering its IP every
  minute.** Built in an earlier revision of #3270; a scheduled job to chase
  an IP the proxy keeps stable on its own.

## Revisit if

PrivateLink to serverless becomes available on our plan, Databricks offers
per-workspace egress IPs, or the proxy's endpoint IPs turn out to change.

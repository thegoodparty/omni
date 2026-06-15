# Slice 6 — Constituent-data tool (aggregate-only)

Split into two parts so the code can be written before the credential exists:

- **6a — buildable now, parallel, flag-DISABLED.** The tool + all app-layer
  enforcement (lever 1) + app-layer bypass tests against a **mocked** Databricks
  provider (`InMemoryDatabricksProvider`). No live credential, no deployed access.
  Ships behind a flag, off.
- **6b — gated on the data-team credential.** Wire the scoped "Serve agent" key,
  run `/security-review` + the credential-level bypass tests **against the real key
  in dev/qa** (confirm PII/party columns are denied AND that legitimate aggregate
  queries still work), then enable for prod. The key swap is a validated promotion,
  not a rubber-stamp env change.

> Hard line: never wire a broad/unscoped credential into any **deployed** environment
> as a stand-in. Local dev and tests mock the provider; the tool stays flag-off until
> the scoped key is validated in dev/qa.

## Goal

Let the CoS agent answer aggregate questions about constituents ("how many X in Y")
with deterministic safeguards. Essentially a more flexible, aggregate-only version
of the existing production `districtInsights` tool.

## Package

`packages/gp-api`.

## Hard constraints

- **Aggregations only. No row-level results.**
- **No political party** (a single column, excluded from the credential grant).

## Enforcement — two levers

Our code does the active enforcement; the credential is the backstop.

1. **Deterministic query parsing (ours, app-layer)** — extend
   `packages/gp-api/src/llm/tools/queryDatabricks.tool.ts`:
   - SELECT-only, single statement, no comments/invisible chars, row/time caps
     (existing).
   - **Aggregate-only**: every SELECT-list item is an aggregate fn (allowlist:
     `COUNT`, `SUM`, `AVG`, `MIN`, `MAX`, `APPROX_COUNT_DISTINCT`) or a `GROUP BY`
     column. Reject `SELECT *`, window functions, `DISTINCT`-enumeration, subqueries
     against base views.
   - **Coarse dimension allowlist**: only approved coarse columns may appear
     anywhere — limits differencing (belt-and-suspenders over the grant).
   - **District scoping**: bind server-side from
     `DistrictResolverService.resolveByUserId` (never agent input); inject the
     district predicate deterministically.
2. **Scoped Databricks credential (data team, external)** — a dedicated "Serve
   agent" key with table-level + column-level Unity Catalog grants: approved tables
   only; PII columns and the party column not granted. Databricks denies anything
   outside the grant regardless of SQL. This is the backstop: even an accidental
   single-row return carries no PII/party.

`sub-100` small-cell suppression is a secondary backstop only, not the headline
control (a per-query floor is defeated by differencing; the coarse dimension
allowlist is the real anti-differencing control).

Model routing: CoS is Anthropic-only (slice 3's sensitive-scope rule).

## Tools

- `query_constituent_data(sql, maxRows?)` — the scoped aggregate-only SELECT.
- (`describe_constituent_data` — optional metadata helper listing allowed
  tables/columns so the agent writes valid queries without internal names.)

## `/security-review` + bypass tests

Bypass tests are adversarial cases that try to defeat each safeguard and assert it
holds (regression net). Split by part:

**6a — app-layer, runs now against a mocked provider:**
- row-returning query (no aggregation) → aggregate-only check rejects.
- hard-code a different district → server-bound predicate wins.
- differencing attempt → coarse dimension allowlist + suppression.
- SQL-shape attacks: stacked statements, `UNION` to a system table, window
  functions, comment-hidden tokens → parser rejects.

**6b — credential-level, runs in dev/qa against the real scoped key:**
- select a PII column / non-granted table → credential denies.
- reference the party column → not granted.
- a legitimate aggregate query over granted columns → still works (no over-tight
  grant).
- `/security-review` before enabling for prod.

## External unblockers

- Scoped Serve agent credential (table+column grants) — data team (Collin, Dan).
- We provide the party column (and any modeled partisan-lean column) to exclude.
- Confirm L2 terms permit sending aggregate-derived data to Anthropic (likely fine;
  `districtInsights` precedent).

## Standing rules

`npm run verify` green; `/security-review` before merge.

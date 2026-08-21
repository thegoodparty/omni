# Databricks

Where GoodParty's analytics data lives, and how to get at it. For ad-hoc work,
**use the Databricks CLI** — it's the path this doc leads with.

## What it is

Databricks is our lakehouse: the warehouse where ingested source data is cleaned,
modelled, and made queryable as SQL tables. It is the read side of the data
pipeline, not a product database — none of the services in this monorepo treat it as
a primary store.

- **Workspace:** `https://dbc-3d8ca484-79f3.cloud.databricks.com` (AWS).
- **Catalog:** `goodparty_data_catalog` is ours (`samples` and `system` are
  Databricks built-ins). Modelled tables live under the `dbt` schema —
  `goodparty_data_catalog.dbt.<table>`.
- **SQL warehouses:** _Serverless Starter Warehouse_
  (`/sql/1.0/warehouses/18583d8b081c6486`) for everyday querying; _Serverless
  Medium_ for heavier jobs. A warehouse is the compute that runs your SQL — pick the
  smallest one that finishes.

### Where the data comes from

The pipeline that fills this catalog lives in a **separate repo,
`gp-data-platform`** (not in omni): Airbyte ingests 9+ sources, dbt transforms them
with 460+ models, and the results land here and get written back to the Postgres
databases. If you need to change what a table contains or add one, that work happens
in `gp-data-platform`, not here. This repo only _reads_ Databricks.

## Access — use the CLI

The Databricks CLI authenticates with OAuth (browser login, token stored in your OS
keyring), so there's no personal access token to mint, paste, or rotate. Prefer it
for any interactive or exploratory work.

### Install and log in

```bash
brew install databricks                       # or: see docs.databricks.com/dev-tools/cli
databricks auth login --host https://dbc-3d8ca484-79f3.cloud.databricks.com
```

The login opens a browser; approve it and the CLI stores the token in your keyring.
Confirm you're in:

```bash
databricks auth describe        # shows host + the user you authenticated as
databricks auth profiles        # lists configured profiles and which are valid
```

### Explore the catalog

```bash
databricks catalogs list
databricks schemas list goodparty_data_catalog
databricks tables list goodparty_data_catalog dbt
```

### Run a query

There's no SQL REPL subcommand; run statements against a warehouse through the
Statement Execution API:

```bash
databricks api post /api/2.0/sql/statements --json '{
  "warehouse_id": "18583d8b081c6486",
  "statement": "SELECT 1 AS ok",
  "wait_timeout": "30s"
}'
```

For anything beyond a quick check — iterating on queries, pulling results into a
DataFrame — use the Python script in `packages/runbooks/scripts/python/`
(`databricks_query.py`); see `packages/runbooks/books/query-voter-data.md` for table
names and worked examples. That script is the documented path for real query work.

## Programmatic access (services and scripts)

Application code does **not** use the CLI. It connects with the SQL connector using
credentials from the environment. Three consumers exist today:

- **gp-api** — `packages/gp-api/src/llm/tools/databricksConnection.ts` resolves the
  connection from env and powers the `queryDatabricks` / `queryConstituentData` /
  `districtInsights` LLM tools. It prefers OAuth **M2M** (`DATABRICKS_CLIENT_ID` +
  `DATABRICKS_CLIENT_SECRET`) and falls back to a PAT (`DATABRICKS_API_KEY`); the
  tool stays unregistered if neither host/path nor a usable credential is set.
- **gp-api's voter engine** — `packages/gp-api/src/peopleDb/databricks/` serves the
  CRM's voter queries (aggregates, list/search, overlap, district stats, CSV export)
  from `goodparty_data_catalog.dbt` instead of the people-db Postgres cluster, behind
  `USE_DATABRICKS_PEOPLE_DB`. It talks to the Statement Execution API rather than the
  SQL connector, because a CSV export needs `EXTERNAL_LINKS` chunks. See
  `packages/gp-api/src/peopleDb/AGENTS.md`.
- **runbooks** — `packages/runbooks/scripts/python/databricks_query.py` uses a PAT.

`resolveDatabricksConnection(prefix)` resolves per-identity credentials: the
default `DATABRICKS_` prefix is the shared Serve credential (`sp_serve_agent`,
Chief of Staff + briefing chats, `mart_serve_agents`); the `WIN_DATABRICKS_`
prefix is the Campaign Manager's `sp_win_agent` (own warehouse,
`mart_win_agents.win_agent_voters`). Grants are per service principal — the two
identities are deliberately not interchangeable.

Both read the same connection coordinates from the environment:

| Variable                                            | Value for this workspace                              |
| --------------------------------------------------- | ----------------------------------------------------- |
| `DATABRICKS_SERVER_HOSTNAME`                        | `dbc-3d8ca484-79f3.cloud.databricks.com`              |
| `DATABRICKS_HTTP_PATH`                              | `/sql/1.0/warehouses/18583d8b081c6486`                |
| `DATABRICKS_CLIENT_ID` / `DATABRICKS_CLIENT_SECRET` | OAuth M2M service-principal creds (gp-api, preferred) |
| `DATABRICKS_API_KEY`                                | Personal access token (PAT fallback)                  |
| `WIN_DATABRICKS_SERVER_HOSTNAME`                    | `dbc-3d8ca484-79f3.cloud.databricks.com` (same workspace) |
| `WIN_DATABRICKS_HTTP_PATH`                          | `/sql/1.0/warehouses/a6f5281417d1c869` (wh-win-agents)      |
| `WIN_DATABRICKS_CLIENT_ID` / `WIN_DATABRICKS_CLIENT_SECRET` | OAuth M2M creds for `sp_win_agent` (Campaign Manager) |

The hostname and HTTP path are workspace identifiers, not secrets. The credentials
are — never commit them; pull service-principal secrets from the deployment env, not
your personal login.

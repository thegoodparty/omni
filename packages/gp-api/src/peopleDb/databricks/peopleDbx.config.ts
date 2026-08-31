export const PEOPLE_DBX_CATALOG = 'goodparty_data_catalog'
// The consumer-facing mart, not the `dbt` models underneath it. Both are the
// same data — these are pass-through views — but access is granted differently:
// `mart_gp_api` carries a schema-scoped SELECT for the `mart_gp_api_readers`
// group, which survives the CREATE OR REPLACE VIEW that a dbt rebuild performs.
// Table-level grants on the dbt objects do not, and silently vanished once.
export const PEOPLE_DBX_SCHEMA = 'mart_gp_api'

// One workspace, and a workspace identifier is not a secret (docs/databricks.md
// says so explicitly). Making it configurable bought nothing: there is no
// second value it could correctly take, and a wrong one fails on the first
// request rather than silently.
export const PEOPLE_DBX_HOSTNAME = 'dbc-3d8ca484-79f3.cloud.databricks.com'

// The warehouse stays configurable, unlike the hostname. Two reasons: dev and
// prod should be able to run on separate compute so preview traffic cannot
// queue against prod page loads, and moving off a saturated warehouse mid
// incident should be a secret update and a task cycle rather than a deploy.
//
// It is the bare id, not an HTTP path. The path form only ever existed so the
// id could be parsed back out of it.
const WAREHOUSE_ID_ENV = 'PEOPLE_DATABRICKS_WAREHOUSE_ID'
const CLIENT_ID_ENV = 'PEOPLE_DATABRICKS_CLIENT_ID'
const CLIENT_SECRET_ENV = 'PEOPLE_DATABRICKS_CLIENT_SECRET'
const API_KEY_ENV = 'PEOPLE_DATABRICKS_API_KEY'

const WAREHOUSE_ID_RE = /^[A-Za-z0-9-]+$/

export type PeopleDbxConfig = {
  hostname: string
  warehouseId: string
  accessToken?: string
  oauthClientId?: string
  oauthClientSecret?: string
}

// Resolved fresh rather than cached so a rotated credential is picked up
// without a restart. Returns null when unconfigured; voter reads then fail
// loudly rather than silently answering from somewhere else.
//
// Reads the credential vars directly instead of through
// resolveDatabricksConnection: that helper requires a host and an HTTP path in
// env, and this identity now takes neither.
export const resolvePeopleDbxConfig = (): PeopleDbxConfig | null => {
  const warehouseId = process.env[WAREHOUSE_ID_ENV]
  if (!warehouseId || !WAREHOUSE_ID_RE.test(warehouseId)) return null

  const oauthClientId = process.env[CLIENT_ID_ENV]
  const oauthClientSecret = process.env[CLIENT_SECRET_ENV]
  const accessToken = process.env[API_KEY_ENV]
  // OAuth wins when both are present: the service principal is the intended
  // identity and a leftover personal token must not quietly outrank it.
  if (!(oauthClientId && oauthClientSecret) && !accessToken) return null

  return {
    hostname: PEOPLE_DBX_HOSTNAME,
    warehouseId,
    // Withheld when OAuth is available, not just deprioritized: the client
    // returns any accessToken it is given before it looks at the OAuth fields,
    // so leaving a stale PAT in here is the same as choosing it.
    accessToken: oauthClientId && oauthClientSecret ? undefined : accessToken,
    oauthClientId,
    oauthClientSecret,
  }
}

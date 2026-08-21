import { resolveDatabricksConnection } from '@/llm/tools/databricksConnection'

export const PEOPLE_DBX_CATALOG = 'goodparty_data_catalog'
export const PEOPLE_DBX_SCHEMA = 'dbt'

const WAREHOUSE_PATH_RE = /\/sql\/1\.0\/warehouses\/([A-Za-z0-9]+)\/?$/

export type PeopleDbxConfig = {
  hostname: string
  warehouseId: string
  accessToken?: string
  oauthClientId?: string
  oauthClientSecret?: string
}

// Selects the voter-data backing store at request time (not boot) so a
// rollback is an env flip, not a redeploy — the same shape as the
// USE_LOCAL_PEOPLE_DB cutover that moved these queries in-process.
export const useDatabricksPeopleDb = (): boolean =>
  process.env.USE_DATABRICKS_PEOPLE_DB === 'true'

// Reuses the DATABRICKS_* service-principal credential the LLM tools already
// resolve. The warehouse defaults to the one in DATABRICKS_HTTP_PATH, but
// PEOPLE_DB_DATABRICKS_WAREHOUSE_ID can point voter scans at their own
// warehouse so they don't queue behind interactive chat sessions.
export const resolvePeopleDbxConfig = (): PeopleDbxConfig | null => {
  const connection = resolveDatabricksConnection()
  if (!connection) return null
  const warehouseId =
    process.env.PEOPLE_DB_DATABRICKS_WAREHOUSE_ID ??
    WAREHOUSE_PATH_RE.exec(connection.httpPath)?.[1]
  if (!warehouseId) return null
  return {
    hostname: connection.hostname,
    warehouseId,
    accessToken: connection.accessToken,
    oauthClientId: connection.oauthClientId,
    oauthClientSecret: connection.oauthClientSecret,
  }
}

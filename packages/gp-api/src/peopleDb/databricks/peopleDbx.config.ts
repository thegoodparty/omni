import { resolveDatabricksConnection } from '@/llm/tools/databricksConnection'

export const PEOPLE_DBX_CATALOG = 'goodparty_data_catalog'
export const PEOPLE_DBX_SCHEMA = 'dbt'

// Its own service principal (sp_people_db), never the Serve or Campaign
// Manager identities: those are scoped to their own marts, and this one holds
// a least-privilege grant on the two voter tables. Grants are per principal,
// so the prefixes are deliberately not interchangeable.
const PEOPLE_DBX_ENV_PREFIX = 'PEOPLE_DATABRICKS_'

const WAREHOUSE_PATH_RE = /\/sql\/1\.0\/warehouses\/([A-Za-z0-9-]+)\/?$/

export type PeopleDbxConfig = {
  hostname: string
  warehouseId: string
  accessToken?: string
  oauthClientId?: string
  oauthClientSecret?: string
}

// The warehouse is whichever one PEOPLE_DATABRICKS_HTTP_PATH names — voter
// scans run on their own, so there is no default to fall back to.
export const resolvePeopleDbxConfig = (): PeopleDbxConfig | null => {
  const connection = resolveDatabricksConnection(PEOPLE_DBX_ENV_PREFIX)
  if (!connection) return null
  const warehouseId = WAREHOUSE_PATH_RE.exec(connection.httpPath)?.[1]
  if (!warehouseId) return null
  return {
    hostname: connection.hostname,
    warehouseId,
    accessToken: connection.accessToken,
    oauthClientId: connection.oauthClientId,
    oauthClientSecret: connection.oauthClientSecret,
  }
}

export interface DatabricksConnectionConfig {
  hostname: string
  httpPath: string
  accessToken?: string
  oauthClientId?: string
  oauthClientSecret?: string
}

// Resolves the shared Databricks connection + credential from env. Prefers
// OAuth M2M (DATABRICKS_CLIENT_ID + DATABRICKS_CLIENT_SECRET) and falls back to
// a PAT (DATABRICKS_API_KEY) so environments can migrate one at a time. Returns
// null when host/path or any usable credential is missing, so a caller's
// provider stays unregistered (and its tool stays off) until configured.
export const resolveDatabricksConnection =
  (): DatabricksConnectionConfig | null => {
    const hostname = process.env.DATABRICKS_SERVER_HOSTNAME
    const httpPath = process.env.DATABRICKS_HTTP_PATH
    if (!hostname || !httpPath) return null
    const oauthClientId = process.env.DATABRICKS_CLIENT_ID
    const oauthClientSecret = process.env.DATABRICKS_CLIENT_SECRET
    const accessToken = process.env.DATABRICKS_API_KEY
    if (!(oauthClientId && oauthClientSecret) && !accessToken) return null
    return { hostname, httpPath, accessToken, oauthClientId, oauthClientSecret }
  }

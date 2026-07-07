export interface DatabricksConnectionConfig {
  hostname: string
  httpPath: string
  accessToken?: string
  oauthClientId?: string
  oauthClientSecret?: string
}

// Resolves a Databricks connection + credential from env vars under the given
// prefix (default DATABRICKS_, the shared Serve credential; Campaign Manager
// passes WIN_DATABRICKS_ for its dedicated sp_win_agent identity). Prefers
// OAuth M2M (<prefix>CLIENT_ID + <prefix>CLIENT_SECRET) and falls back to a
// PAT (<prefix>API_KEY) so environments can migrate one at a time. Returns
// null when host/path or any usable credential is missing, so a caller's
// provider stays unregistered (and its tool stays off) until configured.
export const resolveDatabricksConnection = (
  prefix = 'DATABRICKS_',
): DatabricksConnectionConfig | null => {
  const hostname = process.env[`${prefix}SERVER_HOSTNAME`]
  const httpPath = process.env[`${prefix}HTTP_PATH`]
  if (!hostname || !httpPath) return null
  const oauthClientId = process.env[`${prefix}CLIENT_ID`]
  const oauthClientSecret = process.env[`${prefix}CLIENT_SECRET`]
  const accessToken = process.env[`${prefix}API_KEY`]
  if (!(oauthClientId && oauthClientSecret) && !accessToken) return null
  return { hostname, httpPath, accessToken, oauthClientId, oauthClientSecret }
}

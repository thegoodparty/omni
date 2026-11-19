// Where a test user is provisioned, and who signs it in. Resolved per call,
// never at import: one process provisions users on two base URLs at once (the
// judge's two arms), and the e2e suite takes both values from its own .env.

export const resolveApiBaseUrl = (override?: string): string => {
  const baseUrl = override ?? process.env.API_BASE_URL ?? process.env.BASE_URL
  if (!baseUrl) {
    throw new Error(
      'Set API_BASE_URL or BASE_URL so a test user knows which gp-api to provision through',
    )
  }
  return baseUrl.replace(/\/$/, '')
}

// The webapp root plus /api: gp-api behind Next's rewrite, the base every e2e
// client already uses.
export const apiUrlFor = (baseUrl?: string): string =>
  `${resolveApiBaseUrl(baseUrl)}/api`

export const requireClerkSecretKey = (): string => {
  const secretKey = process.env.CLERK_SECRET_KEY
  if (!secretKey) {
    throw new Error(
      'CLERK_SECRET_KEY is not set; creating a test user needs the dev Clerk instance secret',
    )
  }
  return secretKey
}

// Vercel Authentication guards every gp-webapp PR preview (dev is exempt). A
// Node client of the webapp's /api proxy needs the bypass header; a cookie
// would only work for a browser. A no-op when the secret is unset.
export const vercelBypassHeaders = (): Record<string, string> => {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  return secret ? { 'x-vercel-protection-bypass': secret } : {}
}

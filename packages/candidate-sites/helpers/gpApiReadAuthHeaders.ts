import { getVercelOidcToken } from '@vercel/oidc'

export const gpApiReadAuthHeaders = async (): Promise<
  Record<string, string>
> => {
  if (process.env.GP_API_AUTH_MODE !== 'oidc') {
    return {}
  }

  try {
    const oidcToken = await getVercelOidcToken()
    if (oidcToken) {
      return { Authorization: `Bearer ${oidcToken}` }
    }
  } catch (error) {
    console.warn(
      'Vercel OIDC token unavailable, sending gp-api read without one:',
      error instanceof Error ? error.message : error,
    )
  }

  return {}
}

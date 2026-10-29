import { Injectable } from '@nestjs/common'
import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose'
import { PinoLogger } from 'nestjs-pino'

const VERCEL_OIDC_ORIGIN = 'https://oidc.vercel.com'
const VERCEL_TEAM_SLUG = 'good-party'
const VERCEL_OIDC_AUDIENCE = `https://vercel.com/${VERCEL_TEAM_SLUG}`
// A project in team issuer mode signs with the first, one in global mode with
// the second. Each publishes its JWKS at <issuer>/.well-known/jwks.
const VERCEL_OIDC_ISSUERS = [
  `${VERCEL_OIDC_ORIGIN}/${VERCEL_TEAM_SLUG}`,
  VERCEL_OIDC_ORIGIN,
]
const VERCEL_JWKS_TIMEOUT_MS = 2_000

export type VercelOidcServiceReader = {
  source: 'vercel-oidc'
  projectId: string
  project: string
  environment: string
}

export const isVercelOidcToken = (token: string): boolean => {
  try {
    const { iss } = decodeJwt(token)
    return (
      iss === VERCEL_OIDC_ORIGIN ||
      (typeof iss === 'string' && iss.startsWith(`${VERCEL_OIDC_ORIGIN}/`))
    )
  } catch {
    return false
  }
}

@Injectable()
export class VercelOidcService {
  private readonly jwksByIssuer = new Map(
    VERCEL_OIDC_ISSUERS.map((issuer) => [
      issuer,
      createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks`), {
        timeoutDuration: VERCEL_JWKS_TIMEOUT_MS,
      }),
    ]),
  )

  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(VercelOidcService.name)
  }

  async verify(token: string): Promise<VercelOidcServiceReader | undefined> {
    const allowed = new Set(
      (process.env.VERCEL_OIDC_ALLOWED_PROJECTS ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
    )
    if (allowed.size === 0) {
      this.logger.debug('Vercel OIDC token ignored: no projects allowed')
      return undefined
    }

    try {
      const { iss } = decodeJwt(token)
      const jwks = typeof iss === 'string' && this.jwksByIssuer.get(iss)
      if (!jwks) {
        throw new Error(`Unexpected Vercel OIDC issuer ${iss}`)
      }
      const { payload } = await jwtVerify(token, jwks, {
        issuer: iss,
        audience: VERCEL_OIDC_AUDIENCE,
        algorithms: ['RS256'],
      })
      const { project_id, project, environment } = payload
      if (
        typeof project_id !== 'string' ||
        typeof project !== 'string' ||
        typeof environment !== 'string' ||
        !allowed.has(`${project_id}:${environment}`)
      ) {
        throw new Error(
          `Vercel project ${String(project_id)} (${String(environment)}) is not allowed`,
        )
      }
      return {
        source: 'vercel-oidc',
        projectId: project_id,
        project,
        environment,
      }
    } catch (err) {
      this.logger.warn({ err }, 'Vercel OIDC token verification failed')
      return undefined
    }
  }
}

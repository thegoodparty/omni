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

export type VercelOidcMachine = {
  source: 'vercel-oidc'
  subject: string
  projectId: string
  project: string
  environment: string
}

export type VercelOidcCaller =
  | { tier: 'admin'; m2mToken: VercelOidcMachine }
  | { tier: 'reader'; serviceReader: VercelOidcServiceReader }

const parseProjectAllowlist = (value: string | undefined): Set<string> =>
  new Set(
    (value ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  )

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

  async verify(token: string): Promise<VercelOidcCaller | undefined> {
    const admins = parseProjectAllowlist(process.env.VERCEL_OIDC_ADMIN_PROJECTS)
    const readers = parseProjectAllowlist(
      process.env.VERCEL_OIDC_ALLOWED_PROJECTS,
    )
    if (admins.size === 0 && readers.size === 0) {
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
        typeof environment !== 'string'
      ) {
        throw new Error('Vercel OIDC token is missing its project claims')
      }
      const entry = `${project_id}:${environment}`
      // The two lists are separate so a reader entry can never grant admin.
      if (admins.has(entry)) {
        return {
          tier: 'admin',
          m2mToken: {
            source: 'vercel-oidc',
            subject: `vercel:${project}:${environment}`,
            projectId: project_id,
            project,
            environment,
          },
        }
      }
      if (readers.has(entry)) {
        return {
          tier: 'reader',
          serviceReader: {
            source: 'vercel-oidc',
            projectId: project_id,
            project,
            environment,
          },
        }
      }
      throw new Error(
        `Vercel project ${project_id} (${environment}) is not allowed`,
      )
    } catch (err) {
      this.logger.warn({ err }, 'Vercel OIDC token verification failed')
      return undefined
    }
  }
}

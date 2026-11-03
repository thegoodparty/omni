import { Injectable } from '@nestjs/common'
import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose'
import { PinoLogger } from 'nestjs-pino'

const AWS_OIDC_AUDIENCE = 'gp-api'
const AWS_JWKS_TIMEOUT_MS = 2_000
// Every account's issuer is https://<id>.tokens.sts.global.api.aws
const AWS_OIDC_ISSUER_HOST_SUFFIX = '.tokens.sts.global.api.aws'

export type AwsOidcHandoffAgent = {
  source: 'aws-oidc'
  roleArn: string
}

const parseList = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)

// Recognized by issuer shape alone so an AWS token is never sent down the
// Clerk paths, whether or not this environment trusts it.
export const isAwsOidcToken = (token: string): boolean => {
  try {
    const { iss } = decodeJwt(token)
    if (typeof iss !== 'string') return false
    const configured = process.env.AWS_OIDC_ISSUER?.trim()
    if (configured && iss === configured) return true
    const url = new URL(iss)
    return (
      url.protocol === 'https:' &&
      url.hostname.endsWith(AWS_OIDC_ISSUER_HOST_SUFFIX)
    )
  } catch {
    return false
  }
}

@Injectable()
export class AwsOidcService {
  private readonly jwksByIssuer = new Map<
    string,
    ReturnType<typeof createRemoteJWKSet>
  >()

  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(AwsOidcService.name)
  }

  async verify(token: string): Promise<AwsOidcHandoffAgent | undefined> {
    const issuer = process.env.AWS_OIDC_ISSUER?.trim()
    const roles = parseList(process.env.AWS_OIDC_HANDOFF_AGENT_ROLES)
    if (!issuer || roles.length === 0) {
      this.logger.debug('AWS OIDC token ignored: no issuer or roles configured')
      return undefined
    }

    try {
      const { payload } = await jwtVerify(token, this.jwksFor(issuer), {
        issuer,
        audience: AWS_OIDC_AUDIENCE,
        algorithms: ['ES384', 'RS256'],
      })
      // `sub` is the ARN of the IAM role that requested the token.
      const { sub } = payload
      if (typeof sub !== 'string' || !roles.includes(sub)) {
        throw new Error(`AWS role ${String(sub)} is not allowed`)
      }
      return { source: 'aws-oidc', roleArn: sub }
    } catch (err) {
      this.logger.warn({ err }, 'AWS OIDC token verification failed')
      return undefined
    }
  }

  private jwksFor(issuer: string): ReturnType<typeof createRemoteJWKSet> {
    let jwks = this.jwksByIssuer.get(issuer)
    if (!jwks) {
      jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), {
        timeoutDuration: AWS_JWKS_TIMEOUT_MS,
      })
      this.jwksByIssuer.set(issuer, jwks)
    }
    return jwks
  }
}

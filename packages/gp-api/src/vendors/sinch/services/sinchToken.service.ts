import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { SinchConfig } from '../config/sinchConfig'

// Renew slightly before expiry so an in-flight request never uses a token that
// expires mid-call.
const TOKEN_RENEWAL_BUFFER_MS = 30_000

/**
 * Reads the token response without trusting its shape. `expires_in` is optional
 * because a missing TTL only costs us an extra mint on the next send, whereas a
 * missing token is fatal and handled by the caller.
 */
function readTokenResponse(
  payload: unknown,
): { accessToken: string; expiresInSeconds: number | null } | null {
  if (!payload || typeof payload !== 'object') return null
  const accessToken = 'access_token' in payload ? payload.access_token : null
  if (typeof accessToken !== 'string' || accessToken === '') return null
  const expiresIn = 'expires_in' in payload ? payload.expires_in : null
  return {
    accessToken,
    expiresInSeconds: typeof expiresIn === 'number' ? expiresIn : null,
  }
}

/**
 * Exchanges the project access key for a short-lived Conversation API bearer
 * token via the OAuth2 client credentials flow. Sinch rejects locally signed
 * JWTs, so the token must come from their auth server.
 *
 * The token is cached and reused until shortly before it expires; concurrent
 * callers share a single in-flight mint.
 */
@Injectable()
export class SinchTokenService {
  private readonly config = new SinchConfig()
  private cachedToken: string | null = null
  private tokenExpiration: number | null = null
  private pendingTokenPromise: Promise<string> | null = null

  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(SinchTokenService.name)
  }

  async getToken(): Promise<string> {
    if (this.cachedToken && this.isTokenValid()) {
      return this.cachedToken
    }
    if (this.pendingTokenPromise) {
      return this.pendingTokenPromise
    }
    const promise = this.createAndCacheToken()
    this.pendingTokenPromise = promise
    try {
      return await promise
    } finally {
      if (this.pendingTokenPromise === promise) {
        this.pendingTokenPromise = null
      }
    }
  }

  /**
   * Drops the cached token so the next send mints a fresh one. Called when Sinch
   * answers 401, which means the token was revoked or expired earlier than its
   * advertised TTL.
   */
  invalidate() {
    this.cachedToken = null
    this.tokenExpiration = null
  }

  private isTokenValid(): boolean {
    if (!this.tokenExpiration) return false
    return Date.now() < this.tokenExpiration - TOKEN_RENEWAL_BUFFER_MS
  }

  private async createAndCacheToken(): Promise<string> {
    const { keyId, keySecret } = this.config
    if (!keyId || !keySecret) {
      throw new Error(
        'SINCH_KEY_ID and SINCH_KEY_SECRET must be set to mint a Sinch access token',
      )
    }

    const credentials = Buffer.from(`${keyId}:${keySecret}`).toString('base64')
    const res = await fetch(this.config.tokenUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(this.config.httpTimeoutMs),
    })

    if (!res.ok) {
      const text = await res.text()
      this.logger.error(
        { status: res.status, text },
        'Sinch refused to issue an access token',
      )
      throw new Error(`Sinch token request returned ${res.status}: ${text}`)
    }

    const parsed = readTokenResponse(await res.json())
    if (!parsed) {
      throw new Error('Sinch token response contained no access_token')
    }

    // Leave the cache untouched on failure above: a stale token is no better
    // than none, and there is no negative caching to unwind.
    this.cachedToken = parsed.accessToken
    this.tokenExpiration = parsed.expiresInSeconds
      ? Date.now() + parsed.expiresInSeconds * 1000
      : null
    return parsed.accessToken
  }
}

import { Inject, Injectable } from '@nestjs/common'
import { ClerkClient } from '@clerk/backend'
import { PinoLogger } from 'nestjs-pino'
import { CLERK_CLIENT_PROVIDER_TOKEN } from '@/vendors/clerk/providers/clerk-client.provider'

// Renew slightly before expiry so an in-flight request never uses a token
// that expires mid-call.
const TOKEN_RENEWAL_BUFFER_MS = 30_000
const TOKEN_TTL_SECONDS = 600

const { GP_API_MACHINE_SECRET } = process.env

/**
 * Mints and caches a Clerk JWT-format M2M token for calling election-api. gp-api
 * is the caller, so it mints with its own machine secret (GP_API_MACHINE_SECRET);
 * election-api verifies as the recipient (networkless, since the token is a JWT).
 * The gp-api machine must be connected to the election-api machine in the Clerk
 * dashboard.
 *
 * The token is cached and reused until shortly before it expires; concurrent
 * callers share a single in-flight mint.
 */
@Injectable()
export class ElectionApiTokenService {
  private cachedToken: string | null = null
  private tokenExpiration: number | null = null
  private pendingTokenPromise: Promise<string> | null = null

  constructor(
    @Inject(CLERK_CLIENT_PROVIDER_TOKEN)
    private readonly clerkClient: ClerkClient,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ElectionApiTokenService.name)
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

  /** Authorization header for an election-api request. */
  async authHeader(): Promise<{ Authorization: string }> {
    return { Authorization: `Bearer ${await this.getToken()}` }
  }

  private isTokenValid(): boolean {
    if (!this.tokenExpiration) return false
    return Date.now() < this.tokenExpiration - TOKEN_RENEWAL_BUFFER_MS
  }

  private async createAndCacheToken(): Promise<string> {
    if (!GP_API_MACHINE_SECRET) {
      throw new Error(
        'GP_API_MACHINE_SECRET must be set to mint an election-api M2M token',
      )
    }
    const minted = await this.clerkClient.m2m.createToken({
      machineSecretKey: GP_API_MACHINE_SECRET,
      tokenFormat: 'jwt',
      secondsUntilExpiration: TOKEN_TTL_SECONDS,
    })
    if (!minted.token) {
      throw new Error('Clerk M2M token creation returned no token')
    }
    this.cachedToken = minted.token
    // Anchor the cache window to the TTL we requested, NOT to `minted.expiration`.
    // The JWT's real `exp` claim is (mint time + secondsUntilExpiration). Clerk's
    // returned `expiration` field is typed as seconds but is actually milliseconds
    // at runtime, so `* 1000` double-scaled it ~56k years into the future — the
    // cache then never renewed and replayed one token long past its real `exp`,
    // which election-api rejected as expired. Deriving from TTL is unit-agnostic
    // and keeps the cache strictly inside the JWT's actual lifetime.
    this.tokenExpiration = Date.now() + TOKEN_TTL_SECONDS * 1000
    return minted.token
  }
}

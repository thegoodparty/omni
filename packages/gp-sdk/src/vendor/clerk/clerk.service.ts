import { createClerkClient } from '@clerk/backend'
import { SdkError } from '../../types/result'

const TOKEN_RENEWAL_BUFFER_MS = 30_000

export class ClerkService {
  private readonly m2mSecret: string
  private readonly clerkClient: ReturnType<typeof createClerkClient>
  private cachedToken: string | null = null
  private tokenExpiration: number | null = null
  private renewalTimer: ReturnType<typeof setTimeout> | null = null
  private pendingTokenPromise: Promise<string> | null = null
  private destroyed = false

  constructor(m2mSecret: string) {
    this.m2mSecret = m2mSecret
    this.clerkClient = createClerkClient({})
  }

  getToken = async (): Promise<string> => {
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

  destroy = (): void => {
    this.destroyed = true
    if (this.renewalTimer) {
      clearTimeout(this.renewalTimer)
      this.renewalTimer = null
    }
    this.cachedToken = null
    this.tokenExpiration = null
    this.pendingTokenPromise = null
  }

  private isTokenValid = (): boolean => {
    if (!this.tokenExpiration) return true
    return Date.now() < this.tokenExpiration - TOKEN_RENEWAL_BUFFER_MS
  }

  private createAndCacheToken = async (): Promise<string> => {
    try {
      const m2mToken = await this.clerkClient.m2m.createToken({
        machineSecretKey: this.m2mSecret,
      })

      if (!m2mToken.token) {
        throw new SdkError(
          0,
          'Clerk M2M token creation succeeded but returned no token string',
        )
      }

      if (this.destroyed) return m2mToken.token

      this.cachedToken = m2mToken.token
      this.tokenExpiration = m2mToken.expiration
      this.scheduleRenewal()

      return this.cachedToken
    } catch (error: unknown) {
      if (error instanceof SdkError) {
        throw error
      }
      const message = error instanceof Error ? error.message : 'Unknown error'
      throw new SdkError(0, `Failed to create Clerk M2M token: ${message}`)
    }
  }

  private scheduleRenewal = (): void => {
    if (this.renewalTimer) {
      clearTimeout(this.renewalTimer)
      this.renewalTimer = null
    }

    if (!this.tokenExpiration) return

    const timeUntilRenewal =
      this.tokenExpiration - Date.now() - TOKEN_RENEWAL_BUFFER_MS

    if (timeUntilRenewal <= 0) return

    this.renewalTimer = setTimeout(() => {
      this.cachedToken = null
      this.getToken().catch((error: unknown) => {
        console.error('Proactive M2M token renewal failed:', error)
      })
    }, timeUntilRenewal)
  }
}

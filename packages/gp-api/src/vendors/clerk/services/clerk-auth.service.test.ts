import { UnauthorizedException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ClerkClient, verifyToken } from '@clerk/backend'
import jwt from 'jsonwebtoken'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { ClerkAuthService } from './clerk-auth.service'

// ClerkClient is a type-only export, but SWC emits it as runtime decorator
// metadata for the constructor param, so the mock must expose a placeholder.
vi.mock('@clerk/backend', () => ({
  verifyToken: vi.fn(),
  ClerkClient: class {},
}))

const BROKER_SECRET = process.env.AGENT_MCP_TOKEN_SECRET as string
const AGENT_SUB = 'user_agent_1'
const CLERK_TOKEN = 'clerk.session.token'

const signBrokerToken = (
  payload: Record<string, unknown>,
  options: jwt.SignOptions = {},
  secret: string = BROKER_SECRET,
): string =>
  jwt.sign(payload, secret, {
    issuer: 'gp-broker',
    audience: 'gp-api',
    ...options,
  })

describe('ClerkAuthService', () => {
  let service: ClerkAuthService
  let m2mVerify: ReturnType<typeof vi.fn>
  let getUser: ReturnType<typeof vi.fn>

  beforeEach(() => {
    m2mVerify = vi.fn()
    getUser = vi.fn()
    const clerkClient = {
      m2m: { verify: m2mVerify },
      users: { getUser },
    } as unknown as ClerkClient
    service = new ClerkAuthService(clerkClient, createMockLogger())
  })

  describe('verifySessionToken — broker-issued agent tokens', () => {
    it('verifies a gp-broker token and flags it as an agent token', async () => {
      const token = signBrokerToken({ sub: AGENT_SUB })

      await expect(service.verifySessionToken(token)).resolves.toEqual({
        externalUserId: AGENT_SUB,
        actor: undefined,
        isAgentToken: true,
      })
      expect(verifyToken).not.toHaveBeenCalled()
    })

    it('carries through a valid actor (act.sub) claim', async () => {
      const token = signBrokerToken({
        sub: AGENT_SUB,
        act: { sub: 'user_admin_2' },
      })

      const result = await service.verifySessionToken(token)

      expect(result.actor).toEqual({ sub: 'user_admin_2' })
      expect(result.isAgentToken).toBe(true)
    })

    it('drops an act claim that has no sub', async () => {
      const token = signBrokerToken({ sub: AGENT_SUB, act: {} })

      const result = await service.verifySessionToken(token)

      expect(result.actor).toBeUndefined()
    })

    it('rejects a gp-broker token signed with the wrong secret', async () => {
      const token = signBrokerToken({ sub: AGENT_SUB }, {}, 'wrong-secret')

      await expect(service.verifySessionToken(token)).rejects.toThrow(
        'Agent token verification failed',
      )
    })

    it('rejects a gp-broker token with the wrong audience', async () => {
      const token = signBrokerToken(
        { sub: AGENT_SUB },
        { audience: 'not-gp-api' },
      )

      await expect(service.verifySessionToken(token)).rejects.toThrow(
        'Agent token verification failed',
      )
    })

    it('rejects a gp-broker token missing the sub claim', async () => {
      const token = signBrokerToken({ role: 'agent' })

      await expect(service.verifySessionToken(token)).rejects.toThrow(
        'Agent token missing sub claim',
      )
    })
  })

  describe('verifySessionToken — Clerk session tokens', () => {
    it('returns the external user id from a verified Clerk token', async () => {
      vi.mocked(verifyToken).mockResolvedValue({
        sub: 'user_clerk_1',
      } as never)

      await expect(service.verifySessionToken(CLERK_TOKEN)).resolves.toEqual({
        externalUserId: 'user_clerk_1',
        actor: undefined,
      })
      expect(verifyToken).toHaveBeenCalledWith(CLERK_TOKEN, {
        secretKey: process.env.CLERK_SECRET_KEY,
        authorizedParties: undefined,
      })
    })

    it('includes the actor when the Clerk token carries a valid act claim', async () => {
      vi.mocked(verifyToken).mockResolvedValue({
        sub: 'user_clerk_1',
        act: { sub: 'user_admin_2' },
      } as never)

      const result = await service.verifySessionToken(CLERK_TOKEN)

      expect(result.actor).toEqual({ sub: 'user_admin_2' })
    })

    it('rejects when the Clerk token has no sub claim', async () => {
      vi.mocked(verifyToken).mockResolvedValue({} as never)

      await expect(service.verifySessionToken(CLERK_TOKEN)).rejects.toThrow(
        'Token missing sub claim',
      )
    })

    it('rejects when Clerk verification fails', async () => {
      vi.mocked(verifyToken).mockRejectedValue(new Error('bad signature'))

      await expect(service.verifySessionToken(CLERK_TOKEN)).rejects.toThrow(
        'Session token verification failed',
      )
    })
  })

  describe('verifyM2MToken', () => {
    it('returns only id and subject from a verified machine token', async () => {
      m2mVerify.mockResolvedValue({
        id: 'm2m_1',
        subject: 'machine_abc',
        claims: { extra: true },
      })

      await expect(service.verifyM2MToken('mt_token')).resolves.toEqual({
        id: 'm2m_1',
        subject: 'machine_abc',
      })
      expect(m2mVerify).toHaveBeenCalledWith({
        token: 'mt_token',
        machineSecretKey: process.env.GP_WEBAPP_MACHINE_SECRET,
      })
    })

    it('rejects with UnauthorizedException on verification failure', async () => {
      m2mVerify.mockRejectedValue(new Error('clerk rejected'))

      await expect(service.verifyM2MToken('mt_token')).rejects.toThrow(
        UnauthorizedException,
      )
    })
  })

  describe('isM2MToken', () => {
    it('recognizes the mt_ prefix', () => {
      expect(service.isM2MToken('mt_token')).toBe(true)
    })

    it('rejects tokens without the mt_ prefix', () => {
      expect(service.isM2MToken('sess_token')).toBe(false)
    })
  })

  describe('getUser', () => {
    it('maps the Clerk primary email and name', async () => {
      const primary = 'primary@goodparty.org'
      getUser.mockResolvedValue({
        primaryEmailAddress: { emailAddress: primary },
        emailAddresses: [{ emailAddress: primary }],
        firstName: 'First',
        lastName: 'Last',
      })

      await expect(service.getUser('user_1')).resolves.toEqual({
        email: primary,
        firstName: 'First',
        lastName: 'Last',
      })
    })

    it('falls back to the first email when there is no primary', async () => {
      getUser.mockResolvedValue({
        primaryEmailAddress: null,
        emailAddresses: [{ emailAddress: 'fallback@goodparty.org' }],
        firstName: null,
        lastName: null,
      })

      await expect(service.getUser('user_1')).resolves.toEqual({
        email: 'fallback@goodparty.org',
        firstName: undefined,
        lastName: undefined,
      })
    })

    it('returns null when the Clerk lookup fails', async () => {
      getUser.mockRejectedValue(new Error('clerk down'))

      await expect(service.getUser('user_1')).resolves.toBeNull()
    })
  })
})

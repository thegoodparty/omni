import { UnauthorizedException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ClerkClient } from '@clerk/backend'
import { verifyM2MToken } from './VerifyM2MToken.util'

describe('verifyM2MToken', () => {
  let verify: ReturnType<typeof vi.fn>
  let clerkClient: ClerkClient

  beforeEach(() => {
    verify = vi.fn()
    clerkClient = { m2m: { verify } } as unknown as ClerkClient
  })

  it('returns the verified machine token, passing the configured secret', async () => {
    const verified = { id: 'm2m_1', subject: 'machine_abc' }
    verify.mockResolvedValue(verified)

    await expect(verifyM2MToken('mt_token', clerkClient)).resolves.toBe(
      verified,
    )
    expect(verify).toHaveBeenCalledWith({
      token: 'mt_token',
      machineSecretKey: process.env.GP_API_MACHINE_SECRET,
    })
  })

  it('translates a Clerk verification failure into UnauthorizedException', async () => {
    verify.mockRejectedValue(new Error('clerk rejected'))

    await expect(verifyM2MToken('mt_token', clerkClient)).rejects.toThrow(
      UnauthorizedException,
    )
  })
})

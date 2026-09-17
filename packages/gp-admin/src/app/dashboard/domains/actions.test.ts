import { describe, it, expect, vi, beforeEach } from 'vitest'
import { issueDomainAuthCode } from './actions'
import { PERMISSIONS } from '@/lib/permissions'

const OPERATOR = 'dee@goodparty.org'

// --- Clerk server auth ---
const mockHas = vi.fn()
const mockAuth = vi.fn()
const mockCurrentUser = vi.fn()
vi.mock('@clerk/nextjs/server', () => ({
  auth: () => mockAuth(),
  currentUser: () => mockCurrentUser(),
}))

// --- GP API client ---
const mockGetAuthCode = vi.fn()
vi.mock('@/shared/util/gpClient.util', () => ({
  gpAction: vi.fn(async (fn: (client: unknown) => unknown) =>
    fn({ domains: { getAuthCode: mockGetAuthCode } })
  ),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockHas.mockReturnValue(true)
  mockAuth.mockReturnValue({
    userId: 'user_admin_123',
    orgId: 'org_dev_123',
    has: mockHas,
  })
  mockCurrentUser.mockResolvedValue({
    primaryEmailAddress: { emailAddress: OPERATOR },
  })
  mockGetAuthCode.mockResolvedValue({ authCode: 'AuthC0de!' })
})

describe('issueDomainAuthCode', () => {
  it('returns the auth code and names the operator as actor', async () => {
    const result = await issueDomainAuthCode('stephanieberardi.com')

    expect(mockGetAuthCode).toHaveBeenCalledWith({
      domain: 'stephanieberardi.com',
      actorEmail: OPERATOR,
    })
    expect(result).toEqual({ ok: true, authCode: 'AuthC0de!' })
  })

  it('requires the write_campaigns permission', async () => {
    mockHas.mockReturnValue(false)

    await expect(issueDomainAuthCode('stephanieberardi.com')).rejects.toThrow(
      /write_campaigns/
    )
    expect(mockGetAuthCode).not.toHaveBeenCalled()
  })

  it('checks the permission gp-api cannot check for itself', async () => {
    // gp-api sees only a shared machine token on this route, so this call is
    // the only authorization in the chain.
    await issueDomainAuthCode('stephanieberardi.com')

    expect(mockHas).toHaveBeenCalledWith({
      permission: PERMISSIONS.WRITE_CAMPAIGNS,
    })
  })

  it('refuses when the acting operator cannot be identified', async () => {
    // An unattributed issuance is not worth recording, so this fails rather
    // than sending a placeholder actor.
    mockCurrentUser.mockResolvedValue({ primaryEmailAddress: null })

    await expect(issueDomainAuthCode('stephanieberardi.com')).rejects.toThrow(
      /which operator is acting/
    )
    expect(mockGetAuthCode).not.toHaveBeenCalled()
  })

  it('normalizes the domain before sending it', async () => {
    await issueDomainAuthCode('  StephanieBerardi.com  ')

    expect(mockGetAuthCode).toHaveBeenCalledWith({
      domain: 'stephanieberardi.com',
      actorEmail: OPERATOR,
    })
  })

  it('returns gp-api refusals as data so the operator can read them', async () => {
    // The 60-day ICANN lock message names the date it lifts, which is the only
    // actionable detail for the candidate — it has to reach the screen.
    mockGetAuthCode.mockRejectedValue(
      new Error('Domain cannot be transferred out until 2026-11-04')
    )

    await expect(issueDomainAuthCode('stephanieberardi.com')).resolves.toEqual({
      ok: false,
      error: 'Domain cannot be transferred out until 2026-11-04',
    })
  })

  it('rejects an empty domain without calling gp-api', async () => {
    await expect(issueDomainAuthCode('   ')).resolves.toEqual({
      ok: false,
      error: 'Enter a domain.',
    })
    expect(mockGetAuthCode).not.toHaveBeenCalled()
  })
})

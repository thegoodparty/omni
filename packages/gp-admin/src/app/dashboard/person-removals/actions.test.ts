import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  listPersonRemovals,
  lookupPerson,
  removePersonProfile,
  restorePersonProfile,
} from './actions'
import { PERMISSIONS } from '@/lib/permissions'

const PERSON_ID = '22222222-2222-2222-2222-222222222222'
const OPERATOR = 'ops@goodparty.org'

// --- Clerk server auth ---
const mockHas = vi.fn()
const mockAuth = vi.fn()
const mockCurrentUser = vi.fn()
vi.mock('@clerk/nextjs/server', () => ({
  auth: () => mockAuth(),
  currentUser: () => mockCurrentUser(),
}))

// --- GP API client ---
const mockListRemovals = vi.fn()
const mockSetRemoval = vi.fn()
const mockClearRemoval = vi.fn()
const mockLookupPerson = vi.fn()
vi.mock('@/shared/util/gpClient.util', () => ({
  gpAction: vi.fn(async (fn: (client: unknown) => unknown) =>
    fn({
      personProfiles: {
        listRemovals: mockListRemovals,
        setRemoval: mockSetRemoval,
        clearRemoval: mockClearRemoval,
        lookupPerson: mockLookupPerson,
      },
    })
  ),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

function makeAuthResult(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'user_admin_123',
    orgId: 'org_dev_123',
    has: mockHas,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockHas.mockReturnValue(true)
  mockAuth.mockReturnValue(makeAuthResult())
  mockCurrentUser.mockResolvedValue({
    primaryEmailAddress: { emailAddress: OPERATOR },
  })
  mockListRemovals.mockResolvedValue([])
  mockSetRemoval.mockResolvedValue({ personId: PERSON_ID, removed: true })
  mockClearRemoval.mockResolvedValue({ personId: PERSON_ID, removed: false })
  mockLookupPerson.mockResolvedValue({
    personId: PERSON_ID,
    fullName: 'Jordan Reyes',
    state: 'CA',
    office: 'City Council Member',
  })
})

// Taking a public page down is not something sales or read_only should be able
// to do, so every entry point is gated on its own dedicated permission rather
// than on write_users.
describe('permission gating', () => {
  const callers: Array<[string, () => Promise<unknown>]> = [
    ['listPersonRemovals', () => listPersonRemovals(false)],
    ['lookupPerson', () => lookupPerson('jordan-reyes-a1b2c3d4')],
    ['removePersonProfile', () => removePersonProfile(PERSON_ID, 'note')],
    ['restorePersonProfile', () => restorePersonProfile(PERSON_ID)],
  ]

  it.each(callers)(
    '%s refuses a caller without the permission',
    async (_name, call) => {
      mockHas.mockReturnValue(false)

      await expect(call()).rejects.toThrow(
        'Missing manage_person_removals permission'
      )
      expect(mockSetRemoval).not.toHaveBeenCalled()
      expect(mockClearRemoval).not.toHaveBeenCalled()
    }
  )

  it.each(callers)(
    '%s reports a permission failure when unauthenticated',
    async (_name, call) => {
      // Clerk returns has: null for an unauthenticated session; calling it
      // unguarded would surface a TypeError instead.
      mockAuth.mockReturnValue(makeAuthResult({ has: null }))

      await expect(call()).rejects.toThrow(
        'Missing manage_person_removals permission'
      )
    }
  )

  it('checks the dedicated removals permission, not a borrowed one', async () => {
    await listPersonRemovals(false)

    expect(mockHas).toHaveBeenCalledWith({
      permission: PERMISSIONS.MANAGE_PERSON_REMOVALS,
    })
  })
})

// gp-admin talks to gp-api over a shared M2M token, so this server action is
// the only place the acting human is known. An action that omits the email
// records the takedown against nobody, which is the whole point of the audit
// trail.
describe('operator attribution', () => {
  it('sends the Clerk user email as appliedBy', async () => {
    await removePersonProfile(PERSON_ID, 'CA privacy request')

    expect(mockSetRemoval).toHaveBeenCalledWith({
      personId: PERSON_ID,
      appliedBy: OPERATOR,
      note: 'CA privacy request',
    })
  })

  it('sends the Clerk user email as clearedBy', async () => {
    await restorePersonProfile(PERSON_ID)

    expect(mockClearRemoval).toHaveBeenCalledWith({
      personId: PERSON_ID,
      clearedBy: OPERATOR,
    })
  })

  it.each([
    ['removePersonProfile', () => removePersonProfile(PERSON_ID, '')],
    ['restorePersonProfile', () => restorePersonProfile(PERSON_ID)],
  ])('%s refuses to write when the email is unknown', async (_name, call) => {
    mockCurrentUser.mockResolvedValue({ primaryEmailAddress: null })

    await expect(call()).rejects.toThrow(
      'Could not determine which operator is acting'
    )
    expect(mockSetRemoval).not.toHaveBeenCalled()
    expect(mockClearRemoval).not.toHaveBeenCalled()
  })
})

describe('removePersonProfile', () => {
  it('stores an omitted note as null rather than an empty string', async () => {
    await removePersonProfile(PERSON_ID, '   ')

    expect(mockSetRemoval).toHaveBeenCalledWith(
      expect.objectContaining({ note: null })
    )
  })
})

describe('listPersonRemovals', () => {
  it('asks for active takedowns only by default', async () => {
    await listPersonRemovals(false)

    expect(mockListRemovals).toHaveBeenCalledWith({ includeCleared: false })
  })

  it('asks for the reverted history when requested', async () => {
    await listPersonRemovals(true)

    expect(mockListRemovals).toHaveBeenCalledWith({ includeCleared: true })
  })
})

describe('lookupPerson', () => {
  it('returns the identity the operator confirms against', async () => {
    const result = await lookupPerson(
      'https://goodparty.org/people/jordan-reyes-a1b2c3d4'
    )

    expect(mockLookupPerson).toHaveBeenCalledWith(
      'https://goodparty.org/people/jordan-reyes-a1b2c3d4'
    )
    expect(result.fullName).toBe('Jordan Reyes')
  })
})

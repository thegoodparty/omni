import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SdkError } from '@/shared/gpApi'
import { PERMISSIONS } from '@/lib/permissions'
import {
  findPublicProfile,
  getPublicProfileLink,
  linkPublicProfile,
} from './publicProfile.actions'

const USER_ID = 348
const PERSON_ID = '22222222-2222-2222-2222-222222222222'
const OPERATOR = 'ops@goodparty.org'

const mockHas = vi.fn()
const mockCurrentUser = vi.fn()
vi.mock('@clerk/nextjs/server', () => ({
  auth: () => ({ userId: 'user_admin_123', has: mockHas }),
  currentUser: () => mockCurrentUser(),
}))

const mockGetLink = vi.fn()
const mockLinkOwner = vi.fn()
const mockLookupPerson = vi.fn()
vi.mock('@/shared/util/gpClient.util', () => ({
  gpAction: vi.fn(async (fn: (client: unknown) => unknown) =>
    fn({
      personProfiles: {
        getLink: mockGetLink,
        linkOwner: mockLinkOwner,
        lookupPerson: mockLookupPerson,
      },
    })
  ),
}))

const linked = {
  userId: USER_ID,
  personId: PERSON_ID,
  fullName: 'Josh Santeramo',
  profileUrl: 'https://goodparty.org/people/josh-santeramo-22222222',
  hasProfile: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockHas.mockReturnValue(true)
  mockCurrentUser.mockResolvedValue({
    primaryEmailAddress: { emailAddress: OPERATOR },
  })
})

describe('getPublicProfileLink', () => {
  it('returns the link state for the user', async () => {
    mockGetLink.mockResolvedValue(linked)

    expect(await getPublicProfileLink(USER_ID)).toEqual({
      data: linked,
      error: null,
    })
    expect(mockGetLink).toHaveBeenCalledWith(USER_ID)
  })

  it('needs read_users', async () => {
    mockHas.mockReturnValue(false)

    const result = await getPublicProfileLink(USER_ID)

    expect(result.error).toMatch(/read_users/)
    expect(mockHas).toHaveBeenCalledWith({
      permission: PERMISSIONS.READ_USERS,
    })
    expect(mockGetLink).not.toHaveBeenCalled()
  })
})

describe('findPublicProfile', () => {
  it('needs write_users, since it only ever leads to a link', async () => {
    mockHas.mockReturnValue(false)

    const result = await findPublicProfile('josh-santeramo-22222222')

    expect(result.error).toMatch(/write_users/)
    expect(mockLookupPerson).not.toHaveBeenCalled()
  })

  it('turns a miss into a message staff can act on', async () => {
    mockLookupPerson.mockRejectedValue(new SdkError(404, 'Not Found'))

    const result = await findPublicProfile('nobody-00000000')

    expect(result).toEqual({
      data: null,
      error: 'No profile matches that link. Check it and try again.',
    })
  })
})

describe('linkPublicProfile', () => {
  it('sends the acting operator as linkedBy', async () => {
    mockLinkOwner.mockResolvedValue(linked)

    const result = await linkPublicProfile(USER_ID, PERSON_ID)

    expect(result).toEqual({ data: linked, error: null })
    expect(mockLinkOwner).toHaveBeenCalledWith({
      userId: USER_ID,
      personId: PERSON_ID,
      linkedBy: OPERATOR,
    })
  })

  // gp-api's message says who holds the person or where a merged record
  // went, which is the next thing staff need; a generic failure would not.
  it("returns gp-api's message instead of throwing", async () => {
    mockLinkOwner.mockRejectedValue(
      new SdkError(409, 'Conflict', undefined, {
        statusCode: 409,
        message: 'That person is already linked to user 346374',
      })
    )

    const result = await linkPublicProfile(USER_ID, PERSON_ID)

    expect(result).toEqual({
      data: null,
      error: 'That person is already linked to user 346374',
    })
  })

  it('refuses to write without a known operator', async () => {
    mockCurrentUser.mockResolvedValue(null)

    const result = await linkPublicProfile(USER_ID, PERSON_ID)

    expect(result.error).toMatch(/operator/)
    expect(mockLinkOwner).not.toHaveBeenCalled()
  })

  it('needs write_users', async () => {
    mockHas.mockReturnValue(false)

    const result = await linkPublicProfile(USER_ID, PERSON_ID)

    expect(result.error).toMatch(/write_users/)
    expect(mockLinkOwner).not.toHaveBeenCalled()
  })
})

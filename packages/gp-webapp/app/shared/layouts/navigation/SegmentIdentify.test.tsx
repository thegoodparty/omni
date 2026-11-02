import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { User, UserRole } from 'helpers/types'
import { identifyUser } from '@shared/utils/analytics'
import {
  persistUtmsOnce,
  getPersistedUtms,
  getPersistedClids,
  extractClids,
  setUserEmail,
  setActorUserId,
  setActorRole,
  setActiveProduct,
} from 'helpers/analyticsHelper'
import { buildUserTraits } from 'helpers/buildUserTraits'

let mockUser: User | null = null
let mockIsUserLoading = false
let mockSearchParamsValue: URLSearchParams | null = new URLSearchParams()
let mockOrganizationRole: 'owner' | 'campaignAdmin' | 'volunteer' | undefined =
  undefined
let mockElectedOfficeId: string | null = null

vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => [mockUser, vi.fn(), mockIsUserLoading],
}))

vi.mock('@shared/organization-picker', () => ({
  useOrganization: () =>
    mockOrganizationRole
      ? { role: mockOrganizationRole, electedOfficeId: mockElectedOfficeId }
      : undefined,
}))

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({})),
  useSearchParams: () => mockSearchParamsValue,
}))

vi.mock('@shared/utils/analytics', () => ({
  identifyUser: vi.fn().mockResolvedValue(true),
}))

vi.mock('helpers/analyticsHelper', () => ({
  persistUtmsOnce: vi.fn(),
  getPersistedUtms: vi.fn(() => ({})),
  getPersistedClids: vi.fn(() => ({})),
  extractClids: vi.fn(() => ({})),
  setUserEmail: vi.fn(),
  setActorUserId: vi.fn(),
  setActorRole: vi.fn(),
  setActiveProduct: vi.fn(),
  toActiveProduct: vi.fn((org) =>
    org ? (org.electedOfficeId ? 'serve' : 'win') : null,
  ),
}))

vi.mock('helpers/buildUserTraits', () => ({
  buildUserTraits: vi.fn(() => ({})),
}))

import SegmentIdentify from './SegmentIdentify'

const fullUser: User = {
  id: 42,
  createdAt: '2024-01-01',
  updatedAt: '2024-01-01',
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@example.com',
  phone: '555-1234',
  zip: '90210',
  roles: [UserRole.candidate],
  hasPassword: true,
}

const fullUserTraits = {
  email: 'jane@example.com',
  name: 'Jane Doe',
  phone: '555-1234',
  zip: '90210',
}

beforeEach(() => {
  mockUser = null
  mockIsUserLoading = false
  mockSearchParamsValue = new URLSearchParams()
  mockOrganizationRole = undefined
  mockElectedOfficeId = null
  vi.mocked(identifyUser).mockReset().mockResolvedValue(true)
  vi.mocked(persistUtmsOnce).mockReset()
  vi.mocked(getPersistedUtms).mockReset().mockReturnValue({})
  vi.mocked(getPersistedClids).mockReset().mockReturnValue({})
  vi.mocked(extractClids).mockReset().mockReturnValue({})
  vi.mocked(buildUserTraits).mockReset().mockReturnValue(fullUserTraits)
  vi.mocked(setUserEmail).mockReset()
  vi.mocked(setActorUserId).mockReset()
  vi.mocked(setActorRole).mockReset()
})

describe('SegmentIdentify', () => {
  it('mirrors the signed-in user id into the GTM dataLayer', async () => {
    const w = window as unknown as {
      dataLayer?: Record<string, unknown>[]
    }
    delete w.dataLayer
    mockUser = fullUser

    render(<SegmentIdentify />)

    await vi.waitFor(() => {
      expect(w.dataLayer).toContainEqual({ user_id: '42' })
    })
  })

  it('clears the dataLayer user id when there is no user', async () => {
    const w = window as unknown as {
      dataLayer?: Record<string, unknown>[]
    }
    delete w.dataLayer
    mockUser = null

    render(<SegmentIdentify />)

    await vi.waitFor(() => {
      expect(w.dataLayer).toContainEqual({ user_id: null })
    })
  })

  it('does not touch the dataLayer user id while the user is loading', async () => {
    const w = window as unknown as {
      dataLayer?: Record<string, unknown>[]
    }
    delete w.dataLayer
    mockUser = null
    mockIsUserLoading = true

    render(<SegmentIdentify />)

    await vi.waitFor(() => {
      expect(identifyUser).toHaveBeenCalled()
    })
    expect(w.dataLayer).toBeUndefined()
  })

  it('calls identifyUser with buildUserTraits output when user is logged in', async () => {
    mockUser = fullUser

    render(<SegmentIdentify />)

    await vi.waitFor(() => {
      expect(identifyUser).toHaveBeenCalledWith(42, fullUserTraits)
    })
    expect(buildUserTraits).toHaveBeenCalledWith(fullUser)
  })

  it('calls identifyUser with null and UTM traits when no user', async () => {
    mockUser = null
    vi.mocked(getPersistedUtms).mockReturnValue({
      utm_source_first: 'google',
      utm_medium_last: 'cpc',
    })

    render(<SegmentIdentify />)

    await vi.waitFor(() => {
      expect(identifyUser).toHaveBeenCalledWith(null, {
        utm_source_first: 'google',
        utm_medium_last: 'cpc',
      })
    })
    expect(buildUserTraits).not.toHaveBeenCalled()
  })

  it('merges UTM and CLID traits into user identification', async () => {
    mockUser = fullUser
    vi.mocked(getPersistedUtms).mockReturnValue({ utm_source_first: 'twitter' })
    vi.mocked(extractClids).mockReturnValue({ gclid: 'abc123' })

    render(<SegmentIdentify />)

    await vi.waitFor(() => {
      expect(identifyUser).toHaveBeenCalledWith(42, {
        ...fullUserTraits,
        utm_source_first: 'twitter',
        gclid: 'abc123',
      })
    })
  })

  it('merges persisted CLIDs so fbclid survives post-auth redirect without URL params', async () => {
    mockUser = fullUser
    mockSearchParamsValue = new URLSearchParams('source=signup')
    vi.mocked(getPersistedClids).mockReturnValue({
      fbclid_first: 'test-fbclid',
      fbclid_last: 'test-fbclid',
    })
    vi.mocked(extractClids).mockReturnValue({})

    render(<SegmentIdentify />)

    await vi.waitFor(() => {
      expect(identifyUser).toHaveBeenCalledWith(42, {
        ...fullUserTraits,
        fbclid_first: 'test-fbclid',
        fbclid_last: 'test-fbclid',
      })
    })
  })

  it('drops null persisted CLID values', async () => {
    mockUser = fullUser
    vi.mocked(getPersistedClids).mockReturnValue({
      fbclid_first: 'keep-me',
      gclid_last: null,
    })

    render(<SegmentIdentify />)

    await vi.waitFor(() => {
      expect(identifyUser).toHaveBeenCalledWith(42, {
        ...fullUserTraits,
        fbclid_first: 'keep-me',
      })
    })
  })

  it('lets live URL CLIDs override persisted CLIDs for the same key', async () => {
    mockUser = fullUser
    vi.mocked(getPersistedClids).mockReturnValue({
      fbclid: 'from-session',
    })
    vi.mocked(extractClids).mockReturnValue({
      fbclid: 'from-url',
    })

    render(<SegmentIdentify />)

    await vi.waitFor(() => {
      expect(identifyUser).toHaveBeenCalledWith(42, {
        ...fullUserTraits,
        fbclid: 'from-url',
      })
    })
  })

  it('sets the user email for event tracking when logged in', async () => {
    mockUser = fullUser

    render(<SegmentIdentify />)

    await vi.waitFor(() => {
      expect(setUserEmail).toHaveBeenCalledWith('jane@example.com')
    })
  })

  it('clears the user email for event tracking when no user', async () => {
    mockUser = null

    render(<SegmentIdentify />)

    await vi.waitFor(() => {
      expect(setUserEmail).toHaveBeenCalledWith(undefined)
    })
  })

  it('calls persistUtmsOnce on render', async () => {
    render(<SegmentIdentify />)

    await vi.waitFor(() => {
      expect(persistUtmsOnce).toHaveBeenCalled()
    })
  })

  it('skips extractClids when searchParams is null', async () => {
    mockUser = fullUser
    mockSearchParamsValue = null

    render(<SegmentIdentify />)

    await vi.waitFor(() => {
      expect(identifyUser).toHaveBeenCalled()
    })
    expect(extractClids).not.toHaveBeenCalled()
  })

  it('sets the actor user id and role for analytics when signed in with a selected org', async () => {
    mockUser = fullUser
    mockOrganizationRole = 'campaignAdmin'

    render(<SegmentIdentify />)

    await vi.waitFor(() => {
      expect(setActorUserId).toHaveBeenCalledWith(42)
    })
    expect(setActorRole).toHaveBeenCalledWith('campaignAdmin')
  })

  it('sets a null actor role, not undefined, with no selected org', async () => {
    mockUser = fullUser
    mockOrganizationRole = undefined

    render(<SegmentIdentify />)

    await vi.waitFor(() => {
      expect(setActorRole).toHaveBeenCalledWith(null)
    })
  })

  it('sets an undefined actor user id when signed out', async () => {
    mockUser = null

    render(<SegmentIdentify />)

    await vi.waitFor(() => {
      expect(setActorUserId).toHaveBeenCalledWith(undefined)
    })
  })

  it('sets the active product from the selected org', async () => {
    mockUser = fullUser
    mockOrganizationRole = 'owner'
    mockElectedOfficeId = 'eo1'

    render(<SegmentIdentify />)

    await vi.waitFor(() => {
      expect(setActiveProduct).toHaveBeenCalledWith('serve')
    })
  })
})

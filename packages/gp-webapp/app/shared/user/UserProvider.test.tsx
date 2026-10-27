import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useContext } from 'react'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { User } from 'helpers/types'
import { UserContext, UserProvider } from './UserProvider'

const { mockUseClerkUser } = vi.hoisted(() => ({
  mockUseClerkUser: vi.fn(),
}))

vi.mock('@clerk/nextjs', () => ({
  useUser: () => mockUseClerkUser(),
}))

const baseUser: User = {
  id: 1,
  createdAt: '2024-01-01',
  updatedAt: '2024-01-01',
  firstName: 'Jane',
  lastName: 'Doe',
  hasPassword: true,
  email: 'old@example.com',
  roles: [],
}

const clerkWithPrimary = (emailAddress: string, status: string) => ({
  isLoaded: true,
  isSignedIn: true,
  user: { primaryEmailAddress: { emailAddress, verification: { status } } },
})

const ShowEmail = () => {
  const [user] = useContext(UserContext)
  return <div>{user?.email ?? 'none'}</div>
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('UserProvider email sync', () => {
  it('asks gp-api to copy a verified Clerk email that differs', async () => {
    mockUseClerkUser.mockReturnValue(
      clerkWithPrimary('New@Example.com', 'verified'),
    )
    api.mock('GET /v1/users/me', { status: 200, data: baseUser })
    const sync = vi.fn(() => ({
      status: 200 as const,
      data: { ...baseUser, email: 'new@example.com' },
    }))
    api.mock('POST /v1/users/me/sync-email', sync)

    render(
      <UserProvider>
        <ShowEmail />
      </UserProvider>,
    )

    expect(await screen.findByText('new@example.com')).toBeInTheDocument()
    expect(sync).toHaveBeenCalledTimes(1)
  })

  it('does not call gp-api when the emails already match', async () => {
    mockUseClerkUser.mockReturnValue(
      clerkWithPrimary('Old@Example.com', 'verified'),
    )
    api.mock('GET /v1/users/me', { status: 200, data: baseUser })
    const sync = vi.fn(() => ({ status: 200 as const, data: baseUser }))
    api.mock('POST /v1/users/me/sync-email', sync)

    render(
      <UserProvider>
        <ShowEmail />
      </UserProvider>,
    )

    expect(await screen.findByText('old@example.com')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(sync).not.toHaveBeenCalled()
  })

  it('does not call gp-api for an unverified Clerk email', async () => {
    mockUseClerkUser.mockReturnValue(
      clerkWithPrimary('staff@goodparty.org', 'unverified'),
    )
    api.mock('GET /v1/users/me', { status: 200, data: baseUser })
    const sync = vi.fn(() => ({ status: 200 as const, data: baseUser }))
    api.mock('POST /v1/users/me/sync-email', sync)

    render(
      <UserProvider>
        <ShowEmail />
      </UserProvider>,
    )

    expect(await screen.findByText('old@example.com')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(sync).not.toHaveBeenCalled()
  })
})

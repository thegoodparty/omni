import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useContext } from 'react'
import { screen, waitFor } from '@testing-library/react'
import { useUser as useClerkUser } from '@clerk/nextjs'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { useIsImpersonating } from '@shared/hooks/useIsImpersonating'
import { User, UserRole } from 'helpers/types'
import { UserContext, UserProvider } from './UserProvider'

vi.mock('@clerk/nextjs', () => ({
  useUser: vi.fn(),
}))

vi.mock('@shared/hooks/useIsImpersonating', () => ({
  useIsImpersonating: vi.fn(),
}))

const appUser = (overrides: Partial<User> = {}): User => ({
  id: 42,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  firstName: 'Sumit',
  lastName: 'Garg',
  name: 'Sumit Garg',
  email: 'candidate@example.com',
  hasPassword: false,
  roles: [UserRole.candidate],
  ...overrides,
})

const signedInAs = (firstName: string | null, lastName: string | null) => {
  vi.mocked(useClerkUser).mockReturnValue({
    isSignedIn: true,
    isLoaded: true,
    user: { firstName, lastName },
  } as any)
}

const UserName = () => {
  const [user] = useContext(UserContext)
  return <p>{user ? `${user.firstName} ${user.lastName}` : 'loading'}</p>
}

const renderProvider = () =>
  render(
    <UserProvider>
      <UserName />
    </UserProvider>,
  )

describe('UserProvider name sync', () => {
  let putBodies: unknown[]

  beforeEach(() => {
    putBodies = []
    vi.mocked(useIsImpersonating).mockReturnValue(false)
    api.mock('PUT /v1/users/me', ({ body }) => {
      putBodies.push(body)
      return {
        status: 200,
        data: appUser({ ...body, name: body.name ?? null }),
      }
    })
  })

  it('copies a name edited in Clerk onto the gp-api user', async () => {
    signedInAs('Deepti', 'Garg')
    api.mock('GET /v1/users/me', { status: 200, data: appUser() })

    renderProvider()

    await screen.findByText('Deepti Garg')
    expect(putBodies).toEqual([{ firstName: 'Deepti', name: 'Deepti Garg' }])
  })

  it('does nothing when the names already match', async () => {
    signedInAs('Sumit', 'Garg')
    api.mock('GET /v1/users/me', { status: 200, data: appUser() })

    renderProvider()

    await screen.findByText('Sumit Garg')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(putBodies).toEqual([])
  })

  it('treats an all-lowercase Clerk name as matching its title-cased copy', async () => {
    signedInAs('sumit', 'garg')
    api.mock('GET /v1/users/me', { status: 200, data: appUser() })

    renderProvider()

    await screen.findByText('Sumit Garg')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(putBodies).toEqual([])
  })

  it('never blanks or shortens a name past what gp-api accepts', async () => {
    signedInAs('D', null)
    api.mock('GET /v1/users/me', { status: 200, data: appUser() })

    renderProvider()

    await screen.findByText('Sumit Garg')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(putBodies).toEqual([])
  })

  it('does not write while an admin is impersonating', async () => {
    vi.mocked(useIsImpersonating).mockReturnValue(true)
    signedInAs('Deepti', 'Garg')
    api.mock('GET /v1/users/me', { status: 200, data: appUser() })

    renderProvider()

    await screen.findByText('Sumit Garg')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(putBodies).toEqual([])
  })

  it('tries a rejected sync once rather than on every render', async () => {
    signedInAs('Deepti', 'Garg')
    api.mock('GET /v1/users/me', { status: 200, data: appUser() })
    api.mock('PUT /v1/users/me', ({ body }) => {
      putBodies.push(body)
      return { status: 400, data: {} as User }
    })
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    const { rerender } = renderProvider()
    await waitFor(() => expect(putBodies).toHaveLength(1))
    rerender(
      <UserProvider>
        <UserName />
      </UserProvider>,
    )

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(putBodies).toHaveLength(1)
    expect(screen.getByText('Sumit Garg')).toBeInTheDocument()
    consoleError.mockRestore()
  })
})

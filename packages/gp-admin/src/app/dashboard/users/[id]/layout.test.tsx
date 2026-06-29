import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PERMISSIONS } from '@/lib/permissions'
import { status } from '@poppanator/http-constants'

// --- Clerk server auth ---
const mockHas = vi.fn()
const mockAuth = vi.fn()
vi.mock('@clerk/nextjs/server', () => ({
  auth: () => mockAuth(),
}))

// notFound() halts rendering by throwing in Next; model that so we can assert
// the layout never proceeds to fetch when the caller is unauthorized.
const mockNotFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND')
})
vi.mock('next/navigation', () => ({
  notFound: () => mockNotFound(),
}))

// Controllable SdkError so the catch-branch tests can drive the 404-vs-rethrow
// logic without constructing the real SDK error.
vi.mock('@goodparty_org/sdk', () => {
  class SdkError extends Error {
    status: number
    constructor(statusCode: number) {
      super(`SdkError ${statusCode}`)
      this.status = statusCode
    }
  }
  return { SdkError }
})
import { SdkError } from '@goodparty_org/sdk'

// --- GP API client ---
// gpAction wraps an M2M-authenticated SDK client; mock it to actually invoke the
// callback with a stub client so we verify the real SDK call (users.get) runs
// with the right id, not just that gpAction was reached.
const mockUsersGet = vi.fn()
const mockClient = { users: { get: mockUsersGet } }
const mockGpAction = vi.fn()
vi.mock('@/shared/util/gpClient.util', () => ({
  gpAction: (fn: (client: unknown) => unknown) => mockGpAction(fn),
}))

vi.mock('./context/UserContext', () => ({
  UserProvider: ({ children }: { children: React.ReactNode }) => children,
}))

import UserLayout from './layout'

function render(idValue = '1') {
  return UserLayout({
    children: 'child',
    params: Promise.resolve({ id: idValue }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockHas.mockReturnValue(true)
  mockAuth.mockReturnValue({ has: mockHas })
  mockUsersGet.mockResolvedValue({ id: 1, email: 'u@example.com' })
  mockGpAction.mockImplementation((fn: (client: unknown) => unknown) =>
    fn(mockClient)
  )
})

describe('UserLayout authorization', () => {
  it('404s and never fetches when the caller lacks READ_USERS', async () => {
    mockHas.mockReturnValue(false)
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mockNotFound).toHaveBeenCalled()
    expect(mockGpAction).not.toHaveBeenCalled()
  })

  it('404s (not a TypeError) and never fetches when unauthenticated', async () => {
    // Unauthenticated sessions can yield a null has; the optional-call must
    // fail closed rather than throw.
    mockAuth.mockReturnValue({ has: null })
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mockGpAction).not.toHaveBeenCalled()
  })

  it('checks the READ_USERS permission', async () => {
    await render()
    expect(mockHas).toHaveBeenCalledWith({
      permission: PERMISSIONS.READ_USERS,
    })
  })

  it('fetches the user by numeric id once the caller is authorized', async () => {
    await render('42')
    expect(mockGpAction).toHaveBeenCalledTimes(1)
    expect(mockUsersGet).toHaveBeenCalledWith(42)
  })

  it('calls notFound() when the API returns a 404 SdkError', async () => {
    mockUsersGet.mockRejectedValue(new SdkError(status.NotFound, 'Not Found'))
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mockNotFound).toHaveBeenCalled()
  })

  it('re-throws non-404 errors instead of 404-ing', async () => {
    mockUsersGet.mockRejectedValue(
      new SdkError(status.InternalServerError, 'Internal Server Error')
    )
    await expect(render()).rejects.toThrow('SdkError 500')
    expect(mockNotFound).not.toHaveBeenCalled()
  })
})

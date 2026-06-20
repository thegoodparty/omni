import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PERMISSIONS } from '@/lib/permissions'

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

// --- GP API client ---
const mockGpAction = vi.fn()
vi.mock('@/shared/util/gpClient.util', () => ({
  gpAction: (fn: unknown) => mockGpAction(fn),
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
  mockGpAction.mockResolvedValue({ id: 1, email: 'u@example.com' })
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

  it('fetches the user once the caller is authorized', async () => {
    await render()
    expect(mockGpAction).toHaveBeenCalledTimes(1)
  })
})

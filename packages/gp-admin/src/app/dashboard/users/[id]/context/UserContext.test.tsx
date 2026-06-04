import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useUser, UserProvider } from './UserContext'
import type { User } from '@goodparty_org/sdk'

const mockUser: User = {
  id: 1,
  firstName: 'Test',
  lastName: 'User',
  email: 'test@example.com',
  hasPassword: true,
}

describe('UserContext', () => {
  it('throws when useUser is called outside UserProvider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => renderHook(() => useUser())).toThrow(
      'useUser must be used within a UserProvider'
    )

    vi.restoreAllMocks()
  })

  it('returns user when called inside UserProvider', () => {
    const { result } = renderHook(() => useUser(), {
      wrapper: ({ children }) => (
        <UserProvider user={mockUser}>{children}</UserProvider>
      ),
    })

    expect(result.current).toBe(mockUser)
  })
})

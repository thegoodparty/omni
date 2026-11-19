'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { User } from '@/shared/gpApi'

const UserContext = createContext<User | null>(null)

export function UserProvider({
  user,
  children,
}: {
  user: User
  children: ReactNode
}) {
  return <UserContext.Provider value={user}>{children}</UserContext.Provider>
}

export function useUser(): User {
  const context = useContext(UserContext)
  if (!context) throw new Error('useUser must be used within a UserProvider')
  return context
}

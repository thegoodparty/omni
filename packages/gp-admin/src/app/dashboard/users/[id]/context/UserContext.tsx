'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { User } from '@/shared/gpApi'

const UserContext = createContext<User | null>(null)
const ClerkBanStatusContext = createContext(false)

export function UserProvider({
  user,
  clerkBanned = false,
  children,
}: {
  user: User
  clerkBanned?: boolean
  children: ReactNode
}) {
  return (
    <UserContext.Provider value={user}>
      <ClerkBanStatusContext.Provider value={clerkBanned}>
        {children}
      </ClerkBanStatusContext.Provider>
    </UserContext.Provider>
  )
}

export function useUser(): User {
  const context = useContext(UserContext)
  if (!context) throw new Error('useUser must be used within a UserProvider')
  return context
}

export function useClerkBanStatus(): boolean {
  return useContext(ClerkBanStatusContext)
}

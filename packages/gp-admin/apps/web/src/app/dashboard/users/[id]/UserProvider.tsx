'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { DetailedUser } from './types'

const UserContext = createContext<DetailedUser | null>(null)

interface UserProviderProps {
  user: DetailedUser
  children: ReactNode
}

export function UserProvider({ user, children }: UserProviderProps) {
  return <UserContext.Provider value={user}>{children}</UserContext.Provider>
}

export function useUser(): DetailedUser {
  const context = useContext(UserContext)
  if (!context) {
    throw new Error('useUser must be used within a UserProvider')
  }
  return context
}

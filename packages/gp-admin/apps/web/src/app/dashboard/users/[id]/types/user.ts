export const USER_ROLES = [
  'admin',
  'sales',
  'candidate',
  'campaignManager',
  'demo',
] as const

export type UserRole = (typeof USER_ROLES)[number]

export interface UserMetaData {
  hubspotId?: string
  textNotifications?: boolean
}

export interface User {
  id: number
  createdAt: string
  updatedAt: string
  firstName: string | null
  lastName: string | null
  name: string | null
  avatar: string | null
  email: string
  phone: string | null
  zip: string | null
  roles: UserRole[]
  metaData: UserMetaData | null
}

/**
 * Minimal user data needed for the shared header.
 */
export interface UserHeaderData {
  id: number
  name: string | null
  avatar: string | null
}

export enum UserRole {
  admin = 'admin',
  sales = 'sales',
  candidate = 'candidate',
  campaignManager = 'campaignManager',
  demo = 'demo',
}

export enum WhyBrowsing {
  considering = 'considering',
  learning = 'learning',
  test = 'test',
  else = 'else',
}

export type UserMetaData = {
  customerId?: string
  checkoutSessionId?: string | null
  accountType?: string | null
  lastVisited?: number
  sessionCount?: number
  isDeleted?: boolean
  fsUserId?: string
  whyBrowsing?: WhyBrowsing | null
  hubspotId?: string
  profile_updated_count?: number
  textNotifications?: boolean
} | null

export type User = {
  id: number
  firstName: string
  lastName: string
  name?: string | null
  email: string
  phone?: string | null
  zip?: string | null
  avatar?: string | null
  hasPassword: boolean
  roles?: UserRole[]
  metaData?: UserMetaData
}

export type UpdatePasswordInput = {
  oldPassword?: string
  newPassword: string
}

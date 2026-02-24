import { SIGN_UP_MODE } from '@goodparty_org/contracts'
import type { PaginationOptions } from './result'

export type {
  ReadUserOutput as User,
  UpdatePasswordInput,
} from '@goodparty_org/contracts'

export { SIGN_UP_MODE } from '@goodparty_org/contracts'

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

export type ListUsersOptions = PaginationOptions & {
  firstName?: string
  lastName?: string
  email?: string
}

export type UpdateUserInput = {
  firstName?: string
  lastName?: string
  email?: string
  name?: string
  zip?: string
  phone?: string
  roles?: UserRole[]
  signUpMode?: SIGN_UP_MODE
  allowTexts?: boolean
  metaData?: UserMetaData
}

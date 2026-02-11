export interface User {
  id: number
  email: string
  firstName: string
  lastName: string
  phone?: string | null
}

export const SEARCH_PARAMS = {
  EMAIL: 'email',
  FIRST_NAME: 'first_name',
  LAST_NAME: 'last_name',
} as const

export interface SearchUsersParams {
  [SEARCH_PARAMS.EMAIL]?: string
  [SEARCH_PARAMS.FIRST_NAME]?: string
  [SEARCH_PARAMS.LAST_NAME]?: string
}

export type SearchUsersResult = User[]

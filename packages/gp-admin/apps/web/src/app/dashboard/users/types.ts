export interface User {
  id: string
  email: string
  firstName: string
  lastName: string
  phone: string | null
}

export interface SearchUsersParams {
  email?: string
  first_name?: string
  last_name?: string
}

export type SearchUsersResult = User[]

import type { PaginationMeta } from '@goodparty_org/sdk'

export type { PaginationMeta }

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
  PAGE: 'page',
  PER_PAGE: 'per_page',
} as const

export const DEFAULT_PER_PAGE = 20

export const PER_PAGE_OPTIONS = [10, 20, 50, 100] as const

export type PerPageOption = (typeof PER_PAGE_OPTIONS)[number]

export function isPerPageOption(value: number): value is PerPageOption {
  return (PER_PAGE_OPTIONS as readonly number[]).includes(value)
}

export type SearchParamKey =
  (typeof SEARCH_PARAMS)[keyof typeof SEARCH_PARAMS]

export type SearchParamUpdates = Partial<
  Record<SearchParamKey, string | undefined>
>

export interface SearchUsersParams {
  [SEARCH_PARAMS.EMAIL]?: string
  [SEARCH_PARAMS.FIRST_NAME]?: string
  [SEARCH_PARAMS.LAST_NAME]?: string
  [SEARCH_PARAMS.PAGE]?: number
  [SEARCH_PARAMS.PER_PAGE]?: number
}

export interface SearchUsersResult {
  data: User[]
  meta: PaginationMeta
}

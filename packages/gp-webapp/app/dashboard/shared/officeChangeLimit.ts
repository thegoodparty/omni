import { FetchError } from 'ofetch'

export const OFFICE_CHANGE_LIMIT_MESSAGE =
  "You've reached the limit of 4 office changes. Contact support to change it again."

export const isOfficeChangeLimitReached = (error: unknown): boolean =>
  error instanceof FetchError &&
  error.status === 403 &&
  (error.data as { code?: unknown } | undefined)?.code ===
    'OFFICE_CHANGE_LIMIT_REACHED'

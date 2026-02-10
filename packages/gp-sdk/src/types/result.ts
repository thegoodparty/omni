export class SdkError extends Error {
  readonly status: number
  readonly response?: Response

  constructor(status: number, message: string, response?: Response) {
    super(message)
    this.name = 'SdkError'
    this.status = status
    this.response = response
  }
}

export type PaginationOptions = {
  offset?: number
  limit?: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

export type PaginationMeta = {
  total: number
  offset: number
  limit: number
}

export type PaginatedList<T> = {
  data: T[]
  meta: PaginationMeta
}

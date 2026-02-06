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
  page?: number
  limit?: number
}

export type PaginationMeta = {
  page: number
  limit: number
  total: number
  totalPages: number
}

export type PaginatedList<T> = {
  data: T[]
  pagination: PaginationMeta
}

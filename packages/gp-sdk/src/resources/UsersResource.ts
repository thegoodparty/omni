import type { PaginatedList, PaginationOptions } from '../types/result'
import type { UpdatePasswordInput, User } from '../types/user'
import { BaseResource } from './BaseResource'

export class UsersResource extends BaseResource {
  list = async (options?: PaginationOptions): Promise<PaginatedList<User>> => {
    const { data, meta: pagination } = await this.getRequest<{
      data: User[]
      meta: { page: number; limit: number; total: number; totalPages: number }
    }>('/users', options)

    return {
      data,
      pagination,
    }
  }

  get = (id: number): Promise<User> => this.getRequest<User>(`/users/${id}`)

  delete = (id: number): Promise<void> =>
    this.deleteRequest<void>(`/users/${id}`)

  updatePassword = (id: number, input: UpdatePasswordInput): Promise<void> =>
    this.putRequest<void>(`/users/${id}/password`, input)
}

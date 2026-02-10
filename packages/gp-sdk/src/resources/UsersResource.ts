import type { PaginatedList } from '../types/result'
import type { ListUsersOptions, UpdatePasswordInput, User } from '../types/user'
import { BaseResource } from './BaseResource'

export class UsersResource extends BaseResource {
  list = (options?: ListUsersOptions): Promise<PaginatedList<User>> =>
    this.getRequest<PaginatedList<User>>('/users', options)

  get = (id: number): Promise<User> => this.getRequest<User>(`/users/${id}`)

  delete = (id: number): Promise<void> =>
    this.deleteRequest<void>(`/users/${id}`)

  updatePassword = (id: number, input: UpdatePasswordInput): Promise<void> =>
    this.putRequest<void>(`/users/${id}/password`, input)
}

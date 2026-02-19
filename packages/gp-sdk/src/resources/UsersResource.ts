import type { PaginatedList } from '../types/result'
import type {
  ListUsersOptions,
  UpdatePasswordInput,
  UpdateUserInput,
  User,
} from '../types/user'
import { BaseResource } from './BaseResource'

export class UsersResource extends BaseResource {
  protected readonly resourceBasePath = '/users'

  list = (options?: ListUsersOptions): Promise<PaginatedList<User>> =>
    this.getRequest<PaginatedList<User>>(this.resourceBasePath, options)

  get = (id: number): Promise<User> => this.getRequest<User>(`/users/${id}`)

  update = (id: number, input: UpdateUserInput): Promise<User> =>
    this.putRequest<User>(`${this.resourceBasePath}/${id}`, input)

  delete = (id: number): Promise<void> =>
    this.deleteRequest<void>(`${this.resourceBasePath}/${id}`)

  updatePassword = (id: number, input: UpdatePasswordInput): Promise<void> =>
    this.putRequest<void>(`${this.resourceBasePath}/${id}/password`, input)
}

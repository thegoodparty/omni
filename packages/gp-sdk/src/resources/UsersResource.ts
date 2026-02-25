import type {
  ListUsersPagination,
  PaginatedList,
  ReadUserOutput,
  UpdatePasswordInput,
  UpdateUserInput,
} from '@goodparty_org/contracts'
import { BaseResource } from './BaseResource'

export class UsersResource extends BaseResource {
  protected readonly resourceBasePath = '/users'

  list = (
    options?: ListUsersPagination,
  ): Promise<PaginatedList<ReadUserOutput>> =>
    this.getRequest<PaginatedList<ReadUserOutput>>(
      this.resourceBasePath,
      options,
    )

  get = (id: number): Promise<ReadUserOutput> =>
    this.getRequest<ReadUserOutput>(`/users/${id}`)

  update = (id: number, input: UpdateUserInput): Promise<ReadUserOutput> =>
    this.putRequest<ReadUserOutput>(`${this.resourceBasePath}/${id}`, input)

  delete = (id: number): Promise<void> =>
    this.deleteRequest<void>(`${this.resourceBasePath}/${id}`)

  updatePassword = (id: number, input: UpdatePasswordInput): Promise<void> =>
    this.putRequest<void>(`${this.resourceBasePath}/${id}/password`, input)
}

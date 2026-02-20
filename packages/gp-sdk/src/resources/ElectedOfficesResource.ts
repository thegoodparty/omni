import type { PaginatedList } from '../types/result'
import type {
  ElectedOffice,
  ListElectedOfficesOptions,
  UpdateElectedOfficeInput,
} from '../types/electedOffice'
import { BaseResource } from './BaseResource'

export class ElectedOfficesResource extends BaseResource {
  protected readonly resourceBasePath = '/elected-office'

  list = (
    options?: ListElectedOfficesOptions,
  ): Promise<PaginatedList<ElectedOffice>> =>
    this.getRequest<PaginatedList<ElectedOffice>>(
      `${this.resourceBasePath}/list`,
      options,
    )

  get = (id: string): Promise<ElectedOffice> =>
    this.getRequest<ElectedOffice>(`${this.resourceBasePath}/${id}`)

  update = (
    id: string,
    input: UpdateElectedOfficeInput,
  ): Promise<ElectedOffice> =>
    this.putRequest<ElectedOffice>(`${this.resourceBasePath}/${id}`, input)
}

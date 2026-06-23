import type { PaginatedList } from '@goodparty_org/contracts'
import type {
  CreateElectedOfficeInput,
  ElectedOffice,
  ListElectedOfficesOptions,
  SetElectedOfficeDistrictOutput,
  UpdateElectedOfficeDistrictInput,
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

  create = (input: CreateElectedOfficeInput): Promise<ElectedOffice> =>
    this.postRequest<ElectedOffice>(this.resourceBasePath, input)

  get = (id: string): Promise<ElectedOffice> =>
    this.getRequest<ElectedOffice>(`${this.resourceBasePath}/${id}`)

  update = (
    id: string,
    input: UpdateElectedOfficeInput,
  ): Promise<ElectedOffice> =>
    this.putRequest<ElectedOffice>(`${this.resourceBasePath}/${id}`, input)

  updateDistrict = (
    id: string,
    input: UpdateElectedOfficeDistrictInput,
  ): Promise<SetElectedOfficeDistrictOutput> =>
    this.putRequest<SetElectedOfficeDistrictOutput>(
      `${this.resourceBasePath}/${id}/district`,
      input,
    )
}

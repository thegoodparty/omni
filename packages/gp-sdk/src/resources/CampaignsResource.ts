import type {
  ListCampaignsPagination,
  PaginatedList,
  ReadCampaignOutput,
  SetDistrictOutput,
  UpdateCampaignM2MInput,
} from '@goodparty_org/contracts'
import type { UpdateDistrictInput } from '../types/district'
import { BaseResource } from './BaseResource'

export class CampaignsResource extends BaseResource {
  protected readonly resourceBasePath = '/campaigns'

  get = (id: number): Promise<ReadCampaignOutput> =>
    this.getRequest<ReadCampaignOutput>(`${this.resourceBasePath}/${id}`)

  list = (
    options?: ListCampaignsPagination,
  ): Promise<PaginatedList<ReadCampaignOutput>> =>
    this.getRequest<PaginatedList<ReadCampaignOutput>>(
      `${this.resourceBasePath}/list`,
      options,
    )

  update = (
    id: number,
    input: UpdateCampaignM2MInput,
  ): Promise<ReadCampaignOutput> =>
    this.putRequest<ReadCampaignOutput>(`${this.resourceBasePath}/${id}`, input)

  updateDistrict = (
    id: number,
    input: UpdateDistrictInput,
  ): Promise<SetDistrictOutput> =>
    this.putRequest<SetDistrictOutput>(
      `${this.resourceBasePath}/${id}/district`,
      input,
    )
}

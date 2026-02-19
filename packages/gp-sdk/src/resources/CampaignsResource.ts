import type { PaginatedList } from '../types/result'
import type {
  Campaign,
  ListCampaignsOptions,
  UpdateCampaignInput,
} from '../types/campaign'
import { BaseResource } from './BaseResource'

export class CampaignsResource extends BaseResource {
  protected readonly resourceBasePath = '/campaigns'

  get = (id: number): Promise<Campaign> =>
    this.getRequest<Campaign>(`${this.resourceBasePath}/${id}`)

  list = (options?: ListCampaignsOptions): Promise<PaginatedList<Campaign>> =>
    this.getRequest<PaginatedList<Campaign>>(
      `${this.resourceBasePath}/list`,
      options,
    )

  update = (id: number, input: UpdateCampaignInput): Promise<Campaign> =>
    this.putRequest<Campaign>(`${this.resourceBasePath}/${id}`, input)
}

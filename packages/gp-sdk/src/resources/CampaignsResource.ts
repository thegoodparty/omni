import type { PaginatedList } from '../types/result'
import type {
  Campaign,
  ListCampaignsOptions,
  UpdateCampaignInput,
} from '../types/campaign'
import { BaseResource } from './BaseResource'

export class CampaignsResource extends BaseResource {
  get = (id: number): Promise<Campaign> =>
    this.getRequest<Campaign>(`/campaigns/${id}`)

  list = (options?: ListCampaignsOptions): Promise<PaginatedList<Campaign>> =>
    this.getRequest<PaginatedList<Campaign>>('/campaigns/list', options)

  update = (id: number, input: UpdateCampaignInput): Promise<Campaign> =>
    this.putRequest<Campaign>(`/campaigns/${id}`, input)
}

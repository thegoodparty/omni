import type {
  CreateEcanvasserInput,
  Ecanvasser,
  EcanvasserSummary,
} from '@goodparty_org/contracts'
import { BaseResource } from './BaseResource'

export class EcanvasserResource extends BaseResource {
  protected readonly resourceBasePath = '/ecanvasser'

  create = (input: CreateEcanvasserInput): Promise<Ecanvasser> =>
    this.postRequest<Ecanvasser>(this.resourceBasePath, input)

  list = (): Promise<EcanvasserSummary[]> =>
    this.getRequest<EcanvasserSummary[]>(`${this.resourceBasePath}/list`)

  syncAll = (): Promise<void> =>
    this.getRequest<void>(`${this.resourceBasePath}/sync-all`)

  delete = (campaignId: number): Promise<void> =>
    this.deleteRequest<void>(`${this.resourceBasePath}/${campaignId}`)
}

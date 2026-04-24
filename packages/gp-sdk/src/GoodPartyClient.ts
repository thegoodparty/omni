import { HttpClient } from './http/HttpClient'
import { AdminResource } from './resources/AdminResource'
import { CampaignsResource } from './resources/CampaignsResource'
import { EcanvasserResource } from './resources/EcanvasserResource'
import { ElectedOfficesResource } from './resources/ElectedOfficesResource'
import { ElectionsResource } from './resources/ElectionsResource'
import { OrganizationsResource } from './resources/OrganizationsResource'
import { UsersResource } from './resources/UsersResource'
import { ClerkService } from './vendor/clerk/clerk.service'

export type GoodPartyClientConfig = {
  m2mSecret: string
  gpApiRootUrl: string
}

export class GoodPartyClient {
  readonly admin: AdminResource
  readonly users: UsersResource
  readonly campaigns: CampaignsResource
  readonly ecanvasser: EcanvasserResource
  readonly electedOffices: ElectedOfficesResource
  readonly elections: ElectionsResource
  readonly organizations: OrganizationsResource
  private clerkService: ClerkService

  private constructor(clerkService: ClerkService, gpApiRootUrl: string) {
    this.clerkService = clerkService
    const httpClient = new HttpClient(gpApiRootUrl, clerkService.getToken)
    this.admin = new AdminResource(httpClient)
    this.users = new UsersResource(httpClient)
    this.campaigns = new CampaignsResource(httpClient)
    this.ecanvasser = new EcanvasserResource(httpClient)
    this.electedOffices = new ElectedOfficesResource(httpClient)
    this.elections = new ElectionsResource(httpClient)
    this.organizations = new OrganizationsResource(httpClient)
  }

  static create = async (
    config: GoodPartyClientConfig,
  ): Promise<GoodPartyClient> => {
    const { m2mSecret, gpApiRootUrl } = config
    const clerkService = new ClerkService(m2mSecret)
    await clerkService.getToken()
    return new GoodPartyClient(clerkService, gpApiRootUrl)
  }

  destroy = (): void => {
    this.clerkService.destroy()
  }
}

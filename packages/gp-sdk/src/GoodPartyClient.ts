import { HttpClient } from './http/HttpClient'
import { UsersResource } from './resources/UsersResource'
import { ClerkService } from './vendor/clerk/clerk.service'

export type GoodPartyClientConfig = {
  m2mSecret: string
  gpApiRootUrl: string
}

export class GoodPartyClient {
  readonly users: UsersResource
  private clerkService: ClerkService

  private constructor(clerkService: ClerkService, gpApiRootUrl: string) {
    this.clerkService = clerkService
    const httpClient = new HttpClient(gpApiRootUrl, clerkService.getToken)
    this.users = new UsersResource(httpClient)
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

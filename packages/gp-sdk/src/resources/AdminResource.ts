import type { ImpersonateUserOutput } from '../types/admin'
import type { HttpClient } from '../http/HttpClient'
import { AdminBriefingsResource } from './AdminBriefingsResource'
import { BaseResource } from './BaseResource'

export class AdminResource extends BaseResource {
  protected readonly resourceBasePath = '/admin'

  readonly briefings: AdminBriefingsResource

  constructor(httpClient: HttpClient) {
    super(httpClient)
    this.briefings = new AdminBriefingsResource(httpClient)
  }

  impersonateUser = (
    targetUserId: number,
    actorEmail: string,
  ): Promise<ImpersonateUserOutput> =>
    this.postRequest<ImpersonateUserOutput>(
      `${this.resourceBasePath}/users/impersonate/${targetUserId}`,
      { actorEmail },
    )
}

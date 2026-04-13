import type { ImpersonateUserOutput } from '../types/admin'
import { BaseResource } from './BaseResource'

export class AdminResource extends BaseResource {
  protected readonly resourceBasePath = '/admin'

  impersonateUser = (
    targetUserId: number,
    actorClerkId: string,
  ): Promise<ImpersonateUserOutput> =>
    this.postRequest<ImpersonateUserOutput>(
      `${this.resourceBasePath}/users/impersonate/${targetUserId}`,
      { actorClerkId },
    )
}

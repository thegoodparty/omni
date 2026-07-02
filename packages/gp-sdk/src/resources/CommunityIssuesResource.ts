import type {
  CommunityIssuesDispatchRequest,
  CommunityIssuesDispatchResult,
} from '@goodparty_org/contracts'
import { BaseResource } from './BaseResource'

export class CommunityIssuesResource extends BaseResource {
  protected readonly resourceBasePath = '/community-issues'

  dispatch = (
    body: CommunityIssuesDispatchRequest,
  ): Promise<CommunityIssuesDispatchResult> =>
    this.postRequest<CommunityIssuesDispatchResult>(
      `${this.resourceBasePath}/dispatch`,
      body,
    )
}

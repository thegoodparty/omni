import type {
  BackgroundAgentRunDetail,
  BackgroundAgentRunListItem,
  BackgroundAgentRunsListQuery,
  PaginatedList,
} from '@goodparty_org/contracts'
import { BaseResource } from './BaseResource'

export class AdminBackgroundAgentRunsResource extends BaseResource {
  protected readonly resourceBasePath = '/admin/background-agent-runs'

  list = (
    options?: BackgroundAgentRunsListQuery
  ): Promise<PaginatedList<BackgroundAgentRunListItem>> =>
    this.getRequest<PaginatedList<BackgroundAgentRunListItem>>(
      this.resourceBasePath,
      options
    )

  get = (runId: string): Promise<BackgroundAgentRunDetail> =>
    this.getRequest<BackgroundAgentRunDetail>(
      `${this.resourceBasePath}/${runId}`
    )
}

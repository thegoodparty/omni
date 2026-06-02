import type {
  AgentRunDetail,
  AgentRunListItem,
  AgentRunsListQuery,
  PaginatedList,
} from '@goodparty_org/contracts'
import { BaseResource } from './BaseResource'

export class AdminAgentRunsResource extends BaseResource {
  protected readonly resourceBasePath = '/admin/agent-runs'

  list = (
    options?: AgentRunsListQuery,
  ): Promise<PaginatedList<AgentRunListItem>> =>
    this.getRequest<PaginatedList<AgentRunListItem>>(
      this.resourceBasePath,
      options,
    )

  get = (runId: string): Promise<AgentRunDetail> =>
    this.getRequest<AgentRunDetail>(`${this.resourceBasePath}/${runId}`)

  retry = (runId: string): Promise<AgentRunListItem> =>
    this.postRequest<AgentRunListItem>(
      `${this.resourceBasePath}/${runId}/retry`,
      {},
    )
}

import type { PaginatedList } from '@goodparty_org/contracts'
import type {
  BriefingAdminListQuery,
  BriefingAdminRow,
} from '../types/briefing'
import { BaseResource } from './BaseResource'

export class AdminBriefingsResource extends BaseResource {
  protected readonly resourceBasePath = '/admin/briefings'

  list = (
    options?: BriefingAdminListQuery,
  ): Promise<PaginatedList<BriefingAdminRow>> =>
    this.getRequest<PaginatedList<BriefingAdminRow>>(
      this.resourceBasePath,
      options,
    )

  get = (briefingId: string): Promise<BriefingAdminRow> =>
    this.getRequest<BriefingAdminRow>(`${this.resourceBasePath}/${briefingId}`)
}

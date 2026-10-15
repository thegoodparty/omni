import type {
  ApprovePollRequest,
  DenyPollRequest,
  EditPollRequest,
  PollApprovalStatus,
  PollQueueItem,
  PollQueueResponse,
  PollReviewDetail,
} from '@goodparty_org/contracts'
import { BaseResource } from './BaseResource'

// The staff poll review queue — gp-api's /outreach/admin/polls surface,
// AdminOrM2M-gated. A paid poll sends nothing until it is approved here.
export class PollOutreachAdminResource extends BaseResource {
  protected readonly resourceBasePath = '/outreach/admin/polls'

  getQueue = (status?: PollApprovalStatus): Promise<PollQueueResponse> =>
    this.getRequest<PollQueueResponse>(
      `${this.resourceBasePath}/queue`,
      status ? { status } : undefined,
    )

  getDetail = (id: number): Promise<PollReviewDetail> =>
    this.getRequest<PollReviewDetail>(`${this.resourceBasePath}/${id}`)

  approve = (id: number, input: ApprovePollRequest): Promise<PollQueueItem> =>
    this.postRequest<PollQueueItem>(
      `${this.resourceBasePath}/${id}/approve`,
      input,
    )

  deny = (id: number, input: DenyPollRequest): Promise<PollQueueItem> =>
    this.postRequest<PollQueueItem>(
      `${this.resourceBasePath}/${id}/deny`,
      input,
    )

  edit = (id: number, input: EditPollRequest): Promise<PollReviewDetail> =>
    this.patchRequest<PollReviewDetail>(`${this.resourceBasePath}/${id}`, input)
}

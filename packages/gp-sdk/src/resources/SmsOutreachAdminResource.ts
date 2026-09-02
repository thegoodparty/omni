import type {
  ApproveSmsOutreachRequest,
  DenySmsOutreachRequest,
  SmsAdminDetailResponse,
  SmsApprovalQueueItem,
  SmsApprovalQueueResponse,
} from '@goodparty_org/contracts'
import { BaseResource } from './BaseResource'

// The CAS SMS console (approval queue + monitor) — gp-api's
// /outreach/admin/sms surface, AdminOrM2M-gated.
export class SmsOutreachAdminResource extends BaseResource {
  protected readonly resourceBasePath = '/outreach/admin/sms'

  getQueue = (): Promise<SmsApprovalQueueResponse> =>
    this.getRequest<SmsApprovalQueueResponse>(`${this.resourceBasePath}/queue`)

  getDetail = (id: number): Promise<SmsAdminDetailResponse> =>
    this.getRequest<SmsAdminDetailResponse>(`${this.resourceBasePath}/${id}`)

  approve = (
    id: number,
    input: ApproveSmsOutreachRequest,
  ): Promise<SmsApprovalQueueItem> =>
    this.postRequest<SmsApprovalQueueItem>(
      `${this.resourceBasePath}/${id}/approve`,
      input,
    )

  deny = (
    id: number,
    input: DenySmsOutreachRequest,
  ): Promise<SmsApprovalQueueItem> =>
    this.postRequest<SmsApprovalQueueItem>(
      `${this.resourceBasePath}/${id}/deny`,
      input,
    )
}

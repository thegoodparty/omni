import type {
  ApproveSmsOutreachRequest,
  CancelSmsOutreachRequest,
  DenySmsOutreachRequest,
  EditSmsOutreachDateRequest,
  EditSmsOutreachRequest,
  LinkSmsOutreachJobRequest,
  ReplaceSmsOutreachJobRequest,
  SmsAdminDetailResponse,
  SmsApprovalQueueItem,
  SmsApprovalQueueResponse,
  SmsReplyBackfillRequest,
  SmsReplyBackfillResponse,
  SmsTestMessageRequest,
  SmsTestMessageResponse,
  SmsVendorBalanceResponse,
} from '@goodparty_org/contracts'
import { BaseResource } from './BaseResource'

// The CAS SMS console (approval queue + monitor) — gp-api's
// /outreach/admin/sms surface, AdminOrM2M-gated.
export class SmsOutreachAdminResource extends BaseResource {
  protected readonly resourceBasePath = '/outreach/admin/sms'

  getQueue = (): Promise<SmsApprovalQueueResponse> =>
    this.getRequest<SmsApprovalQueueResponse>(`${this.resourceBasePath}/queue`)

  // The vendor account's prepaid balance; `account` is null when the live
  // vendor read failed.
  getBalance = (): Promise<SmsVendorBalanceResponse> =>
    this.getRequest<SmsVendorBalanceResponse>(
      `${this.resourceBasePath}/balance`
    )

  backfillReplies = (
    input: SmsReplyBackfillRequest
  ): Promise<SmsReplyBackfillResponse> =>
    this.postRequest<SmsReplyBackfillResponse>(
      `${this.resourceBasePath}/backfill-replies`,
      input
    )

  getDetail = (id: number): Promise<SmsAdminDetailResponse> =>
    this.getRequest<SmsAdminDetailResponse>(`${this.resourceBasePath}/${id}`)

  approve = (
    id: number,
    input: ApproveSmsOutreachRequest
  ): Promise<SmsApprovalQueueItem> =>
    this.postRequest<SmsApprovalQueueItem>(
      `${this.resourceBasePath}/${id}/approve`,
      input
    )

  deny = (
    id: number,
    input: DenySmsOutreachRequest
  ): Promise<SmsApprovalQueueItem> =>
    this.postRequest<SmsApprovalQueueItem>(
      `${this.resourceBasePath}/${id}/deny`,
      input
    )

  cancel = (
    id: number,
    input: CancelSmsOutreachRequest
  ): Promise<SmsApprovalQueueItem> =>
    this.postRequest<SmsApprovalQueueItem>(
      `${this.resourceBasePath}/${id}/cancel`,
      input
    )

  edit = (
    id: number,
    input: EditSmsOutreachRequest
  ): Promise<SmsApprovalQueueItem> =>
    this.patchRequest<SmsApprovalQueueItem>(
      `${this.resourceBasePath}/${id}`,
      input
    )

  editDate = (
    id: number,
    input: EditSmsOutreachDateRequest
  ): Promise<SmsApprovalQueueItem> =>
    this.patchRequest<SmsApprovalQueueItem>(
      `${this.resourceBasePath}/${id}/date`,
      input
    )

  // Cancels the send's vendor job and makes a new one on the same list; the
  // row returns to awaiting review.
  replaceJob = (
    id: number,
    input: ReplaceSmsOutreachJobRequest
  ): Promise<SmsApprovalQueueItem> =>
    this.postRequest<SmsApprovalQueueItem>(
      `${this.resourceBasePath}/${id}/replace-job`,
      input
    )

  // Points the send at a replacement job staff made by hand in Peerly.
  linkJob = (
    id: number,
    input: LinkSmsOutreachJobRequest
  ): Promise<SmsApprovalQueueItem> =>
    this.postRequest<SmsApprovalQueueItem>(
      `${this.resourceBasePath}/${id}/link-job`,
      input
    )

  // Sends the campaign's live template as a real text to the supplied
  // phone (CAS's own handset) via the job's Peerly test job.
  sendTest = (
    id: number,
    input: SmsTestMessageRequest
  ): Promise<SmsTestMessageResponse> =>
    this.postRequest<SmsTestMessageResponse>(
      `${this.resourceBasePath}/${id}/test`,
      input
    )
}

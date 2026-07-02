import type {
  BriefingDispatchPreview,
  DispatchMeetingAgentRequest,
  DispatchMeetingAgentResult,
} from '@goodparty_org/contracts'
import { BaseResource } from './BaseResource'

export class MeetingBriefingsResource extends BaseResource {
  protected readonly resourceBasePath = '/meetings/briefings'

  dispatch = (
    body: DispatchMeetingAgentRequest,
  ): Promise<DispatchMeetingAgentResult> =>
    this.postRequest<DispatchMeetingAgentResult>(
      `${this.resourceBasePath}/dispatch`,
      body,
    )

  dispatchPreview = (
    electedOfficeId: string,
  ): Promise<BriefingDispatchPreview> =>
    this.getRequest<BriefingDispatchPreview>(
      `${this.resourceBasePath}/dispatch/preview`,
      { electedOfficeId },
    )
}

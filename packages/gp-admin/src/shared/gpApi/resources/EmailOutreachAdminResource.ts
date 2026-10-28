import type { EmailPausedSendsResponse } from '@goodparty_org/contracts'
import { BaseResource } from './BaseResource'

export class EmailOutreachAdminResource extends BaseResource {
  protected readonly resourceBasePath = '/admin/outreach/email'

  getPaused = (): Promise<EmailPausedSendsResponse> =>
    this.getRequest<EmailPausedSendsResponse>(`${this.resourceBasePath}/paused`)

  resume = (outreachId: number): Promise<void> =>
    this.postRequest<void>(`${this.resourceBasePath}/${outreachId}/resume`, {})

  cancel = (outreachId: number): Promise<void> =>
    this.postRequest<void>(`${this.resourceBasePath}/${outreachId}/cancel`, {})
}

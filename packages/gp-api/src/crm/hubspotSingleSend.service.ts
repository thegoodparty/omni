import { BadGatewayException, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { z } from 'zod'
import { HubspotService } from './hubspot.service'
import { isTestEmail } from '../email/util/testEmailValidator.util'

// The fields callers here act on — HubSpot's EmailSendStatusView carries
// more (requestedAt, eventId, ...) that nothing in this codebase reads yet.
const emailSendStatusViewSchema = z.object({
  statusId: z.string(),
  status: z.string(),
})

export type HubspotSingleSendInput = {
  emailId: number
  to: string
  customProperties?: Record<string, string>
  contactProperties?: Record<string, string>
}

@Injectable()
export class HubspotSingleSendService {
  constructor(
    private readonly hubspot: HubspotService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(this.constructor.name)
  }

  get isConfigured(): boolean {
    return this.hubspot.isConfigured
  }

  // Sends one HubSpot marketing single-send transactional email (ENG-11034).
  // Recipient and content are explicit call parameters — never resolved from
  // a HubSpot contact's stored properties — so a merged/secondary contact
  // record can't misroute the address or render another campaign's content.
  // Skips (no-op) for a HubSpot-unconfigured environment or a test-email
  // recipient. A real API failure is logged and rethrown as
  // BadGatewayException so callers apply their own failure handling instead
  // of this generic client guessing at it.
  async sendSingleSend({
    emailId,
    to,
    customProperties,
    contactProperties,
  }: HubspotSingleSendInput): Promise<void> {
    if (isTestEmail(to)) {
      this.logger.debug(
        { emailId, to },
        'skipping HubSpot single-send to a test email address',
      )
      return
    }
    if (!this.isConfigured) {
      this.logger.debug(
        { emailId },
        'HubSpot not configured — skipping single-send',
      )
      return
    }

    try {
      const response =
        await this.hubspot.client.marketing.transactional.singleSendApi.sendEmail(
          {
            emailId,
            message: { to },
            customProperties,
            contactProperties,
          },
        )
      const { statusId, status } = emailSendStatusViewSchema.parse(response)
      this.logger.info(
        { emailId, to, statusId, status },
        'HubSpot single-send accepted',
      )
    } catch (err) {
      this.logger.error({ err, emailId, to }, 'HubSpot single-send failed')
      throw new BadGatewayException(
        'error communicating with HubSpot single-send API',
      )
    }
  }
}

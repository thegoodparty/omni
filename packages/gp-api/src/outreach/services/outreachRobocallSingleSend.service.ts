import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { HubspotSingleSendService } from '@/crm/hubspotSingleSend.service'
import { UsersService } from '@/users/services/users.service'
import { EVENTS } from '@/vendors/segment/segment.types'

// One HubSpot single-send asset per robocall payment/receipt milestone
// (ENG-11035). Each is gated on its own env var, unset in every environment
// today pending Ops creating the assets — mirrors HUBSPOT_PIN_SENT_EMAIL_ID
// (ENG-11034). Keyed by the Segment event name every call site already has
// in scope, so callers don't need a second identifier for the same event.
const ROBOCALL_SINGLE_SEND_ENV_VARS: Record<string, string> = {
  [EVENTS.Robocall.Scheduled]: 'HUBSPOT_ROBOCALL_SCHEDULED_EMAIL_ID',
  [EVENTS.Robocall.HoldPlaced]: 'HUBSPOT_ROBOCALL_HOLD_PLACED_EMAIL_ID',
  [EVENTS.Robocall.HoldFailed]: 'HUBSPOT_ROBOCALL_HOLD_FAILED_EMAIL_ID',
  [EVENTS.Robocall.SendFailed]: 'HUBSPOT_ROBOCALL_SEND_FAILED_EMAIL_ID',
  [EVENTS.Robocall.Reminder]: 'HUBSPOT_ROBOCALL_REMINDER_EMAIL_ID',
  [EVENTS.Robocall.Canceled]: 'HUBSPOT_ROBOCALL_CANCELED_EMAIL_ID',
  [EVENTS.Robocall.Receipt]: 'HUBSPOT_ROBOCALL_RECEIPT_EMAIL_ID',
}

// Read live rather than cached at module load (mirrors
// getPinSentSingleSendEmailId in campaignTcrCompliance.service.ts) so a prod
// cutover needs no redeploy and tests can stub it per-case.
const getSingleSendEmailId = (event: string): number | null => {
  const envVar = ROBOCALL_SINGLE_SEND_ENV_VARS[event]
  const raw = envVar ? process.env[envVar] : undefined
  const emailId = raw ? Number(raw) : NaN
  return Number.isFinite(emailId) ? emailId : null
}

// Shared single-send leg for every robocall payment/receipt milestone
// (ENG-11035). Every firing site already emits the matching Segment event
// unchanged (other consumers key off it) and passes only a userId, not a
// loaded User — several sites are SQS-consumer or payment-flow terminals with
// no request-scoped user object — so recipient email is resolved fresh here
// rather than threading a User through every call site.
@Injectable()
export class OutreachRobocallSingleSendService {
  constructor(
    private readonly hubspotSingleSend: HubspotSingleSendService,
    private readonly usersService: UsersService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(this.constructor.name)
  }

  // Never throws: an unset env var, a missing user, or a HubSpot failure are
  // all logged and swallowed. This runs alongside a payment capture, an SQS
  // consumer milestone, or a cron sweep transition that has already
  // committed — the Segment event is the source of truth for those, and a
  // lost single-send email must never fail the flow it rides along with.
  async send(
    event: string,
    userId: number,
    outreachId: number,
    customProperties: Record<string, string>,
  ): Promise<void> {
    const emailId = getSingleSendEmailId(event)
    if (!emailId) {
      this.logger.debug(
        { event, outreachId },
        `${ROBOCALL_SINGLE_SEND_ENV_VARS[event]} not set — skipping ` +
          'HubSpot single-send; the Segment event still fired',
      )
      return
    }
    try {
      const user = await this.usersService.findFirst({
        where: { id: userId },
      })
      if (!user) {
        this.logger.error(
          { event, outreachId, userId },
          'robocall single-send: user not found for recipient',
        )
        return
      }
      await this.hubspotSingleSend.sendSingleSend({
        emailId,
        to: user.email,
        customProperties,
      })
    } catch (err) {
      this.logger.error(
        { err, event, outreachId, userId },
        'robocall single-send failed; the Segment event still fired',
      )
    }
  }
}

import { Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { SlackService } from '@/vendors/slack/services/slack.service'
import { SlackChannel } from '@/vendors/slack/slackService.types'
import { OutreachEmailPauseReason } from '../../generated/prisma'

const DEFAULT_GP_ADMIN_BASE_URL = 'http://localhost:3500'

const REASON_TEXT: Record<OutreachEmailPauseReason, string> = {
  bounce_rate: 'too many emails bounced',
  complaint_rate: 'too many people marked it as spam',
  ses_tenant: 'Amazon SES paused this sender',
  ses_account: 'Amazon SES paused sending',
  daily_quota: 'the daily sending limit was reached',
  manual: 'it hit a sending problem',
}

export const emailSendsAdminUrl = (): string => {
  const base = process.env.GP_ADMIN_BASE_URL || DEFAULT_GP_ADMIN_BASE_URL
  return `${base.replace(/\/+$/, '')}/dashboard/email-sends`
}

// Tells customer-facing staff that a send stopped, so someone can reach the
// customer. The channel isn't picked yet: with
// SLACK_EMAIL_OUTREACH_PAUSES_CHANNEL_ID unset it posts nothing and logs.
@Injectable()
export class OutreachEmailPauseAlertService extends createPrismaBase(
  MODELS.OutreachEmail,
) {
  constructor(private readonly slack: SlackService) {
    super()
  }

  async notify(
    outreachEmailId: number,
    reason: OutreachEmailPauseReason,
  ): Promise<void> {
    try {
      if (!process.env.SLACK_EMAIL_OUTREACH_PAUSES_CHANNEL_ID) {
        this.logger.info(
          { outreachEmailId, reason },
          'No channel set for email pause alerts; not posting',
        )
        return
      }
      const row = await this.model.findUniqueOrThrow({
        where: { id: outreachEmailId },
        select: {
          subject: true,
          outreach: { select: { organizationSlug: true } },
          sender: { select: { organizationSlug: true, displayName: true } },
        },
      })
      const organization =
        row.outreach.organizationSlug ?? row.sender.organizationSlug
      const text = `An email send from ${row.sender.displayName} (${organization}) is paused because ${REASON_TEXT[reason]}. Subject: "${row.subject}". Review it here: ${emailSendsAdminUrl()}`
      await this.slack.message({ text }, SlackChannel.emailOutreachPauses)
    } catch (err) {
      this.logger.warn(
        { err, outreachEmailId },
        'Posting an email pause alert failed',
      )
    }
  }
}

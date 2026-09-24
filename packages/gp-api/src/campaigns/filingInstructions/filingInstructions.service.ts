import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import type { FilingInstructionsContent } from '@goodparty_org/contracts'
import { EmailService } from 'src/email/email.service'
import { Campaign, User } from 'src/generated/prisma'
import { CampaignsService } from '../services/campaigns.service'
import {
  buildFilingInstructionsContent,
  renderEinInstructionsEmail,
  renderFilingInstructionsEmail,
} from './filingInstructions.util'

@Injectable()
export class FilingInstructionsService {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly email: EmailService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(FilingInstructionsService.name)
  }

  async getContent(campaign: Campaign): Promise<FilingInstructionsContent> {
    const metrics = await this.campaigns.fetchLiveRaceTargetMetrics(campaign)
    return buildFilingInstructionsContent(campaign, metrics)
  }

  async emailToCandidate(campaign: Campaign, user: User) {
    const content = await this.getContent(campaign)
    const message = renderFilingInstructionsEmail(content)
    return this.email.sendEmail({
      to: user.email,
      subject: 'Your filing instructions - GoodParty.org',
      message,
      html: message.replace(/\n/g, '<br />'),
    })
  }

  // The EIN step's "Email me these steps": the same six IRS steps the wizard
  // shows, so the candidate can finish at the IRS from their inbox.
  async emailEinInstructionsToCandidate(user: User) {
    const message = renderEinInstructionsEmail()
    return this.email.sendEmail({
      to: user.email,
      subject: 'How to get your free EIN - GoodParty.org',
      message,
      html: message.replace(/\n/g, '<br />'),
    })
  }
}

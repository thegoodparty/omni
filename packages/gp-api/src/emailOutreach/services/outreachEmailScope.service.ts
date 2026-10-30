import { Injectable } from '@nestjs/common'
import { CampaignWith } from '@/campaigns/campaigns.types'
import { ownerCandidateName } from '@/campaigns/util/ownerCandidateName.util'
import { getUserFullName } from '@/users/util/users.util'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { ElectedOffice, User } from '../../generated/prisma'
import { EmailSendScope } from '../emailOutreach.types'

@Injectable()
export class OutreachEmailScopeService extends createPrismaBase(
  MODELS.TcrCompliance,
) {
  async forCampaign(
    campaign: CampaignWith<'user'>,
    user: User,
  ): Promise<EmailSendScope> {
    const tcr = await this.model.findFirst({
      where: { campaignId: campaign.id },
    })
    return {
      organizationSlug: campaign.organizationSlug,
      campaignId: campaign.id,
      suppressionSlugs: [campaign.organizationSlug],
      senderName: ownerCandidateName(campaign),
      fallbackName: campaign.organizationSlug,
      forwardToCandidates: [campaign.campaignEmail, user.email],
      paidForBy: tcr?.committeeName ?? null,
      canReadVoterFile: campaign.isPro === true,
    }
  }

  async forOffice(
    electedOffice: ElectedOffice,
    user: User,
  ): Promise<EmailSendScope> {
    const campaign = electedOffice.campaignId
      ? await this.client.campaign.findUnique({
          where: { id: electedOffice.campaignId },
          select: { organizationSlug: true, campaignEmail: true },
        })
      : null
    return {
      organizationSlug: electedOffice.organizationSlug,
      campaignId: null,
      suppressionSlugs: [
        electedOffice.organizationSlug,
        ...(campaign?.organizationSlug ? [campaign.organizationSlug] : []),
      ],
      senderName: getUserFullName(user),
      fallbackName: electedOffice.organizationSlug,
      forwardToCandidates: [campaign?.campaignEmail, user.email],
      paidForBy: null,
      canReadVoterFile: true,
    }
  }
}

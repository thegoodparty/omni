import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { OutreachDetail, SocialSaveRequest } from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import {
  Campaign,
  OutreachStatus,
  OutreachType,
  Prisma,
  SocialAssetKind,
} from '../../generated/prisma'
import { SOCIAL_PLATFORM_KIND } from '../util/socialAssets.util'

type OutreachWithSocial = Prisma.OutreachGetPayload<{
  include: { social: { include: { assets: true } } }
}>

const toOutreachDetail = (outreach: OutreachWithSocial): OutreachDetail => ({
  ...outreach,
  social: outreach.social
    ? {
        purpose: outreach.social.purpose,
        draftMessage: outreach.social.draftMessage,
        assets: outreach.social.assets.map((asset) => ({
          platform: asset.platform,
          kind: asset.kind,
          text: asset.text,
          caption: asset.caption,
        })),
      }
    : undefined,
})

@Injectable()
export class OutreachSocialService extends createPrismaBase(
  MODELS.OutreachSocial,
) {
  async saveSocialOutreach(
    campaign: Campaign,
    input: SocialSaveRequest,
  ): Promise<OutreachDetail> {
    const platforms = input.assets.map((asset) => asset.platform)
    if (new Set(platforms).size !== platforms.length) {
      throw new BadRequestException(
        'Assets must contain at most one asset per platform',
      )
    }

    const outreach = await this.client.$transaction(async (tx) => {
      const spine = await tx.outreach.create({
        data: {
          campaignId: campaign.id,
          organizationSlug: campaign.organizationSlug,
          outreachType: OutreachType.socialMedia,
          status: OutreachStatus.completed,
          name: input.name,
        },
      })
      await tx.outreachSocial.create({
        data: {
          outreachId: spine.id,
          purpose: input.purpose,
          draftMessage: input.draftMessage,
          assets: {
            create: input.assets.map((asset) => {
              const kind = SOCIAL_PLATFORM_KIND[asset.platform]
              return {
                platform: asset.platform,
                kind,
                text: asset.text,
                caption:
                  kind === SocialAssetKind.video_script
                    ? (asset.caption ?? null)
                    : null,
              }
            }),
          },
        },
      })
      return tx.outreach.findUniqueOrThrow({
        where: { id: spine.id },
        include: { social: { include: { assets: true } } },
      })
    })

    return toOutreachDetail(outreach)
  }

  async findDetail(campaignId: number, id: number): Promise<OutreachDetail> {
    const outreach = await this.client.outreach.findFirst({
      where: { id, campaignId },
      include: { social: { include: { assets: true } } },
    })
    if (!outreach) {
      throw new NotFoundException('Outreach not found')
    }
    return toOutreachDetail(outreach)
  }
}

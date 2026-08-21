import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  OutreachDetail,
  PhoneBankingOutreachDetail,
  SocialSaveRequest,
} from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import {
  Campaign,
  OutreachStatus,
  OutreachType,
  PhoneBankCallOutcome,
  Prisma,
  SocialAssetKind,
  SupportAnswer,
} from '../../generated/prisma'
import { SOCIAL_PLATFORM_KIND } from '../util/socialAssets.util'

type OutreachWithSocial = Prisma.OutreachGetPayload<{
  include: { social: { include: { assets: true } } }
}>

const toOutreachDetail = (
  outreach: OutreachWithSocial,
  phoneBanking?: PhoneBankingOutreachDetail,
): OutreachDetail => ({
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
  phoneBanking,
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
    const phoneBanking =
      outreach.outreachType === OutreachType.nativePhoneBanking &&
      outreach.phoneBankingListId !== null
        ? await this.computePhoneBankingDetail(outreach.phoneBankingListId)
        : undefined
    return toOutreachDetail(outreach, phoneBanking)
  }

  // Progress counts PEOPLE, byOutcome counts ENTRIES: a person is called
  // once they have an interaction row, an entry is called once any of its
  // persons is logged. An entry's rolled-up outcome is its most recent call
  // across all persons on it — the same latest-wins rule
  // SupportStatusService uses, since a fan-out write's uniform outcome can
  // later diverge when one housemate is corrected on their own.
  private async computePhoneBankingDetail(
    listId: number,
  ): Promise<PhoneBankingOutreachDetail> {
    const [entriesTotal, peopleTotal, peopleCalled, supporters, calledEntries] =
      await Promise.all([
        this.client.phoneBankingListEntry.count({
          where: { phoneBankingListId: listId },
        }),
        this.client.phoneBankingListEntryPerson.count({
          where: { entry: { phoneBankingListId: listId } },
        }),
        this.client.contactInteractionPhoneBanking.count({
          where: { phoneBankingListId: listId },
        }),
        this.client.contactInteractionPhoneBanking.count({
          where: {
            phoneBankingListId: listId,
            supportAnswer: SupportAnswer.supporter,
          },
        }),
        this.client.$queryRaw<{ outcome: PhoneBankCallOutcome }[]>(Prisma.sql`
          SELECT DISTINCT ON (entry.id) interaction.outcome
          FROM phone_banking_list_entry entry
          JOIN phone_banking_list_entry_person person
            ON person.phone_banking_list_entry_id = entry.id
          JOIN contact_interaction_phone_banking interaction
            ON interaction.person_id = person.person_id
            AND interaction.phone_banking_list_id = entry.phone_banking_list_id
          WHERE entry.phone_banking_list_id = ${listId}
          ORDER BY entry.id, interaction.occurred_at DESC, interaction.id DESC
        `),
      ])

    const byOutcome: Record<PhoneBankCallOutcome, number> = {
      [PhoneBankCallOutcome.answered]: 0,
      [PhoneBankCallOutcome.no_answer]: 0,
      [PhoneBankCallOutcome.voicemail]: 0,
      [PhoneBankCallOutcome.wrong_number]: 0,
      [PhoneBankCallOutcome.refused]: 0,
    }
    for (const { outcome } of calledEntries) {
      byOutcome[outcome] += 1
    }

    return {
      listId,
      entriesTotal,
      entriesCalled: calledEntries.length,
      peopleTotal,
      peopleCalled,
      byOutcome,
      supporters,
    }
  }
}

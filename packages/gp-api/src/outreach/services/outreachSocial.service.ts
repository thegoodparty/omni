import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  DoorKnockingOutreachDetail,
  OutreachDetail,
  PhoneBankingOutreachDetail,
  SocialSaveRequest,
} from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { DoorKnockingTurfCountsService } from '@/doorKnocking/services/doorKnockingTurfCounts.service'
import { activeTurfScope } from '@/doorKnocking/utils/turfScope.util'
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
  doorKnocking?: DoorKnockingOutreachDetail,
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
  doorKnocking,
})

@Injectable()
export class OutreachSocialService extends createPrismaBase(
  MODELS.OutreachSocial,
) {
  constructor(
    private readonly doorKnockingCounts: DoorKnockingTurfCountsService,
  ) {
    super()
  }

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
    // organizationSlug is nullable on the spine for legacy rows, and it is the
    // scope every suppression read in the counts aggregate needs. Every
    // nativeDoorKnocking envelope has one — the knock transaction writes it
    // from an org-gated request — so a null here is a row this feature never
    // wrote, and the block is simply absent rather than counted org-wide.
    const doorKnocking =
      outreach.outreachType === OutreachType.nativeDoorKnocking &&
      outreach.doorKnockingRouteId !== null &&
      outreach.organizationSlug !== null
        ? await this.computeDoorKnockingDetail(
            outreach.doorKnockingRouteId,
            outreach.organizationSlug,
          )
        : undefined
    return toOutreachDetail(outreach, phoneBanking, doorKnocking)
  }

  // The reverse edge the drawer was missing, and it needed no column: the
  // envelope stores `doorKnockingRouteId`, and `door_knocking_route` already
  // carries a `@unique doorKnockingTurfId` back to the list it was frozen for.
  // So turf → route → envelope resolved all along, and route → turf is one hop
  // the other way. No migration.
  //
  // The counts come from `DoorKnockingTurfCountsService`, which is the same
  // aggregate the door-knocking rail and its details drawer read — deliberately
  // reused rather than recomputed here. Doors are addresses paired with their
  // stop, people exclude ADR 0007 / ADR 0008 residents, and logged is the
  // subset of those people with a recorded status; deriving any of the three a
  // second time is how this drawer and the rail would come to print two
  // numbers for one quantity (ADR 0010).
  //
  // The turf is read through `activeTurfScope`, so a tombstoned list yields no
  // block at all. That is the honest answer: a soft-deleted turf is gone from
  // every door-knocking read path, and a drawer offering an Archive button
  // pointed at an endpoint that 404s would be worse than one that offers none.
  private async computeDoorKnockingDetail(
    routeId: number,
    organizationSlug: string,
  ): Promise<DoorKnockingOutreachDetail | undefined> {
    const route = await this.client.doorKnockingRoute.findFirst({
      where: { id: routeId, turf: activeTurfScope(organizationSlug) },
      select: {
        id: true,
        turf: {
          select: {
            id: true,
            name: true,
            completedAt: true,
            archivedAt: true,
          },
        },
      },
    })
    if (!route) return undefined

    const counts = await this.doorKnockingCounts.forRoutes(organizationSlug, [
      route.id,
    ])
    // `forRoutes` keys on the route id and seeds every requested id, so a route
    // with no targets comes back as zeroes rather than absent — but the map
    // lookup is still narrowed rather than asserted.
    const routeCounts = counts.get(route.id)
    if (!routeCounts) return undefined

    return {
      turfId: route.turf.id,
      routeId: route.id,
      turfName: route.turf.name,
      doorCount: routeCounts.doorCount,
      peopleCount: routeCounts.peopleCount,
      loggedCount: routeCounts.loggedCount,
      completedAt: route.turf.completedAt,
      archivedAt: route.turf.archivedAt,
    }
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
    const [
      entriesTotal,
      peopleTotal,
      peopleCalled,
      supporters,
      unsure,
      nonSupporters,
      calledEntries,
    ] = await Promise.all([
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
      this.client.contactInteractionPhoneBanking.count({
        where: {
          phoneBankingListId: listId,
          supportAnswer: SupportAnswer.unsure,
        },
      }),
      this.client.contactInteractionPhoneBanking.count({
        where: {
          phoneBankingListId: listId,
          supportAnswer: SupportAnswer.non_supporter,
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
      [PhoneBankCallOutcome.disconnected]: 0,
      [PhoneBankCallOutcome.hung_up]: 0,
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
      unsure,
      nonSupporters,
    }
  }
}

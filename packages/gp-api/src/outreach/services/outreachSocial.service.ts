import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  DoorKnockingOutreachDetail,
  OutreachDetail,
  PhoneBankingOutreachDetail,
  ServeSocialSaveRequest,
  SocialSaveRequest,
} from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { DoorKnockingTurfCountsService } from '@/doorKnocking/services/doorKnockingTurfCounts.service'
import { activeTurfScope } from '@/doorKnocking/utils/turfScope.util'
import {
  FollowUpAnswer,
  Outreach,
  OutreachStatus,
  OutreachType,
  PhoneBankCallOutcome,
  Prisma,
  SocialAssetKind,
  SupportAnswer,
} from '../../generated/prisma'
import { SOCIAL_PLATFORM_KIND } from '../util/socialAssets.util'

type OutreachWithSocial = Prisma.OutreachGetPayload<{
  include: { social: { include: { assets: true } }; robocall: true }
}>

// A Win save/detail carries the paying campaign (and its org slug); a Serve
// save/detail carries only the org slug, with campaignId null — the
// Win/Serve isolation boundary documented in AGENTS.md (ENG-10976).
export type OutreachSocialSaveScope =
  | { campaignId: number; organizationSlug: string | null }
  | { campaignId: null; organizationSlug: string }

export type OutreachSocialDetailScope =
  | { campaignId: number }
  | { organizationSlug: string; campaignId: null }

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
  // The two fields a resume cannot re-derive plus the priced landline count
  // (the history's People figure); the rest of the satellite is billing and
  // settlement state no client reads.
  robocall: outreach.robocall
    ? {
        audioKey: outreach.robocall.audioKey,
        callbackNumber: outreach.robocall.callbackNumber,
        billableCount: outreach.robocall.billableCount,
      }
    : undefined,
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
    scope: OutreachSocialSaveScope,
    input: SocialSaveRequest | ServeSocialSaveRequest,
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
          campaignId: scope.campaignId,
          organizationSlug: scope.organizationSlug,
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
        include: { social: { include: { assets: true } }, robocall: true },
      })
    })

    return toOutreachDetail(outreach)
  }

  async findDetail(
    scope: OutreachSocialDetailScope,
    id: number,
  ): Promise<OutreachDetail> {
    const outreach = await this.client.outreach.findFirst({
      where: { id, ...scope },
      include: { social: { include: { assets: true } }, robocall: true },
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
    // nativeDoorKnocking envelope has one — the create transaction writes it
    // from an org-gated request — so a null here is a row this feature never
    // wrote, and the block is simply absent rather than counted org-wide.
    const doorKnocking =
      outreach.outreachType === OutreachType.nativeDoorKnocking &&
      outreach.doorKnockingTurfId !== null &&
      outreach.organizationSlug !== null
        ? await this.computeDoorKnockingDetail(
            outreach.doorKnockingTurfId,
            outreach.organizationSlug,
            outreach,
          )
        : undefined
    return toOutreachDetail(outreach, phoneBanking, doorKnocking)
  }

  // Keyed on the TURF, which the envelope names directly. It used to be
  // keyed on the route and reach the turf through it, which worked exactly
  // as long as every turf had a route — a campaign nobody has walked yet
  // would have dropped out of its own drawer.
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
  // An UNROUTED turf is the opposite case and does get a block: the list is
  // there, nobody has walked it, and `routeId: null` plus zero counts is what
  // says so. Withholding it would read as the tombstoned case.
  //
  // The lifecycle comes from the envelope the caller already holds rather than
  // from a second read, because since 3.0 the envelope IS where it lives. This
  // used to select `completedAt`/`archivedAt` off the turf specifically so the
  // drawer would read the source instead of the envelope's mirror of it; there
  // is one row now, so the block and the row it decorates cannot disagree.
  // Public: also reused by OutreachAssignmentService.listMineDetailed to
  // hydrate a volunteer's assignment cards (ENG-11048) — same reasoning as
  // the ADR 0010 note above, one more caller.
  async computeDoorKnockingDetail(
    turfId: number,
    organizationSlug: string,
    envelope: Pick<Outreach, 'status' | 'archivedAt'>,
  ): Promise<DoorKnockingOutreachDetail | undefined> {
    const turf = await this.client.doorKnockingTurf.findFirst({
      where: { id: turfId, ...activeTurfScope(organizationSlug) },
      select: { id: true, name: true, route: { select: { id: true } } },
    })
    if (!turf) return undefined

    const counts = await this.doorKnockingCounts.forTurfs(organizationSlug, [
      turf.id,
    ])
    // `forTurfs` seeds every requested id, so a turf with no targets comes
    // back as zeroes rather than absent — but the map lookup is still
    // narrowed rather than asserted.
    const turfCounts = counts.get(turf.id)
    if (!turfCounts) return undefined

    return {
      turfId: turf.id,
      routeId: turf.route?.id ?? null,
      turfName: turf.name,
      doorCount: turfCounts.doorCount,
      peopleCount: turfCounts.peopleCount,
      loggedCount: turfCounts.loggedCount,
      completed: envelope.status === OutreachStatus.completed,
      archivedAt: envelope.archivedAt,
    }
  }

  // Progress counts PEOPLE, byOutcome counts ENTRIES: a person is called
  // once they have an interaction row, an entry is called once any of its
  // persons is logged. An entry's rolled-up outcome is its most recent call
  // across all persons on it — the same latest-wins rule
  // SupportStatusService uses, since a fan-out write's uniform outcome can
  // later diverge when one housemate is corrected on their own.
  // Public: also reused by OutreachAssignmentService.listMineDetailed (see
  // the note on computeDoorKnockingDetail above).
  async computePhoneBankingDetail(
    listId: number,
  ): Promise<PhoneBankingOutreachDetail> {
    const [
      entriesTotal,
      peopleTotal,
      peopleCalled,
      supporters,
      unsure,
      nonSupporters,
      followUpGroups,
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
      // One grouped read rather than a count per answer: the answer is
      // binary, so two counts would be two round trips for the same row set.
      this.client.contactInteractionPhoneBanking.groupBy({
        by: ['followUp'],
        where: { phoneBankingListId: listId, followUp: { not: null } },
        _count: { _all: true },
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

    // Both keys present at zero, for the reason door-knocking's
    // knockStatusCounts gives: "nobody needs following up" is an answer, and a
    // row that vanished when it emptied would make the table's own shape a
    // fact about the list.
    const byFollowUp: Record<FollowUpAnswer, number> = {
      [FollowUpAnswer.yes]: 0,
      [FollowUpAnswer.no]: 0,
    }
    for (const group of followUpGroups) {
      if (group.followUp) byFollowUp[group.followUp] = group._count._all
    }

    return {
      listId,
      entriesTotal,
      entriesCalled: calledEntries.length,
      peopleTotal,
      peopleCalled,
      byOutcome,
      byFollowUp,
      supporters,
      unsure,
      nonSupporters,
    }
  }
}

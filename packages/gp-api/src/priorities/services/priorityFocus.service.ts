import { BadRequestException, Injectable } from '@nestjs/common'
import type {
  OnboardingFocus,
  SetOnboardingFocusInput,
  SetOnboardingFocusResult,
} from '@goodparty_org/contracts'
import {
  CommunityIssue,
  CommunityIssueList,
  FocusFactSource,
  Priority,
  PriorityFocusChoice,
  PriorityFocusOption,
  PriorityFocusOptionKind,
  PrioritySource,
  Prisma,
} from '../../generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { AnalyticsService } from '@/analytics/analytics.service'
import { EVENTS } from 'src/vendors/segment/segment.types'
import type { SegmentTrackEventProperties } from 'src/vendors/segment/segment.types'
import {
  cleanRecapLine,
  firstWinFact,
  focusCards,
  focusKindOf,
  residentInterestFact,
  type FocusCard,
} from '../util/focusCards.util'
import {
  trackForOffice,
  type PrioritySurface,
} from '../util/priorityAnalytics.util'
import { PrioritiesService } from './priorities.service'
import {
  firstSentence,
  PriorityOnboardingService,
} from './priorityOnboarding.service'

const SURFACE: PrioritySurface = 'serve_onboarding'

const RAN_ON_SOURCES = [PrioritySource.win_import, PrioritySource.user_stated]

type OfficeRef = { id: string; organizationSlug: string }

export type SavedPriorityFocus = PriorityFocusChoice & {
  options: PriorityFocusOption[]
}

// Picked positions, then typed campaign issues, then anything typed in
// Serve; inside each, the order they were added.
const ranOnGroup = (row: Priority): number => {
  if (row.source !== PrioritySource.win_import) return 2
  return row.sourceCampaignPositionId === null ? 1 : 0
}

const byRanOnOrder = (a: Priority, b: Priority): number =>
  ranOnGroup(a) - ranOnGroup(b) ||
  a.createdAt.getTime() - b.createdAt.getTime() ||
  a.id.localeCompare(b.id)

const ranOnCard = (row: Priority): FocusCard => {
  const interest = residentInterestFact(
    row.residentInterest,
    row.residentInterestSource,
  )
  const firstWin = firstWinFact(row.firstWin, row.firstWinSource)
  return {
    key: row.id,
    kind: PriorityFocusOptionKind.ran_on,
    title: row.title,
    description: firstSentence(row.description),
    residentInterest: interest.value,
    residentInterestSource: interest.source,
    firstWin: firstWin.value,
    firstWinSource: firstWin.source,
    recapLine: cleanRecapLine(row.recapLine) ?? row.title,
  }
}

// A community issue's priority is its resident interest: both lists rate it
// from resident attention in local sources.
const communityCard = (issue: CommunityIssue): FocusCard => {
  const firstWin = firstWinFact(issue.firstWin, issue.firstWinSource)
  return {
    key: issue.id,
    kind: PriorityFocusOptionKind.community,
    title: issue.title,
    description: firstSentence(issue.summary),
    residentInterest: issue.priority,
    residentInterestSource: FocusFactSource.local_sources,
    firstWin: firstWin.value,
    firstWinSource: firstWin.source,
    recapLine: cleanRecapLine(issue.recapLine) ?? issue.title,
  }
}

@Injectable()
export class PriorityFocusService extends createPrismaBase(
  MODELS.PriorityFocusChoice,
) {
  constructor(
    private readonly priorities: PrioritiesService,
    private readonly onboarding: PriorityOnboardingService,
    private readonly analytics: AnalyticsService,
  ) {
    super()
  }

  // What the official picked as their first focus and every card on screen
  // when they did, sources included. Null until they pick.
  savedFor(electedOfficeId: string): Promise<SavedPriorityFocus | null> {
    return this.model.findUnique({
      where: { electedOfficeId },
      include: { options: { orderBy: { position: Prisma.SortOrder.asc } } },
    })
  }

  private async freshCards(office: OfficeRef): Promise<FocusCard[]> {
    const [ranOn, issues] = await Promise.all([
      this.client.priority.findMany({
        where: {
          electedOfficeId: office.id,
          archivedAt: null,
          source: { in: RAN_ON_SOURCES },
        },
      }),
      this.client.communityIssue.findMany({
        where: {
          organizationSlug: office.organizationSlug,
          list: CommunityIssueList.top_community,
          archivedAt: null,
        },
        orderBy: [
          { rank: { sort: Prisma.SortOrder.asc, nulls: 'last' } },
          { createdAt: Prisma.SortOrder.asc },
        ],
      }),
    ])
    return focusCards(
      ranOn.sort(byRanOnOrder).map(ranOnCard),
      issues.map(communityCard),
    )
  }

  // Cards by key, in the order asked, as they read now. A key that is neither
  // one of the office's ran-on priorities nor one of its top community issues
  // is left out.
  private async cardsFor(
    office: OfficeRef,
    keys: string[],
    client: Prisma.TransactionClient = this.client,
  ): Promise<FocusCard[]> {
    const [ranOn, issues] = await Promise.all([
      client.priority.findMany({
        where: {
          id: { in: keys },
          electedOfficeId: office.id,
          source: { in: RAN_ON_SOURCES },
        },
      }),
      client.communityIssue.findMany({
        where: {
          id: { in: keys },
          organizationSlug: office.organizationSlug,
          list: CommunityIssueList.top_community,
        },
      }),
    ])
    const cards = new Map(
      [...ranOn.map(ranOnCard), ...issues.map(communityCard)].map((card) => [
        card.key,
        card,
      ]),
    )
    return keys.flatMap((key) => cards.get(key) ?? [])
  }

  async forOnboarding(office: OfficeRef): Promise<OnboardingFocus> {
    await this.priorities.seedFromWin(office.id)
    const [saved, searchPending] = await Promise.all([
      this.savedFor(office.id),
      this.onboarding.searchPending(office),
    ])
    // Once they have picked, going back shows the cards they picked from,
    // not a list a later search has since re-ranked.
    const cards = saved
      ? await this.cardsFor(
          office,
          saved.options.map((option) => option.key),
        )
      : await this.freshCards(office)

    const picked = saved?.options.find((option) => option.picked)
    const pickedCard = cards.find((card) => card.key === picked?.key)
    return {
      kind: focusKindOf(cards),
      options: cards.map((card) => ({
        key: card.key,
        kind: card.kind,
        title: card.title,
        description: card.description,
        residentInterest: card.residentInterest,
        firstWin: card.firstWin,
        recapLine: card.recapLine,
      })),
      searchPending,
      saved:
        saved && picked
          ? {
              focusKey: picked.key,
              priorityId: saved.priorityId,
              title: pickedCard?.title ?? picked.title,
              recapLine: pickedCard?.recapLine ?? picked.title,
              pickedAt: saved.pickedAt.toISOString(),
              shown: saved.options.map((option) => ({
                key: option.key,
                kind: option.kind,
                title: option.title,
                residentInterest: option.residentInterest,
                firstWin: option.firstWin,
                picked: option.picked,
              })),
            }
          : null,
    }
  }

  // The picked card becomes the office's first focus. Nothing else changes:
  // issues they ran on stay priorities and community issues not picked stay
  // community issues. Saving again moves the focus, and a priority an
  // earlier save here made live is archived once it is no longer the pick.
  async set(
    office: OfficeRef,
    { shownKeys, focusKey }: SetOnboardingFocusInput,
  ): Promise<SetOnboardingFocusResult> {
    const keys = [...new Set(shownKeys)]
    if (!keys.includes(focusKey)) {
      throw new BadRequestException('The focus must be one of the cards shown')
    }
    const now = new Date()
    const events: [string, SegmentTrackEventProperties][] = []

    const result = await this.client.$transaction(async (tx) => {
      // A double tap would otherwise create the priority twice or leave two
      // rows marked as the focus.
      const lockKey = `priority_focus:${office.id}`
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`

      const cards = await this.cardsFor(office, keys, tx)
      const focus = cards.find((card) => card.key === focusKey)
      if (cards.length !== keys.length || !focus) {
        throw new BadRequestException('Unknown card')
      }

      const previous = await tx.priorityFocusChoice.findUnique({
        where: { electedOfficeId: office.id },
      })
      const { priority, activated } =
        focus.kind === PriorityFocusOptionKind.ran_on
          ? await this.ranOnFocus(tx, office, focus.key)
          : await this.communityFocus(tx, office, focus.key, events)

      if (previous && previous.priorityId !== priority.id) {
        if (previous.priorityActivated) {
          const { count } = await tx.priority.updateMany({
            where: { id: previous.priorityId, archivedAt: null },
            data: { archivedAt: now },
          })
          if (count > 0) {
            events.push([
              EVENTS.Priorities.PriorityArchived,
              { priorityId: previous.priorityId, surface: SURFACE },
            ])
          }
        }
      }
      await tx.priority.updateMany({
        where: {
          electedOfficeId: office.id,
          focusedAt: { not: null },
          id: { not: priority.id },
        },
        data: { focusedAt: null },
      })
      await tx.priority.update({
        where: { id: priority.id },
        data: { focusedAt: now },
      })

      const choice = {
        priorityId: priority.id,
        // Picking the same card again must not forget that the first save
        // is what made its priority live.
        priorityActivated:
          activated ||
          (previous?.priorityId === priority.id && previous.priorityActivated),
        pickedAt: now,
      }
      const saved = await tx.priorityFocusChoice.upsert({
        where: { electedOfficeId: office.id },
        create: { electedOfficeId: office.id, ...choice },
        update: choice,
      })
      await tx.priorityFocusOption.deleteMany({
        where: { choiceId: saved.id },
      })
      await tx.priorityFocusOption.createMany({
        data: cards.map((card, position) => ({
          choiceId: saved.id,
          position,
          key: card.key,
          kind: card.kind,
          title: card.title,
          residentInterest: card.residentInterest,
          residentInterestSource: card.residentInterestSource,
          firstWin: card.firstWin,
          firstWinSource: card.firstWinSource,
          picked: card.key === focusKey,
        })),
      })

      return {
        priorityId: priority.id,
        title: priority.title,
        recapLine: focus.recapLine,
      }
    })

    await trackForOffice(this.client, this.analytics, { id: office.id }, events)
    return result
  }

  private async ranOnFocus(
    tx: Prisma.TransactionClient,
    office: OfficeRef,
    priorityId: string,
  ): Promise<{ priority: Priority; activated: boolean }> {
    const priority = await tx.priority.findFirst({
      where: {
        id: priorityId,
        electedOfficeId: office.id,
        archivedAt: null,
        source: { in: RAN_ON_SOURCES },
      },
    })
    if (!priority) {
      throw new BadRequestException('That priority is no longer on the list')
    }
    return { priority, activated: false }
  }

  // The same row PriorityOnboardingService.set makes from a community issue,
  // carrying the card's facts so the priority keeps them.
  private async communityFocus(
    tx: Prisma.TransactionClient,
    office: OfficeRef,
    issueId: string,
    events: [string, SegmentTrackEventProperties][],
  ): Promise<{ priority: Priority; activated: boolean }> {
    const issue = await tx.communityIssue.findFirstOrThrow({
      where: { id: issueId, organizationSlug: office.organizationSlug },
    })
    // sourceCommunityIssueId is unique, and an issue's org has one office.
    const existing = await tx.priority.findFirst({
      where: { sourceCommunityIssueId: issue.id },
    })
    if (existing && existing.electedOfficeId !== office.id) {
      throw new BadRequestException('Unknown card')
    }
    if (existing) {
      return existing.archivedAt === null
        ? { priority: existing, activated: false }
        : {
            priority: await tx.priority.update({
              where: { id: existing.id },
              data: { archivedAt: null },
            }),
            activated: true,
          }
    }
    const created = await tx.priority.create({
      data: {
        electedOfficeId: office.id,
        title: issue.title,
        description: issue.summary,
        source: PrioritySource.community_issue,
        sourceCommunityIssueId: issue.id,
        residentInterest: issue.priority,
        residentInterestSource: FocusFactSource.local_sources,
        firstWin: issue.firstWin,
        firstWinSource: issue.firstWinSource,
        recapLine: cleanRecapLine(issue.recapLine),
      },
    })
    events.push([
      EVENTS.Priorities.PriorityCreated,
      {
        priorityId: created.id,
        source: PrioritySource.community_issue,
        communityIssueId: issue.id,
        surface: SURFACE,
      },
    ])
    return { priority: created, activated: true }
  }
}

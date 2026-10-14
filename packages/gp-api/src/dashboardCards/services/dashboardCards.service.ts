import { Injectable } from '@nestjs/common'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { addDays, endOfWeek, startOfWeek } from 'date-fns'
import {
  CommunityIssue,
  DashboardCard,
  DashboardCardType,
  ElectedOffice,
  MeetingBriefing,
  OutreachStatus,
  OutreachType,
  Prisma,
  Priority,
} from '../../generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import {
  CIVIC_PANEL_BUILD_CARD_HREF,
  civicPanelBuildCardSourceId,
  DASHBOARD_CARD_SNOOZE_DAYS,
  DashboardCardBucket,
  PRIORITY_STEP_IDS,
  PRIORITY_STEP_LABELS,
} from '@goodparty_org/contracts'
import { currentStepOf } from '@/priorities/util/priority.util'
import {
  briefingItemHref,
  briefingOverviewHref,
} from '../util/briefingHref.util'
import { BriefingArtifactCardSourceSchema } from '../schemas/briefingArtifactCardSource.schema'
import {
  OutreachReportBackService,
  REPORT_BACK_DUE_DAYS,
} from '@/outreach/services/outreachReportBack.service'

// Community issues have no natural deadline; give their cards a fixed window so
// they ride the existing active/this_week/missed bucketing off dueDate.
const COMMUNITY_ISSUE_CARD_DUE_DAYS = 7

// Same reason as above: recruiting has no deadline, and the window is what
// keeps an untouched card from sitting on the home page forever.
const CIVIC_PANEL_CARD_DUE_DAYS = 30

// The priority's own page, so the card and the Priorities page open the one
// conversation the priority keeps, and its steps and sends are recorded there.
export const civicPanelCardHref = (priorityId: string): string =>
  `/dashboard/priorities/${encodeURIComponent(priorityId)}`

type PriorityForCard = Pick<
  Priority,
  'id' | 'title' | 'status' | 'currentStep' | 'nextAction'
>

// A priority whose every step is settled: the page's "Plan ready". It has no
// next step, so it has no card.
const isPlanReady = (priority: PriorityForCard): boolean =>
  currentStepOf(priority) === null

// What the Priorities page shows for the priority: its "Next" line, or with
// none, the step badge, so the card and the page never disagree. A step id
// this build does not know gets no badge on the page, so the card reads it as
// not started.
const priorityStepLabel = (priority: PriorityForCard): string => {
  const currentStep = currentStepOf(priority)
  const step =
    PRIORITY_STEP_IDS.find((id) => id === currentStep) ?? PRIORITY_STEP_IDS[0]
  return PRIORITY_STEP_LABELS[step]
}

const priorityNextStepCardContent = (priority: PriorityForCard) => ({
  title: priority.title,
  summary: priority.nextAction?.trim() || priorityStepLabel(priority),
  ctaLabel: 'Open priority',
  ctaHref: civicPanelCardHref(priority.id),
})

// The priority's own conversation, told which send to report back on; the
// workspace starts the report back with one hidden turn.
export const reportBackCardHref = (
  priorityId: string,
  outreachId: number,
): string => `${civicPanelCardHref(priorityId)}?reportBack=${outreachId}`

const reportBackCardContent = (
  outreachId: number,
  priorityId: string,
  priorityTitle: string,
) => ({
  title: `Show people their voice counted on ${priorityTitle}`,
  summary: 'People keep answering when they see what came of it.',
  ctaLabel: 'Report back',
  ctaHref: reportBackCardHref(priorityId, outreachId),
})

const CIVIC_PANEL_BUILD_CARD_CONTENT = {
  title: 'Hear from more than the loudest voices',
  summary:
    'Decisions land better when you know what the whole community ' +
    'thinks, not just who shows up.',
  ctaLabel: 'Get started',
  ctaHref: CIVIC_PANEL_BUILD_CARD_HREF,
}

// A text past checkout. The same statuses the priority flow counts as sent.
// The Chief of Staff reads the build card's invite as sent off this same list.
export const UNSENT_OUTREACH_STATUSES = [
  OutreachStatus.pending_payment,
  OutreachStatus.draft,
  OutreachStatus.canceled,
  OutreachStatus.denied,
  OutreachStatus.failed,
]

type DesiredCard = {
  type: DashboardCardType
  sourceItemId: string | null
  title: string
  summary: string
  ctaLabel: string
  ctaHref: string
  dueDate: Date
}

@Injectable()
export class DashboardCardsService extends createPrismaBase(
  MODELS.DashboardCard,
) {
  constructor(private readonly reportBack: OutreachReportBackService) {
    super()
  }

  // One "Report back" card per priority text whose replies are in, created
  // when the card list is read, due two weeks out. It is done once a report
  // back on that send goes out (past checkout), or when the official marks
  // it done.
  async syncReportBackCards(
    electedOffice: Pick<ElectedOffice, 'id' | 'organizationSlug'>,
  ): Promise<void> {
    await this.client.$transaction(async (tx) => {
      // Same reason as the panel cards: a null sourceItemId leaves the
      // unique key unable to stop the home page and the archive both
      // inserting one.
      const lockKey = `report_back_cards:${electedOffice.id}`
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`
      const sends = await tx.outreach.findMany({
        where: this.reportBack.repliesInWhere(
          electedOffice.organizationSlug,
          electedOffice.id,
        ),
        select: {
          id: true,
          priorityId: true,
          priority: { select: { title: true } },
        },
      })
      const existing = await tx.dashboardCard.findMany({
        where: {
          electedOfficeId: electedOffice.id,
          type: DashboardCardType.report_back,
        },
        select: { id: true, sourceExternalId: true, completedAt: true },
      })
      const carded = new Set(existing.map((card) => card.sourceExternalId))
      const now = new Date()
      const missing = sends.filter((send) => !carded.has(String(send.id)))
      if (missing.length > 0) {
        await tx.dashboardCard.createMany({
          data: missing.map((send) => ({
            electedOfficeId: electedOffice.id,
            type: DashboardCardType.report_back,
            sourceExternalId: String(send.id),
            sourceItemId: null,
            ...reportBackCardContent(
              send.id,
              send.priorityId ?? '',
              send.priority?.title ?? '',
            ),
            dueDate: addDays(now, REPORT_BACK_DUE_DAYS),
          })),
        })
      }
      // Every open card, the ones just made included: a report back can be
      // past checkout before its card's first read.
      const openIds = [
        ...existing
          .filter((card) => card.completedAt === null)
          .map((card) => Number(card.sourceExternalId)),
        ...missing.map((send) => send.id),
      ]
      const sent = await this.reportBack.sentReportBacks(openIds)
      if (sent.size > 0) {
        await tx.dashboardCard.updateMany({
          where: {
            electedOfficeId: electedOffice.id,
            type: DashboardCardType.report_back,
            completedAt: null,
            sourceExternalId: { in: [...sent.keys()].map(String) },
          },
          data: { completedAt: now, dismissedAt: null, snoozedUntil: null },
        })
      }
    })
  }

  // Generates/reconciles cards for a single briefing from its artifact JSONB
  // (no S3 read). Upserts by stable identity so dismissals survive a re-run,
  // and removes cards for this briefing whose item is no longer featured.
  async syncFromBriefing(briefing: MeetingBriefing): Promise<void> {
    const desired = this.buildDesiredCards(briefing)
    // A successful parse always yields at least the briefing card, so an empty
    // list means the artifact failed to parse. Skip reconciliation entirely so
    // a transient bad artifact doesn't strand the briefing card while wiping
    // this briefing's agenda-item cards.
    if (!desired.length) return

    const electedOfficeId = briefing.electedOfficeId
    const sourceExternalId = briefing.id

    await this.client.$transaction(async (tx) => {
      for (const card of desired) {
        await this.upsertCard(tx, electedOfficeId, sourceExternalId, card)
      }
      await this.removeDeFeatured(
        tx,
        electedOfficeId,
        sourceExternalId,
        desired,
      )
    })
  }

  // Creates a single task card for a newly-surfaced community issue. Unlike
  // briefings there is nothing to reconcile — an issue is created once and never
  // de-featured — so this is a guarded create keyed on the issue id, idempotent
  // against at-least-once redelivery of the run-completed event.
  async syncFromCommunityIssue(
    electedOfficeId: string,
    issue: CommunityIssue,
  ): Promise<void> {
    const existing = await this.model.findFirst({
      where: {
        electedOfficeId,
        type: DashboardCardType.community_issue,
        sourceExternalId: issue.id,
      },
      select: { id: true },
    })
    if (existing) return

    await this.model.create({
      data: {
        electedOfficeId,
        type: DashboardCardType.community_issue,
        sourceExternalId: issue.id,
        sourceItemId: null,
        title: issue.title,
        summary: issue.summary,
        ctaLabel: 'View issue',
        ctaHref: `/dashboard/community-issues/${issue.id}`,
        dueDate: addDays(issue.createdAt, COMMUNITY_ISSUE_CARD_DUE_DAYS),
      },
    })
  }

  // The civic panel cards, created when the card list is read, so an
  // office that onboarded long ago gets them on its next visit: the office's
  // one build card, and a next-step card per open priority alongside it.
  async syncCivicPanelCards(
    electedOffice: Pick<ElectedOffice, 'id' | 'organizationSlug'>,
  ): Promise<void> {
    await this.client.$transaction(async (tx) => {
      // The home page and the archive read the list at once, and the build
      // card's null sourceItemId leaves the unique key unable to stop a
      // second insert.
      const lockKey = `civic_panel_cards:${electedOffice.id}`
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`
      await this.syncCivicPanelBuildCard(tx, electedOffice)
      await this.syncPriorityPanelCards(tx, electedOffice.id)
    })
  }

  // The build card has no Mark done: it is done once any sent text asked
  // people to JOIN, whichever purpose it went out under. The purpose is not
  // stored on the row, and the ask is what puts people on the panel.
  private async syncCivicPanelBuildCard(
    tx: Prisma.TransactionClient,
    electedOffice: Pick<ElectedOffice, 'id' | 'organizationSlug'>,
  ): Promise<void> {
    const where = {
      electedOfficeId: electedOffice.id,
      type: DashboardCardType.civic_panel,
      sourceExternalId: civicPanelBuildCardSourceId(electedOffice.id),
      sourceItemId: null,
    }
    const now = new Date()
    const card =
      (await tx.dashboardCard.findFirst({ where })) ??
      (await tx.dashboardCard.create({
        data: {
          ...where,
          ...CIVIC_PANEL_BUILD_CARD_CONTENT,
          dueDate: addDays(now, CIVIC_PANEL_CARD_DUE_DAYS),
        },
      }))
    // Its words follow the current copy in every state, so a done card in the
    // archive reads the same as an open one.
    const stale =
      card.title !== CIVIC_PANEL_BUILD_CARD_CONTENT.title ||
      card.summary !== CIVIC_PANEL_BUILD_CARD_CONTENT.summary ||
      card.ctaLabel !== CIVIC_PANEL_BUILD_CARD_CONTENT.ctaLabel ||
      card.ctaHref !== CIVIC_PANEL_BUILD_CARD_CONTENT.ctaHref
    if (card.completedAt) {
      if (stale) {
        await tx.dashboardCard.update({
          where: { id: card.id },
          data: CIVIC_PANEL_BUILD_CARD_CONTENT,
        })
      }
      return
    }

    const seedSent = await tx.outreach.findFirst({
      where: {
        organizationSlug: electedOffice.organizationSlug,
        campaignId: null,
        outreachType: OutreachType.text,
        asksToJoinCivicPanel: true,
        status: { notIn: UNSENT_OUTREACH_STATUSES },
      },
      select: { id: true },
    })
    if (seedSent) {
      await tx.dashboardCard.update({
        where: { id: card.id },
        data: {
          ...CIVIC_PANEL_BUILD_CARD_CONTENT,
          completedAt: now,
          dismissedAt: null,
          snoozedUntil: null,
        },
      })
      return
    }

    // It has no date of its own to miss, so it does not lapse into missed
    // while it is still open.
    const lapsed = !card.dismissedAt && card.dueDate < now
    if (stale || lapsed) {
      await tx.dashboardCard.update({
        where: { id: card.id },
        data: {
          ...CIVIC_PANEL_BUILD_CARD_CONTENT,
          ...(lapsed && { dueDate: addDays(now, CIVIC_PANEL_CARD_DUE_DAYS) }),
        },
      })
    }
  }

  // One next-step card per priority with a step left to take. It goes once
  // the priority is archived or deleted, or its plan is ready, and comes back
  // if the priority is unarchived or a step comes open again. Its words follow
  // the priority's next step; a skipped or done card stays that way. It cannot
  // be done by hand, and does not lapse into missed, so there is always a
  // next step waiting.
  private async syncPriorityPanelCards(
    tx: Prisma.TransactionClient,
    electedOfficeId: string,
  ): Promise<void> {
    const open = await tx.priority.findMany({
      where: { electedOfficeId, archivedAt: null },
      select: {
        id: true,
        title: true,
        status: true,
        currentStep: true,
        nextAction: true,
      },
    })
    const openIds = open.map((priority) => priority.id)
    const priorities = open.filter((priority) => !isPlanReady(priority))
    const liveIds = priorities.map((priority) => priority.id)

    await tx.dashboardCard.deleteMany({
      where: {
        electedOfficeId,
        type: DashboardCardType.civic_panel,
        sourceExternalId: {
          notIn: [...openIds, civicPanelBuildCardSourceId(electedOfficeId)],
        },
      },
    })
    // A ready plan takes the card off the home and out of the archive, the
    // same as archiving; a card the official marked done stays done.
    await tx.dashboardCard.deleteMany({
      where: {
        electedOfficeId,
        type: DashboardCardType.civic_panel,
        completedAt: null,
        sourceExternalId: {
          in: openIds.filter((id) => !liveIds.includes(id)),
        },
      },
    })
    const existing = await tx.dashboardCard.findMany({
      where: {
        electedOfficeId,
        type: DashboardCardType.civic_panel,
        sourceExternalId: { in: liveIds },
      },
      select: {
        id: true,
        sourceExternalId: true,
        title: true,
        summary: true,
        ctaLabel: true,
        ctaHref: true,
        dueDate: true,
        dismissedAt: true,
        completedAt: true,
      },
    })
    const now = new Date()
    const dueDate = addDays(now, CIVIC_PANEL_CARD_DUE_DAYS)
    const byPriority = new Map(priorities.map((p) => [p.id, p]))
    for (const card of existing) {
      const priority = byPriority.get(card.sourceExternalId)
      if (!priority) continue
      const content = priorityNextStepCardContent(priority)
      const stale =
        card.title !== content.title ||
        card.summary !== content.summary ||
        card.ctaLabel !== content.ctaLabel ||
        card.ctaHref !== content.ctaHref
      const lapsed =
        !card.dismissedAt && !card.completedAt && card.dueDate < now
      if (stale || lapsed) {
        await tx.dashboardCard.update({
          where: { id: card.id },
          data: { ...content, ...(lapsed && { dueDate }) },
        })
      }
    }
    const carded = new Set(existing.map((card) => card.sourceExternalId))
    const missing = priorities.filter((priority) => !carded.has(priority.id))
    if (missing.length === 0) return
    await tx.dashboardCard.createMany({
      data: missing.map((priority) => ({
        electedOfficeId,
        type: DashboardCardType.civic_panel,
        sourceExternalId: priority.id,
        sourceItemId: null,
        ...priorityNextStepCardContent(priority),
        dueDate,
      })),
    })
  }

  private buildDesiredCards(briefing: MeetingBriefing): DesiredCard[] {
    const parsed = BriefingArtifactCardSourceSchema.safeParse(briefing.artifact)
    if (!parsed.success) {
      this.logger.warn(
        { briefingId: briefing.id },
        'dashboard card sync: briefing artifact missing card fields',
      )
      return []
    }

    const artifact = parsed.data
    const dateSlug = formatInTimeZone(briefing.meetingDate, 'UTC', 'yyyy-MM-dd')
    // dueDate is the instant the meeting day ends in the meeting's own
    // timezone, so a card stays active through the whole meeting day and the
    // active/missed split is a plain now() comparison. meetingDate is a
    // calendar date stored at UTC midnight; reinterpret it in the briefing's
    // timezone and take the end of that day.
    const dueDate = fromZonedTime(
      `${dateSlug}T23:59:59.999`,
      briefing.meetingTimezone || 'UTC',
    )
    const summary =
      artifact.executive_summary?.subheadline ??
      artifact.executive_summary?.headline ??
      artifact.executive_summary?.lead_in ??
      ''

    const briefingCard: DesiredCard = {
      type: DashboardCardType.briefing,
      sourceItemId: null,
      title: artifact.meeting_name ?? 'Your meeting briefing',
      summary,
      ctaLabel: 'Prepare for the meeting',
      ctaHref: briefingOverviewHref(dateSlug),
      dueDate,
    }

    const itemCards: DesiredCard[] = (
      artifact.executive_summary?.items ?? []
    ).map((item) => ({
      type: DashboardCardType.agenda_item,
      sourceItemId: item.item_id,
      title: item.title,
      summary: item.overview,
      ctaLabel: 'Learn more',
      ctaHref: briefingItemHref(dateSlug, item.item_id),
      dueDate,
    }))

    return [briefingCard, ...itemCards]
  }

  private async upsertCard(
    tx: Prisma.TransactionClient,
    electedOfficeId: string,
    sourceExternalId: string,
    card: DesiredCard,
  ): Promise<void> {
    const content = {
      title: card.title,
      summary: card.summary,
      ctaLabel: card.ctaLabel,
      ctaHref: card.ctaHref,
      dueDate: card.dueDate,
    }

    const existing = await tx.dashboardCard.findFirst({
      where: {
        electedOfficeId,
        type: card.type,
        sourceExternalId,
        sourceItemId: card.sourceItemId,
      },
      select: { id: true },
    })

    // Only content fields change on update — dismissedAt is left untouched so
    // a dismissal survives regeneration.
    if (existing) {
      await tx.dashboardCard.update({
        where: { id: existing.id },
        data: content,
      })
      return
    }

    await tx.dashboardCard.create({
      data: {
        electedOfficeId,
        type: card.type,
        sourceExternalId,
        sourceItemId: card.sourceItemId,
        ...content,
      },
    })
  }

  private async removeDeFeatured(
    tx: Prisma.TransactionClient,
    electedOfficeId: string,
    sourceExternalId: string,
    desired: DesiredCard[],
  ): Promise<void> {
    const keepItemIds = desired
      .filter((card) => card.type === DashboardCardType.agenda_item)
      .map((card) => card.sourceItemId)
      .filter((id): id is string => id !== null)

    await tx.dashboardCard.deleteMany({
      where: {
        electedOfficeId,
        sourceExternalId,
        type: DashboardCardType.agenda_item,
        sourceItemId: { notIn: keepItemIds },
      },
    })
  }

  async listByBucket(
    electedOfficeId: string,
    bucket: DashboardCardBucket,
    { includeCivicPanel = false }: { includeCivicPanel?: boolean } = {},
  ): Promise<DashboardCard[]> {
    return this.findMany({
      where: {
        ...this.bucketWhere(electedOfficeId, bucket),
        // Off, the panel cards an office already has stay out of every list.
        ...(!includeCivicPanel && {
          type: {
            notIn: [
              DashboardCardType.civic_panel,
              DashboardCardType.report_back,
            ],
          },
        }),
      },
      orderBy: { dueDate: Prisma.SortOrder.asc },
    })
  }

  private bucketWhere(
    electedOfficeId: string,
    bucket: DashboardCardBucket,
  ): Prisma.DashboardCardWhereInput {
    const now = new Date()
    switch (bucket) {
      case 'skipped':
        return { electedOfficeId, dismissedAt: { not: null } }
      case 'done':
        return { electedOfficeId, completedAt: { not: null } }
      case 'missed':
        return {
          electedOfficeId,
          dismissedAt: null,
          completedAt: null,
          dueDate: { lt: now },
        }
      case 'this_week':
        return {
          electedOfficeId,
          dueDate: {
            gte: startOfWeek(now),
            lte: endOfWeek(now),
          },
        }
      case 'active':
        return {
          electedOfficeId,
          dismissedAt: null,
          completedAt: null,
          dueDate: { gte: now },
          OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
        }
    }
  }

  async dismiss(electedOfficeId: string, id: string): Promise<void> {
    await this.client.dashboardCard.updateMany({
      where: { id, electedOfficeId, dismissedAt: null, completedAt: null },
      data: { dismissedAt: new Date() },
    })
  }

  // Civic panel cards finish on their own: the build card when its text
  // goes out, a priority card when its priority is resolved.
  async complete(electedOfficeId: string, id: string): Promise<void> {
    await this.client.dashboardCard.updateMany({
      where: {
        id,
        electedOfficeId,
        dismissedAt: null,
        completedAt: null,
        type: { not: DashboardCardType.civic_panel },
      },
      data: { completedAt: new Date(), snoozedUntil: null },
    })
  }

  // "Show in 3 days" moves the card's date with it, so it comes back due
  // rather than lapsing into missed while it is away.
  async snooze(electedOfficeId: string, id: string): Promise<void> {
    const until = addDays(new Date(), DASHBOARD_CARD_SNOOZE_DAYS)
    const open = { id, electedOfficeId, dismissedAt: null, completedAt: null }
    await this.client.$transaction([
      this.client.dashboardCard.updateMany({
        where: { ...open, dueDate: { lt: until } },
        data: { dueDate: until },
      }),
      this.client.dashboardCard.updateMany({
        where: open,
        data: { snoozedUntil: until },
      }),
    ])
  }

  // "Bring it back" undoes "Not for me".
  async restore(electedOfficeId: string, id: string): Promise<void> {
    await this.client.dashboardCard.updateMany({
      where: { id, electedOfficeId, dismissedAt: { not: null } },
      data: { dismissedAt: null, snoozedUntil: null },
    })
  }
}

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
} from '../../generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import {
  BUILD_CITIZENS_PANEL_PURPOSE,
  civicPanelBuildCardSourceId,
  DashboardCardBucket,
} from '@goodparty_org/contracts'
import {
  briefingItemHref,
  briefingOverviewHref,
} from '../util/briefingHref.util'
import { BriefingArtifactCardSourceSchema } from '../schemas/briefingArtifactCardSource.schema'

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

const civicPanelCardContent = (priority: { id: string; title: string }) => ({
  title: priority.title,
  summary: `Let's get a representative sample of constituents to weigh in on ${priority.title}.`,
  ctaLabel: 'Get started',
  ctaHref: civicPanelCardHref(priority.id),
})

// The outreach page opens its text flow on the panel purpose with a random
// draw of the district already chosen (ConstituentOutreachPage).
export const CIVIC_PANEL_BUILD_CARD_HREF = `/dashboard/constituent-outreach?compose=text&purpose=${BUILD_CITIZENS_PANEL_PURPOSE}`

const CIVIC_PANEL_BUILD_CARD_CONTENT = {
  title: "Build your citizens' panel",
  summary:
    'Invite a random sample of residents to weigh in, so you hear from more than the loudest voices.',
  ctaLabel: 'Get started',
  ctaHref: CIVIC_PANEL_BUILD_CARD_HREF,
}

// A text past checkout. The same statuses the priority flow counts as sent.
const UNSENT_OUTREACH_STATUSES = [
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

  // The citizens' panel cards, created when the card list is read. First the
  // office's one build card, done once a text asking residents to join has
  // gone out; only then a card per open priority, since a priority is asked
  // of the panel and there is none until that text.
  async syncCivicPanelCards(
    electedOffice: Pick<ElectedOffice, 'id' | 'organizationSlug'>,
  ): Promise<void> {
    await this.client.$transaction(async (tx) => {
      // The home page and the archive read the list at once, and the build
      // card's null sourceItemId leaves the unique key unable to stop a
      // second insert.
      const lockKey = `civic_panel_cards:${electedOffice.id}`
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`
      const built = await this.syncCivicPanelBuildCard(tx, electedOffice)
      if (built) await this.syncPriorityPanelCards(tx, electedOffice.id)
    })
  }

  // Returns whether the build card is done. Any sent text that asked people
  // to JOIN counts, whichever purpose it went out under: the purpose is not
  // stored on the row, and the ask is what puts people on the panel.
  private async syncCivicPanelBuildCard(
    tx: Prisma.TransactionClient,
    electedOffice: Pick<ElectedOffice, 'id' | 'organizationSlug'>,
  ): Promise<boolean> {
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
    if (card.completedAt) return true

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
        data: { completedAt: now, dismissedAt: null },
      })
      return true
    }

    // Every panel card waits on this one, so it does not lapse into missed
    // while it is still open.
    const stale =
      card.title !== CIVIC_PANEL_BUILD_CARD_CONTENT.title ||
      card.summary !== CIVIC_PANEL_BUILD_CARD_CONTENT.summary ||
      card.ctaLabel !== CIVIC_PANEL_BUILD_CARD_CONTENT.ctaLabel ||
      card.ctaHref !== CIVIC_PANEL_BUILD_CARD_CONTENT.ctaHref
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
    return false
  }

  // One card per open priority. A skipped or done card stays that way; only
  // its words follow a renamed priority. A card whose priority was archived
  // or deleted goes, unless the official already acted on it.
  private async syncPriorityPanelCards(
    tx: Prisma.TransactionClient,
    electedOfficeId: string,
  ): Promise<void> {
    const priorities = await tx.priority.findMany({
      where: { electedOfficeId, archivedAt: null },
      select: { id: true, title: true },
    })
    const openIds = priorities.map((priority) => priority.id)

    await tx.dashboardCard.deleteMany({
      where: {
        electedOfficeId,
        type: DashboardCardType.civic_panel,
        dismissedAt: null,
        completedAt: null,
        sourceExternalId: {
          notIn: [...openIds, civicPanelBuildCardSourceId(electedOfficeId)],
        },
      },
    })
    const existing = await tx.dashboardCard.findMany({
      where: {
        electedOfficeId,
        type: DashboardCardType.civic_panel,
        sourceExternalId: { in: openIds },
      },
      select: {
        id: true,
        sourceExternalId: true,
        title: true,
        summary: true,
        ctaLabel: true,
        ctaHref: true,
      },
    })
    const byPriority = new Map(priorities.map((p) => [p.id, p]))
    for (const card of existing) {
      const priority = byPriority.get(card.sourceExternalId)
      if (!priority) continue
      const content = civicPanelCardContent(priority)
      const stale =
        card.title !== content.title ||
        card.summary !== content.summary ||
        card.ctaLabel !== content.ctaLabel ||
        card.ctaHref !== content.ctaHref
      if (stale) {
        await tx.dashboardCard.update({
          where: { id: card.id },
          data: content,
        })
      }
    }
    const carded = new Set(existing.map((card) => card.sourceExternalId))
    const dueDate = addDays(new Date(), CIVIC_PANEL_CARD_DUE_DAYS)
    const missing = priorities.filter((priority) => !carded.has(priority.id))
    if (missing.length === 0) return
    await tx.dashboardCard.createMany({
      data: missing.map((priority) => ({
        electedOfficeId,
        type: DashboardCardType.civic_panel,
        sourceExternalId: priority.id,
        sourceItemId: null,
        ...civicPanelCardContent(priority),
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
          type: { not: DashboardCardType.civic_panel },
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
        }
    }
  }

  async dismiss(electedOfficeId: string, id: string): Promise<void> {
    await this.client.dashboardCard.updateMany({
      where: { id, electedOfficeId, dismissedAt: null, completedAt: null },
      data: { dismissedAt: new Date() },
    })
  }

  async complete(electedOfficeId: string, id: string): Promise<void> {
    await this.client.dashboardCard.updateMany({
      where: { id, electedOfficeId, dismissedAt: null, completedAt: null },
      data: { completedAt: new Date() },
    })
  }
}

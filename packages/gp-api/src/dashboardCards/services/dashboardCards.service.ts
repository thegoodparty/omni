import { Injectable } from '@nestjs/common'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { addDays, endOfWeek, startOfWeek } from 'date-fns'
import {
  CommunityIssue,
  DashboardCard,
  DashboardCardType,
  MeetingBriefing,
  Prisma,
} from '../../generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { DashboardCardBucket } from '@goodparty_org/contracts'
import {
  briefingItemHref,
  briefingOverviewHref,
} from '../util/briefingHref.util'
import { BriefingArtifactCardSourceSchema } from '../schemas/briefingArtifactCardSource.schema'

// Community issues have no natural deadline; give their cards a fixed window so
// they ride the existing active/this_week/missed bucketing off dueDate.
const COMMUNITY_ISSUE_CARD_DUE_DAYS = 7

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
  ): Promise<DashboardCard[]> {
    return this.findMany({
      where: this.bucketWhere(electedOfficeId, bucket),
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
      case 'missed':
        return {
          electedOfficeId,
          dismissedAt: null,
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
          dueDate: { gte: now },
        }
    }
  }

  async dismiss(electedOfficeId: string, id: string): Promise<void> {
    await this.client.dashboardCard.updateMany({
      where: { id, electedOfficeId, dismissedAt: null },
      data: { dismissedAt: new Date() },
    })
  }
}

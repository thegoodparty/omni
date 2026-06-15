import { Injectable } from '@nestjs/common'
import { formatInTimeZone } from 'date-fns-tz'
import { endOfWeek, parseISO, startOfWeek } from 'date-fns'
import {
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
    const electedOfficeId = briefing.electedOfficeId
    const sourceBriefingId = briefing.id

    await this.client.$transaction(async (tx) => {
      for (const card of desired) {
        await this.upsertCard(tx, electedOfficeId, sourceBriefingId, card)
      }
      await this.removeDeFeatured(
        tx,
        electedOfficeId,
        sourceBriefingId,
        desired,
      )
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
    const dueDate = briefing.meetingDate
    const dateSlug = formatInTimeZone(dueDate, 'UTC', 'yyyy-MM-dd')
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
    sourceBriefingId: string,
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
        sourceBriefingId,
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
        sourceBriefingId,
        sourceItemId: card.sourceItemId,
        ...content,
      },
    })
  }

  private async removeDeFeatured(
    tx: Prisma.TransactionClient,
    electedOfficeId: string,
    sourceBriefingId: string,
    desired: DesiredCard[],
  ): Promise<void> {
    const keepItemIds = desired
      .filter((card) => card.type === DashboardCardType.agenda_item)
      .map((card) => card.sourceItemId)
      .filter((id): id is string => id !== null)

    await tx.dashboardCard.deleteMany({
      where: {
        electedOfficeId,
        sourceBriefingId,
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
    // dueDate holds the meeting date at UTC midnight (it derives from a
    // @db.Date). Compare against the start of today in UTC so a card stays
    // active through its whole meeting day. A local-timezone startOfDay would
    // shift the boundary off the stored UTC-midnight value and drop same-day
    // cards in any timezone west of UTC.
    const today = parseISO(`${formatInTimeZone(now, 'UTC', 'yyyy-MM-dd')}T00:00:00Z`)
    switch (bucket) {
      case 'skipped':
        return { electedOfficeId, dismissedAt: { not: null } }
      case 'missed':
        return {
          electedOfficeId,
          dismissedAt: null,
          dueDate: { lt: today },
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
          dueDate: { gte: today },
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

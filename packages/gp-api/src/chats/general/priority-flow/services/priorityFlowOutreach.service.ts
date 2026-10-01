import { Injectable } from '@nestjs/common'
import { format } from 'date-fns'
import type { ChatCardKind } from '@goodparty_org/contracts'
import { Outreach, OutreachType, Prisma } from '../../../../generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'

const MAX_ROWS = 10

export interface PastOutreachRow {
  outreachId: number
  scope: 'priority' | 'office'
  audience: string
  channel: OutreachType
  status: string | null
  recipients: number | null
  sentOn: string | null
  replies: number
  // Replies over recipients, so a sample is sized on what this office's
  // texts actually bring back. Null until something has gone out.
  replyRate: number | null
}

// One resolved line per card this thread has already left. Built fresh on
// every context assembly so a card written weeks ago reads as it stands
// today, not as it stood when the model wrote it. `kind` is the card kind so
// the block widens to past_outreach and contacts cards without reshaping.
export interface PriorityAnchorSummary {
  kind: ChatCardKind
  ref: string
  line: string
}

@Injectable()
export class PriorityFlowOutreachService extends createPrismaBase(
  MODELS.Outreach,
) {
  async forPriority(
    priorityId: string,
    channel?: OutreachType,
  ): Promise<PastOutreachRow[]> {
    const rows = await this.findMany({
      where: {
        priorityId,
        ...(channel === undefined ? {} : { outreachType: channel }),
      },
      orderBy: { createdAt: Prisma.SortOrder.desc },
      take: MAX_ROWS,
    })
    return this.withReplyCounts(rows, 'priority')
  }

  async forOffice(
    organizationSlug: string,
    priorityId: string | null,
    channel?: OutreachType,
  ): Promise<PastOutreachRow[]> {
    const rows = await this.findMany({
      where: {
        organizationSlug,
        // `not` alone compiles to SQL `<>`, which drops every NULL row. Nearly
        // all outreach has no priority, so that silently emptied the list.
        ...(priorityId === null
          ? {}
          : {
              OR: [{ priorityId: { not: priorityId } }, { priorityId: null }],
            }),
        ...(channel === undefined ? {} : { outreachType: channel }),
      },
      orderBy: { createdAt: Prisma.SortOrder.desc },
      take: MAX_ROWS,
    })
    return this.withReplyCounts(rows, 'office')
  }

  async summarizeAnchors(priorityId: string): Promise<PriorityAnchorSummary[]> {
    const rows = await this.forPriority(priorityId)
    return rows.map((row) => ({
      kind: 'outreach_proposal' as const,
      ref: `outreach:${row.outreachId}`,
      line: [
        row.audience,
        row.recipients === null ? null : `${row.recipients} recipients`,
        row.sentOn === null ? `not sent yet` : `sent ${row.sentOn}`,
        `${row.replies} replies`,
      ]
        .filter((part): part is string => part !== null)
        .join(', '),
    }))
  }

  private async withReplyCounts(
    rows: Outreach[],
    scope: 'priority' | 'office',
  ): Promise<PastOutreachRow[]> {
    if (rows.length === 0) return []
    const replies = await this.client.contactInteractionText.groupBy({
      by: ['outreachId'],
      where: {
        outreachId: { in: rows.map((row) => row.id) },
        respondedAt: { not: null },
      },
      _count: { _all: true },
    })
    const repliesById = new Map(
      replies.map((group) => [group.outreachId, group._count._all]),
    )
    return rows.map((row) => {
      const recipients = row.textCount ?? row.billableTextCount
      const replies = repliesById.get(row.id) ?? 0
      return {
        outreachId: row.id,
        scope,
        audience: row.name ?? row.audienceRequest ?? 'Unnamed audience',
        channel: row.outreachType,
        status: row.status,
        recipients,
        sentOn: row.date === null ? null : format(row.date, 'd MMM'),
        replies,
        replyRate:
          recipients === null || recipients === 0
            ? null
            : Math.round((replies / recipients) * 1000) / 1000,
      }
    })
  }
}

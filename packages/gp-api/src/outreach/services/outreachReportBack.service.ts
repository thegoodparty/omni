import { Injectable } from '@nestjs/common'
import { format } from 'date-fns'
import {
  DashboardCardType,
  OutreachStatus,
  OutreachType,
  Prisma,
  SynthesisRunStatus,
  SynthesisScope,
} from '../../generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { answeredPersonIds } from '@/priorities/util/priorityRespondents.util'

// The brief's report-back window: a send's replies are in, and the official
// has two weeks to tell those people what was heard and what comes next.
export const REPORT_BACK_DUE_DAYS = 14

const MAX_THEMES = 3
const MAX_SENDS = 10

// Past checkout, the same statuses the civic panel build card reads as
// sent.
export const REPORT_BACK_UNSENT_STATUSES: OutreachStatus[] = [
  OutreachStatus.pending_payment,
  OutreachStatus.draft,
  OutreachStatus.canceled,
  OutreachStatus.denied,
  OutreachStatus.failed,
]

export interface ReportBackTheme {
  title: string
  people: number
}

export interface ReportBackSend {
  outreachId: number
  priorityId: string
  priorityTitle: string
  sentOn: string | null
  // Who the report back goes to, in the official's words: everyone who
  // answered the priority on any channel.
  audience: string
  // How many people answered the priority on any channel, each counted once,
  // and how many of them can still be texted: everyone who has not opted out
  // since. `reached` is the same people, since they are who it goes to.
  reached: number
  canReach: number
  answered: number
  themes: ReportBackTheme[]
  // The report back that went out since the priority's read status last
  // changed, if one has.
  reportBack: { outreachId: number; sentOn: string | null } | null
}

const sentOnOf = (row: {
  scheduledLocalDate: string | null
  date: Date | null
}): string | null =>
  row.scheduledLocalDate ??
  (row.date === null ? null : format(row.date, 'yyyy-MM-dd'))

export const reportBackAudience = (priorityTitle: string): string =>
  `Everyone who answered about ${priorityTitle}`

/**
 * Reporting back on a priority's text sends: which sends have their replies
 * in, who a report back on one reaches, and whether one has gone out.
 *
 * A send's replies are in once its results upload has committed (the ingest
 * moves it to completed) and no summary of those replies is still running,
 * so the agent drafts from the themes rather than from half of them. A send
 * under the summary floor never gets a run, and is in as soon as it lands.
 *
 * Only a priority's own sends are asked about, and a report back is never
 * itself one: it is linked to the send it reports on, not to the priority.
 */
@Injectable()
export class OutreachReportBackService extends createPrismaBase(
  MODELS.Outreach,
) {
  repliesInWhere(
    organizationSlug: string,
    electedOfficeId: string,
  ): Prisma.OutreachWhereInput {
    return {
      organizationSlug,
      campaignId: null,
      outreachType: OutreachType.text,
      reportBackForOutreachId: null,
      priority: { electedOfficeId, archivedAt: null },
      status: OutreachStatus.completed,
      feedbackSynthesisRuns: {
        none: {
          scope: SynthesisScope.effort,
          status: SynthesisRunStatus.running,
        },
      },
    }
  }

  // The priority a text send belongs to, which its report back answers.
  async priorityOf(
    organizationSlug: string,
    outreachId: number,
  ): Promise<string | null> {
    const row = await this.findFirst({
      where: { id: outreachId, organizationSlug, campaignId: null },
      select: { priorityId: true },
    })
    return row?.priorityId ?? null
  }

  // The report back on a priority that went out since its read status last
  // changed, which is when its card was last made. With no card yet, any
  // report back that went out counts. A new status is a new reason to tell
  // people, so it opens the way to another.
  async sentReportBack(
    organizationSlug: string,
    priorityId: string,
    excludingOutreachId?: number,
  ): Promise<{ outreachId: number; sentOn: string | null } | null> {
    const [sends, card] = await Promise.all([
      this.findMany({
        where: {
          priorityId,
          organizationSlug,
          campaignId: null,
          outreachType: OutreachType.text,
        },
        select: { id: true },
      }),
      this.client.dashboardCard.findFirst({
        where: {
          type: DashboardCardType.report_back,
          sourceExternalId: priorityId,
        },
        orderBy: { createdAt: Prisma.SortOrder.desc },
        select: { createdAt: true },
      }),
    ])
    const row = await this.findFirst({
      where: {
        reportBackForOutreachId: { in: sends.map((send) => send.id) },
        status: { notIn: REPORT_BACK_UNSENT_STATUSES },
        ...(excludingOutreachId !== undefined && {
          id: { not: excludingOutreachId },
        }),
        ...(card && { createdAt: { gte: card.createdAt } }),
      },
      orderBy: { createdAt: Prisma.SortOrder.desc },
      select: { id: true, scheduledLocalDate: true, date: true },
    })
    return row ? { outreachId: row.id, sentOn: sentOnOf(row) } : null
  }

  // The office's priorities with a text whose replies are in, newest first,
  // one entry each, optionally one priority or the priority a send belongs
  // to. The entry is anchored on the priority's latest such send.
  async listForOffice(
    organizationSlug: string,
    electedOfficeId: string,
    scope: { priorityId?: string; outreachId?: number } = {},
  ): Promise<ReportBackSend[]> {
    const rows = await this.findMany({
      where: {
        ...this.repliesInWhere(organizationSlug, electedOfficeId),
        ...(scope.priorityId === undefined
          ? {}
          : { priorityId: scope.priorityId }),
      },
      orderBy: { createdAt: Prisma.SortOrder.desc },
      select: {
        id: true,
        priorityId: true,
        scheduledLocalDate: true,
        date: true,
        priority: { select: { title: true } },
      },
    })
    const anchors = new Map<string, (typeof rows)[number]>()
    for (const row of rows) {
      if (row.priorityId !== null && !anchors.has(row.priorityId)) {
        anchors.set(row.priorityId, row)
      }
    }
    const sends = [...anchors.values()]
      .filter(
        (send) =>
          scope.outreachId === undefined || send.id === scope.outreachId,
      )
      .slice(0, MAX_SENDS)
    return Promise.all(
      sends.map(async (send) => {
        const priorityId = send.priorityId ?? ''
        const title = send.priority?.title ?? ''
        const [answered, reportBack, themes] = await Promise.all([
          answeredPersonIds(this.client, organizationSlug, priorityId),
          this.sentReportBack(organizationSlug, priorityId),
          this.topThemes(organizationSlug, priorityId),
        ])
        return {
          outreachId: send.id,
          priorityId,
          priorityTitle: title,
          sentOn: sentOnOf(send),
          audience: reportBackAudience(title),
          reached: answered.length,
          canReach: answered.length,
          answered: answered.length,
          themes,
          reportBack,
        }
      }),
    )
  }

  // The priority's top themes from its latest finished pooled summary, each
  // with how many people it covers. Titles and counts only: a report back
  // never quotes or points at anyone.
  private async topThemes(
    organizationSlug: string,
    priorityId: string,
  ): Promise<ReportBackTheme[]> {
    const run = await this.client.feedbackSynthesisRun.findFirst({
      where: {
        organizationSlug,
        priorityId,
        scope: SynthesisScope.priority,
        status: SynthesisRunStatus.completed,
      },
      orderBy: { completedAt: Prisma.SortOrder.desc },
      select: {
        themes: {
          orderBy: { rank: Prisma.SortOrder.asc },
          select: {
            title: true,
            members: {
              where: {
                OR: [
                  { feedback: { confirmedAt: { not: null } } },
                  { textReplyId: { not: null } },
                ],
              },
              select: {
                feedback: { select: { personId: true } },
                textReply: { select: { personId: true } },
              },
            },
          },
        },
      },
    })
    return (run?.themes ?? [])
      .map((theme) => ({
        title: theme.title,
        people: new Set(
          theme.members.flatMap((member) => {
            const personId =
              member.feedback?.personId ?? member.textReply?.personId
            return personId === undefined ? [] : [personId]
          }),
        ).size,
      }))
      .filter((theme) => theme.people > 0)
      .slice(0, MAX_THEMES)
  }
}

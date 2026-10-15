import { Injectable } from '@nestjs/common'
import { format, parseISO } from 'date-fns'
import {
  OutreachStatus,
  OutreachType,
  Prisma,
  SynthesisRunStatus,
  SynthesisScope,
} from '../../generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'

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
  // Who the report back goes to, in the official's words.
  audience: string
  // How many people the send reached, and how many of them can still be
  // texted: everyone who has not opted out since.
  reached: number
  canReach: number
  answered: number
  themes: ReportBackTheme[]
  // The report back that went out on this send, if one has.
  reportBack: { outreachId: number; sentOn: string | null } | null
}

const sentOnOf = (row: {
  scheduledLocalDate: string | null
  date: Date | null
}): string | null =>
  row.scheduledLocalDate ??
  (row.date === null ? null : format(row.date, 'yyyy-MM-dd'))

export const reportBackAudience = (
  priorityTitle: string,
  sentOn: string | null,
): string =>
  sentOn === null
    ? `Everyone you texted about ${priorityTitle}`
    : `Everyone you texted about ${priorityTitle} on ${format(parseISO(sentOn), 'MMMM d')}`

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

  // Report backs that have gone out, keyed by the send they report on.
  async sentReportBacks(
    outreachIds: number[],
  ): Promise<Map<number, { outreachId: number; sentOn: string | null }>> {
    if (outreachIds.length === 0) return new Map()
    const rows = await this.findMany({
      where: {
        reportBackForOutreachId: { in: outreachIds },
        status: { notIn: REPORT_BACK_UNSENT_STATUSES },
      },
      orderBy: { createdAt: Prisma.SortOrder.asc },
      select: {
        id: true,
        reportBackForOutreachId: true,
        scheduledLocalDate: true,
        date: true,
      },
    })
    return new Map(
      rows.flatMap((row) =>
        row.reportBackForOutreachId === null
          ? []
          : [
              [
                row.reportBackForOutreachId,
                { outreachId: row.id, sentOn: sentOnOf(row) },
              ] as const,
            ],
      ),
    )
  }

  // The office's sends whose replies are in, newest first, optionally on
  // one priority or one send.
  async listForOffice(
    organizationSlug: string,
    electedOfficeId: string,
    scope: { priorityId?: string; outreachId?: number } = {},
  ): Promise<ReportBackSend[]> {
    const sends = await this.findMany({
      where: {
        ...this.repliesInWhere(organizationSlug, electedOfficeId),
        ...(scope.priorityId === undefined
          ? {}
          : { priorityId: scope.priorityId }),
        ...(scope.outreachId === undefined ? {} : { id: scope.outreachId }),
      },
      orderBy: { createdAt: Prisma.SortOrder.desc },
      take: MAX_SENDS,
      select: {
        id: true,
        priorityId: true,
        scheduledLocalDate: true,
        date: true,
        priority: { select: { title: true } },
      },
    })
    const ids = sends.map((send) => send.id)
    const reportBacks = await this.sentReportBacks(ids)
    return Promise.all(
      sends.map(async (send) => {
        const sentOn = sentOnOf(send)
        const title = send.priority?.title ?? ''
        const [reached, canReach, answered, themes] = await Promise.all([
          this.client.outreachTextRecipient.count({
            where: { outreachId: send.id, organizationSlug },
          }),
          this.countAudience(organizationSlug, send.id),
          this.client.contactInteractionText.count({
            where: {
              outreachId: send.id,
              respondedAt: { not: null },
              optedOutAt: null,
            },
          }),
          this.topThemes(send.id),
        ])
        return {
          outreachId: send.id,
          priorityId: send.priorityId ?? '',
          priorityTitle: title,
          sentOn,
          audience: reportBackAudience(title, sentOn),
          reached,
          canReach,
          answered,
          themes,
          reportBack: reportBacks.get(send.id) ?? null,
        }
      }),
    )
  }

  // Everyone the send reached who has not opted out of the office's texts
  // since. The recipient rows are who the delivery layer actually handed the
  // text to, so this is the send's real audience, not its list re-read. The
  // list a report back saves freezes the same people
  // (VoterFileFilterSampleService.personIdsReachedBy).
  async countAudience(
    organizationSlug: string,
    outreachId: number,
  ): Promise<number> {
    const [row] = await this.client.$queryRaw<{ count: bigint }[]>(
      Prisma.sql`
        SELECT COUNT(*) AS count
        FROM outreach_text_recipient r
        WHERE r.outreach_id = ${outreachId}
        AND r.organization_slug = ${organizationSlug}
        AND NOT EXISTS (
          SELECT 1 FROM contact_interaction_text t
          WHERE t.organization_slug = r.organization_slug
          AND t.person_id = r.person_id
          AND t.opted_out_at IS NOT NULL
        )
      `,
    )
    return Number(row?.count ?? 0)
  }

  // The send's top themes from its latest finished summary, each with how
  // many people it covers. Titles and counts only: a report back never
  // quotes or points at anyone.
  private async topThemes(outreachId: number): Promise<ReportBackTheme[]> {
    const run = await this.client.feedbackSynthesisRun.findFirst({
      where: {
        outreachId,
        scope: SynthesisScope.effort,
        status: SynthesisRunStatus.completed,
      },
      orderBy: { completedAt: Prisma.SortOrder.desc },
      select: {
        themes: {
          orderBy: { rank: Prisma.SortOrder.asc },
          select: {
            title: true,
            members: {
              where: { textReplyId: { not: null } },
              select: { textReply: { select: { personId: true } } },
            },
          },
        },
      },
    })
    return (run?.themes ?? [])
      .map((theme) => ({
        title: theme.title,
        people: new Set(
          theme.members.flatMap((member) =>
            member.textReply ? [member.textReply.personId] : [],
          ),
        ).size,
      }))
      .filter((theme) => theme.people > 0)
      .slice(0, MAX_THEMES)
  }
}

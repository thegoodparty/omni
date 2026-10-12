import { Injectable, StreamableFile } from '@nestjs/common'
import {
  ConstituentFeedbackChannel,
  ConstituentFeedbackStance,
  Prisma,
  SynthesisRunStatus,
} from '@/generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { FeedbackReportService } from './feedbackReport.service'

const CHANNEL_LABELS: Record<ConstituentFeedbackChannel, string> = {
  [ConstituentFeedbackChannel.door_knock]: 'At the door',
  [ConstituentFeedbackChannel.phone_bank]: 'On the phone',
}

// The report card's own words for a stance (feedbackReport.service.ts's
// summarize()), so a staffer reading the export sees the same vocabulary as
// the page. An issue with no stance is unclear there too.
const STANCE_LABELS: Record<ConstituentFeedbackStance, string> = {
  [ConstituentFeedbackStance.supports]: 'For it',
  [ConstituentFeedbackStance.opposes]: 'Against it',
  [ConstituentFeedbackStance.mixed]: 'Mixed',
  [ConstituentFeedbackStance.unclear]: 'Unclear',
}

const CSV_HEADER = [
  'Date',
  'Recorded by',
  'Source',
  'Status',
  'Note',
  'Issues',
  'Stance',
  'Wants',
  'Theme',
]

// Every cell is quoted, embedded quotes doubled (RFC 4180), the same rule
// `pipelineSynthesisEngine.ts` writes to S3 with. Unlike that file, this one
// IS opened in Excel/Sheets by a staffer, so a cell starting with =, +, - or
// @ is also prefixed with a quote to stop it executing as a formula — a
// memo's transcript or an issue's wording is free text a canvasser typed or
// dictated, the same risk `pollResponsesDownload.service.ts` guards against.
const csvCell = (value: string): string => {
  const guarded = /^[=+\-@]/.test(value) ? `'${value}` : value
  return `"${guarded.replace(/"/g, '""')}"`
}

const actorName = (actor: {
  firstName: string | null
  lastName: string | null
}): string | null => {
  const name = [actor.firstName, actor.lastName]
    .filter((part) => part !== null && part !== '')
    .join(' ')
  return name === '' ? null : name
}

const MEMO_SELECT = {
  id: true,
  occurredAt: true,
  channel: true,
  transcript: true,
  confirmedAt: true,
  actor: { select: { firstName: true, lastName: true } },
  issues: {
    orderBy: { position: Prisma.SortOrder.asc },
    select: { issueLabel: true, stance: true, desiredOutcome: true },
  },
} as const satisfies Prisma.ConstituentFeedbackSelect

type ExportMemo = Prisma.ConstituentFeedbackGetPayload<{
  select: typeof MEMO_SELECT
}>

// The export file name is built from the effort's own name, never from
// voter-file data, so it reads like the turf or list a user already knows
// rather than a database id on its own.
const sanitizeFileName = (value: string): string =>
  value.replace(/[^a-zA-Z0-9 _-]/g, '').trim()

@Injectable()
export class FeedbackNotesExportService extends createPrismaBase(
  MODELS.ConstituentFeedback,
) {
  constructor(private readonly reports: FeedbackReportService) {
    super()
  }

  // Every note on the effort, confirmed or pending, newest first — not the
  // report's 200-note display cap, since the whole point of a download is
  // the notes the page cannot list. Access is the report's own check:
  // findEffort 404s an outreach this org does not hold, before any row is
  // read.
  async buildNotesCsv(input: {
    organizationSlug: string
    outreachId: number
  }): Promise<StreamableFile> {
    const { organizationSlug, outreachId } = input
    const effort = await this.reports.findEffort(organizationSlug, outreachId)

    const [memos, completedRun] = await Promise.all([
      this.client.constituentFeedback.findMany({
        where: { organizationSlug, outreachId: effort.id },
        orderBy: { occurredAt: Prisma.SortOrder.desc },
        select: MEMO_SELECT,
      }),
      this.client.feedbackSynthesisRun.findFirst({
        where: {
          organizationSlug,
          outreachId: effort.id,
          status: SynthesisRunStatus.completed,
        },
        orderBy: { completedAt: Prisma.SortOrder.desc },
        select: { id: true },
      }),
    ])

    const themeTitlesByFeedbackId = completedRun
      ? await this.themeTitlesByFeedbackId(completedRun.id)
      : new Map<string, string[]>()

    const rows = memos.map((memo) =>
      this.toRow(memo, themeTitlesByFeedbackId.get(memo.id) ?? []),
    )
    const csv =
      [CSV_HEADER, ...rows]
        .map((row) => row.map(csvCell).join(','))
        .join('\r\n') + '\r\n'
    const body = Buffer.from(csv, 'utf-8')

    const name = sanitizeFileName(effort.name ?? '') || 'issue-capture-notes'
    return new StreamableFile(body, {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${name}-${effort.id}-notes.csv"`,
      length: body.length,
    })
  }

  // Only confirmed members, the same rule the report's cards count by: a
  // memo re-recorded after the run loses its confirmation and the export
  // should stop crediting it to a theme it no longer vouches for.
  private async themeTitlesByFeedbackId(
    runId: string,
  ): Promise<Map<string, string[]>> {
    const themes = await this.client.feedbackTheme.findMany({
      where: { runId },
      select: {
        title: true,
        members: {
          where: { feedback: { confirmedAt: { not: null } } },
          select: { feedbackId: true },
        },
      },
    })
    const byFeedbackId = new Map<string, string[]>()
    for (const theme of themes) {
      for (const member of theme.members) {
        const titles = byFeedbackId.get(member.feedbackId) ?? []
        titles.push(theme.title)
        byFeedbackId.set(member.feedbackId, titles)
      }
    }
    return byFeedbackId
  }

  private toRow(memo: ExportMemo, themeTitles: string[]): string[] {
    const issues = memo.issues
    return [
      memo.occurredAt.toISOString(),
      actorName(memo.actor) ?? '',
      CHANNEL_LABELS[memo.channel],
      memo.confirmedAt === null ? 'Not yet reviewed' : 'Confirmed',
      memo.transcript ?? '',
      issues.map((issue) => issue.issueLabel).join('; '),
      issues
        .map((issue) =>
          issue.stance === null ? 'Unclear' : STANCE_LABELS[issue.stance],
        )
        .join('; '),
      issues.map((issue) => issue.desiredOutcome ?? '').join('; '),
      themeTitles.join('; '),
    ]
  }
}

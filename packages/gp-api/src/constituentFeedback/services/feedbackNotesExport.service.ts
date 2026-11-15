import { Injectable, StreamableFile } from '@nestjs/common'
import {
  ConstituentFeedbackChannel,
  ConstituentFeedbackStance,
  PollIndividualMessageSender,
  Prisma,
  SynthesisRunStatus,
} from '@/generated/prisma'
import { OutreachSmsRepliesService } from '@/outreach/services/outreachSmsReplies.service'
import { INERT_NUMERIC } from '@/shared/util/csv.util'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import {
  FeedbackReportService,
  isTextEffortType,
} from './feedbackReport.service'

const CHANNEL_LABELS: Record<ConstituentFeedbackChannel, string> = {
  [ConstituentFeedbackChannel.door_knock]: 'At the door',
  [ConstituentFeedbackChannel.phone_bank]: 'On the phone',
  [ConstituentFeedbackChannel.text]: 'By text',
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

// people-api's id filter is a guid column; a personId that is not one cannot
// match, and sending it would fail the whole page's validation.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const TEXT_CSV_HEADER = [
  'Name',
  'Phone',
  'Texted at',
  'Replied',
  'Reply text',
  'Opted out',
]

// One page of recipients per read, so a large send is never held as one
// unbounded findMany or one unbounded people-api id list (docs/scale.md).
const RECIPIENT_PAGE_SIZE = 1000

// Every cell is quoted, embedded quotes doubled (RFC 4180), the same rule
// `pipelineSynthesisEngine.ts` writes to S3 with. Unlike that file, this one
// IS opened in Excel/Sheets by a staffer, so a cell starting with =, +, - or
// @ is also prefixed with a quote to stop it executing as a formula — a
// memo's transcript or an issue's wording is free text a canvasser typed or
// dictated, the same risk `pollResponsesDownload.service.ts` guards against.
export const csvCell = (value: string): string => {
  const guarded = /^[=+\-@]/.test(value) ? `'${value}` : value
  return `"${guarded.replace(/"/g, '""')}"`
}

const phoneCell = (phone: string): string =>
  INERT_NUMERIC.test(phone) ? `"${phone}"` : csvCell(phone)

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
  constructor(
    private readonly reports: FeedbackReportService,
    private readonly replies: OutreachSmsRepliesService,
  ) {
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
    if (isTextEffortType(effort.outreachType)) {
      return this.buildTextRecipientsCsv(organizationSlug, effort)
    }

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

  // A text send's export is one row per person texted, not per note: a
  // ContactInteractionText exists for every recipient from launch, so people
  // who never replied are rows too. Replies come from PollIndividualMessage,
  // opt-out replies included, in time order in one cell.
  private async buildTextRecipientsCsv(
    organizationSlug: string,
    effort: { id: number; name: string | null },
  ): Promise<StreamableFile> {
    const lines: string[] = [TEXT_CSV_HEADER.map(csvCell).join(',')]
    let afterId: string | undefined

    for (;;) {
      const recipients = await this.client.contactInteractionText.findMany({
        where: { organizationSlug, outreachId: effort.id },
        orderBy: { id: Prisma.SortOrder.asc },
        take: RECIPIENT_PAGE_SIZE,
        ...(afterId === undefined ? {} : { cursor: { id: afterId }, skip: 1 }),
        select: {
          id: true,
          personId: true,
          occurredAt: true,
          respondedAt: true,
          optedOutAt: true,
        },
      })
      if (recipients.length === 0) break
      afterId = recipients[recipients.length - 1]!.id

      const personIds = recipients.map((recipient) => recipient.personId)
      const [replyRows, identities] = await Promise.all([
        this.client.pollIndividualMessage.findMany({
          where: {
            outreachId: effort.id,
            sender: PollIndividualMessageSender.CONSTITUENT,
            personId: { in: personIds },
          },
          orderBy: [
            { sentAt: Prisma.SortOrder.asc },
            { id: Prisma.SortOrder.asc },
          ],
          select: { personId: true, personCellPhone: true, content: true },
        }),
        this.replies.fetchIdentities(
          organizationSlug,
          personIds.filter((id) => UUID_RE.test(id)),
        ),
      ])
      const repliesByPerson = new Map<
        string,
        { phone: string | null; contents: string[] }
      >()
      for (const reply of replyRows) {
        const entry = repliesByPerson.get(reply.personId) ?? {
          phone: reply.personCellPhone,
          contents: [],
        }
        if (reply.content !== null && reply.content.trim() !== '') {
          entry.contents.push(reply.content)
        }
        repliesByPerson.set(reply.personId, entry)
      }

      for (const recipient of recipients) {
        const identity = identities.get(recipient.personId)
        const replied = repliesByPerson.get(recipient.personId)
        const name = [identity?.firstName, identity?.lastName]
          .filter((part) => part !== null && part !== undefined && part !== '')
          .join(' ')
        lines.push(
          [
            name,
            phoneCell(identity?.phone ?? replied?.phone ?? ''),
            recipient.occurredAt.toISOString(),
            replied !== undefined || recipient.respondedAt !== null
              ? 'Yes'
              : 'No',
            replied?.contents.join('\n') ?? '',
            recipient.optedOutAt === null ? 'No' : 'Yes',
          ]
            .map((cell, index) => (index === 1 ? cell : csvCell(cell)))
            .join(','),
        )
      }
      if (recipients.length < RECIPIENT_PAGE_SIZE) break
    }

    const body = Buffer.from(lines.join('\r\n') + '\r\n', 'utf-8')
    const name = sanitizeFileName(effort.name ?? '') || 'text-responses'
    return new StreamableFile(body, {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${name}-${effort.id}-responses.csv"`,
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
        if (member.feedbackId === null) continue
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

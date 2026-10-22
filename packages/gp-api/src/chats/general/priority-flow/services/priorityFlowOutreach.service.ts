import { Injectable } from '@nestjs/common'
import { formatInTimeZone } from 'date-fns-tz'
import { outreachHasGoneOut, type ChatCardKind } from '@goodparty_org/contracts'
import {
  Outreach,
  OutreachStatus,
  OutreachType,
  PollIndividualMessageSender,
  Prisma,
  SynthesisRunStatus,
  SynthesisScope,
} from '../../../../generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'

const MAX_ROWS = 10
// Enough of what people said for the model to quote and weigh it without
// one big send crowding the rest of the turn out of its context.
const MAX_VERBATIMS_PER_SEND = 60
const MAX_VERBATIM_CHARS = 500
const RECENT_SENDS_WITHOUT_SCOPE = 5
const UNSENT_STATUSES: OutreachStatus[] = [
  OutreachStatus.pending_payment,
  OutreachStatus.draft,
  OutreachStatus.canceled,
]
// The sends a note can be taken on. A Win text's replies come back as
// timestamps, never words, so on a campaign it has nothing to read and would
// read as nobody answering.
const NOTE_CHANNELS: OutreachType[] = [
  OutreachType.nativeDoorKnocking,
  OutreachType.nativePhoneBanking,
]
// The model names a channel by whichever value reads right to it, usually
// the legacy one, while walks and call lists are stored under the native
// one. Filtering on the exact value dropped every native walk.
const CHANNEL_FAMILIES: OutreachType[][] = [
  [OutreachType.doorKnocking, OutreachType.nativeDoorKnocking],
  [OutreachType.phoneBanking, OutreachType.nativePhoneBanking],
]

export interface PastOutreachRow {
  outreachId: number
  scope: 'priority' | 'office'
  audience: string
  channel: OutreachType
  status: string | null
  // yyyy-MM-dd. scheduledFor is the day it is set to go out; sentOn is that
  // day once it has gone, and null until then.
  scheduledFor: string | null
  sentOn: string | null
  recipients: number | null
  replies: number
  // Replies over recipients, so a sample is sized on what this office's
  // texts actually bring back. Null until something has gone out.
  replyRate: number | null
}

export interface OutreachVerbatim {
  said: string
  // A door or call note is a volunteer's account the official may not have
  // reviewed yet; a text reply is the constituent's own words.
  source: 'text_reply' | 'door_note' | 'call_note'
  confirmed: boolean
  issues: { issue: string; stance: string | null }[]
}

export interface OutreachFeedback {
  outreachId: number
  audience: string
  channel: OutreachType
  scheduledFor: string | null
  sentOn: string | null
  heardFrom: number
  verbatims: OutreachVerbatim[]
  verbatimsLeftOut: number
  themes: { title: string; summary: string; people: number }[]
}

export interface PooledTheme {
  title: string
  summary: string
  people: number
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
  // `timeZone` is the reader's zone, the one their date line is in, so a send
  // is never read as out before that line's day reaches it.
  async forPriority(
    priorityId: string,
    timeZone: string,
    channel?: OutreachType,
  ): Promise<PastOutreachRow[]> {
    const rows = await this.findMany({
      where: {
        priorityId,
        ...channelWhere(channel),
      },
      orderBy: { createdAt: Prisma.SortOrder.desc },
      take: MAX_ROWS,
    })
    return this.withReplyCounts(rows, 'priority', timeZone)
  }

  async forOffice(
    organizationSlug: string,
    priorityId: string | null,
    timeZone: string,
    channel?: OutreachType,
  ): Promise<PastOutreachRow[]> {
    const rows = await this.findMany({
      where: {
        organizationSlug,
        // An org can hold a Campaign and an ElectedOffice at once, and a
        // Win row carries the slug too; only campaignId null is the office's.
        campaignId: null,
        // `not` alone compiles to SQL `<>`, which drops every NULL row. Nearly
        // all outreach has no priority, so that silently emptied the list.
        ...(priorityId === null
          ? {}
          : {
              OR: [{ priorityId: { not: priorityId } }, { priorityId: null }],
            }),
        ...channelWhere(channel),
      },
      orderBy: { createdAt: Prisma.SortOrder.desc },
      take: MAX_ROWS,
    })
    return this.withReplyCounts(rows, 'office', timeZone)
  }

  // A campaign's sends, by campaignId: an org can hold a Campaign and an
  // ElectedOffice at once, so its slug alone would mix in the office's sends.
  async forCampaign(
    campaignId: number,
    timeZone: string,
    channel?: OutreachType,
  ): Promise<PastOutreachRow[]> {
    const rows = await this.findMany({
      where: {
        campaignId,
        ...channelWhere(channel),
      },
      orderBy: { createdAt: Prisma.SortOrder.desc },
      take: MAX_ROWS,
    })
    return this.withReplyCounts(rows, 'office', timeZone)
  }

  // Whether every one of these sends put out this side of this priority's
  // check. Only then is a proposal for that side a wider sample of the same
  // ask rather than the same people asked twice.
  async allPutOutCheck(
    priorityId: string,
    stepId: string,
    // Null takes a send that put out either side of the step's check.
    side: string | null,
    outreachIds: number[],
  ): Promise<boolean> {
    const ids = [...new Set(outreachIds)]
    if (ids.length === 0) return false
    const matching = await this.count({
      where: {
        id: { in: ids },
        priorityId,
        priorityStepId: stepId,
        ...(side === null
          ? { priorityCheckSide: { not: null } }
          : { priorityCheckSide: side }),
      },
    })
    return matching === ids.length
  }

  async summarizeAnchors(
    priorityId: string,
    timeZone: string,
  ): Promise<PriorityAnchorSummary[]> {
    const rows = await this.forPriority(priorityId, timeZone)
    return rows.map((row) => ({
      kind: 'outreach_proposal' as const,
      ref: `outreach:${row.outreachId}`,
      line: [
        row.audience,
        row.recipients === null ? null : `${row.recipients} recipients`,
        row.sentOn !== null
          ? `sent ${row.sentOn}`
          : row.scheduledFor === null
            ? 'not sent yet'
            : `scheduled for ${row.scheduledFor}, not sent yet`,
        `${row.replies} replies`,
      ]
        .filter((part): part is string => part !== null)
        .join(', '),
    }))
  }

  // What a send brought back in people's own words, plus the themes the
  // latest finished synthesis found in it. Scoped to the office's own sends
  // (campaignId null) so a Win row on the same org never leaks in.
  async feedbackFor(
    organizationSlug: string,
    scope: { priorityId?: string | null; outreachId?: number },
    timeZone: string,
  ): Promise<OutreachFeedback[]> {
    const rows = await this.findMany({
      where: {
        organizationSlug,
        campaignId: null,
        status: { notIn: UNSENT_STATUSES },
        ...(scope.outreachId === undefined ? {} : { id: scope.outreachId }),
        ...(scope.priorityId ? { priorityId: scope.priorityId } : {}),
      },
      orderBy: { createdAt: Prisma.SortOrder.desc },
      take:
        scope.outreachId === undefined && !scope.priorityId
          ? RECENT_SENDS_WITHOUT_SCOPE
          : MAX_ROWS,
    })
    return Promise.all(rows.map((row) => this.feedbackForSend(row, timeZone)))
  }

  // A campaign's door and call notes, by campaignId like forCampaign.
  async feedbackForCampaign(
    campaignId: number,
    timeZone: string,
    outreachId?: number,
  ): Promise<OutreachFeedback[]> {
    const rows = await this.findMany({
      where: {
        campaignId,
        outreachType: { in: NOTE_CHANNELS },
        status: { notIn: UNSENT_STATUSES },
        ...(outreachId === undefined ? {} : { id: outreachId }),
      },
      orderBy: { createdAt: Prisma.SortOrder.desc },
      take: RECENT_SENDS_WITHOUT_SCOPE,
    })
    return Promise.all(rows.map((row) => this.feedbackForSend(row, timeZone)))
  }

  private async feedbackForSend(
    row: Outreach,
    timeZone: string,
  ): Promise<OutreachFeedback> {
    const verbatims =
      row.outreachType === OutreachType.text
        ? await this.textReplies(row.id)
        : await this.capturedNotes(row.id)
    const run = await this.client.feedbackSynthesisRun.findFirst({
      where: {
        outreachId: row.id,
        scope: SynthesisScope.effort,
        status: SynthesisRunStatus.completed,
      },
      orderBy: { completedAt: Prisma.SortOrder.desc },
      select: {
        themes: {
          orderBy: { rank: Prisma.SortOrder.asc },
          select: {
            title: true,
            summary: true,
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
    return {
      outreachId: row.id,
      audience: row.name ?? row.audienceRequest ?? 'Unnamed audience',
      channel: row.outreachType,
      ...sendDays(row, timeZone),
      heardFrom: verbatims.length,
      verbatims: verbatims.slice(0, MAX_VERBATIMS_PER_SEND),
      verbatimsLeftOut: Math.max(0, verbatims.length - MAX_VERBATIMS_PER_SEND),
      themes: themesWithPeople(run?.themes ?? []),
    }
  }

  // The themes across every send for the priority, from its latest finished
  // pooled run. Empty until one has run.
  async pooledThemes(
    organizationSlug: string,
    priorityId: string,
  ): Promise<PooledTheme[]> {
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
            summary: true,
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
    return themesWithPeople(run?.themes ?? [])
  }

  // One entry per person, their messages joined in order. A reply that was
  // only an opt-out is not an answer, so it is left out.
  private async textReplies(outreachId: number): Promise<OutreachVerbatim[]> {
    const messages = await this.client.pollIndividualMessage.findMany({
      where: {
        outreachId,
        sender: PollIndividualMessageSender.CONSTITUENT,
        NOT: { isOptOut: true },
      },
      orderBy: { sentAt: Prisma.SortOrder.asc },
      select: { personId: true, content: true },
    })
    const byPerson = new Map<string, string[]>()
    for (const { personId, content } of messages) {
      const text = content?.trim() ?? ''
      if (text === '') continue
      byPerson.set(personId, [...(byPerson.get(personId) ?? []), text])
    }
    return [...byPerson.values()].map((said) => ({
      said: clip(said.join(' / ')),
      source: 'text_reply' as const,
      confirmed: true,
      issues: [],
    }))
  }

  private async capturedNotes(outreachId: number): Promise<OutreachVerbatim[]> {
    const notes = await this.client.constituentFeedback.findMany({
      where: { outreachId, transcript: { not: null } },
      orderBy: { occurredAt: Prisma.SortOrder.asc },
      select: {
        transcript: true,
        channel: true,
        confirmedAt: true,
        issues: {
          orderBy: { position: Prisma.SortOrder.asc },
          select: { issueLabel: true, stance: true },
        },
      },
    })
    return notes.flatMap((note) => {
      const text = note.transcript?.trim() ?? ''
      if (text === '') return []
      return [
        {
          said: clip(text),
          source:
            note.channel === 'door_knock'
              ? ('door_note' as const)
              : ('call_note' as const),
          confirmed: note.confirmedAt !== null,
          issues: note.issues.map((issue) => ({
            issue: issue.issueLabel,
            stance: issue.stance,
          })),
        },
      ]
    })
  }

  private async withReplyCounts(
    rows: Outreach[],
    scope: 'priority' | 'office',
    timeZone: string,
  ): Promise<PastOutreachRow[]> {
    if (rows.length === 0) return []
    const replies = await this.client.contactInteractionText.groupBy({
      by: ['outreachId'],
      where: {
        outreachId: { in: rows.map((row) => row.id) },
        respondedAt: { not: null },
        // A STOP is an opt-out, not something the person told the office.
        optedOutAt: null,
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
        ...sendDays(row, timeZone),
        recipients,
        replies,
        replyRate:
          recipients === null || recipients === 0
            ? null
            : Math.round((replies / recipients) * 1000) / 1000,
      }
    })
  }
}

const channelWhere = (channel?: OutreachType): Prisma.OutreachWhereInput =>
  channel === undefined
    ? {}
    : {
        outreachType: {
          in: CHANNEL_FAMILIES.find((family) => family.includes(channel)) ?? [
            channel,
          ],
        },
      }

// A Serve text has no `date`: it goes out at a fixed local hour on
// scheduledLocalDate, so that day is when it went once it has gone. Full
// yyyy-MM-dd, never a bare "27 Oct", so the model cannot misplace the year.
const sendDays = (
  row: Outreach,
  timeZone: string,
): { scheduledFor: string | null; sentOn: string | null } => {
  // Both days in the office's zone: the server runs on UTC, which is already
  // tomorrow for part of every US evening.
  const scheduledFor =
    row.scheduledLocalDate ??
    (row.date === null
      ? null
      : formatInTimeZone(row.date, timeZone, 'yyyy-MM-dd'))
  const today = formatInTimeZone(new Date(), timeZone, 'yyyy-MM-dd')
  return {
    scheduledFor,
    sentOn: outreachHasGoneOut({ status: row.status, scheduledFor }, today)
      ? scheduledFor
      : null,
  }
}

// The one rule for how many people a theme covers, shared by a send's
// themes, the priority's pooled themes and the results page
// (PriorityResultsService): confirmed notes and text replies, someone heard
// twice counted once. A theme nobody counts toward is left out.
type ThemeRow = {
  title: string
  summary: string
  members: {
    feedback: { personId: string } | null
    textReply: { personId: string } | null
  }[]
}

const themesWithPeople = (themes: ThemeRow[]): PooledTheme[] =>
  themes.flatMap((theme) => {
    const people = new Set(
      theme.members.flatMap((member) => {
        const personId = member.feedback?.personId ?? member.textReply?.personId
        return personId === undefined ? [] : [personId]
      }),
    ).size
    return people === 0
      ? []
      : [{ title: theme.title, summary: theme.summary, people }]
  })

const clip = (text: string): string =>
  text.length <= MAX_VERBATIM_CHARS
    ? text
    : `${text.slice(0, MAX_VERBATIM_CHARS - 1)}…`

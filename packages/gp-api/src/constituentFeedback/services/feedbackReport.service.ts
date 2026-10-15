import { Injectable, NotFoundException } from '@nestjs/common'
import {
  FEEDBACK_REPORT_MEMO_LIMIT,
  type FeedbackReportChannel,
  type FeedbackReportMemo,
  type FeedbackReportResponse,
  type FeedbackThemeDetail,
  type FeedbackThemeMember,
  type FeedbackThemeSummary,
  type SynthesisRun,
} from '@goodparty_org/contracts'
import {
  ConstituentFeedbackChannel,
  ConstituentFeedbackStance,
  DoorKnockOutcome,
  type FeedbackSynthesisRun,
  OutreachType,
  PhoneBankCallOutcome,
  PollIndividualMessageSender,
  Prisma,
  SynthesisRunStatus,
} from '@/generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'

// Provisional, until dev runs at 20, 40 and 80 memos show where grouping
// stops splintering. Under it the report lists the memos instead of themes:
// a percentage over two conversations is the misleading number the report
// exists to avoid. Declared here, not beside the synthesis that enforces it,
// because that service already imports this one.
export const MIN_CONFIRMED_FOR_SYNTHESIS = 5

// The report card shows a few asks; the theme page shows them all.
const REPORT_OUTCOME_LIMIT = 5

export const TEXT_CHANNEL: FeedbackReportChannel = 'text'

// A member counts while its memo is confirmed now; a reply has no review
// step and counts from the moment it lands.
const COUNTED_MEMBERS = {
  where: {
    OR: [
      { feedback: { confirmedAt: { not: null } } },
      { textReplyId: { not: null } },
    ],
  } satisfies Prisma.FeedbackThemeMemberWhereInput,
}

const ISSUE_SELECT = {
  orderBy: { position: Prisma.SortOrder.asc },
  select: {
    id: true,
    position: true,
    issueLabel: true,
    stance: true,
    desiredOutcome: true,
  },
} as const satisfies Prisma.ConstituentFeedbackIssueFindManyArgs

const TAG_SELECT = {
  select: { id: true, name: true, status: true },
} as const satisfies Prisma.IssueTagDefaultArgs

// Whether the run matched issues to themes, and which of its member
// issues this theme was given.
const ISSUE_MATCH_INCLUDE = {
  run: { select: { issuesMatchedAt: true } },
  issues: { select: { issueId: true } },
} as const satisfies Prisma.FeedbackThemeInclude

const THEME_INCLUDE = {
  ...ISSUE_MATCH_INCLUDE,
  tag: TAG_SELECT,
  members: {
    ...COUNTED_MEMBERS,
    select: {
      textReplyId: true,
      feedback: { select: { issues: ISSUE_SELECT } },
    },
  },
} as const satisfies Prisma.FeedbackThemeInclude

const REPLY_SELECT = {
  id: true,
  personId: true,
  sentAt: true,
  content: true,
} as const satisfies Prisma.PollIndividualMessageSelect

const THEME_DETAIL_INCLUDE = {
  ...ISSUE_MATCH_INCLUDE,
  tag: TAG_SELECT,
  members: {
    ...COUNTED_MEMBERS,
    select: {
      textReplyId: true,
      feedback: {
        select: {
          id: true,
          personId: true,
          occurredAt: true,
          channel: true,
          transcript: true,
          issues: ISSUE_SELECT,
          actor: { select: { firstName: true, lastName: true } },
        },
      },
      textReply: { select: REPLY_SELECT },
    },
  },
} as const satisfies Prisma.FeedbackThemeInclude

const MEMO_SELECT = {
  id: true,
  personId: true,
  occurredAt: true,
  channel: true,
  transcript: true,
  issues: ISSUE_SELECT,
  confirmedAt: true,
  actor: { select: { firstName: true, lastName: true } },
} as const satisfies Prisma.ConstituentFeedbackSelect

const actorName = (actor: {
  firstName: string | null
  lastName: string | null
}): string | null => {
  const name = [actor.firstName, actor.lastName]
    .filter((part) => part !== null && part !== '')
    .join(' ')
  return name === '' ? null : name
}

type ThemeRow = Prisma.FeedbackThemeGetPayload<{
  include: typeof THEME_INCLUDE
}>

type ReplyRow = Prisma.PollIndividualMessageGetPayload<{
  select: typeof REPLY_SELECT
}>

export type Effort = Awaited<ReturnType<FeedbackReportService['findEffort']>>

export type Denominators = FeedbackReportResponse['denominators']

// A Serve poll is a text send, so its replies take the text path.
const isTextEffortType = (outreachType: OutreachType): boolean =>
  outreachType === OutreachType.text || outreachType === OutreachType.poll

export const effortChannel = (effort: Effort): FeedbackReportChannel => {
  if (isTextEffortType(effort.outreachType)) return TEXT_CHANNEL
  return effort.phoneBankingListId === null
    ? ConstituentFeedbackChannel.door_knock
    : ConstituentFeedbackChannel.phone_bank
}

// A reply enters the report only when a constituent said something: an
// opt-out is a request, not an opinion, and an empty body is nothing to
// group. One predicate for the floor, the run's input and the denominators,
// so none of the three can disagree.
export const textRepliesWhere = (
  outreachId: number,
): Prisma.PollIndividualMessageWhereInput => ({
  outreachId,
  sender: PollIndividualMessageSender.CONSTITUENT,
  OR: [{ isOptOut: false }, { isOptOut: null }],
  content: { not: null },
})

export const hasWords = <T extends { content: string | null }>(
  reply: T,
): reply is T & { content: string } =>
  reply.content !== null && reply.content.trim() !== ''

// A reply in the report's own shape: what the constituent wrote, by text,
// named no issue and nobody took it down. Never the number it came from.
const replyWords = (reply: ReplyRow) => ({
  personId: reply.personId,
  occurredAt: reply.sentAt,
  channel: TEXT_CHANNEL,
  transcript: reply.content,
  issues: [],
  actorName: null,
})

// A reply needs no review, so it is confirmed from the moment it lands.
const replyMemo = (reply: ReplyRow): FeedbackReportMemo => ({
  id: reply.id,
  ...replyWords(reply),
  confirmedAt: reply.sentAt,
})

// Counts are computed here, on every read, from member rows whose memo is
// confirmed now. Two reasons not to store them on the run: the pipeline
// counts fragments, not conversations, and a memo re-recorded after a run
// loses its confirmation and must stop counting without a new run.
//
// Conversations are memos and replies. Membership is per memo, so stances
// and outcomes come from the issues the run assigned to this theme, each
// issue to at most one of its memo's themes. Until a run's matching
// completes, or when it failed, they come from every issue the member memos
// raised, and the split can sum past conversationCount. A theme with no
// issue to count has no split at all rather than four zeros.
const summarize = (
  theme: ThemeRow,
  outcomeLimit: number,
): FeedbackThemeSummary => {
  const memos = theme.members.flatMap((member) => member.feedback ?? [])
  const memoIssues = memos.flatMap((memo) => memo.issues)
  const matched = theme.run.issuesMatchedAt !== null
  const assigned = new Set(theme.issues.map((row) => row.issueId))
  const issues = matched
    ? memoIssues.filter((issue) => assigned.has(issue.id))
    : memoIssues
  const noSplit = matched ? issues.length === 0 : memos.length === 0
  const count = (stance: ConstituentFeedbackStance) =>
    issues.filter((issue) => issue.stance === stance).length
  const outcomes = issues
    .map((issue) => issue.desiredOutcome?.trim() ?? '')
    .filter((outcome) => outcome !== '')

  return {
    id: theme.id,
    rank: theme.rank,
    title: theme.title,
    summary: theme.summary,
    conversationCount: theme.members.length,
    stanceCounts: noSplit
      ? null
      : {
          supports: count(ConstituentFeedbackStance.supports),
          opposes: count(ConstituentFeedbackStance.opposes),
          mixed: count(ConstituentFeedbackStance.mixed),
          // An issue with no stance was raised without a position, which
          // is what unclear means.
          unclear: issues.filter(
            (issue) =>
              issue.stance === null ||
              issue.stance === ConstituentFeedbackStance.unclear,
          ).length,
        },
    desiredOutcomes: [...new Set(outcomes)].slice(0, outcomeLimit),
    tag:
      theme.tag === null
        ? null
        : { id: theme.tag.id, name: theme.tag.name, status: theme.tag.status },
  }
}

const toRun = (run: FeedbackSynthesisRun): SynthesisRun => ({
  id: run.id,
  status: run.status,
  createdAt: run.createdAt,
  completedAt: run.completedAt,
  engine: run.engine,
})

@Injectable()
export class FeedbackReportService extends createPrismaBase(
  MODELS.FeedbackSynthesisRun,
) {
  // An effort is a door-knocking turf's or a phone list's envelope, or a
  // Serve text send, in this org. Any other outreach has no conversations
  // to report on. A Win text is not one: its replies come back from the
  // vendor as timestamps, never words.
  async findEffort(organizationSlug: string, outreachId: number) {
    const effort = await this.client.outreach.findFirst({
      where: {
        id: outreachId,
        organizationSlug,
        OR: [
          { doorKnockingTurfId: { not: null } },
          { phoneBankingListId: { not: null } },
          {
            outreachType: { in: [OutreachType.text, OutreachType.poll] },
            campaignId: null,
          },
        ],
      },
      select: {
        id: true,
        name: true,
        outreachType: true,
        phoneBankingListId: true,
        doorKnockingTurf: { select: { communityInputQuestion: true } },
        phoneBankingList: { select: { communityInputQuestion: true } },
      },
    })
    if (effort === null) throw new NotFoundException('Effort not found')
    return effort
  }

  // Conversations are distinct people who answered, not rows, so a
  // corrected re-knock does not count twice. Knocks recorded before the
  // knock row kept its envelope have no outreachId and do not count. On a
  // text send, people who replied with words; a reply needs no review, so
  // nothing is pending.
  async denominators(
    organizationSlug: string,
    effort: Effort,
  ): Promise<Denominators> {
    if (effortChannel(effort) === TEXT_CHANNEL) {
      const replies = (
        await this.client.pollIndividualMessage.findMany({
          where: textRepliesWhere(effort.id),
          select: { personId: true, content: true },
        })
      ).filter(hasWords)
      return {
        conversations: new Set(replies.map((reply) => reply.personId)).size,
        memos: replies.length,
        confirmed: replies.length,
        pending: 0,
      }
    }

    const [knocks, calls, memos, confirmed] = await Promise.all([
      this.client.contactInteractionDoorKnock.findMany({
        where: {
          organizationSlug,
          outreachId: effort.id,
          outcome: DoorKnockOutcome.answered,
        },
        distinct: [Prisma.ContactInteractionDoorKnockScalarFieldEnum.personId],
        select: { personId: true },
      }),
      effort.phoneBankingListId === null
        ? []
        : this.client.contactInteractionPhoneBanking.findMany({
            where: {
              organizationSlug,
              phoneBankingListId: effort.phoneBankingListId,
              outcome: PhoneBankCallOutcome.answered,
            },
            distinct: [
              Prisma.ContactInteractionPhoneBankingScalarFieldEnum.personId,
            ],
            select: { personId: true },
          }),
      this.client.constituentFeedback.count({
        where: { organizationSlug, outreachId: effort.id },
      }),
      this.client.constituentFeedback.count({
        where: {
          organizationSlug,
          outreachId: effort.id,
          confirmedAt: { not: null },
        },
      }),
    ])

    return {
      conversations: new Set([...knocks, ...calls].map((row) => row.personId))
        .size,
      memos,
      confirmed,
      pending: memos - confirmed,
    }
  }

  async effortReport(input: {
    organizationSlug: string
    outreachId: number
  }): Promise<FeedbackReportResponse> {
    const { organizationSlug, outreachId } = input
    const effort = await this.findEffort(organizationSlug, outreachId)
    const [denominators, latest, completed, memos] = await Promise.all([
      this.denominators(organizationSlug, effort),
      this.findFirst({
        where: {
          organizationSlug,
          outreachId,
          status: { not: SynthesisRunStatus.superseded },
        },
        orderBy: { createdAt: Prisma.SortOrder.desc },
      }),
      this.findFirst({
        where: {
          organizationSlug,
          outreachId,
          status: SynthesisRunStatus.completed,
        },
        orderBy: { completedAt: Prisma.SortOrder.desc },
        select: { id: true },
      }),
      this.listMemos(organizationSlug, effort),
    ])
    const themes =
      completed === null
        ? []
        : await this.client.feedbackTheme.findMany({
            where: { runId: completed.id },
            orderBy: { rank: Prisma.SortOrder.asc },
            include: THEME_INCLUDE,
          })

    return {
      question:
        effort.doorKnockingTurf?.communityInputQuestion ??
        effort.phoneBankingList?.communityInputQuestion ??
        null,
      channel: effortChannel(effort),
      floor: MIN_CONFIRMED_FOR_SYNTHESIS,
      denominators,
      run: latest === null ? null : toRun(latest),
      themes: themes.map((theme) => summarize(theme, REPORT_OUTCOME_LIMIT)),
      memos,
    }
  }

  // Newest first, capped: the page shows them when there are no themes to
  // show.
  private async listMemos(
    organizationSlug: string,
    effort: Effort,
  ): Promise<FeedbackReportMemo[]> {
    if (effortChannel(effort) === TEXT_CHANNEL) {
      const replies = await this.client.pollIndividualMessage.findMany({
        where: textRepliesWhere(effort.id),
        orderBy: [
          { sentAt: Prisma.SortOrder.desc },
          { id: Prisma.SortOrder.asc },
        ],
        take: FEEDBACK_REPORT_MEMO_LIMIT,
        select: REPLY_SELECT,
      })
      return replies.filter(hasWords).map(replyMemo)
    }
    const memos = await this.client.constituentFeedback.findMany({
      where: { organizationSlug, outreachId: effort.id },
      orderBy: { occurredAt: Prisma.SortOrder.desc },
      take: FEEDBACK_REPORT_MEMO_LIMIT,
      select: MEMO_SELECT,
    })
    return memos.map(
      ({ actor, ...memo }): FeedbackReportMemo => ({
        ...memo,
        actorName: actorName(actor),
      }),
    )
  }

  async themeDetail(input: {
    organizationSlug: string
    themeId: string
  }): Promise<FeedbackThemeDetail> {
    const theme = await this.client.feedbackTheme.findFirst({
      where: {
        id: input.themeId,
        run: { organizationSlug: input.organizationSlug },
      },
      include: THEME_DETAIL_INCLUDE,
    })
    if (theme === null) throw new NotFoundException('Theme not found')

    const members = theme.members.flatMap(
      ({ feedback, textReply }): FeedbackThemeMember[] => {
        if (feedback !== null) {
          return [
            {
              feedbackId: feedback.id,
              textReplyId: null,
              personId: feedback.personId,
              occurredAt: feedback.occurredAt,
              channel: feedback.channel,
              transcript: feedback.transcript,
              issues: feedback.issues,
              actorName: actorName(feedback.actor),
            },
          ]
        }
        if (textReply === null) return []
        return [
          {
            feedbackId: null,
            textReplyId: textReply.id,
            ...replyWords(textReply),
          },
        ]
      },
    )
    // Sorted here rather than by the query: a member's time lives on
    // whichever of its two sources it has.
    members.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())

    return {
      ...summarize(theme, Number.POSITIVE_INFINITY),
      details: theme.details,
      members,
    }
  }
}

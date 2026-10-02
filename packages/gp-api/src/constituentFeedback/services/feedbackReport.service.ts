import { Injectable, NotFoundException } from '@nestjs/common'
import {
  FEEDBACK_REPORT_MEMO_LIMIT,
  type FeedbackReportMemo,
  type FeedbackReportResponse,
  type FeedbackThemeDetail,
  type FeedbackThemeSummary,
  type SynthesisRun,
} from '@goodparty_org/contracts'
import {
  ConstituentFeedbackChannel,
  ConstituentFeedbackStance,
  DoorKnockOutcome,
  type FeedbackSynthesisRun,
  PhoneBankCallOutcome,
  Prisma,
  SynthesisRunStatus,
} from '@/generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { normalizeTagName } from '../util/issueTagName.util'

// Provisional, until dev runs at 20, 40 and 80 memos show where grouping
// stops splintering. Under it the report lists the memos instead of themes:
// a percentage over two conversations is the misleading number the report
// exists to avoid. Declared here, not beside the synthesis that enforces it,
// because that service already imports this one.
export const MIN_CONFIRMED_FOR_SYNTHESIS = 5

// The report card shows a few asks; the theme page shows them all.
const REPORT_OUTCOME_LIMIT = 5

const CONFIRMED_MEMBERS = {
  where: { feedback: { confirmedAt: { not: null } } },
} as const

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
  select: { id: true, name: true, status: true, normalizedName: true },
} as const satisfies Prisma.IssueTagDefaultArgs

const THEME_INCLUDE = {
  tag: TAG_SELECT,
  members: {
    ...CONFIRMED_MEMBERS,
    select: { feedback: { select: { issues: ISSUE_SELECT } } },
  },
} as const satisfies Prisma.FeedbackThemeInclude

const THEME_DETAIL_INCLUDE = {
  tag: TAG_SELECT,
  members: {
    ...CONFIRMED_MEMBERS,
    orderBy: { feedback: { occurredAt: Prisma.SortOrder.desc } },
    select: {
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

export type Effort = Awaited<ReturnType<FeedbackReportService['findEffort']>>

export type Denominators = FeedbackReportResponse['denominators']

// Counts are computed here, on every read, from member rows whose memo is
// confirmed now. Two reasons not to store them on the run: the pipeline
// counts fragments, not conversations, and a memo re-recorded after a run
// loses its confirmation and must stop counting without a new run.
//
// Conversations are memos; stances and outcomes are the issues that matched
// the theme. Membership is per memo, so a member that raised one issue
// counts it whatever it was labelled, and one that raised several counts
// only those named like the theme's tag; its other issues belong to other
// themes. With no tag there is nothing to match them against.
const summarize = (
  theme: ThemeRow,
  outcomeLimit: number,
): FeedbackThemeSummary => {
  const memos = theme.members.map((member) => member.feedback)
  const tagName = theme.tag?.normalizedName
  const issues = memos.flatMap((memo) =>
    memo.issues.length === 1
      ? memo.issues
      : memo.issues.filter(
          (issue) => normalizeTagName(issue.issueLabel) === tagName,
        ),
  )
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
    conversationCount: memos.length,
    stanceCounts: {
      supports: count(ConstituentFeedbackStance.supports),
      opposes: count(ConstituentFeedbackStance.opposes),
      mixed: count(ConstituentFeedbackStance.mixed),
      // An issue with no stance was raised without a position, which is
      // what unclear means.
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
  // An effort is a door-knocking turf's or a phone list's envelope, in
  // this org. Any other outreach has no conversations to report on.
  async findEffort(organizationSlug: string, outreachId: number) {
    const effort = await this.client.outreach.findFirst({
      where: {
        id: outreachId,
        organizationSlug,
        OR: [
          { doorKnockingTurfId: { not: null } },
          { phoneBankingListId: { not: null } },
        ],
      },
      select: {
        id: true,
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
  // knock row kept its envelope have no outreachId and do not count.
  async denominators(
    organizationSlug: string,
    effort: Effort,
  ): Promise<Denominators> {
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
      this.client.constituentFeedback.findMany({
        where: { organizationSlug, outreachId },
        orderBy: { occurredAt: Prisma.SortOrder.desc },
        take: FEEDBACK_REPORT_MEMO_LIMIT,
        select: MEMO_SELECT,
      }),
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
      channel:
        effort.phoneBankingListId === null
          ? ConstituentFeedbackChannel.door_knock
          : ConstituentFeedbackChannel.phone_bank,
      floor: MIN_CONFIRMED_FOR_SYNTHESIS,
      denominators,
      run: latest === null ? null : toRun(latest),
      themes: themes.map((theme) => summarize(theme, REPORT_OUTCOME_LIMIT)),
      memos: memos.map(
        ({ actor, ...memo }): FeedbackReportMemo => ({
          ...memo,
          actorName: actorName(actor),
        }),
      ),
    }
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

    return {
      ...summarize(theme, Number.POSITIVE_INFINITY),
      details: theme.details,
      members: theme.members.map(({ feedback }) => ({
        feedbackId: feedback.id,
        personId: feedback.personId,
        occurredAt: feedback.occurredAt,
        channel: feedback.channel,
        transcript: feedback.transcript,
        issues: feedback.issues,
        actorName: actorName(feedback.actor),
      })),
    }
  }
}

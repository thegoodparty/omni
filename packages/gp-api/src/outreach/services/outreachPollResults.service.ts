import { Injectable, NotFoundException } from '@nestjs/common'
import {
  isHighConfidence,
  POLL_MIN_RESPONSES,
  POLL_SAMPLE_QUOTES_MAX,
  POLL_THEMES_MAX,
  type PollAnalysisStatus,
  type PollResults,
  type PollSampleQuote,
} from '@goodparty_org/contracts'
import { hasWords } from '@/constituentFeedback/services/feedbackReport.service'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import {
  OutreachType,
  PollIndividualMessageSender,
  Prisma,
  SynthesisRunStatus,
} from '../../generated/prisma'
import type { OutreachScope } from './outreach.service'
import { OutreachSmsRepliesService } from './outreachSmsReplies.service'

type Run = { id: string; status: SynthesisRunStatus; completedAt: Date | null }

const toAnalysisStatus = (runs: Run[]): PollAnalysisStatus => {
  if (runs.some((run) => run.status === SynthesisRunStatus.running)) {
    return 'running'
  }
  const latest = runs[0]
  if (!latest) return 'none'
  return latest.status === SynthesisRunStatus.failed ? 'failed' : 'completed'
}

@Injectable()
export class OutreachPollResultsService extends createPrismaBase(
  MODELS.Outreach,
) {
  constructor(private readonly replies: OutreachSmsRepliesService) {
    super()
  }

  /**
   * One poll's status, counts, confidence and themes.
   *
   * The population for confidence is `sent`, every recipient the poll went
   * to, not the district: the sample is what the official asked.
   */
  async getResults(
    outreachId: number,
    scope: OutreachScope,
  ): Promise<PollResults> {
    const outreach = await this.model.findFirst({
      where: { id: outreachId, ...scope, outreachType: OutreachType.poll },
      select: {
        id: true,
        organizationSlug: true,
        pollDetails: {
          select: {
            lastAnalysisAt: true,
            expansions: {
              orderBy: { sendSeq: Prisma.SortOrder.asc },
              select: { sendSeq: true, textCount: true, status: true },
            },
          },
        },
      },
    })
    if (!outreach) {
      throw new NotFoundException('Poll not found')
    }

    const [sent, messages, runs] = await Promise.all([
      this.client.outreachTextRecipient.count({ where: { outreachId } }),
      this.client.pollIndividualMessage.findMany({
        where: { outreachId, sender: PollIndividualMessageSender.CONSTITUENT },
        select: { id: true, personId: true, isOptOut: true, createdAt: true },
      }),
      this.client.feedbackSynthesisRun.findMany({
        where: { outreachId },
        orderBy: { createdAt: Prisma.SortOrder.desc },
        select: { id: true, status: true, completedAt: true },
      }),
    ])

    const answers = messages.filter((message) => message.isOptOut !== true)
    const responses = new Set(answers.map((message) => message.personId)).size
    const optOuts = new Set(
      messages
        .filter((message) => message.isOptOut === true)
        .map((message) => message.personId),
    ).size
    const notEnoughResponses = responses < POLL_MIN_RESPONSES
    const lastAnalysisAt = outreach.pollDetails?.lastAnalysisAt ?? null

    const completed = runs
      .filter(
        (run) =>
          run.completedAt !== null &&
          (run.status === SynthesisRunStatus.completed ||
            run.status === SynthesisRunStatus.superseded),
      )
      .sort(
        (a, b) =>
          (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0),
      )
    const latest = completed[0]
    const previous = completed[1]

    const { themes, nonClusteredCount } =
      notEnoughResponses || !latest
        ? { themes: [], nonClusteredCount: 0 }
        : await this.readThemes(
            outreachId,
            outreach.organizationSlug,
            latest.id,
            previous?.completedAt ?? null,
            answers,
          )

    return {
      outreachId,
      sent,
      responses,
      responseRate: sent === 0 ? 0 : responses / sent,
      optOutRate: sent === 0 ? 0 : optOuts / sent,
      confidence: notEnoughResponses || sent === 0 ? null : responses / sent,
      isHighConfidence:
        !notEnoughResponses &&
        isHighConfidence({ replies: responses, population: sent }),
      notEnoughResponses,
      newSinceLastAnalysis:
        lastAnalysisAt === null
          ? 0
          : answers.filter((message) => message.createdAt > lastAnalysisAt)
              .length,
      lastAnalysisAt,
      themes,
      nonClustered: { count: nonClusteredCount },
      analysis: { status: toAnalysisStatus(runs) },
      expansions: (outreach.pollDetails?.expansions ?? []).map((expansion) => ({
        sendSeq: expansion.sendSeq,
        textCount: expansion.textCount,
        status: expansion.status,
      })),
    }
  }

  private async readThemes(
    outreachId: number,
    organizationSlug: string | null,
    runId: string,
    previousCompletedAt: Date | null,
    answers: { id: string }[],
  ): Promise<{ themes: PollResults['themes']; nonClusteredCount: number }> {
    const rows = await this.client.feedbackTheme.findMany({
      where: { runId },
      orderBy: { rank: Prisma.SortOrder.asc },
      select: {
        id: true,
        title: true,
        summary: true,
        members: {
          where: { textReplyId: { not: null } },
          select: {
            textReplyId: true,
            textReply: {
              select: {
                personId: true,
                content: true,
                createdAt: true,
                sentAt: true,
              },
            },
          },
        },
      },
    })

    // Every theme in the run, not only the five shown: a reply in a sixth
    // theme was still grouped.
    const placed = new Set(
      (
        await this.client.feedbackThemeMember.findMany({
          where: { theme: { runId }, textReplyId: { not: null } },
          select: { textReplyId: true },
        })
      ).map((member) => member.textReplyId),
    )
    const nonClusteredCount = answers.filter(
      (answer) => !placed.has(answer.id),
    ).length

    const shown = rows.slice(0, POLL_THEMES_MAX).map((row) => {
      const replies = row.members.flatMap((member) =>
        member.textReply ? [member.textReply] : [],
      )
      const quoted = new Map<string, (typeof replies)[number]>()
      for (const reply of [...replies].sort(
        (a, b) => b.sentAt.getTime() - a.sentAt.getTime(),
      )) {
        if (quoted.size === POLL_SAMPLE_QUOTES_MAX) break
        if (hasWords(reply) && !quoted.has(reply.personId)) {
          quoted.set(reply.personId, reply)
        }
      }
      return { row, replies, quoted: [...quoted.values()] }
    })

    const identities = await this.replies.resolveIdentities(
      outreachId,
      organizationSlug,
      shown.flatMap(({ quoted }) => quoted.map((reply) => reply.personId)),
    )

    const themes = shown.map(({ row, replies, quoted }) => ({
      id: row.id,
      label: row.title,
      summary: row.summary,
      mentionCount: replies.length,
      newMentions:
        previousCompletedAt === null
          ? 0
          : replies.filter((reply) => reply.createdAt > previousCompletedAt)
              .length,
      sampleQuotes: quoted.flatMap((reply): PollSampleQuote[] =>
        reply.content === null
          ? []
          : [
              {
                text: reply.content,
                firstName: identities.get(reply.personId)?.firstName ?? null,
              },
            ],
      ),
    }))
    return { themes, nonClusteredCount }
  }
}

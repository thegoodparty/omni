import { Injectable } from '@nestjs/common'
import {
  type FeedbackSynthesisCompleteEvent,
  FeedbackSynthesisResponseRowsSchema,
} from '@goodparty_org/contracts'
import { differenceInMilliseconds } from 'date-fns'
import { groupBy } from 'es-toolkit'
import {
  type FeedbackSynthesisRun,
  IssueTagSource,
  IssueTagStatus,
  PollIndividualMessageSender,
  Prisma,
  SynthesisRunStatus,
  SynthesisScope,
} from '@/generated/prisma'
import { AnalyticsService } from '@/analytics/analytics.service'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import { cleanTagName, normalizeTagName } from '../util/issueTagName.util'

type Issue = FeedbackSynthesisCompleteEvent['data']['issues'][number]

// Which table a member id was found in: a confirmed memo, or a
// constituent's reply on a text send.
type MemberSource = 'feedback' | 'text'

// The single write path for synthesis results. The SQS consumer calls it
// with the pipeline's event and the mock engine calls it in-process with the
// same shape, so everything after "an engine grouped the memos" is shared.
@Injectable()
export class FeedbackSynthesisIngestService extends createPrismaBase(
  MODELS.FeedbackSynthesisRun,
) {
  constructor(
    private readonly s3: S3Service,
    private readonly analytics: AnalyticsService,
  ) {
    super()
  }

  async handle(event: FeedbackSynthesisCompleteEvent): Promise<void> {
    const { sourceId, issues, responsesLocation } = event.data
    const run = await this.findUnique({ where: { id: sourceId } })
    // A redelivered event, or one that lands after the sweep failed the run.
    if (run === null || run.status !== SynthesisRunStatus.running) {
      this.logger.info(
        { runId: sourceId, status: run?.status ?? null },
        'Ignoring synthesis results for a run that is not running',
      )
      return
    }

    const rowsByTheme =
      responsesLocation === null
        ? {}
        : await this.readResponseRows(responsesLocation)
    const candidates = issues.map((issue) => ({
      issue,
      memberIds: [
        ...new Set([
          ...issue.quotes.map((quote) => quote.respondent_id),
          ...(issue.memberIds ?? []),
          ...(rowsByTheme[issue.theme] ?? []).map((row) => row.respondent_id),
        ]),
      ],
    }))
    const candidateIds = new Set(
      candidates.flatMap((candidate) => candidate.memberIds),
    )
    const inScope = await this.idsInScope(run, [...candidateIds])
    const themes = candidates.map(({ issue, memberIds }) => ({
      issue,
      members: memberIds.flatMap((id) => {
        const source = inScope.get(id)
        return source === undefined ? [] : [{ id, source }]
      }),
    }))
    const droppedCount = candidateIds.size - inScope.size
    if (droppedCount > 0) {
      this.logger.warn(
        { runId: run.id, droppedCount },
        'Dropped synthesis respondents outside the run scope',
      )
    }

    // Themes nobody in scope belongs to would supersede a good run with an
    // empty one, so the run fails instead and the previous themes stay up.
    if (themes.every((theme) => theme.members.length === 0)) {
      await this.model.updateMany({
        where: { id: run.id, status: SynthesisRunStatus.running },
        data: {
          status: SynthesisRunStatus.failed,
          activeKey: null,
          error: 'no_members_in_scope',
        },
      })
      this.logger.warn(
        { runId: run.id, themeCount: issues.length, droppedCount },
        'Synthesis run had no members in scope',
      )
      return
    }

    const completedAt = new Date()
    const written = await this.client.$transaction(async (tx) => {
      // Claimed first and conditionally, so two deliveries of one event
      // cannot both write themes: the loser's update matches no row once
      // the winner commits.
      const claim = await tx.feedbackSynthesisRun.updateMany({
        where: { id: run.id, status: SynthesisRunStatus.running },
        data: {
          status: SynthesisRunStatus.completed,
          completedAt,
          activeKey: null,
        },
      })
      if (claim.count === 0) return false

      const applied: Array<{ feedbackId: string; tagId: string }> = []
      const pooled = run.scope === SynthesisScope.priority
      for (const { issue, members } of themes) {
        // The org's tag list and a memo's tags come from its own send's run.
        // A priority run regroups the same memos, and tagging them again
        // would propose a second vocabulary for one conversation.
        const tagId = pooled ? null : await this.resolveTag(tx, run, issue)
        const theme = await tx.feedbackTheme.create({
          data: {
            runId: run.id,
            rank: issue.rank,
            title: issue.theme,
            summary: issue.summary,
            details: issue.analysis,
            tagId,
          },
        })
        await tx.feedbackThemeMember.createMany({
          data: members.map(({ id, source }) =>
            source === 'feedback'
              ? { themeId: theme.id, feedbackId: id }
              : { themeId: theme.id, textReplyId: id },
          ),
          skipDuplicates: true,
        })
        // A tag lands on a memo's record; a reply has no row to carry one.
        if (tagId !== null) {
          applied.push(
            ...members.flatMap(({ id, source }) =>
              source === 'feedback' ? [{ feedbackId: id, tagId }] : [],
            ),
          )
        }
      }

      // Before this run's tag rows go in: a pair the old run applied and
      // this one applies again must end up carrying this run's id, and
      // skipDuplicates would otherwise keep the old row, which the
      // supersede then deletes.
      await this.supersedePrevious(tx, run)

      // skipDuplicates is what keeps a human's row (runId null) on a pair
      // this run also applies: a run never overwrites a person's tagging.
      await tx.constituentFeedbackTag.createMany({
        data: applied.map((row) => ({ ...row, runId: run.id })),
        skipDuplicates: true,
      })
      return true
    })

    this.logger.info(
      {
        runId: run.id,
        scope: run.scope,
        inputCount: run.confirmed,
        themeCount: issues.length,
        durationMs: differenceInMilliseconds(completedAt, run.createdAt),
        engine: run.engine,
        written,
      },
      'Feedback synthesis completed',
    )
    if (written) this.trackCompleted(run, issues.length)
  }

  // Attributed to whoever pressed the button, or to the org's owner when
  // the effort's completion started the run. Everything here, the owner
  // lookup included, runs after the commit and must never reject handle():
  // a rejection would requeue an event whose run is already completed.
  private trackCompleted(run: FeedbackSynthesisRun, themeCount: number): void {
    const send = async () => {
      const userId =
        run.requestedByUserId ??
        (
          await this.client.organization.findUniqueOrThrow({
            where: { slug: run.organizationSlug },
            select: { ownerId: true },
          })
        ).ownerId
      await this.analytics.track(
        userId,
        EVENTS.IssueCapture.SynthesisCompleted,
        {
          scope: run.scope,
          outreachId: run.outreachId,
          themeCount,
          confirmedCount: run.confirmed,
          product: run.organizationSlug.startsWith('eo-') ? 'serve' : 'win',
        },
      )
    }
    void send().catch((err: Error) =>
      this.logger.warn(
        { err, runId: run.id },
        'Synthesis Completed event not sent',
      ),
    )
  }

  private async readResponseRows(location: string) {
    const bucket = process.env.SERVE_ANALYSIS_BUCKET_NAME
    if (!bucket) {
      throw new Error('SERVE_ANALYSIS_BUCKET_NAME is required to ingest runs')
    }
    const content = await this.s3.getFile(bucket, location)
    if (content === undefined) {
      throw new Error(`Synthesis results not found at ${location}`)
    }
    const rows = FeedbackSynthesisResponseRowsSchema.parse(JSON.parse(content))
    return groupBy(rows, (row) => row.theme)
  }

  // Respondent ids come from outside. Only memos and replies in the run's
  // own scope become members, so a stray or forged id cannot pull another
  // effort's, or another org's, memo into this report. Each id maps to the
  // table it was found in: a memo's id is a uuid v7 and a reply's a uuid v5
  // from its own namespace, so one id never names both.
  private async idsInScope(
    run: FeedbackSynthesisRun,
    ids: string[],
  ): Promise<Map<string, MemberSource>> {
    const outreachScope = await this.outreachScope(run)
    const [memos, replies] = await Promise.all([
      this.client.constituentFeedback.findMany({
        where: {
          id: { in: ids },
          organizationSlug: run.organizationSlug,
          ...outreachScope,
        },
        select: { id: true },
      }),
      this.client.pollIndividualMessage.findMany({
        where: {
          id: { in: ids },
          sender: PollIndividualMessageSender.CONSTITUENT,
          outreach: { organizationSlug: run.organizationSlug },
          ...outreachScope,
        },
        select: { id: true },
      }),
    ])
    return new Map<string, MemberSource>([
      ...replies.map((row) => [row.id, 'text'] as const),
      ...memos.map((row) => [row.id, 'feedback'] as const),
    ])
  }

  // An effort run reads its own send; a priority run every send the office
  // made for that priority; an organization run the whole org.
  private async outreachScope(
    run: FeedbackSynthesisRun,
  ): Promise<{ outreachId?: number | null | { in: number[] } }> {
    if (run.scope === SynthesisScope.effort) {
      return { outreachId: run.outreachId }
    }
    if (run.scope !== SynthesisScope.priority || run.priorityId === null) {
      return {}
    }
    const sends = await this.client.outreach.findMany({
      where: {
        priorityId: run.priorityId,
        organizationSlug: run.organizationSlug,
        campaignId: null,
      },
      select: { id: true },
    })
    return { outreachId: { in: sends.map((send) => send.id) } }
  }

  // One tag per theme, matched on the normalized title.
  private async resolveTag(
    tx: Prisma.TransactionClient,
    run: FeedbackSynthesisRun,
    issue: Issue,
  ): Promise<string> {
    const name = cleanTagName(issue.theme)
    const normalizedName = normalizeTagName(issue.theme)
    // Equal timestamps mark a proposal no human has touched, which is
    // what lets a superseding run delete it. Skipping a duplicate rather
    // than reading first: another run in the org can insert the same name
    // between a read and this write, and the conflict would abort the run.
    const now = new Date()
    const { count } = await tx.issueTag.createMany({
      data: {
        organizationSlug: run.organizationSlug,
        name,
        normalizedName,
        status: IssueTagStatus.proposed,
        source: IssueTagSource.synthesis,
        proposedByRunId: run.id,
        createdAt: now,
        updatedAt: now,
      },
      skipDuplicates: true,
    })
    const existing = await tx.issueTag.findUniqueOrThrow({
      where: {
        organizationSlug_normalizedName: {
          organizationSlug: run.organizationSlug,
          normalizedName,
        },
      },
    })
    if (count === 1) return existing.id

    // A person merged this name into another tag. The theme follows that
    // decision rather than reviving the merged-away name. A merge re-points
    // earlier ones, so one hop is enough; the target was accepted then but
    // may have been retired since, which retiring does not re-point, so it
    // goes through the same branches as a tag matched by name.
    const tag =
      existing.mergedIntoId === null
        ? existing
        : await tx.issueTag.findUniqueOrThrow({
            where: { id: existing.mergedIntoId },
          })

    if (tag.status === IssueTagStatus.proposed) {
      // Moved to this run so superseding the run that first proposed it
      // does not delete a suggestion this run still makes. updatedAt is
      // carried over: relinking is not a human touching it.
      await tx.issueTag.update({
        where: { id: tag.id },
        data: { proposedByRunId: run.id, updatedAt: tag.updatedAt },
      })
    } else if (tag.status === IssueTagStatus.retired) {
      // Revived as this run's own untouched proposal, so updatedAt goes
      // back to createdAt: the retire was a human touching the old one, and
      // left standing it would keep a later run from ever sweeping this.
      await tx.issueTag.update({
        where: { id: tag.id },
        data: {
          status: IssueTagStatus.proposed,
          proposedByRunId: run.id,
          updatedAt: tag.createdAt,
        },
      })
    }
    return tag.id
  }

  // Older completed runs for the same scope become history. Their themes
  // and members stay, for comparing runs over time; their tagging and any
  // proposal nobody touched go, so only the latest run's tagging is live.
  // A status change cascades nothing, so both deletes are explicit. Only a
  // run's own proposals go: a seeded or typed tag a run revived is a
  // person's, and deleting it would take their tagging with it.
  private async supersedePrevious(
    tx: Prisma.TransactionClient,
    run: FeedbackSynthesisRun,
  ): Promise<void> {
    const previous = await tx.feedbackSynthesisRun.findMany({
      where: {
        organizationSlug: run.organizationSlug,
        scope: run.scope,
        outreachId: run.outreachId,
        priorityId: run.priorityId,
        status: SynthesisRunStatus.completed,
        id: { not: run.id },
      },
      select: { id: true },
    })
    if (previous.length === 0) return
    const ids = previous.map((row) => row.id)

    await tx.feedbackSynthesisRun.updateMany({
      where: { id: { in: ids } },
      data: { status: SynthesisRunStatus.superseded },
    })
    await tx.constituentFeedbackTag.deleteMany({
      where: { runId: { in: ids } },
    })
    await tx.issueTag.deleteMany({
      where: {
        proposedByRunId: { in: ids },
        source: IssueTagSource.synthesis,
        status: IssueTagStatus.proposed,
        updatedAt: { equals: tx.issueTag.fields.createdAt },
      },
    })
  }
}

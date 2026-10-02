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
  Prisma,
  SynthesisRunStatus,
  SynthesisScope,
} from '@/generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { cleanTagName, normalizeTagName } from '../util/issueTagName.util'

type Issue = FeedbackSynthesisCompleteEvent['data']['issues'][number]

// The single write path for synthesis results. The SQS consumer calls it
// with the pipeline's event and the mock engine calls it in-process with the
// same shape, so everything after "an engine grouped the memos" is shared.
@Injectable()
export class FeedbackSynthesisIngestService extends createPrismaBase(
  MODELS.FeedbackSynthesisRun,
) {
  constructor(private readonly s3: S3Service) {
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
    const inScope = await this.idsInScope(
      run,
      candidates.flatMap((candidate) => candidate.memberIds),
    )

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
      for (const { issue, memberIds } of candidates) {
        const members = memberIds.filter((id) => inScope.has(id))
        const tagId = await this.resolveTag(tx, run, issue)
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
          data: members.map((feedbackId) => ({
            themeId: theme.id,
            feedbackId,
          })),
          skipDuplicates: true,
        })
        applied.push(...members.map((feedbackId) => ({ feedbackId, tagId })))
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

  // Respondent ids come from outside. Only memos in the run's own scope
  // become members, so a stray or forged id cannot pull another effort's,
  // or another org's, memo into this report.
  private async idsInScope(
    run: FeedbackSynthesisRun,
    ids: string[],
  ): Promise<Set<string>> {
    const rows = await this.client.constituentFeedback.findMany({
      where: {
        id: { in: [...new Set(ids)] },
        organizationSlug: run.organizationSlug,
        ...(run.scope === SynthesisScope.effort
          ? { outreachId: run.outreachId }
          : {}),
      },
      select: { id: true },
    })
    return new Set(rows.map((row) => row.id))
  }

  // One tag per theme, matched on the normalized title.
  private async resolveTag(
    tx: Prisma.TransactionClient,
    run: FeedbackSynthesisRun,
    issue: Issue,
  ): Promise<string> {
    const name = cleanTagName(issue.theme)
    const normalizedName = normalizeTagName(issue.theme)
    const existing = await tx.issueTag.findUnique({
      where: {
        organizationSlug_normalizedName: {
          organizationSlug: run.organizationSlug,
          normalizedName,
        },
      },
    })

    if (existing === null) {
      // Equal timestamps mark a proposal no human has touched, which is
      // what lets a superseding run delete it.
      const now = new Date()
      const created = await tx.issueTag.create({
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
      })
      return created.id
    }

    if (existing.status === IssueTagStatus.proposed) {
      // Moved to this run so superseding the run that first proposed it
      // does not delete a suggestion this run still makes. updatedAt is
      // carried over: relinking is not a human touching it.
      await tx.issueTag.update({
        where: { id: existing.id },
        data: { proposedByRunId: run.id, updatedAt: existing.updatedAt },
      })
    } else if (existing.status === IssueTagStatus.retired) {
      await tx.issueTag.update({
        where: { id: existing.id },
        data: { status: IssueTagStatus.proposed, proposedByRunId: run.id },
      })
    }
    return existing.id
  }

  // Older completed runs for the same scope become history. Their themes
  // and members stay, for comparing runs over time; their tagging and any
  // proposal nobody touched go, so only the latest run's tagging is live.
  // A status change cascades nothing, so both deletes are explicit.
  private async supersedePrevious(
    tx: Prisma.TransactionClient,
    run: FeedbackSynthesisRun,
  ): Promise<void> {
    const previous = await tx.feedbackSynthesisRun.findMany({
      where: {
        organizationSlug: run.organizationSlug,
        scope: run.scope,
        outreachId: run.outreachId,
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
        status: IssueTagStatus.proposed,
        updatedAt: { equals: tx.issueTag.fields.createdAt },
      },
    })
  }
}

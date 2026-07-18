import { Injectable, NotFoundException } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { isAfter, subMinutes } from 'date-fns'
import { v7 as uuidv7 } from 'uuid'
import { z } from 'zod'
import {
  OrdinanceQualityIterationsResponseSchema,
  OrdinanceQualityReportSchema,
  OrdinanceSourceSchema,
  type OrdinanceQualityIterationsResponse,
  type OrdinanceQualityLoop,
  type OrdinanceQualityLoopPhase,
  type OrdinanceQualityReport,
  type OrdinanceSource,
} from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { FeaturesService } from 'src/features/services/features.service'
import { AnalyticsService } from 'src/analytics/analytics.service'
import { EVENTS } from 'src/vendors/segment/segment.types'
import { QueueProducerService } from 'src/queue/producer/queueProducer.service'
import {
  QueueType,
  type OrdinanceQualityLoopMessage,
} from 'src/queue/queue.types'
import {
  ElectedOffice,
  Ordinance,
  OrdinanceQualityIteration,
  OrdinanceQualityLoopStatus,
  OrdinanceStatus,
  Prisma,
} from '../../generated/prisma'
import {
  MAX_QUALITY_LOOP_REVISIONS,
  ORDINANCE_QUALITY_LOOP_ENABLED_ENV,
  QUALITY_LOOP_LLM_RETRIES,
  QUALITY_LOOP_MODELS,
  QUALITY_LOOP_STALL_MINUTES,
  QUALITY_LOOP_STEP_TIMEOUT_MS,
  SERVE_ORDINANCE_QUALITY_LOOP_FLAG,
} from '../ordinances.constants'
import {
  OrdinanceQualityReportService,
  qualityReportInputHash,
} from './ordinanceQualityReport.service'
import {
  OrdinanceDraftRevisionService,
  OrdinanceRevisionGuardError,
} from './ordinanceDraftRevision.service'
import {
  type OrdinanceQualityLoopCompletedProps,
  type OrdinanceQualityLoopStartInput,
  type OrdinanceQualityLoopStartResult,
  type OrdinanceWithLatestIteration,
} from './ordinanceQualityLoop.types'

// Mirrors the manual quality-run staleness window in ordinances.service.ts: a
// 'running' claim older than this is an interrupted run, not a live one.
const MANUAL_RUN_STALE_MINUTES = 10

// One retry after a degraded report; the degraded-attempt count lives on the
// iteration row, never in the message.
const MAX_QC_ATTEMPTS_PER_ITERATION = 2

const RevisionNotesSchema = z.array(
  z.object({ checkId: z.string(), note: z.string() }),
)

// Thrown inside a fenced $transaction when the conditional updateMany matched
// zero rows: a cancel, supersede, sweep, or newer run took ownership while the
// LLM call was in flight, so the result must be discarded.
class OwnershipLostError extends Error {}

type LoadedOrdinance = Ordinance & { electedOffice: ElectedOffice }

const flaggedIds = (report: OrdinanceQualityReport): string[] =>
  report.checks.filter((c) => c.status === 'flag').map((c) => c.id)

const isProperSubset = (subset: string[], superset: string[]): boolean =>
  subset.length < superset.length && subset.every((id) => superset.includes(id))

@Injectable()
export class OrdinanceQualityLoopService extends createPrismaBase(
  MODELS.Ordinance,
) {
  constructor(
    private readonly features: FeaturesService,
    private readonly qualityReports: OrdinanceQualityReportService,
    private readonly revisions: OrdinanceDraftRevisionService,
    private readonly producer: QueueProducerService,
    private readonly analytics: AnalyticsService,
  ) {
    super()
  }

  async start(
    input: OrdinanceQualityLoopStartInput,
  ): Promise<OrdinanceQualityLoopStartResult> {
    const { ordinance, userId, trigger } = input
    const enabled = await this.features.isFeatureEnabled({
      user: userId,
      feature: SERVE_ORDINANCE_QUALITY_LOOP_FLAG,
    })
    if (!enabled) {
      return { started: false, reason: 'flag_off' }
    }
    if (process.env[ORDINANCE_QUALITY_LOOP_ENABLED_ENV] !== 'true') {
      return { started: false, reason: 'env_off' }
    }
    if (ordinance.status !== OrdinanceStatus.draft) {
      return { started: false, reason: 'status_beyond_draft' }
    }
    const body = ordinance.draftBody ?? ''
    if (body.includes('{-') || body.includes('{+')) {
      return { started: false, reason: 'redline_draft' }
    }
    if (body.trim().length === 0) {
      return { started: false, reason: 'empty_draft' }
    }
    if (this.passesBarForCurrentInputs(ordinance)) {
      return { started: false, reason: 'already_passing' }
    }
    if (this.manualRunActive(ordinance)) {
      return { started: false, reason: 'manual_run_active' }
    }
    if (ordinance.qualityLoopStatus === OrdinanceQualityLoopStatus.running) {
      if (trigger === 'manual') {
        return { started: false, reason: 'already_running' }
      }
      // A re-drafted ordinance restarts its loop: retire the old run first,
      // fenced by its own runId so a race can't flip a newer run.
      await this.model.updateMany({
        where: {
          id: ordinance.id,
          qualityLoopStatus: OrdinanceQualityLoopStatus.running,
          qualityLoopRunId: ordinance.qualityLoopRunId,
        },
        data: {
          qualityLoopStatus: OrdinanceQualityLoopStatus.superseded_by_edit,
          qualityLoopUpdatedAt: new Date(),
        },
      })
    }
    const loopRunId = uuidv7()
    // Never-ran columns are NULL, and neither Prisma's NOT nor `not:` matches
    // NULL, so each exclusion needs an explicit null branch (same shape as
    // the manual claim in ordinances.service.ts).
    const claimed = await this.model.updateMany({
      where: {
        id: ordinance.id,
        deletedAt: null,
        OR: [
          { qualityLoopStatus: null },
          {
            qualityLoopStatus: { not: OrdinanceQualityLoopStatus.running },
          },
        ],
        // A live manual QC run blocks a loop start; a stale or startedAt-less
        // claim is an interrupted run and does not.
        AND: [
          {
            OR: [
              { qualityRunStatus: null },
              { qualityRunStatus: { not: 'running' } },
              {
                qualityRunStartedAt: {
                  lt: subMinutes(new Date(), MANUAL_RUN_STALE_MINUTES),
                },
              },
              { qualityRunStatus: 'running', qualityRunStartedAt: null },
            ],
          },
        ],
      },
      data: {
        qualityLoopStatus: OrdinanceQualityLoopStatus.running,
        qualityLoopRunId: loopRunId,
        qualityLoopIteration: 0,
        qualityLoopUpdatedAt: new Date(),
      },
    })
    if (claimed.count === 0) {
      return { started: false, reason: 'already_running' }
    }
    try {
      await this.enqueueStep({
        ordinanceId: ordinance.id,
        loopRunId,
        iteration: 0,
        phase: 'qc',
        expectedInputHash: qualityReportInputHash(ordinance),
        attempt: 1,
      })
    } catch (err) {
      this.logger.error(
        { ordinanceId: ordinance.id, loopRunId, error: err },
        'quality loop start enqueue failed',
      )
      await this.flipTerminal(
        ordinance.id,
        loopRunId,
        OrdinanceQualityLoopStatus.failed,
      )
      return { started: false, reason: 'enqueue_failed' }
    }
    return { started: true }
  }

  async cancel(ordinanceId: string): Promise<void> {
    await this.model.updateMany({
      where: {
        id: ordinanceId,
        qualityLoopStatus: OrdinanceQualityLoopStatus.running,
      },
      data: {
        qualityLoopStatus: OrdinanceQualityLoopStatus.cancelled,
        qualityLoopUpdatedAt: new Date(),
      },
    })
  }

  async supersedeOnEdit(ordinanceId: string): Promise<void> {
    await this.model.updateMany({
      where: {
        id: ordinanceId,
        qualityLoopStatus: OrdinanceQualityLoopStatus.running,
      },
      data: {
        qualityLoopStatus: OrdinanceQualityLoopStatus.superseded_by_edit,
        qualityLoopUpdatedAt: new Date(),
      },
    })
  }

  async handleStep(data: OrdinanceQualityLoopMessage): Promise<boolean> {
    try {
      return await this.step(data)
    } catch (err) {
      // Unexpected (non-LLM) failure: let SQS redeliver — position resolution
      // makes the retry safe — and age out to the DLQ if it keeps failing.
      this.logger.error(
        { message: data, error: err },
        'ordinance quality loop step failed unexpectedly',
      )
      return false
    }
  }

  // The consumer runs in every replica and SQS redelivers, so every branch
  // here resumes from DB state and every write is fenced on
  // (status running + runId), with the LLM-adjacent writes also fenced on the
  // updatedAt read just before the call.
  private async step(msg: OrdinanceQualityLoopMessage): Promise<boolean> {
    const guard = await this.model.findFirst({
      where: { id: msg.ordinanceId },
    })
    if (
      !guard ||
      guard.deletedAt !== null ||
      guard.qualityLoopStatus !== OrdinanceQualityLoopStatus.running ||
      guard.qualityLoopRunId !== msg.loopRunId
    ) {
      this.logger.info(
        { message: msg, status: guard?.qualityLoopStatus ?? 'missing' },
        'dropping quality loop message for a non-live run',
      )
      return true
    }
    // Heartbeat for the stall sweep; doubles as the ownership re-check.
    const touched = await this.model.updateMany({
      where: this.runningFence(msg.ordinanceId, msg.loopRunId),
      data: { qualityLoopUpdatedAt: new Date() },
    })
    if (touched.count === 0) {
      return true
    }
    // Re-read after the heartbeat so the updatedAt fence below matches what
    // the LLM step actually read.
    const record = await this.model.findFirst({
      where: { id: msg.ordinanceId },
      include: { electedOffice: true },
    })
    if (
      !record ||
      record.qualityLoopStatus !== OrdinanceQualityLoopStatus.running ||
      record.qualityLoopRunId !== msg.loopRunId
    ) {
      return true
    }

    // Position resolution BEFORE any hash interpretation: a message behind
    // the frontier is a completed step's redelivery; interpreting its stale
    // hash as a user edit would falsely supersede a healthy loop.
    const frontier = record.qualityLoopIteration
    if (msg.iteration > frontier) {
      this.logger.warn(
        { message: msg, frontier },
        'quality loop message ahead of frontier; dropping',
      )
      return true
    }
    if (msg.iteration < frontier) {
      return this.resumeFrontier(record, msg.loopRunId)
    }
    const row = await this.iterationRow(record.id, msg.loopRunId, msg.iteration)
    if (msg.phase === 'qc' && row?.report !== null && row !== null) {
      return this.evaluateBar(record, msg.loopRunId, row)
    }
    if (msg.phase === 'revise' && (row === null || row.report === null)) {
      // A revise message exists only after its QC persisted; missing state
      // means we can't trust the message — re-derive from the frontier.
      return this.resumeFrontier(record, msg.loopRunId)
    }
    if (qualityReportInputHash(record) !== msg.expectedInputHash) {
      const flipped = await this.flipTerminal(
        record.id,
        msg.loopRunId,
        OrdinanceQualityLoopStatus.superseded_by_edit,
      )
      if (flipped) {
        await this.trackCompleted(
          record,
          msg.loopRunId,
          OrdinanceQualityLoopStatus.superseded_by_edit,
          null,
        )
      }
      return true
    }
    if (msg.phase === 'qc') {
      return this.runQcStep(record, msg.loopRunId, msg.iteration, row)
    }
    // Unreachable null: the revise branch above already re-derived when the
    // row was missing. The re-check narrows without an assertion.
    return row === null
      ? this.resumeFrontier(record, msg.loopRunId)
      : this.runReviseStep(record, msg.loopRunId, row)
  }

  // A completed (behind-frontier or already-persisted) step's redelivery:
  // re-derive the correct next step from DB state and re-issue it.
  private async resumeFrontier(
    record: LoadedOrdinance,
    loopRunId: string,
  ): Promise<boolean> {
    const frontier = record.qualityLoopIteration
    const frontierRow = await this.iterationRow(record.id, loopRunId, frontier)
    if (frontierRow?.report != null) {
      return this.evaluateBar(record, loopRunId, frontierRow)
    }
    const prevRow =
      frontier > 0
        ? await this.iterationRow(record.id, loopRunId, frontier - 1)
        : null
    await this.enqueueStep({
      ordinanceId: record.id,
      loopRunId,
      iteration: frontier,
      phase: 'qc',
      expectedInputHash:
        prevRow?.revisedInputHash ?? qualityReportInputHash(record),
      attempt: (frontierRow?.qcAttempts ?? 0) + 1,
    })
    return true
  }

  private async runQcStep(
    record: LoadedOrdinance,
    loopRunId: string,
    iteration: number,
    row: OrdinanceQualityIteration | null,
  ): Promise<boolean> {
    const priorAttempts = row?.qcAttempts ?? 0
    let generated: Awaited<
      ReturnType<OrdinanceQualityReportService['generate']>
    >
    try {
      generated = await this.qualityReports.generate(
        record,
        record.electedOffice.userId,
        {
          models: QUALITY_LOOP_MODELS,
          retries: QUALITY_LOOP_LLM_RETRIES,
          abortSignal: AbortSignal.timeout(QUALITY_LOOP_STEP_TIMEOUT_MS),
        },
      )
    } catch (err) {
      this.logger.error(
        { ordinanceId: record.id, loopRunId, iteration, error: err },
        'quality loop qc step failed',
      )
      return this.failLoop(record, loopRunId)
    }
    const attempts = priorAttempts + 1
    const iterationKey = {
      ordinanceId_loopRunId_iteration: {
        ordinanceId: record.id,
        loopRunId,
        iteration,
      },
    }
    if (generated.degradedCheckIds.length > 0) {
      if (attempts >= MAX_QC_ATTEMPTS_PER_ITERATION) {
        this.logger.error(
          {
            ordinanceId: record.id,
            loopRunId,
            iteration,
            degradedCheckIds: generated.degradedCheckIds,
          },
          'quality loop qc degraded twice; failing the loop',
        )
        return this.failLoop(record, loopRunId)
      }
      // A degraded report never converges and never triggers a revision:
      // persist the attempt on the row and retry the step once.
      await this.client.ordinanceQualityIteration.upsert({
        where: iterationKey,
        create: {
          ordinanceId: record.id,
          loopRunId,
          iteration,
          inputHash: generated.report.ranAgainstBodyHash,
          qcAttempts: attempts,
          draftTitle: record.draftTitle ?? '',
          draftBody: record.draftBody ?? '',
          tokens: generated.tokens,
        },
        update: {
          qcAttempts: attempts,
          tokens: (row?.tokens ?? 0) + generated.tokens,
        },
      })
      await this.enqueueStep({
        ordinanceId: record.id,
        loopRunId,
        iteration,
        phase: 'qc',
        expectedInputHash: generated.report.ranAgainstBodyHash,
        attempt: attempts + 1,
      })
      return true
    }
    let persistedRow: OrdinanceQualityIteration
    try {
      persistedRow = await this.client.$transaction(async (tx) => {
        const fenced = await tx.ordinance.updateMany({
          where: {
            ...this.runningFence(record.id, loopRunId),
            updatedAt: record.updatedAt,
          },
          data: {
            qualityReport: generated.report,
            qualityLoopUpdatedAt: new Date(),
          },
        })
        if (fenced.count === 0) {
          throw new OwnershipLostError()
        }
        return tx.ordinanceQualityIteration.upsert({
          where: iterationKey,
          create: {
            ordinanceId: record.id,
            loopRunId,
            iteration,
            inputHash: generated.report.ranAgainstBodyHash,
            qcAttempts: attempts,
            draftTitle: record.draftTitle ?? '',
            draftBody: record.draftBody ?? '',
            report: generated.report,
            model: QUALITY_LOOP_MODELS[0],
            tokens: generated.tokens,
          },
          update: {
            report: generated.report,
            qcAttempts: attempts,
            model: QUALITY_LOOP_MODELS[0],
            tokens: (row?.tokens ?? 0) + generated.tokens,
          },
        })
      })
    } catch (err) {
      if (err instanceof OwnershipLostError) {
        if (await this.stillOwnsRun(record.id, loopRunId)) {
          this.logger.warn(
            { ordinanceId: record.id, loopRunId, iteration },
            'concurrent write moved updatedAt mid-qc; redelivering step',
          )
          return false
        }
        this.logger.info(
          { ordinanceId: record.id, loopRunId, iteration },
          'quality loop ownership lost mid-qc; discarding result',
        )
        return true
      }
      throw err
    }
    return this.evaluateBar(record, loopRunId, persistedRow)
  }

  private async evaluateBar(
    record: LoadedOrdinance,
    loopRunId: string,
    row: OrdinanceQualityIteration,
  ): Promise<boolean> {
    const parsed = OrdinanceQualityReportSchema.safeParse(row.report)
    if (!parsed.success) {
      this.logger.error(
        { ordinanceId: record.id, loopRunId, iteration: row.iteration },
        'quality loop iteration report failed schema parse',
      )
      return this.failLoop(record, loopRunId)
    }
    const flagged = flaggedIds(parsed.data)
    if (flagged.length === 0) {
      const flipped = await this.flipTerminal(
        record.id,
        loopRunId,
        OrdinanceQualityLoopStatus.converged,
      )
      if (flipped) {
        await this.trackCompleted(
          record,
          loopRunId,
          OrdinanceQualityLoopStatus.converged,
          null,
        )
      }
      return true
    }
    if (row.iteration >= MAX_QUALITY_LOOP_REVISIONS) {
      return this.stopWithRestore(
        record,
        loopRunId,
        OrdinanceQualityLoopStatus.stopped_max_iterations,
      )
    }
    if (row.iteration > 0) {
      const prevRow = await this.iterationRow(
        record.id,
        loopRunId,
        row.iteration - 1,
      )
      const prevParsed = OrdinanceQualityReportSchema.safeParse(prevRow?.report)
      const prevFlagged = prevParsed.success ? flaggedIds(prevParsed.data) : []
      // Strict-improvement rule: continue only when the flagged set properly
      // shrank. A flag that became attention drops out of the set, so it
      // counts as resolved.
      if (!isProperSubset(flagged, prevFlagged)) {
        return this.stopWithRestore(
          record,
          loopRunId,
          OrdinanceQualityLoopStatus.stopped_not_improving,
        )
      }
    }
    await this.enqueueStep({
      ordinanceId: record.id,
      loopRunId,
      iteration: row.iteration,
      phase: 'revise',
      expectedInputHash: row.inputHash,
      attempt: 1,
    })
    return true
  }

  private async runReviseStep(
    record: LoadedOrdinance,
    loopRunId: string,
    row: OrdinanceQualityIteration,
  ): Promise<boolean> {
    const parsed = OrdinanceQualityReportSchema.safeParse(row.report)
    if (!parsed.success) {
      this.logger.error(
        { ordinanceId: record.id, loopRunId, iteration: row.iteration },
        'quality loop revise found an unparseable report',
      )
      return this.failLoop(record, loopRunId)
    }
    const flaggedChecks = parsed.data.checks.filter(
      (check) => check.status === 'flag',
    )
    let revision: Awaited<ReturnType<OrdinanceDraftRevisionService['revise']>>
    // One budget for the whole step, shared by the guard retry: a fresh
    // timeout per attempt would let one message exceed the 300s SQS
    // visibility window and spawn a concurrent twin handler.
    const abortSignal = AbortSignal.timeout(QUALITY_LOOP_STEP_TIMEOUT_MS)
    try {
      try {
        revision = await this.revisions.revise(record, flaggedChecks, {
          abortSignal,
        })
      } catch (err) {
        if (!(err instanceof OrdinanceRevisionGuardError)) {
          throw err
        }
        revision = await this.revisions.revise(record, flaggedChecks, {
          abortSignal,
        })
      }
    } catch (err) {
      this.logger.error(
        {
          ordinanceId: record.id,
          loopRunId,
          iteration: row.iteration,
          error: err,
        },
        'quality loop revise step failed',
      )
      return this.failLoop(record, loopRunId)
    }
    const revisedInputHash = qualityReportInputHash({
      ...record,
      draftTitle: revision.title,
      draftBody: revision.body,
    })
    const mergedSources = this.mergedDraftSources(record, revision.sourcesToAdd)
    let nextHash = revisedInputHash
    try {
      await this.client.$transaction(async (tx) => {
        const fenced = await tx.ordinance.updateMany({
          where: {
            ...this.runningFence(record.id, loopRunId),
            updatedAt: record.updatedAt,
          },
          data: {
            draftTitle: revision.title,
            draftBody: revision.body,
            ...(mergedSources ? { draftSources: mergedSources } : {}),
            qualityLoopIteration: row.iteration + 1,
            qualityLoopUpdatedAt: new Date(),
          },
        })
        if (fenced.count === 0) {
          throw new OwnershipLostError()
        }
        await tx.ordinanceQualityIteration.update({
          where: {
            ordinanceId_loopRunId_iteration: {
              ordinanceId: record.id,
              loopRunId,
              iteration: row.iteration,
            },
          },
          data: {
            revisedTitle: revision.title,
            revisedBody: revision.body,
            revisedInputHash,
            revisionNotes: revision.revisions,
            tokens: (row.tokens ?? 0) + revision.tokens,
          },
        })
      })
    } catch (err) {
      if (!(err instanceof OwnershipLostError)) {
        throw err
      }
      const fresh = await this.stillOwnsRun(record.id, loopRunId)
      if (!fresh) {
        this.logger.info(
          { ordinanceId: record.id, loopRunId, iteration: row.iteration },
          'quality loop ownership lost mid-revise; discarding result',
        )
        return true
      }
      if (fresh.qualityLoopIteration <= row.iteration) {
        // Ownership intact and the frontier did not move: some concurrent
        // non-superseding write merely bumped updatedAt. Retry via
        // redelivery rather than stranding a 'running' loop with no
        // in-flight message.
        this.logger.warn(
          { ordinanceId: record.id, loopRunId, iteration: row.iteration },
          'concurrent write moved updatedAt mid-revise; redelivering step',
        )
        return false
      }
      // A visibility-timeout twin applied this same revision first; keep the
      // loop moving with the hash it recorded.
      const twinRow = await this.iterationRow(
        record.id,
        loopRunId,
        row.iteration,
      )
      nextHash = twinRow?.revisedInputHash ?? qualityReportInputHash(fresh)
    }
    await this.enqueueStep({
      ordinanceId: record.id,
      loopRunId,
      iteration: row.iteration + 1,
      phase: 'qc',
      expectedInputHash: nextHash,
      attempt: 1,
    })
    return true
  }

  @Cron('*/10 * * * *')
  async sweepStalled(): Promise<void> {
    const cutoff = subMinutes(new Date(), QUALITY_LOOP_STALL_MINUTES)
    const swept = await this.model.updateMany({
      where: {
        qualityLoopStatus: OrdinanceQualityLoopStatus.running,
        OR: [
          { qualityLoopUpdatedAt: { lt: cutoff } },
          { qualityLoopUpdatedAt: null },
        ],
      },
      data: {
        qualityLoopStatus: OrdinanceQualityLoopStatus.failed,
        qualityLoopUpdatedAt: new Date(),
      },
    })
    if (swept.count > 0) {
      this.logger.error(
        { count: swept.count },
        'swept stalled ordinance quality loops to failed',
      )
    }
  }

  async listIterations(
    ordinanceId: string,
  ): Promise<OrdinanceQualityIterationsResponse> {
    const record = await this.model.findFirst({
      where: { id: ordinanceId },
    })
    if (!record) {
      throw new NotFoundException('Ordinance not found')
    }
    if (!record.qualityLoopRunId) {
      return { loopRunId: null, iterations: [] }
    }
    const rows = await this.client.ordinanceQualityIteration.findMany({
      where: { ordinanceId, loopRunId: record.qualityLoopRunId },
      orderBy: { iteration: Prisma.SortOrder.asc },
    })
    return OrdinanceQualityIterationsResponseSchema.parse({
      loopRunId: record.qualityLoopRunId,
      iterations: rows.map((row) => {
        const report = OrdinanceQualityReportSchema.safeParse(row.report)
        const notes = RevisionNotesSchema.safeParse(row.revisionNotes)
        return {
          iteration: row.iteration,
          flaggedCheckIds: report.success ? flaggedIds(report.data) : [],
          report: report.success ? report.data : null,
          draftTitle: row.draftTitle,
          draftBody: row.draftBody,
          revisedTitle: row.revisedTitle,
          revisedBody: row.revisedBody,
          revisionNotes: notes.success ? notes.data : null,
          createdAt: row.createdAt.toISOString(),
        }
      }),
    })
  }

  qualityLoopForResponse(
    record: OrdinanceWithLatestIteration,
  ): OrdinanceQualityLoop | null {
    if (!record.qualityLoopStatus) {
      return null
    }
    const running =
      record.qualityLoopStatus === OrdinanceQualityLoopStatus.running
    const qcDoneAtFrontier =
      record.latestIteration != null &&
      record.latestIteration.iteration === record.qualityLoopIteration &&
      record.latestIteration.report !== null
    const phase: OrdinanceQualityLoopPhase | null = !running
      ? null
      : qcDoneAtFrontier
        ? 'revising'
        : 'checking'
    return {
      status: record.qualityLoopStatus,
      phase,
      passNumber: record.qualityLoopIteration + 1,
      maxPasses: MAX_QUALITY_LOOP_REVISIONS + 1,
      updatedAt: (
        record.qualityLoopUpdatedAt ?? record.updatedAt
      ).toISOString(),
    }
  }

  // On a stopped_* terminal, keeping the last (possibly regressed) revision
  // while claiming improvement would misrepresent a legal document: restore
  // the iteration with the smallest flagged set (tie: fewest attentions,
  // then earliest) together with its matching report, atomically with the
  // status flip.
  private async stopWithRestore(
    record: LoadedOrdinance,
    loopRunId: string,
    status: OrdinanceQualityLoopStatus,
  ): Promise<boolean> {
    const rows = await this.client.ordinanceQualityIteration.findMany({
      where: { ordinanceId: record.id, loopRunId },
      orderBy: { iteration: Prisma.SortOrder.asc },
    })
    const graded = rows.flatMap((row) => {
      const parsed = OrdinanceQualityReportSchema.safeParse(row.report)
      return parsed.success ? [{ row, report: parsed.data }] : []
    })
    const best = graded.reduce<(typeof graded)[number] | null>(
      (currentBest, candidate) => {
        if (!currentBest) return candidate
        const a = candidate.report.tally
        const b = currentBest.report.tally
        // Rows are iteration-ascending, so strict < keeps the earliest on
        // ties.
        if (a.flag !== b.flag) {
          return a.flag < b.flag ? candidate : currentBest
        }
        return a.attention < b.attention ? candidate : currentBest
      },
      null,
    )
    const restore = best
      ? {
          draftTitle: best.row.draftTitle,
          draftBody: best.row.draftBody,
          qualityReport: best.report,
        }
      : {}
    const flipped = await this.model.updateMany({
      where: this.runningFence(record.id, loopRunId),
      data: {
        qualityLoopStatus: status,
        qualityLoopUpdatedAt: new Date(),
        ...restore,
      },
    })
    if (flipped.count > 0) {
      await this.trackCompleted(
        record,
        loopRunId,
        status,
        best?.row.iteration ?? null,
      )
    }
    return true
  }

  private async failLoop(
    record: LoadedOrdinance,
    loopRunId: string,
  ): Promise<boolean> {
    const flipped = await this.flipTerminal(
      record.id,
      loopRunId,
      OrdinanceQualityLoopStatus.failed,
    )
    if (flipped) {
      await this.trackCompleted(
        record,
        loopRunId,
        OrdinanceQualityLoopStatus.failed,
        null,
      )
    }
    return true
  }

  private async flipTerminal(
    ordinanceId: string,
    loopRunId: string,
    status: OrdinanceQualityLoopStatus,
  ): Promise<boolean> {
    const flipped = await this.model.updateMany({
      where: this.runningFence(ordinanceId, loopRunId),
      data: {
        qualityLoopStatus: status,
        qualityLoopUpdatedAt: new Date(),
      },
    })
    return flipped.count > 0
  }

  private runningFence(ordinanceId: string, loopRunId: string) {
    return {
      id: ordinanceId,
      qualityLoopStatus: OrdinanceQualityLoopStatus.running,
      qualityLoopRunId: loopRunId,
    }
  }

  private async iterationRow(
    ordinanceId: string,
    loopRunId: string,
    iteration: number,
  ): Promise<OrdinanceQualityIteration | null> {
    return this.client.ordinanceQualityIteration.findUnique({
      where: {
        ordinanceId_loopRunId_iteration: {
          ordinanceId,
          loopRunId,
          iteration,
        },
      },
    })
  }

  private async enqueueStep(data: OrdinanceQualityLoopMessage): Promise<void> {
    await this.producer.sendMessage(
      { type: QueueType.ORDINANCE_QUALITY_LOOP, data },
      `ordinance-quality-loop-${data.ordinanceId}`,
      {
        throwOnError: true,
        deduplicationId:
          `${data.loopRunId}:${data.iteration}:` +
          `${data.phase}:${data.attempt}`,
      },
    )
  }

  // A zero-count fenced write means updatedAt moved, which every Ordinance
  // update does (@updatedAt) — it does NOT by itself mean the run was taken.
  // This re-read distinguishes a real ownership change (cancel/supersede/
  // sweep/newer run: null) from a mere concurrent bump (the fresh row).
  private async stillOwnsRun(
    ordinanceId: string,
    loopRunId: string,
  ): Promise<Ordinance | null> {
    const fresh = await this.model.findFirst({ where: { id: ordinanceId } })
    return fresh &&
      fresh.qualityLoopStatus === OrdinanceQualityLoopStatus.running &&
      fresh.qualityLoopRunId === loopRunId
      ? fresh
      : null
  }

  private mergedDraftSources(
    record: Ordinance,
    sourcesToAdd: OrdinanceSource[],
  ): OrdinanceSource[] | undefined {
    const parsed = z.array(OrdinanceSourceSchema).safeParse(record.draftSources)
    const merged = parsed.success ? [...parsed.data] : []
    for (const source of sourcesToAdd) {
      if (!merged.some((existing) => existing.id === source.id)) {
        merged.push(source)
      }
    }
    return merged.length > 0 ? merged : undefined
  }

  private manualRunActive(record: Ordinance): boolean {
    return (
      record.qualityRunStatus === 'running' &&
      record.qualityRunStartedAt !== null &&
      isAfter(
        record.qualityRunStartedAt,
        subMinutes(new Date(), MANUAL_RUN_STALE_MINUTES),
      )
    )
  }

  private passesBarForCurrentInputs(record: Ordinance): boolean {
    const parsed = OrdinanceQualityReportSchema.safeParse(record.qualityReport)
    return (
      parsed.success &&
      parsed.data.ranAgainstBodyHash === qualityReportInputHash(record) &&
      parsed.data.tally.flag === 0
    )
  }

  private async trackCompleted(
    record: LoadedOrdinance,
    loopRunId: string,
    status: OrdinanceQualityLoopStatus,
    restoredIteration: number | null,
  ): Promise<void> {
    try {
      const rows = await this.client.ordinanceQualityIteration.findMany({
        where: { ordinanceId: record.id, loopRunId },
        orderBy: { iteration: Prisma.SortOrder.asc },
      })
      const firstRow = rows.find((row) => row.iteration === 0)
      const firstParsed = OrdinanceQualityReportSchema.safeParse(
        firstRow?.report,
      )
      const first = firstParsed.success ? firstParsed.data : null
      const fresh = await this.model.findFirst({ where: { id: record.id } })
      const finalParsed = OrdinanceQualityReportSchema.safeParse(
        fresh?.qualityReport,
      )
      const final = finalParsed.success ? finalParsed.data : null
      const flagToAttentionCount =
        first && final
          ? flaggedIds(first).filter((id) =>
              final.checks.some(
                (check) => check.id === id && check.status === 'attention',
              ),
            ).length
          : null
      const props: OrdinanceQualityLoopCompletedProps = {
        status,
        iterations: rows.length,
        flagsBefore: first?.tally.flag ?? null,
        flagsAfter: final?.tally.flag ?? null,
        attentionBefore: first?.tally.attention ?? null,
        attentionAfter: final?.tally.attention ?? null,
        flagToAttentionCount,
        restoredIteration,
        totalTokens: rows.reduce((sum, row) => sum + (row.tokens ?? 0), 0),
      }
      await this.analytics.track(
        record.electedOffice.userId,
        EVENTS.Ordinances.QualityLoopCompleted,
        props,
      )
    } catch (err) {
      this.logger.warn(
        { ordinanceId: record.id, loopRunId, error: err },
        'failed to track quality loop completion',
      )
    }
  }
}

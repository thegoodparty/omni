import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { FeaturesService } from 'src/features/services/features.service'
import {
  type CreateOrdinanceRequest,
  type Ordinance as OrdinanceResponse,
  type OrdinanceClarifyAnswer,
  type OrdinanceListResponse,
  type OrdinanceQualityIterationsResponse,
  type OrdinanceQualityReport,
  type OrdinanceQualityRun,
  type OrdinanceStatusCounts,
  type UpdateOrdinanceRequest,
  OrdinanceClarifyAnswersSchema,
  OrdinanceListResponseSchema,
  OrdinanceQualityReportSchema,
  OrdinanceSchema,
  OrdinanceSummarySchema,
} from '@goodparty_org/contracts'
import {
  ElectedOffice,
  Ordinance,
  OrdinanceQualityLoopStatus,
  OrdinanceStatus,
  Prisma,
} from '../../generated/prisma'
import { MANUAL_RUN_STALE_MINUTES } from '../ordinances.constants'
import { OrdinanceExportFormat } from '../schemas/ordinances.schema'
import {
  OrdinanceExportResult,
  OrdinanceExportService,
} from './ordinanceExport.service'
import {
  OrdinanceQualityReportService,
  qualityReportInputHash,
} from './ordinanceQualityReport.service'
import { OrdinanceQualityLoopService } from './ordinanceQualityLoop.service'
import { type OrdinanceQualityLoopStartReason } from './ordinanceQualityLoop.types'

const SERVE_ORDINANCES_FLAG = 'serve-ordinances'

// A 'running' claim older than this is an interrupted run (the server died
// mid-run and the background writer never came back), not a live one.
const STALE_RUN_MS = MANUAL_RUN_STALE_MINUTES * 60_000

const INTERRUPTED_RUN_MESSAGE =
  'The last run was interrupted. Please try again.'

// Served verbatim to end users; raw provider errors can embed API-key,
// billing, or model detail, so only this fixed string is ever persisted.
const QUALITY_RUN_ERROR_MESSAGE = 'Quality check failed. Please try again.'

@Injectable()
export class OrdinancesService extends createPrismaBase(MODELS.Ordinance) {
  constructor(
    private readonly features: FeaturesService,
    private readonly qualityReports: OrdinanceQualityReportService,
    private readonly exporter: OrdinanceExportService,
    private readonly qualityLoop: OrdinanceQualityLoopService,
  ) {
    super()
  }

  // Render the draft (plus a sources + quality-report appendix with links) as a
  // downloadable PDF or Word document for attorney review.
  async exportDraft(
    electedOffice: ElectedOffice,
    slug: string,
    format: OrdinanceExportFormat,
  ): Promise<OrdinanceExportResult> {
    await this.assertEnabled(electedOffice.userId)
    const existing = await this.findOwnedOrThrow(electedOffice, slug)
    return this.exporter.render(existing, format)
  }

  async create(
    electedOffice: ElectedOffice,
    dto: CreateOrdinanceRequest,
  ): Promise<OrdinanceResponse> {
    await this.assertEnabled(electedOffice.userId)
    const record = await this.model.create({
      data: {
        electedOfficeId: electedOffice.id,
        seedType: dto.seedType,
        issueSlug: dto.issueSlug ?? null,
        sourceLink: dto.sourceLink ?? null,
        goalText: dto.goalText ?? null,
      },
    })
    return this.toResponse(record)
  }

  async list(electedOffice: ElectedOffice): Promise<OrdinanceListResponse> {
    await this.assertEnabled(electedOffice.userId)
    const where = { electedOfficeId: electedOffice.id, deletedAt: null }
    const [records, grouped] = await Promise.all([
      this.model.findMany({
        where,
        orderBy: { updatedAt: Prisma.SortOrder.desc },
      }),
      this.model.groupBy({ by: ['status'], where, _count: { _all: true } }),
    ])
    const counts: OrdinanceStatusCounts = {
      in_progress: 0,
      draft: 0,
      in_review: 0,
      proposed: 0,
      passed: 0,
      repealed: 0,
    }
    for (const group of grouped) {
      counts[group.status] = group._count._all
    }
    return OrdinanceListResponseSchema.parse({
      items: records.map((record) => this.toSummary(record)),
      counts,
    })
  }

  async getBySlug(
    electedOffice: ElectedOffice,
    slug: string,
  ): Promise<OrdinanceResponse> {
    await this.assertEnabled(electedOffice.userId)
    return this.toResponse(await this.findOwnedOrThrow(electedOffice, slug))
  }

  async update(
    electedOffice: ElectedOffice,
    slug: string,
    dto: UpdateOrdinanceRequest,
  ): Promise<OrdinanceResponse> {
    await this.assertEnabled(electedOffice.userId)
    const existing = await this.findOwnedOrThrow(electedOffice, slug)
    // A user edit that changes the loop's graded inputs (or advances the
    // ordinance past draft) invalidates any running quality loop. Changed
    // means changed: a PATCH that resends the current text must not retire a
    // healthy run. The flip happens AFTER the write lands — superseded_by_edit
    // is a write-once terminal, so flipping first would permanently kill the
    // loop if the write then threw; the loop's content-fenced terminals
    // guarantee a not-yet-superseded run still can't overwrite the new draft
    // in the gap.
    const changesHashInput =
      (dto.draftTitle !== undefined &&
        dto.draftTitle !== existing.draftTitle) ||
      (dto.draftBody !== undefined && dto.draftBody !== existing.draftBody)
    const advancesPastDraft =
      dto.status !== undefined &&
      dto.status !== OrdinanceStatus.in_progress &&
      dto.status !== OrdinanceStatus.draft
    const record = await this.model.update({
      where: { id: existing.id },
      data: {
        status: dto.status,
        draftTitle: dto.draftTitle,
        draftBody: dto.draftBody,
        ...(dto.draftSources !== undefined && {
          draftSources: dto.draftSources,
        }),
        lastViewedStep: dto.lastViewedStep,
      },
    })
    if (
      existing.qualityLoopStatus === OrdinanceQualityLoopStatus.running &&
      (changesHashInput || advancesPastDraft)
    ) {
      await this.qualityLoop.supersedeOnEdit(existing.id)
      // Re-read so the response carries the superseded loop, not the
      // pre-flip snapshot from the write above.
      return this.toResponse(
        await this.model.findUniqueOrThrow({ where: { id: existing.id } }),
      )
    }
    return this.toResponse(record)
  }

  // Persist one clarify answer straight from the UI, keyed by the widget's own
  // questionId. Re-answering the same question replaces it rather than
  // duplicating. This is the source of truth for clarify answers; the agent no
  // longer records them.
  async appendClarifyAnswer(
    electedOffice: ElectedOffice,
    slug: string,
    answer: OrdinanceClarifyAnswer,
  ): Promise<OrdinanceResponse> {
    await this.assertEnabled(electedOffice.userId)
    const existing = await this.findOwnedOrThrow(electedOffice, slug)
    const parsed = OrdinanceClarifyAnswersSchema.safeParse(
      existing.clarifyAnswers,
    )
    // A fresh record is null (safeParse fails, [] is the right start). But a
    // non-null blob that fails to parse is malformed stored data; overwriting
    // it would silently destroy prior answers, so refuse instead.
    if (!parsed.success && existing.clarifyAnswers !== null) {
      this.logger.error(
        { ordinanceId: existing.id, error: parsed.error },
        'clarifyAnswers failed schema parse; refusing to overwrite',
      )
      throw new InternalServerErrorException(
        'clarifyAnswers is malformed; cannot safely append',
      )
    }
    const answers = parsed.success ? parsed.data : []
    const next = [
      ...answers.filter((a) => a.questionId !== answer.questionId),
      answer,
    ]
    // Changed means changed: both sides are Zod-normalized (stored answers
    // re-parsed above, the incoming answer by the controller pipe), so a
    // same-content re-submit serializes identically and must not retire a
    // healthy running loop via the write-once superseded_by_edit terminal.
    const changed = JSON.stringify(next) !== JSON.stringify(answers)
    const record = await this.model.update({
      where: { id: existing.id },
      data: { clarifyAnswers: next },
    })
    // clarifyAnswers is a quality-report hash input, so a new answer
    // invalidates a running loop the same way a draft edit does. Flipped
    // AFTER the write: superseded_by_edit is write-once, so flipping first
    // would strand a dead loop if the write threw, and the loop's fenced
    // terminals already keep a not-yet-superseded run off the changed record.
    if (
      changed &&
      existing.qualityLoopStatus === OrdinanceQualityLoopStatus.running
    ) {
      await this.qualityLoop.supersedeOnEdit(existing.id)
      return this.toResponse(
        await this.model.findUniqueOrThrow({ where: { id: existing.id } }),
      )
    }
    return this.toResponse(record)
  }

  async softDelete(electedOffice: ElectedOffice, slug: string): Promise<void> {
    await this.assertEnabled(electedOffice.userId)
    const existing = await this.findOwnedOrThrow(electedOffice, slug)
    await this.model.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    })
  }

  // Start (or join) a background quality-report run. The LLM review takes
  // 30-90s, past proxy/serverless cutoffs, so this claims the run, kicks it
  // off without awaiting, and returns immediately; clients poll getQualityRun
  // until the status leaves 'running'.
  async startQualityReport(
    electedOffice: ElectedOffice,
    slug: string,
  ): Promise<OrdinanceQualityRun> {
    await this.assertEnabled(electedOffice.userId)
    const existing = await this.findOwnedOrThrow(electedOffice, slug)
    if ((existing.draftBody ?? '').trim().length === 0) {
      throw new BadRequestException(
        'Cannot run quality checks on an empty draft',
      )
    }
    // The loop writes qualityReport itself; a concurrent manual run would
    // race those fenced writes. Server-side guard — button state is not one.
    if (existing.qualityLoopStatus === OrdinanceQualityLoopStatus.running) {
      throw new ConflictException(
        'A quality-improvement loop is running for this draft',
      )
    }
    const currentRun = this.toQualityRun(existing)
    if (currentRun.status === 'running') {
      return currentRun
    }
    // Idempotency: if a report already exists for the current draft text,
    // return it as an already-done run instead of spending another LLM call.
    // Makes a re-click or retry on an unchanged draft free. A malformed blob
    // is stale/null and correctly falls through to regenerate.
    const current = this.qualityReportWithStaleness(existing)
    if (current && !current.stale) {
      return {
        status: 'done',
        report: current,
        error: null,
        startedAt: existing.qualityRunStartedAt?.toISOString() ?? null,
      }
    }
    // Atomic claim: only one concurrent POST flips the row to 'running'. A
    // stale startedAt lets a fresh request reclaim an interrupted run.
    const claimedAt = new Date()
    const claimed = await this.model.updateMany({
      where: {
        id: existing.id,
        // findOwnedOrThrow already filters deletedAt, but a DELETE landing in
        // the read→claim window must not let this start a paid run on a
        // tombstoned row.
        deletedAt: null,
        OR: [
          { qualityRunStatus: null },
          { qualityRunStatus: { not: 'running' } },
          { qualityRunStartedAt: { lt: new Date(Date.now() - STALE_RUN_MS) } },
          // `lt` never matches NULL, so a 'running' row with no startedAt
          // could otherwise never be reclaimed.
          { qualityRunStatus: 'running', qualityRunStartedAt: null },
        ],
      },
      data: {
        qualityRunStatus: 'running',
        qualityRunStartedAt: claimedAt,
        qualityRunError: null,
      },
    })
    if (claimed.count === 0) {
      return this.toQualityRun(await this.findOwnedOrThrow(electedOffice, slug))
    }
    void this.runQualityReport(existing, electedOffice.userId, claimedAt)
    return {
      status: 'running',
      report: current,
      error: null,
      startedAt: claimedAt.toISOString(),
    }
  }

  async getQualityRun(
    electedOffice: ElectedOffice,
    slug: string,
  ): Promise<OrdinanceQualityRun> {
    // No feature-flag check here: this sits in the client's 2s polling loop
    // and assertEnabled costs a remote Amplitude evaluation plus a user SELECT
    // per poll. The scoped findFirst is the access boundary; the flag gates
    // run creation (POST), not run-state reads.
    return this.toQualityRun(
      await this.findOwnedForRunOrThrow(electedOffice, slug),
    )
  }

  async startQualityLoop(
    electedOffice: ElectedOffice,
    slug: string,
  ): Promise<OrdinanceResponse> {
    await this.assertEnabled(electedOffice.userId)
    const existing = await this.findOwnedOrThrow(electedOffice, slug)
    const result = await this.qualityLoop.start({
      ordinance: existing,
      userId: electedOffice.userId,
      trigger: 'manual',
    })
    if (!result.started) {
      this.throwForLoopStartReason(result.reason)
    }
    return this.toResponse(await this.findOwnedOrThrow(electedOffice, slug))
  }

  async cancelQualityLoop(
    electedOffice: ElectedOffice,
    slug: string,
  ): Promise<OrdinanceResponse> {
    await this.assertEnabled(electedOffice.userId)
    const existing = await this.findOwnedOrThrow(electedOffice, slug)
    await this.qualityLoop.cancel(existing.id)
    return this.toResponse(await this.findOwnedOrThrow(electedOffice, slug))
  }

  async listQualityIterations(
    electedOffice: ElectedOffice,
    slug: string,
  ): Promise<OrdinanceQualityIterationsResponse> {
    await this.assertEnabled(electedOffice.userId)
    const existing = await this.findOwnedOrThrow(electedOffice, slug)
    return this.qualityLoop.listIterations(existing.id)
  }

  private throwForLoopStartReason(
    reason: OrdinanceQualityLoopStartReason | undefined,
  ): never {
    switch (reason) {
      case 'already_running':
      case 'manual_run_active':
        throw new ConflictException(
          'A quality run is already in progress for this draft',
        )
      case 'flag_off':
      case 'env_off':
        throw new ForbiddenException('Quality loop is not enabled')
      case 'enqueue_failed':
        throw new BadGatewayException(
          'Could not queue the quality loop. Please try again.',
        )
      case 'status_beyond_draft':
        throw new BadRequestException(
          'Quality loop only runs while the ordinance is a draft',
        )
      case 'redline_draft':
        throw new BadRequestException(
          'Quality loop does not support redline drafts',
        )
      case 'already_passing':
        throw new BadRequestException(
          'The current draft already passes all quality checks',
        )
      case 'empty_draft':
      default:
        throw new BadRequestException(
          'Cannot run quality checks on an empty draft',
        )
    }
  }

  // Runs after the HTTP response; must never throw (an unhandled rejection
  // here would take down the process). The startedAt-equals-claimedAt guard on
  // both writes means a superseded zombie run can never clobber a newer claim.
  private async runQualityReport(
    record: Ordinance,
    userId: number,
    claimedAt: Date,
  ): Promise<void> {
    try {
      const { report } = await this.qualityReports.generate(record, userId)
      await this.model.updateMany({
        where: { id: record.id, qualityRunStartedAt: claimedAt },
        data: {
          qualityReport: report,
          qualityRunStatus: 'done',
          qualityRunError: null,
        },
      })
    } catch (err) {
      this.logger.error(
        { ordinanceId: record.id, error: err },
        'ordinance quality run failed',
      )
      try {
        await this.model.updateMany({
          where: { id: record.id, qualityRunStartedAt: claimedAt },
          data: {
            qualityRunStatus: 'error',
            qualityRunError: QUALITY_RUN_ERROR_MESSAGE,
          },
        })
      } catch (persistErr) {
        // Nothing may escape this void'd method — an unhandled rejection here
        // kills the process. Losing the terminal write is acceptable: the
        // read path heals a >10-minute-old 'running' row to a retryable
        // error.
        this.logger.error(
          { ordinanceId: record.id, error: persistErr },
          'quality run failed to persist terminal state',
        )
      }
    }
  }

  private async findOwnedOrThrow(
    electedOffice: ElectedOffice,
    slug: string,
  ): Promise<Ordinance> {
    const record = await this.model.findFirst({
      where: { slug, electedOfficeId: electedOffice.id, deletedAt: null },
    })
    if (!record) {
      throw new NotFoundException('Ordinance not found')
    }
    return record
  }

  // Poll-path read: skips the unbounded research/scratchpad blobs the run
  // envelope never uses, so the client's 2s polling loop doesn't drag them
  // out of Postgres on every tick.
  private async findOwnedForRunOrThrow(
    electedOffice: ElectedOffice,
    slug: string,
  ): Promise<Omit<Ordinance, 'research' | 'scratchpad'>> {
    const record = await this.model.findFirst({
      where: { slug, electedOfficeId: electedOffice.id, deletedAt: null },
      omit: { research: true, scratchpad: true },
    })
    if (!record) {
      throw new NotFoundException('Ordinance not found')
    }
    return record
  }

  private async assertEnabled(userId: number): Promise<void> {
    const enabled = await this.features.isFeatureEnabled({
      user: userId,
      feature: SERVE_ORDINANCES_FLAG,
    })
    if (!enabled) {
      throw new ForbiddenException('Ordinances is not enabled')
    }
  }

  // Derive the run envelope from the raw claim columns. `report` always
  // carries the last completed report (staleness-derived) so a failed or
  // in-flight re-run never costs the client the previous result.
  private toQualityRun(
    record: Omit<Ordinance, 'research' | 'scratchpad'>,
  ): OrdinanceQualityRun {
    const report = this.qualityReportWithStaleness(record)
    const startedAt = record.qualityRunStartedAt?.toISOString() ?? null
    if (record.qualityRunStatus === 'running') {
      const fresh =
        record.qualityRunStartedAt !== null &&
        Date.now() - record.qualityRunStartedAt.getTime() < STALE_RUN_MS
      return fresh
        ? { status: 'running', report, error: null, startedAt }
        : { status: 'error', report, error: INTERRUPTED_RUN_MESSAGE, startedAt }
    }
    if (record.qualityRunStatus === 'error') {
      return {
        status: 'error',
        report,
        error: record.qualityRunError ?? 'Quality check failed',
        startedAt,
      }
    }
    // A null column with a stored report is a run that predates the async
    // columns; it still reads as done.
    if (record.qualityRunStatus === 'done' || report !== null) {
      return { status: 'done', report, error: null, startedAt }
    }
    return { status: 'idle', report, error: null, startedAt }
  }

  private async toResponse(record: Ordinance): Promise<OrdinanceResponse> {
    // Phase derivation needs the frontier iteration row, but only a running
    // loop has a phase — never pay the extra query otherwise.
    const latestIteration =
      record.qualityLoopStatus === OrdinanceQualityLoopStatus.running &&
      record.qualityLoopRunId !== null
        ? await this.client.ordinanceQualityIteration.findUnique({
            where: {
              ordinanceId_loopRunId_iteration: {
                ordinanceId: record.id,
                loopRunId: record.qualityLoopRunId,
                iteration: record.qualityLoopIteration,
              },
            },
          })
        : null
    return OrdinanceSchema.parse({
      ...record,
      qualityReport: this.qualityReportWithStaleness(record),
      // The spread leaves the raw claim column (string | null) here; the
      // schema requires the derived enum, so this must override after it.
      qualityRunStatus: this.toQualityRun(record).status,
      qualityLoop: this.qualityLoop.qualityLoopForResponse({
        ...record,
        latestIteration,
      }),
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    })
  }

  // Derive `stale` on read by comparing the hash the report ran against to the
  // current draft body, so an edit marks the report stale without a write on
  // every keystroke. A malformed stored report reads as no report.
  private qualityReportWithStaleness(
    record: Omit<Ordinance, 'research' | 'scratchpad'>,
  ): OrdinanceQualityReport | null {
    const parsed = OrdinanceQualityReportSchema.safeParse(record.qualityReport)
    if (!parsed.success) {
      // A null blob is just "no report yet". A non-null blob that fails to
      // parse is malformed stored data (e.g. a schema change) — log it so it
      // isn't silently indistinguishable from never-generated.
      if (record.qualityReport !== null) {
        this.logger.error(
          { ordinanceId: record.id, error: parsed.error },
          'qualityReport failed schema parse; treating as no report',
        )
      }
      return null
    }
    return {
      ...parsed.data,
      stale: parsed.data.ranAgainstBodyHash !== qualityReportInputHash(record),
    }
  }

  private toSummary(record: Ordinance) {
    return OrdinanceSummarySchema.parse({
      id: record.id,
      slug: record.slug,
      status: record.status,
      seedType: record.seedType,
      draftTitle: record.draftTitle,
      goalText: record.goalText,
      lastViewedStep: record.lastViewedStep,
      qualityLoopStatus: record.qualityLoopStatus,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    })
  }
}

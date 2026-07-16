import {
  BadRequestException,
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
  type OrdinanceQualityReport,
  type OrdinanceStatusCounts,
  type UpdateOrdinanceRequest,
  OrdinanceClarifyAnswersSchema,
  OrdinanceListResponseSchema,
  OrdinanceQualityReportSchema,
  OrdinanceSchema,
  OrdinanceSummarySchema,
} from '@goodparty_org/contracts'
import { ElectedOffice, Ordinance, Prisma } from '../../generated/prisma'
import {
  OrdinanceQualityReportService,
  qualityReportInputHash,
} from './ordinanceQualityReport.service'

const SERVE_ORDINANCES_FLAG = 'serve-ordinances'

// Lifecycle order; a PATCH may advance an ordinance's status but never regress
// it (matches the saveDraft guard, which only advances from in_progress).
const STATUS_ORDER = [
  'in_progress',
  'draft',
  'in_review',
  'proposed',
  'passed',
  'repealed',
] as const

@Injectable()
export class OrdinancesService extends createPrismaBase(MODELS.Ordinance) {
  constructor(
    private readonly features: FeaturesService,
    private readonly qualityReports: OrdinanceQualityReportService,
  ) {
    super()
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
    if (
      dto.status !== undefined &&
      STATUS_ORDER.indexOf(dto.status) < STATUS_ORDER.indexOf(existing.status)
    ) {
      throw new ForbiddenException(
        `Cannot downgrade ordinance status from '${existing.status}' ` +
          `to '${dto.status}'`,
      )
    }
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
    const record = await this.model.update({
      where: { id: existing.id },
      data: { clarifyAnswers: next },
    })
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

  // Generate (or re-run) the six-check quality report against the current
  // draft. Synchronous: one structured LLM call grounded in the draft and the
  // prior-step artifacts. Persists the report and returns the ordinance.
  async generateQualityReport(
    electedOffice: ElectedOffice,
    slug: string,
  ): Promise<OrdinanceResponse> {
    await this.assertEnabled(electedOffice.userId)
    const existing = await this.findOwnedOrThrow(electedOffice, slug)
    if ((existing.draftBody ?? '').trim().length === 0) {
      throw new BadRequestException(
        'Cannot run quality checks on an empty draft',
      )
    }
    // Idempotency: if a report already exists for the current draft text, return
    // it instead of spending another LLM call. Makes a re-click or retry on an
    // unchanged draft free, and collapses the common double-run to one call. A
    // malformed blob is stale/null and correctly falls through to regenerate.
    const current = this.qualityReportWithStaleness(existing)
    if (current && !current.stale) {
      return this.toResponse(existing)
    }
    const report = await this.qualityReports.generate(
      existing,
      electedOffice.userId,
    )
    const record = await this.model.update({
      where: { id: existing.id },
      data: { qualityReport: report },
    })
    return this.toResponse(record)
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

  private async assertEnabled(userId: number): Promise<void> {
    const enabled = await this.features.isFeatureEnabled({
      user: userId,
      feature: SERVE_ORDINANCES_FLAG,
    })
    if (!enabled) {
      throw new ForbiddenException('Ordinances is not enabled')
    }
  }

  private toResponse(record: Ordinance): OrdinanceResponse {
    return OrdinanceSchema.parse({
      ...record,
      qualityReport: this.qualityReportWithStaleness(record),
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    })
  }

  // Derive `stale` on read by comparing the hash the report ran against to the
  // current draft body, so an edit marks the report stale without a write on
  // every keystroke. A malformed stored report reads as no report.
  private qualityReportWithStaleness(
    record: Ordinance,
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
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    })
  }
}

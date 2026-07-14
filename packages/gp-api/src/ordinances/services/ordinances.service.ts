import {
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
  type OrdinanceStatusCounts,
  type UpdateOrdinanceRequest,
  OrdinanceClarifyAnswersSchema,
  OrdinanceListResponseSchema,
  OrdinanceSchema,
  OrdinanceSummarySchema,
} from '@goodparty_org/contracts'
import { ElectedOffice, Ordinance, Prisma } from '../../generated/prisma'

const SERVE_ORDINANCES_FLAG = 'serve-ordinances'

@Injectable()
export class OrdinancesService extends createPrismaBase(MODELS.Ordinance) {
  constructor(private readonly features: FeaturesService) {
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
    const record = await this.model.update({
      where: { id: existing.id },
      data: {
        status: dto.status,
        draftBody: dto.draftBody,
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
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    })
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

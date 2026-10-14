import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Query,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import { ElectedOffice, User } from '../generated/prisma'
import {
  DashboardCard,
  DashboardCardsQuery,
  DashboardCardsQuerySchema,
  DashboardCardsResponse,
  DashboardCardsResponseSchema,
} from '@goodparty_org/contracts'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { FeaturesService } from '@/features/services/features.service'
import { SERVE_CITIZEN_PANELS_FLAG } from '@/shared/util/serveCitizenPanelsFlag.util'
import { ReqElectedOffice } from '@/electedOffice/decorators/ReqElectedOffice.decorator'
import { UseElectedOffice } from '@/electedOffice/decorators/UseElectedOffice.decorator'
import { DashboardCardsService } from './services/dashboardCards.service'
import {
  DashboardCardIdParam,
  DashboardCardIdParamSchema,
} from './schemas/dashboardCardIdParam.schema'
import { DashboardCard as DashboardCardRow } from '../generated/prisma'

@Controller('dashboard/cards')
export class DashboardCardsController {
  constructor(
    private readonly cards: DashboardCardsService,
    private readonly features: FeaturesService,
  ) {}

  @UseElectedOffice()
  @Get()
  @ResponseSchema(DashboardCardsResponseSchema)
  async list(
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @ReqUser() user: User,
    @Query(new ZodValidationPipe(DashboardCardsQuerySchema))
    { bucket }: DashboardCardsQuery,
  ): Promise<DashboardCardsResponse> {
    const includeCivicPanel = await this.features.isFeatureEnabled({
      user,
      feature: SERVE_CITIZEN_PANELS_FLAG,
    })
    if (includeCivicPanel) {
      await this.cards.syncCivicPanelCards(electedOffice)
      await this.cards.syncReportBackCards(electedOffice)
    }
    const rows = await this.cards.listByBucket(electedOffice.id, bucket, {
      includeCivicPanel,
    })
    return { bucket, cards: rows.map(toDto) }
  }

  @UseElectedOffice()
  @Put(':id/dismiss')
  @HttpCode(HttpStatus.NO_CONTENT)
  async dismiss(
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Param(new ZodValidationPipe(DashboardCardIdParamSchema))
    { id }: DashboardCardIdParam,
  ): Promise<void> {
    await this.cards.dismiss(electedOffice.id, id)
  }

  @UseElectedOffice()
  @Put(':id/complete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async complete(
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Param(new ZodValidationPipe(DashboardCardIdParamSchema))
    { id }: DashboardCardIdParam,
  ): Promise<void> {
    await this.cards.complete(electedOffice.id, id)
  }

  @UseElectedOffice()
  @Put(':id/snooze')
  @HttpCode(HttpStatus.NO_CONTENT)
  async snooze(
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Param(new ZodValidationPipe(DashboardCardIdParamSchema))
    { id }: DashboardCardIdParam,
  ): Promise<void> {
    await this.cards.snooze(electedOffice.id, id)
  }

  @UseElectedOffice()
  @Put(':id/restore')
  @HttpCode(HttpStatus.NO_CONTENT)
  async restore(
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Param(new ZodValidationPipe(DashboardCardIdParamSchema))
    { id }: DashboardCardIdParam,
  ): Promise<void> {
    await this.cards.restore(electedOffice.id, id)
  }
}

const toDto = (row: DashboardCardRow): DashboardCard => ({
  id: row.id,
  type: row.type,
  title: row.title,
  summary: row.summary,
  ctaLabel: row.ctaLabel,
  ctaHref: row.ctaHref,
  dueDate: row.dueDate.toISOString(),
  sourceExternalId: row.sourceExternalId,
  sourceItemId: row.sourceItemId,
  dismissedAt: row.dismissedAt ? row.dismissedAt.toISOString() : null,
  completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

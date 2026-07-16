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
import { ElectedOffice } from '../generated/prisma'
import {
  DashboardCard,
  DashboardCardsQuery,
  DashboardCardsQuerySchema,
  DashboardCardsResponse,
  DashboardCardsResponseSchema,
} from '@goodparty_org/contracts'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
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
  constructor(private readonly cards: DashboardCardsService) {}

  @UseElectedOffice()
  @Get()
  @ResponseSchema(DashboardCardsResponseSchema)
  async list(
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Query(new ZodValidationPipe(DashboardCardsQuerySchema))
    { bucket }: DashboardCardsQuery,
  ): Promise<DashboardCardsResponse> {
    const rows = await this.cards.listByBucket(electedOffice.id, bucket)
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
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

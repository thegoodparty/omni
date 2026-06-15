import { ReqElectedOffice } from '@/electedOffice/decorators/ReqElectedOffice.decorator'
import { UseElectedOffice } from '@/electedOffice/decorators/UseElectedOffice.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { Controller, Get } from '@nestjs/common'
import {
  SupportEstimate,
  SupportEstimateSchema,
} from '@goodparty_org/contracts'
import { ElectedOffice } from '../generated/prisma'
import { SupportEstimateService } from './services/supportEstimate.service'

@Controller('dashboard')
@UseElectedOffice()
export class DashboardController {
  constructor(
    private readonly supportEstimateService: SupportEstimateService,
  ) {}

  @Get('support-estimate')
  @ResponseSchema(SupportEstimateSchema)
  getSupportEstimate(
    @ReqElectedOffice() electedOffice: ElectedOffice,
  ): SupportEstimate {
    return this.supportEstimateService.getSupportEstimate(electedOffice.id)
  }
}

import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import { z } from 'zod'
import { M2MOnly } from '@/authentication/guards/M2MOnly.guard'
import {
  GetPositionByBrIdQueryDTO,
  GetPositionByIdParamsDTO,
} from '@/electionDb/positions/positions.schema'
import { PositionsService } from '@/electionDb/positions/positions.service'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'

// `district` only appears with `?includeDistrict=true`, and the filing-fee
// trio only with `?includeFilingFee=true`. `.parse()` drops keys it does not
// declare, so the full District row the service joins in cannot reach this
// externally-consumed surface — only the four fields named below.
export const positionResponseSchema = z.object({
  id: z.string(),
  brPositionId: z.string(),
  brDatabaseId: z.string(),
  state: z.string(),
  name: z.string().nullish(),
  level: z.string().nullish(),
  isWinIcp: z.boolean().nullish(),
  isServeIcp: z.boolean().nullish(),
  district: z
    .object({
      id: z.string(),
      state: z.string(),
      L2DistrictType: z.string(),
      L2DistrictName: z.string(),
    })
    .nullish(),
  filingFee: z.number().nullish(),
  filingRequirementsText: z.string().nullish(),
  filingFeeExtractionSource: z.string().nullish(),
})

@Controller('elections/positions')
@UsePipes(ZodValidationPipe)
@UseInterceptors(ZodResponseInterceptor)
export class ElectionPositionsController {
  constructor(private readonly positions: PositionsService) {}

  @UseGuards(M2MOnly)
  @Get(':id')
  @ResponseSchema(positionResponseSchema)
  async getPositionById(
    @Param() params: GetPositionByIdParamsDTO,
    @Query() query: GetPositionByBrIdQueryDTO,
  ) {
    const { includeDistrict, electionDate, includeFilingFee } = query
    return this.positions.getPositionById({
      id: params.id,
      includeDistrict: includeDistrict,
      electionDate: electionDate,
      includeFilingFee: includeFilingFee,
    })
  }
}

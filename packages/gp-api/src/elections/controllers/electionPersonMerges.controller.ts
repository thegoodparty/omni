import {
  Controller,
  Get,
  Param,
  UseGuards,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import { z } from 'zod'
import { PublicAccess } from '@/authentication/decorators/PublicAccess.decorator'
import { ServiceReadGuard } from '@/authentication/guards/ServiceRead.guard'
import { GetPersonMergeParamsDTO } from '@/electionDb/personMerges/person-merges.schema'
import { PersonMergesService } from '@/electionDb/personMerges/person-merges.service'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ServiceReadConcurrencyInterceptor } from '@/elections/interceptors/serviceReadConcurrency.interceptor'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'

// gp-marketing's /people/<name>-<full-uuid> pages follow this to the person a
// purged duplicate was folded into. A row is two ids, the retired slug and a
// timestamp; nothing on it is PII.
export const personMergeResponseSchema = z.object({
  retiredId: z.string(),
  survivingId: z.string(),
  retiredSlug: z.string().nullish(),
  retiredAt: z.date(),
})

@Controller('elections/person-merges')
@UsePipes(ZodValidationPipe)
@UseInterceptors(ServiceReadConcurrencyInterceptor, ZodResponseInterceptor)
export class ElectionPersonMergesController {
  constructor(private readonly personMerges: PersonMergesService) {}

  @PublicAccess()
  @UseGuards(ServiceReadGuard)
  @Get(':retiredId')
  @ResponseSchema(personMergeResponseSchema)
  async getPersonMerge(@Param() params: GetPersonMergeParamsDTO) {
    return this.personMerges.getPersonMerge(params.retiredId)
  }
}

import { Controller, Get, Param, UseInterceptors } from '@nestjs/common'
import { User } from '@/generated/prisma'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { OrdinanceCodeResponseSchema } from './schemas/getOrdinanceCode.schema'
import { OrdinanceCodeReadService } from './services/ordinanceCodeRead.service'

@Controller('organizations/:slug/ordinance-code')
@UseInterceptors(ZodResponseInterceptor)
export class OrdinancesController {
  constructor(private readonly ordinanceCode: OrdinanceCodeReadService) {}

  @Get()
  @ResponseSchema(OrdinanceCodeResponseSchema)
  getOrdinanceCode(@Param('slug') slug: string, @ReqUser() user: User) {
    return this.ordinanceCode.getForOwner(user.id, slug)
  }
}

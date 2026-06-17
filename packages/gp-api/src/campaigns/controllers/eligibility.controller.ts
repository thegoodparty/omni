import { Controller, Get, UseInterceptors, UsePipes } from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import { Eligibility, EligibilitySchema } from '@goodparty_org/contracts'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { User } from '../../generated/prisma'
import { EligibilityService } from '../services/eligibility.service'

@Controller('eligibility')
@UsePipes(ZodValidationPipe)
@UseInterceptors(ZodResponseInterceptor)
export class EligibilityController {
  constructor(private readonly eligibility: EligibilityService) {}

  @Get('/')
  @ResponseSchema(EligibilitySchema)
  async getEligibility(@ReqUser() user: User): Promise<Eligibility> {
    return this.eligibility.evaluate(user.id)
  }
}

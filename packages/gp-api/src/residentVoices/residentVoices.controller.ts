import { Controller, Get, UseInterceptors } from '@nestjs/common'
import { ResidentVoicesResponseSchema } from '@goodparty_org/contracts'
import type { Organization } from '@/generated/prisma'
import { ReqOrganization } from '@/organizations/decorators/ReqOrganization.decorator'
import { UseOrganization } from '@/organizations/decorators/UseOrganization.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { ResidentVoicesService } from './services/residentVoices.service'

@Controller('resident-voices')
@UseOrganization()
@UseInterceptors(ZodResponseInterceptor)
export class ResidentVoicesController {
  constructor(private readonly residentVoices: ResidentVoicesService) {}

  @Get()
  @ResponseSchema(ResidentVoicesResponseSchema)
  list(@ReqOrganization() organization: Organization) {
    return this.residentVoices.forOrganization(organization)
  }
}

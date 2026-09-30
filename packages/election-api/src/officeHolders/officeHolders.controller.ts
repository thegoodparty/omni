import { Controller, Get, Query, UseInterceptors } from '@nestjs/common'
import { BulkListConcurrencyInterceptor } from 'src/shared/interceptors/bulk-list-concurrency.interceptor'
import { OfficeHoldersService } from './officeHolders.service'
import { OfficeHolderFilterDto } from './officeHolders.schema'

@Controller('officeholders')
export class OfficeHoldersController {
  constructor(private readonly officeHoldersService: OfficeHoldersService) {}

  // A whole state on this route measured 6.9 MB and 8.2 s in prod, holding one
  // of the task's 25 Prisma connections throughout. See the interceptor.
  @UseInterceptors(BulkListConcurrencyInterceptor)
  @Get()
  async getOfficeHolders(@Query() filterDto: OfficeHolderFilterDto) {
    return this.officeHoldersService.getOfficeHolders(filterDto)
  }
}

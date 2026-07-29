import { Controller, Get, Query } from '@nestjs/common'
import { OfficeHoldersService } from './officeHolders.service'
import { OfficeHolderFilterDto } from './officeHolders.schema'

@Controller('officeholders')
export class OfficeHoldersController {
  constructor(private readonly officeHoldersService: OfficeHoldersService) {}

  @Get()
  async getOfficeHolders(@Query() filterDto: OfficeHolderFilterDto) {
    return this.officeHoldersService.getOfficeHolders(filterDto)
  }
}

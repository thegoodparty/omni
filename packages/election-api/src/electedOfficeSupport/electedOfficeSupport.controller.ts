import { Controller, Get, NotFoundException, Query } from '@nestjs/common'
import { ElectedOfficeSupportService } from './electedOfficeSupport.service'
import { ElectedOfficeSupportQueryDTO } from './electedOfficeSupport.schema'

@Controller('elected-office-support')
export class ElectedOfficeSupportController {
  constructor(
    private readonly electedOfficeSupportService: ElectedOfficeSupportService,
  ) {}

  @Get()
  async getByElectedOfficeId(@Query() dto: ElectedOfficeSupportQueryDTO) {
    const record = await this.electedOfficeSupportService.getByElectedOfficeId(
      dto.electedOfficeId,
    )
    if (!record) {
      throw new NotFoundException(
        `No constituent-support row for elected office ${dto.electedOfficeId}`,
      )
    }
    return record
  }
}

import { Controller, Get, Param, Query } from '@nestjs/common'
import { PersonMergesService } from './person-merges.service'
import {
  GetPersonMergeParamsDTO,
  PersonMergeFilterDto,
} from './person-merges.schema'

// Forwarding addresses for canonical persons the data team has purged as
// duplicates. Read-only, like every persons route, and M2M-only via the
// default-deny guard in AuthenticationModule.
//
// Nothing here is PII or is rendered into a page: a row is two ids and a
// timestamp. It sits on its own controller rather than under /persons because
// its subject is precisely the ids that are NOT persons any more.
@Controller('person-merges')
export class PersonMergesController {
  constructor(private readonly personMergesService: PersonMergesService) {}

  @Get()
  async getPersonMerges(@Query() filterDto: PersonMergeFilterDto) {
    return this.personMergesService.getPersonMerges(filterDto)
  }

  @Get(':retiredId')
  async getPersonMerge(@Param() params: GetPersonMergeParamsDTO) {
    return this.personMergesService.getPersonMerge(params.retiredId)
  }
}

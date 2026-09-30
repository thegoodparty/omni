import { Controller, Get, Query, UseInterceptors } from '@nestjs/common'
import { BulkListConcurrencyInterceptor } from 'src/shared/interceptors/bulk-list-concurrency.interceptor'
import { CandidaciesService } from './candidacies.service'
import { CandidacyFilterDto } from './candidacies.schema'

@Controller('candidacies')
export class CandidaciesController {
  constructor(private readonly candidaciesService: CandidaciesService) {}

  // Unpaginated like the other two state-wide lists, and swept the same way.
  // See the interceptor for why the concurrency is bounded here.
  @UseInterceptors(BulkListConcurrencyInterceptor)
  @Get()
  async getCandidates(@Query() filterDto: CandidacyFilterDto) {
    return await this.candidaciesService.getCandidacies(filterDto)
  }
}

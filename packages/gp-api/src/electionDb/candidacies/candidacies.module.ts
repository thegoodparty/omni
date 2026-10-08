import { Module } from '@nestjs/common'
import { CandidaciesService } from './candidacies.service'

@Module({
  providers: [CandidaciesService],
  exports: [CandidaciesService],
})
export class CandidaciesModule {}

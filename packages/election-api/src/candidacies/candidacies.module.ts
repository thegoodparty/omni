import { Module } from '@nestjs/common'
import { PersonRemovalsModule } from 'src/personRemovals/personRemovals.module'
import { CandidaciesController } from './candidacies.controller'
import { CandidaciesService } from './candidacies.service'

@Module({
  imports: [PersonRemovalsModule],
  controllers: [CandidaciesController],
  providers: [CandidaciesService],
})
export class CandidaciesModule {}

import { Module } from '@nestjs/common'
import { RecommendedListsComputeService } from './services/recommendedListsCompute.service'

@Module({
  providers: [RecommendedListsComputeService],
  exports: [RecommendedListsComputeService],
})
export class RecommendedListsModule {}

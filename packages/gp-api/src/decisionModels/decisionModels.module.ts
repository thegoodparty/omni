import { Module } from '@nestjs/common'
import { DecisionModelService } from './services/decisionModel.service'

@Module({
  providers: [DecisionModelService],
  exports: [DecisionModelService],
})
export class DecisionModelsModule {}

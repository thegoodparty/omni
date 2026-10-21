import { Module } from '@nestjs/common'
import { ProjectedTurnoutService } from './projectedTurnout.service'

@Module({
  providers: [ProjectedTurnoutService],
  exports: [ProjectedTurnoutService],
})
export class ProjectedTurnoutModule {}

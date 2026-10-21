import { Module } from '@nestjs/common'
import { JudgeController } from './judge.controller'
import { JudgeTurnTelemetryService } from './services/judgeTurnTelemetry.service'

@Module({
  controllers: [JudgeController],
  providers: [JudgeTurnTelemetryService],
  exports: [JudgeTurnTelemetryService],
})
export class JudgeModule {}

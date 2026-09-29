import { Module } from '@nestjs/common'
import { PositionsService } from './positions.service'

@Module({
  providers: [PositionsService],
  exports: [PositionsService],
})
export class PositionsModule {}

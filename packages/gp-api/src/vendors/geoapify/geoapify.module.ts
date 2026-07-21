import { Module } from '@nestjs/common'
import { GeoapifyRoutePlannerService } from './services/geoapifyRoutePlanner.service'

@Module({
  providers: [GeoapifyRoutePlannerService],
  exports: [GeoapifyRoutePlannerService],
})
export class GeoapifyModule {}

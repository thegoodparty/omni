import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { GeoapifyRoutePlannerService } from './services/geoapifyRoutePlanner.service'

@Module({
  imports: [HttpModule],
  providers: [GeoapifyRoutePlannerService],
  exports: [GeoapifyRoutePlannerService],
})
export class GeoapifyModule {}

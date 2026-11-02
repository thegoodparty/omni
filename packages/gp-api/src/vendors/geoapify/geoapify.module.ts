import { Module } from '@nestjs/common'
import { GeoapifyRoutePlannerService } from './services/geoapifyRoutePlanner.service'
import { GeoapifyReverseGeocodeService } from './services/geoapifyReverseGeocode.service'

@Module({
  providers: [GeoapifyRoutePlannerService, GeoapifyReverseGeocodeService],
  exports: [GeoapifyRoutePlannerService, GeoapifyReverseGeocodeService],
})
export class GeoapifyModule {}

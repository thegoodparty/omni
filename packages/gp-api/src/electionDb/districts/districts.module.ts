import { Module } from '@nestjs/common'
import { DistrictsService } from './districts.service'

@Module({
  providers: [DistrictsService],
  exports: [DistrictsService],
})
export class DistrictsModule {}

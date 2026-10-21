import { Module } from '@nestjs/common'
import { PlacesService } from './places.service'
import { ElectionDbModule } from '@/electionDb/electionDb.module'

@Module({
  providers: [PlacesService],
  exports: [PlacesService],
  imports: [ElectionDbModule],
})
export class PlacesModule {}

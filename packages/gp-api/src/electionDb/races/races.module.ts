import { Module } from '@nestjs/common'
import { RacesService } from './races.service'
import { ElectionDbModule } from '@/electionDb/electionDb.module'

@Module({
  providers: [RacesService],
  exports: [RacesService],
  imports: [ElectionDbModule],
})
export class RacesModule {}

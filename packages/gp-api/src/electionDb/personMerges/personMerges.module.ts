import { Module } from '@nestjs/common'
import { PersonMergesService } from './person-merges.service'

@Module({
  providers: [PersonMergesService],
  exports: [PersonMergesService],
})
export class PersonMergesModule {}

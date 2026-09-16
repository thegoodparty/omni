import { Module } from '@nestjs/common'
import { PersonMergesController } from './person-merges.controller'
import { PersonMergesService } from './person-merges.service'

@Module({
  controllers: [PersonMergesController],
  providers: [PersonMergesService],
})
export class PersonMergesModule {}

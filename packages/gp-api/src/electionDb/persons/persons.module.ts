import { Module } from '@nestjs/common'
import { PersonsService } from './persons.service'

@Module({
  providers: [PersonsService],
  exports: [PersonsService],
})
export class PersonsModule {}

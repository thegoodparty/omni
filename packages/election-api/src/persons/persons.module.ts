import { Module } from '@nestjs/common'
import { PersonRemovalsModule } from 'src/personRemovals/personRemovals.module'
import { PersonsController } from './persons.controller'
import { PersonsService } from './persons.service'

@Module({
  imports: [PersonRemovalsModule],
  controllers: [PersonsController],
  providers: [PersonsService],
})
export class PersonsModule {}

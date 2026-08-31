import { Module } from '@nestjs/common'
import { PersonRemovalsController } from './personRemovals.controller'
import { PersonRemovalsService } from './personRemovals.service'

@Module({
  controllers: [PersonRemovalsController],
  providers: [PersonRemovalsService],
  // Candidacies and Persons read the removal set on every response.
  exports: [PersonRemovalsService],
})
export class PersonRemovalsModule {}

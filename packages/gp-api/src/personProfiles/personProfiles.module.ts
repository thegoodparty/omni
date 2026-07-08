import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { PublicPersonProfilesController } from './controllers/public-person-profiles.controller'
import { PersonProfilesController } from './controllers/person-profiles.controller'
import { PersonProfilesService } from './services/person-profiles.service'
import { MarketingRevalidationService } from './services/marketing-revalidation.service'

@Module({
  imports: [HttpModule],
  controllers: [PublicPersonProfilesController, PersonProfilesController],
  providers: [PersonProfilesService, MarketingRevalidationService],
  exports: [PersonProfilesService],
})
export class PersonProfilesModule {}

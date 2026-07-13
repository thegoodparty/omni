import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { PublicPersonProfilesController } from './controllers/public-person-profiles.controller'
import { PersonProfilesController } from './controllers/person-profiles.controller'
import { PersonProfilesService } from './services/person-profiles.service'
import { MarketingRevalidationService } from './services/marketing-revalidation.service'
import { VoterDensityProxyService } from './services/voter-density-proxy.service'

@Module({
  imports: [HttpModule],
  controllers: [PublicPersonProfilesController, PersonProfilesController],
  providers: [
    PersonProfilesService,
    MarketingRevalidationService,
    VoterDensityProxyService,
  ],
  exports: [PersonProfilesService],
})
export class PersonProfilesModule {}

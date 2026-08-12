import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { AwsModule } from '@/vendors/aws/aws.module'
import { ClerkModule } from '@/vendors/clerk/clerk.module'
import { CronModule } from '@/cron/cron.module'
import { ElectionsModule } from '@/elections/elections.module'
import { PublicPersonProfilesController } from './controllers/public-person-profiles.controller'
import { PersonProfilesController } from './controllers/person-profiles.controller'
import { PersonProfilesService } from './services/person-profiles.service'
import { MarketingRevalidationService } from './services/marketing-revalidation.service'
import { VoterDensityProxyService } from './services/voter-density-proxy.service'
import { PersonIdBackfillService } from './services/person-id-backfill.service'
import { PersonIdReconcileService } from './services/person-id-reconcile.service'

// ElectionsModule provides the S2S client that reads person.gp_api_user_id;
// CronModule provides the daily-run lock for the reconcile backstop; ClerkModule
// provides ElectionApiTokenService so VoterDensityProxyService can authenticate its
// election-api reads. UsersService is global, so no explicit UsersModule import is
// needed for the User write.
@Module({
  imports: [HttpModule, AwsModule, CronModule, ElectionsModule, ClerkModule],
  controllers: [PublicPersonProfilesController, PersonProfilesController],
  providers: [
    PersonProfilesService,
    MarketingRevalidationService,
    VoterDensityProxyService,
    PersonIdBackfillService,
    PersonIdReconcileService,
  ],
  exports: [PersonProfilesService],
})
export class PersonProfilesModule {}

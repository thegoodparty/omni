import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { AwsModule } from '@/vendors/aws/aws.module'
import { PeopleQueryModule } from '@/peopleDb/peopleQuery.module'
import { ClerkModule } from '@/vendors/clerk/clerk.module'
import { CronModule } from '@/cron/cron.module'
import { CrmModule } from '@/crm/crmModule'
import { ElectionsModule } from '@/elections/elections.module'
import { DatabricksSqlProvider } from '@/llm/tools/databricksProvider'
import { resolveDatabricksConnection } from '@/llm/tools/databricksConnection'
import type { DatabricksProvider } from '@/llm/tools/queryDatabricks.tool'
import { PublicPersonProfilesController } from './controllers/public-person-profiles.controller'
import { PersonProfilesController } from './controllers/person-profiles.controller'
import { PersonProfilesService } from './services/person-profiles.service'
import { CrmPersonProfilesService } from './services/crm-person-profiles.service'
import { MarketingRevalidationService } from './services/marketing-revalidation.service'
import { VoterDensityProxyService } from './services/voter-density-proxy.service'
import { PersonIdBackfillService } from './services/person-id-backfill.service'
import { PersonIdReconcileService } from './services/person-id-reconcile.service'
import { PERSON_PROFILES_DATABRICKS } from './personProfiles.constants'

// Single-row identifier lookups against the civics person mart, on the shared
// Serve warehouse credential (DATABRICKS_*) — the same one briefing-chats and
// chief-of-staff use. Returns null unless host/path + a credential are
// configured, so with nothing set the CRM sync reports "no contact" and skips
// instead of erroring on every public claim submission.
const civicsDatabricksProviderFactory = (): DatabricksProvider | null => {
  const conn = resolveDatabricksConnection()
  if (!conn) return null
  return new DatabricksSqlProvider({
    ...conn,
    catalog: 'goodparty_data_catalog',
    schema: 'mart_civics',
  })
}

// ElectionsModule provides the S2S client that reads person.gp_api_user_id;
// CronModule provides the daily-run lock for the reconcile backstop; CrmModule
// provides the HubSpot client for the claim-request counter; ClerkModule
// provides ElectionApiTokenService so VoterDensityProxyService can authenticate its
// election-api reads. UsersService is global, so no explicit UsersModule import is
// needed for the User write.
@Module({
  imports: [
    HttpModule,
    AwsModule,
    PeopleQueryModule,
    CronModule,
    CrmModule,
    ElectionsModule,
    ClerkModule,
  ],
  controllers: [PublicPersonProfilesController, PersonProfilesController],
  providers: [
    PersonProfilesService,
    CrmPersonProfilesService,
    MarketingRevalidationService,
    VoterDensityProxyService,
    PersonIdBackfillService,
    PersonIdReconcileService,
    {
      provide: PERSON_PROFILES_DATABRICKS,
      useFactory: civicsDatabricksProviderFactory,
    },
  ],
  exports: [PersonProfilesService],
})
export class PersonProfilesModule {}

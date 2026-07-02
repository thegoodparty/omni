// OrganizationsModule must load BEFORE ElectionsModule (mirrors the Chief of
// Staff module): ElectionsModule transitively imports AiModule which uses
// forwardRef(OrganizationsModule), so loading Elections first resolves the
// forwardRef to undefined and bootstrap fails.
import { OrganizationsModule } from '@/organizations/organizations.module'
import { ElectionsModule } from '@/elections/elections.module'
import { Module } from '@nestjs/common'
import { FeaturesModule } from '@/features/features.module'
import { ChatsModule } from '@/chats/chats.module'
import { CampaignStoryModule } from '@/campaignStory/campaignStory.module'
import { WebsitesModule } from '@/websites/websites.module'
import { CampaignStrategyModule } from '@/campaignStrategy/campaignStrategy.module'
import { DatabricksSqlProvider } from '@/llm/tools/databricksProvider'
import { resolveDatabricksConnection } from '@/llm/tools/databricksConnection'
import type { DatabricksProvider } from '@/llm/tools/queryDatabricks.tool'
import { DistrictResolverService } from '@/chats/briefing-chats/services/districtResolver.service'
import { CONSTITUENT_TABLES } from '../chief-of-staff/services/constituentDataScope'
import { GeneralChatStoreService } from '../services/generalChatStore.prisma'
import { CampaignStoryIntakeService } from './campaignStoryIntake.service'
import {
  CAMPAIGN_MANAGER_MODELS,
  CampaignManagerHandler,
  CM_CONSTITUENT_DATA_PROVIDER,
  CM_CONSTITUENT_TABLES_CONFIG,
} from './campaignManager.handler'

export { CAMPAIGN_MANAGER_MODELS }

// Aggregate-only Databricks provider for the constituent-data tool. Reads the
// SAME shared Databricks credential Chief of Staff and the briefing chat use
// (OAuth M2M or a PAT fallback — see resolveDatabricksConnection), against the
// serve_agent_voters mart. Returns null unless host/path and a credential are
// set, so with nothing configured the tool never registers. No separate Win
// warehouse identity: the aggregate-only safety is the app-layer scope
// (allowlist + forbidden columns + cell-size floor), not the credential.
const constituentDataProviderFactory = (): DatabricksProvider | null => {
  const conn = resolveDatabricksConnection()
  if (!conn) return null
  return new DatabricksSqlProvider({
    ...conn,
    catalog: 'goodparty_data_catalog',
    schema: 'mart_serve_agents',
  })
}

// Registers the campaign_assistant scope handler. Exported so the general chats
// module can collect it into the scope registry. Imports ChatsModule for the
// shared ChatStoreService (greeting seeding), Organizations/Elections/Features
// for the reused constituent-data tool (district resolution + flag), and
// CampaignStory/Websites/CampaignStrategy for the Campaign Story intake (story +
// website bio/issues + plan generation).
@Module({
  imports: [
    ChatsModule,
    OrganizationsModule,
    ElectionsModule,
    FeaturesModule,
    CampaignStoryModule,
    WebsitesModule,
    CampaignStrategyModule,
  ],
  providers: [
    CampaignManagerHandler,
    GeneralChatStoreService,
    DistrictResolverService,
    CampaignStoryIntakeService,
    {
      provide: CM_CONSTITUENT_DATA_PROVIDER,
      useFactory: constituentDataProviderFactory,
    },
    {
      provide: CM_CONSTITUENT_TABLES_CONFIG,
      useValue: CONSTITUENT_TABLES,
    },
  ],
  exports: [CampaignManagerHandler],
})
export class CampaignManagerModule {}

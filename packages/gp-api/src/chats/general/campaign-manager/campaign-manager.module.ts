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
import { ContactsModule } from '@/contacts/contacts.module'
import { DatabricksSqlProvider } from '@/llm/tools/databricksProvider'
import { resolveDatabricksConnection } from '@/llm/tools/databricksConnection'
import type { DatabricksProvider } from '@/llm/tools/queryDatabricks.tool'
import { DistrictResolverService } from '@/chats/briefing-chats/services/districtResolver.service'
import { WIN_CONSTITUENT_TABLES } from './services/constituentDataScope'
import { GeneralChatStoreService } from '../services/generalChatStore.prisma'
import { CampaignStoryIntakeService } from './campaignStoryIntake.service'
import {
  CAMPAIGN_MANAGER_MODELS,
  CampaignManagerHandler,
  CM_CONSTITUENT_DATA_PROVIDER,
  CM_CONSTITUENT_TABLES_CONFIG,
} from './campaignManager.handler'

export { CAMPAIGN_MANAGER_MODELS }

// Aggregate-only Databricks provider for the constituent-data tool, on Win's
// own warehouse identity: the sp_win_agent service principal + dedicated
// warehouse (WIN_DATABRICKS_* env), against the win_agent_voters mart —
// NOT the shared Serve credential. Returns null unless host/path and a
// credential are set, so with nothing configured the tool never registers.
// Aggregate-only safety stays app-layer (allowlist + forbidden columns +
// cell-size floor); the dedicated credential adds the governance boundary.
const constituentDataProviderFactory = (): DatabricksProvider | null => {
  const conn = resolveDatabricksConnection('WIN_DATABRICKS_')
  if (!conn) return null
  return new DatabricksSqlProvider({
    ...conn,
    catalog: 'goodparty_data_catalog',
    schema: 'mart_win_agents',
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
    ContactsModule,
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
      useValue: WIN_CONSTITUENT_TABLES,
    },
  ],
  exports: [CampaignManagerHandler],
})
export class CampaignManagerModule {}

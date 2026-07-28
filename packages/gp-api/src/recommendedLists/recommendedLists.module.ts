// OrganizationsModule must load BEFORE ElectionsModule (mirrors the Campaign
// Manager / Race Opponent modules): ElectionsModule transitively imports
// AiModule which uses forwardRef(OrganizationsModule), so loading Elections
// first resolves the forwardRef to undefined and bootstrap fails.
import { OrganizationsModule } from '@/organizations/organizations.module'
import { ElectionsModule } from '@/elections/elections.module'
import { Module } from '@nestjs/common'
import { ClerkModule } from '@/vendors/clerk/clerk.module'
import { FeaturesModule } from '@/features/features.module'
import { QueueProducerModule } from '@/queue/producer/queueProducer.module'
import { DatabricksSqlProvider } from '@/llm/tools/databricksProvider'
import { resolveDatabricksConnection } from '@/llm/tools/databricksConnection'
import type { DatabricksProvider } from '@/llm/tools/queryDatabricks.tool'
import { DistrictResolverService } from '@/chats/briefing-chats/services/districtResolver.service'
import { RecommendedListsController } from './recommendedLists.controller'
import { RecommendedListsService } from './services/recommendedLists.service'
import { RecommendedListsComputeService } from './services/recommendedListsCompute.service'
import { RECOMMENDED_LISTS_DATABRICKS } from './recommendedLists.constants'

// Aggregate-only Databricks provider on Win's own warehouse identity
// (sp_win_agent, WIN_DATABRICKS_* env) against the win_agent_voters mart —
// the same dedicated credential Campaign Manager uses, NOT the shared Serve
// credential. Returns null unless host/path + a credential are configured, so
// with nothing set the snapshot service reports 'unavailable' rather than
// queuing a recompute that can't run.
const winDatabricksProviderFactory = (): DatabricksProvider | null => {
  const conn = resolveDatabricksConnection('WIN_DATABRICKS_')
  if (!conn) return null
  return new DatabricksSqlProvider({
    ...conn,
    catalog: 'goodparty_data_catalog',
    schema: 'mart_win_agents',
  })
}

@Module({
  imports: [
    ClerkModule,
    OrganizationsModule,
    ElectionsModule,
    FeaturesModule,
    QueueProducerModule,
  ],
  controllers: [RecommendedListsController],
  providers: [
    RecommendedListsService,
    RecommendedListsComputeService,
    DistrictResolverService,
    {
      provide: RECOMMENDED_LISTS_DATABRICKS,
      useFactory: winDatabricksProviderFactory,
    },
  ],
  exports: [RecommendedListsComputeService],
})
export class RecommendedListsModule {}

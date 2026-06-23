// OrganizationsModule must load BEFORE ElectionsModule. ElectionsModule
// transitively imports AiModule which uses forwardRef(OrganizationsModule);
// if Organizations starts loading after Elections, the forwardRef resolves
// to undefined during Nest's module scan and bootstrap fails.
import { OrganizationsModule } from '@/organizations/organizations.module'
import { ChatsModule } from '@/chats/chats.module'
import { ElectionsModule } from '@/elections/elections.module'
import { DatabricksSqlProvider } from '@/llm/tools/databricksProvider'
import { resolveDatabricksConnection } from '@/llm/tools/databricksConnection'
import type { DatabricksProvider } from '@/llm/tools/queryDatabricks.tool'
import { AwsModule } from '@/vendors/aws/aws.module'
import { Module } from '@nestjs/common'
import { BriefingChatsController } from './controllers/briefing-chats.controller'
import {
  BRIEFING_CHATS_DATABRICKS_PROVIDER,
  BriefingChatsService,
} from './services/briefing-chats.service'
import { BriefingArtifactCacheService } from './services/briefingArtifactCache.service'
import { BriefingChatCreateService } from './services/briefingChatCreate.service'
import { BriefingContextService } from './services/briefingContext.service'
import { BriefingNotesService } from './services/briefingNotes.service'
import { DistrictResolverService } from './services/districtResolver.service'

const databricksProviderFactory = (): DatabricksProvider | null => {
  const conn = resolveDatabricksConnection()
  if (!conn) return null
  return new DatabricksSqlProvider({
    ...conn,
    catalog: 'goodparty_data_catalog',
    schema: 'mart_serve_agents',
  })
}

@Module({
  imports: [ChatsModule, AwsModule, OrganizationsModule, ElectionsModule],
  controllers: [BriefingChatsController],
  providers: [
    BriefingChatsService,
    BriefingChatCreateService,
    BriefingContextService,
    BriefingArtifactCacheService,
    BriefingNotesService,
    DistrictResolverService,
    {
      provide: BRIEFING_CHATS_DATABRICKS_PROVIDER,
      useFactory: databricksProviderFactory,
    },
  ],
  exports: [BriefingChatsService],
})
export class BriefingChatsModule {}

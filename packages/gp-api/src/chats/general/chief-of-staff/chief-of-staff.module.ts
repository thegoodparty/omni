// OrganizationsModule must load BEFORE ElectionsModule. ElectionsModule
// transitively imports AiModule which uses forwardRef(OrganizationsModule); if
// Organizations starts loading after Elections, the forwardRef resolves to
// undefined during Nest's module scan and bootstrap fails.
import { OrganizationsModule } from '@/organizations/organizations.module'
import { ElectionsModule } from '@/elections/elections.module'
import { Module } from '@nestjs/common'
import { PrioritiesModule } from '@/priorities/priorities.module'
import { FeaturesModule } from '@/features/features.module'
import { DatabricksSqlProvider } from '@/llm/tools/databricksProvider'
import { resolveDatabricksConnection } from '@/llm/tools/databricksConnection'
import type { DatabricksProvider } from '@/llm/tools/queryDatabricks.tool'
import { DistrictResolverService } from '@/chats/briefing-chats/services/districtResolver.service'
import { CommunityIssuesModule } from '@/communityIssues/communityIssues.module'
import { ContactsModule } from '@/contacts/contacts.module'
import { VotersModule } from '@/voters/voters.module'
import { GeneralChatStoreService } from '../services/generalChatStore.prisma'
import {
  CHIEF_OF_STAFF_MODELS,
  ChiefOfStaffHandler,
  CONSTITUENT_DATA_PROVIDER,
  CONSTITUENT_TABLES_CONFIG,
} from './chiefOfStaff.handler'
import { ChiefOfStaffBriefingsService } from './services/chiefOfStaffBriefings.service'
import { ChiefOfStaffContextService } from './services/chiefOfStaffContext.service'
import { CONSTITUENT_TABLES } from './services/constituentDataScope'
import { PrioritiesServiceAdapter } from './services/prioritiesService.adapter'
import { PRIORITIES_PORT } from './services/prioritiesPort'
import { CommunityIssueReadAdapter } from './services/communityIssueRead.adapter'
import { COMMUNITY_ISSUE_READ_PORT } from './services/communityIssueRead.port'

export { CHIEF_OF_STAFF_MODELS }

// Aggregate-only Databricks provider for the constituent-data tool. Reads the
// SAME shared Databricks credential the briefing chat uses (OAuth M2M, or a PAT
// fallback — see resolveDatabricksConnection), against the serve_agent_voters
// mart in the mart_serve_agents schema. Returns null unless host/path and a
// credential are set, so with nothing configured the tool never registers and
// prod/local stay off until the credential is deployed. The aggregate-only
// safety comes from the app-layer scope (allowlist + forbidden columns +
// cell-size floor), not from a separate warehouse identity.
const constituentDataProviderFactory = (): DatabricksProvider | null => {
  const conn = resolveDatabricksConnection()
  if (!conn) return null
  return new DatabricksSqlProvider({
    ...conn,
    catalog: 'goodparty_data_catalog',
    schema: 'mart_serve_agents',
  })
}

// Registers the chief_of_staff scope handler. The handler is exported so the
// general chats module can collect it into the scope registry.
@Module({
  imports: [
    PrioritiesModule,
    OrganizationsModule,
    ElectionsModule,
    FeaturesModule,
    CommunityIssuesModule,
    ContactsModule,
    VotersModule,
  ],
  providers: [
    ChiefOfStaffHandler,
    ChiefOfStaffContextService,
    ChiefOfStaffBriefingsService,
    GeneralChatStoreService,
    PrioritiesServiceAdapter,
    DistrictResolverService,
    CommunityIssueReadAdapter,
    {
      provide: PRIORITIES_PORT,
      useClass: PrioritiesServiceAdapter,
    },
    {
      provide: CONSTITUENT_DATA_PROVIDER,
      useFactory: constituentDataProviderFactory,
    },
    {
      provide: CONSTITUENT_TABLES_CONFIG,
      useValue: CONSTITUENT_TABLES,
    },
    {
      provide: COMMUNITY_ISSUE_READ_PORT,
      useClass: CommunityIssueReadAdapter,
    },
  ],
  exports: [ChiefOfStaffHandler],
})
export class ChiefOfStaffModule {}

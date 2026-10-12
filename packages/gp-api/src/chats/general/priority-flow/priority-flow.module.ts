// OrganizationsModule must load BEFORE ElectionsModule. ElectionsModule
// transitively imports AiModule which uses forwardRef(OrganizationsModule); if
// Organizations starts loading after Elections, the forwardRef resolves to
// undefined during Nest's module scan and bootstrap fails.
import { OrganizationsModule } from '@/organizations/organizations.module'
import { ElectionsModule } from '@/elections/elections.module'
import { Module } from '@nestjs/common'
import { CommunityIssuesModule } from '@/communityIssues/communityIssues.module'
import { ContactsModule } from '@/contacts/contacts.module'
import { VotersModule } from '@/voters/voters.module'
import { PeopleQueryModule } from '@/peopleDb/peopleQuery.module'
import { DatabricksSqlProvider } from '@/llm/tools/databricksProvider'
import { resolveDatabricksConnection } from '@/llm/tools/databricksConnection'
import type { DatabricksProvider } from '@/llm/tools/queryDatabricks.tool'
import { PrioritiesModule } from '@/priorities/priorities.module'
import { DistrictResolverService } from '@/chats/briefing-chats/services/districtResolver.service'
import { GeneralChatStoreService } from '../services/generalChatStore.prisma'
import {
  CONSTITUENT_DATA_PROVIDER,
  CONSTITUENT_TABLES_CONFIG,
} from '../chief-of-staff/chiefOfStaff.handler'
import {
  CONSTITUENT_CATALOG,
  CONSTITUENT_SCHEMA,
  CONSTITUENT_TABLES_BY_DATASET,
} from '../chief-of-staff/services/constituentDataScope'
import { CommunityIssueReadAdapter } from '../chief-of-staff/services/communityIssueRead.adapter'
import { COMMUNITY_ISSUE_READ_PORT } from '../chief-of-staff/services/communityIssueRead.port'
import {
  PRIORITY_FLOW_MODELS,
  PriorityFlowHandler,
} from './priorityFlow.handler'
import { PriorityFlowContextService } from './services/priorityFlowContext.service'
import { PriorityFlowOutreachService } from './services/priorityFlowOutreach.service'

export { PRIORITY_FLOW_MODELS }

// Same aggregate-only Databricks provider the Chief of Staff scope builds: the
// shared DATABRICKS_* credential against the mart_serve_agents schema. Returns
// null unless host/path and a credential are set, so the constituent-data
// tools never register until that credential is deployed.
const constituentDataProviderFactory = (): DatabricksProvider | null => {
  const conn = resolveDatabricksConnection()
  if (!conn) return null
  return new DatabricksSqlProvider({
    ...conn,
    catalog: CONSTITUENT_CATALOG,
    schema: CONSTITUENT_SCHEMA,
  })
}

// Registers the priority_flow scope handler. Exported so the general chats
// module can collect it into the scope registry.
@Module({
  imports: [
    PrioritiesModule,
    OrganizationsModule,
    ElectionsModule,
    CommunityIssuesModule,
    ContactsModule,
    VotersModule,
    PeopleQueryModule,
  ],
  providers: [
    PriorityFlowHandler,
    PriorityFlowContextService,
    PriorityFlowOutreachService,
    GeneralChatStoreService,
    DistrictResolverService,
    CommunityIssueReadAdapter,
    {
      provide: COMMUNITY_ISSUE_READ_PORT,
      useClass: CommunityIssueReadAdapter,
    },
    {
      provide: CONSTITUENT_DATA_PROVIDER,
      useFactory: constituentDataProviderFactory,
    },
    {
      provide: CONSTITUENT_TABLES_CONFIG,
      useValue: CONSTITUENT_TABLES_BY_DATASET,
    },
  ],
  exports: [PriorityFlowHandler],
})
export class PriorityFlowModule {}

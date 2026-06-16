// OrganizationsModule must load BEFORE ElectionsModule. ElectionsModule
// transitively imports AiModule which uses forwardRef(OrganizationsModule); if
// Organizations starts loading after Elections, the forwardRef resolves to
// undefined during Nest's module scan and bootstrap fails.
import { OrganizationsModule } from '@/organizations/organizations.module'
import { ElectionsModule } from '@/elections/elections.module'
import { Module } from '@nestjs/common'
import { PrioritiesModule } from '@/priorities/priorities.module'
import { DatabricksSqlProvider } from '@/llm/tools/databricksProvider'
import type { DatabricksProvider } from '@/llm/tools/queryDatabricks.tool'
import {
  TavilySearchProvider,
  type SearchProvider,
} from '@/llm/tools/webSearch.tool'
import { DistrictResolverService } from '@/chats/briefing-chats/services/districtResolver.service'
import { GeneralChatStoreService } from '../services/generalChatStore.prisma'
import {
  CHIEF_OF_STAFF_MODELS,
  ChiefOfStaffHandler,
  CONSTITUENT_DATA_PROVIDER,
  COS_SEARCH_PROVIDER,
} from './chiefOfStaff.handler'
import { ChiefOfStaffBriefingsService } from './services/chiefOfStaffBriefings.service'
import { ChiefOfStaffContextService } from './services/chiefOfStaffContext.service'
import { PrioritiesServiceAdapter } from './services/prioritiesService.adapter'
import { PRIORITIES_PORT } from './services/prioritiesPort'

export { CHIEF_OF_STAFF_MODELS }

const searchProviderFactory = (): SearchProvider | null => {
  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey) return null
  return new TavilySearchProvider({ apiKey })
}

// Scoped, aggregate-only Databricks provider for the constituent-data tool.
// DISTINCT from the briefing chat's broad DATABRICKS_* credential: it reads its
// own SERVE_DATABRICKS_* env set so the tool can only ever talk to a
// narrowly-scoped "Serve agent" warehouse identity. Returns null unless EVERY
// var is set, so with no scoped key configured the tool never registers and
// prod/local stay off until the key is deployed. NEVER point this at the broad
// briefing key.
const constituentDataProviderFactory = (): DatabricksProvider | null => {
  const hostname = process.env.SERVE_DATABRICKS_SERVER_HOSTNAME
  const httpPath = process.env.SERVE_DATABRICKS_HTTP_PATH
  const accessToken = process.env.SERVE_DATABRICKS_API_KEY
  const catalog = process.env.SERVE_DATABRICKS_CATALOG
  const schema = process.env.SERVE_DATABRICKS_SCHEMA
  if (!hostname || !httpPath || !accessToken || !catalog || !schema) {
    return null
  }
  return new DatabricksSqlProvider({
    hostname,
    httpPath,
    accessToken,
    catalog,
    schema,
  })
}

// Registers the chief_of_staff scope handler. The handler is exported so the
// general chats module can collect it into the scope registry.
@Module({
  imports: [PrioritiesModule, OrganizationsModule, ElectionsModule],
  providers: [
    ChiefOfStaffHandler,
    ChiefOfStaffContextService,
    ChiefOfStaffBriefingsService,
    GeneralChatStoreService,
    PrioritiesServiceAdapter,
    DistrictResolverService,
    {
      provide: PRIORITIES_PORT,
      useClass: PrioritiesServiceAdapter,
    },
    {
      provide: COS_SEARCH_PROVIDER,
      useFactory: searchProviderFactory,
    },
    {
      provide: CONSTITUENT_DATA_PROVIDER,
      useFactory: constituentDataProviderFactory,
    },
  ],
  exports: [ChiefOfStaffHandler],
})
export class ChiefOfStaffModule {}

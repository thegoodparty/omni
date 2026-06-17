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
  CONSTITUENT_TABLES_CONFIG,
  COS_SEARCH_PROVIDER,
} from './chiefOfStaff.handler'
import { ChiefOfStaffBriefingsService } from './services/chiefOfStaffBriefings.service'
import { ChiefOfStaffContextService } from './services/chiefOfStaffContext.service'
import { CONSTITUENT_TABLES } from './services/constituentDataScope'
import { PrioritiesServiceAdapter } from './services/prioritiesService.adapter'
import { PRIORITIES_PORT } from './services/prioritiesPort'

export { CHIEF_OF_STAFF_MODELS }

const searchProviderFactory = (): SearchProvider | null => {
  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey) return null
  return new TavilySearchProvider({ apiKey })
}

// Aggregate-only Databricks provider for the constituent-data tool. Reads the
// SAME shared DATABRICKS_* credential the briefing chat uses (same hostname,
// path, token, catalog, and schema). Returns null unless host/path/token are
// set, so with no key configured the tool never registers and prod/local stay
// off until the key is deployed. The aggregate-only safety comes from the
// app-layer scope (allowlist + forbidden columns + cell-size floor), not from a
// separate warehouse identity.
const constituentDataProviderFactory = (): DatabricksProvider | null => {
  const hostname = process.env.DATABRICKS_SERVER_HOSTNAME
  const httpPath = process.env.DATABRICKS_HTTP_PATH
  const accessToken = process.env.DATABRICKS_API_KEY
  if (!hostname || !httpPath || !accessToken) return null
  return new DatabricksSqlProvider({
    hostname,
    httpPath,
    accessToken,
    catalog: 'goodparty_data_catalog',
    schema: 'dbt',
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
  ],
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
    {
      provide: CONSTITUENT_TABLES_CONFIG,
      useValue: CONSTITUENT_TABLES,
    },
  ],
  exports: [ChiefOfStaffHandler],
})
export class ChiefOfStaffModule {}

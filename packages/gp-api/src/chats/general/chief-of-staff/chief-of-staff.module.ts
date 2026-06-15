import { Module } from '@nestjs/common'
import {
  TavilySearchProvider,
  type SearchProvider,
} from '@/llm/tools/webSearch.tool'
import { GeneralChatStoreService } from '../services/generalChatStore.prisma'
import {
  CHIEF_OF_STAFF_MODELS,
  ChiefOfStaffHandler,
  COS_SEARCH_PROVIDER,
} from './chiefOfStaff.handler'
import { ChiefOfStaffBriefingsService } from './services/chiefOfStaffBriefings.service'
import { ChiefOfStaffContextService } from './services/chiefOfStaffContext.service'
import { PlaceholderPrioritiesAdapter } from './services/placeholderPriorities.adapter'
import { PRIORITIES_PORT } from './services/prioritiesPort'

export { CHIEF_OF_STAFF_MODELS }

const searchProviderFactory = (): SearchProvider | null => {
  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey) return null
  return new TavilySearchProvider({ apiKey })
}

// Registers the chief_of_staff scope handler. The handler is exported so the
// general chats module can collect it into the scope registry.
@Module({
  providers: [
    ChiefOfStaffHandler,
    ChiefOfStaffContextService,
    ChiefOfStaffBriefingsService,
    GeneralChatStoreService,
    // INTEGRATION SEAM: at merge, swap PlaceholderPrioritiesAdapter for slice
    // 1's PrioritiesService (which already satisfies PrioritiesToolPort) and
    // delete the adapter. See placeholderPriorities.adapter.ts.
    {
      provide: PRIORITIES_PORT,
      useClass: PlaceholderPrioritiesAdapter,
    },
    {
      provide: COS_SEARCH_PROVIDER,
      useFactory: searchProviderFactory,
    },
  ],
  exports: [ChiefOfStaffHandler],
})
export class ChiefOfStaffModule {}

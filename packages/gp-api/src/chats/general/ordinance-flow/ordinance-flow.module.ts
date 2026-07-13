// OrganizationsModule must load BEFORE ElectionsModule. ElectionsModule
// transitively imports AiModule which uses forwardRef(OrganizationsModule); if
// Organizations starts loading after Elections, the forwardRef resolves to
// undefined during Nest's module scan and bootstrap fails.
import { OrganizationsModule } from '@/organizations/organizations.module'
import { ElectionsModule } from '@/elections/elections.module'
import { AwsModule } from '@/vendors/aws/aws.module'
import { Module } from '@nestjs/common'
import { GeneralChatStoreService } from '../services/generalChatStore.prisma'
import { DistrictResolverService } from '@/chats/briefing-chats/services/districtResolver.service'
import {
  ORDINANCE_FLOW_MODELS,
  OrdinanceFlowHandler,
} from './ordinanceFlow.handler'
import { OrdinanceFlowContextService } from './services/ordinanceFlowContext.service'
import { OrdinanceFlowFetchService } from './services/ordinanceFlowFetch.service'
import { OrdinanceFlowToolsService } from './services/ordinanceFlowTools.service'

export { ORDINANCE_FLOW_MODELS }

// Registers the ordinance_flow scope handler. Exported so the general chats
// module can collect it into the scope registry. The Ordinance record and
// elected office are read via the global Prisma client; OrganizationsModule and
// ElectionsModule are imported only to satisfy DistrictResolverService, which
// resolves the caller's jurisdiction for the prompt's City/District line the
// same way Chief of Staff does.
@Module({
  imports: [OrganizationsModule, ElectionsModule, AwsModule],
  providers: [
    OrdinanceFlowHandler,
    OrdinanceFlowContextService,
    OrdinanceFlowToolsService,
    OrdinanceFlowFetchService,
    GeneralChatStoreService,
    DistrictResolverService,
  ],
  exports: [OrdinanceFlowHandler],
})
export class OrdinanceFlowModule {}

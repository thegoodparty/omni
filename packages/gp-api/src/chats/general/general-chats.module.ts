import { Module } from '@nestjs/common'
import { ChatsModule } from '@/chats/chats.module'
import { BriefingChatsModule } from '@/chats/briefing-chats/briefing-chats.module'
import { BriefingAnnotationHandler } from '@/chats/briefing-chats/briefingAnnotation.handler'
import { OrganizationsModule } from '@/organizations/organizations.module'
import { GeneralChatsController } from './controllers/general-chats.controller'
import { ChatScopeRegistry } from './services/chatScopeRegistry.service'
import { GeneralChatStoreService } from './services/generalChatStore.prisma'
import { GeneralChatsService } from './services/general-chats.service'
import { ChiefOfStaffModule } from './chief-of-staff/chief-of-staff.module'
import { ChiefOfStaffHandler } from './chief-of-staff/chiefOfStaff.handler'
import { CampaignManagerModule } from './campaign-manager/campaign-manager.module'
import { CampaignManagerHandler } from './campaign-manager/campaignManager.handler'
import { OrdinanceFlowModule } from './ordinance-flow/ordinance-flow.module'
import { OrdinanceFlowHandler } from './ordinance-flow/ordinanceFlow.handler'
import { PriorityFlowModule } from './priority-flow/priority-flow.module'
import { PriorityFlowHandler } from './priority-flow/priorityFlow.handler'
import { CHAT_SCOPE_HANDLERS } from './types/chatScopeHandler'

// Scope-generic chat backend. New scopes register a handler here (collected
// into CHAT_SCOPE_HANDLERS). Auth resolves the org from the X-Organization-Slug
// header via the shared UseOrganization guard, so an elected-office scope and a
// campaign scope share one controller.
@Module({
  imports: [
    ChatsModule,
    OrganizationsModule,
    ChiefOfStaffModule,
    CampaignManagerModule,
    OrdinanceFlowModule,
    PriorityFlowModule,
    BriefingChatsModule,
  ],
  controllers: [GeneralChatsController],
  providers: [
    GeneralChatsService,
    GeneralChatStoreService,
    ChatScopeRegistry,
    {
      provide: CHAT_SCOPE_HANDLERS,
      useFactory: (
        chiefOfStaff: ChiefOfStaffHandler,
        campaignManager: CampaignManagerHandler,
        ordinanceFlow: OrdinanceFlowHandler,
        priorityFlow: PriorityFlowHandler,
        briefingAnnotation: BriefingAnnotationHandler,
      ) => [
        chiefOfStaff,
        campaignManager,
        ordinanceFlow,
        priorityFlow,
        briefingAnnotation,
      ],
      inject: [
        ChiefOfStaffHandler,
        CampaignManagerHandler,
        OrdinanceFlowHandler,
        PriorityFlowHandler,
        BriefingAnnotationHandler,
      ],
    },
  ],
  exports: [GeneralChatsService],
})
export class GeneralChatsModule {}

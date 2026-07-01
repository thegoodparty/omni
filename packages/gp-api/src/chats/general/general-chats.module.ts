import { Module } from '@nestjs/common'
import { ChatsModule } from '@/chats/chats.module'
import { ElectedOfficeModule } from '@/electedOffice/electedOffice.module'
import { GeneralChatsController } from './controllers/general-chats.controller'
import { ChatScopeRegistry } from './services/chatScopeRegistry.service'
import { GeneralChatStoreService } from './services/generalChatStore.prisma'
import { GeneralChatsService } from './services/general-chats.service'
import { ChiefOfStaffModule } from './chief-of-staff/chief-of-staff.module'
import { ChiefOfStaffHandler } from './chief-of-staff/chiefOfStaff.handler'
import { CampaignManagerModule } from './campaign-manager/campaign-manager.module'
import { CampaignManagerHandler } from './campaign-manager/campaignManager.handler'
import { ChatOrgGuard } from './guards/chatOrg.guard'
import { CHAT_SCOPE_HANDLERS } from './types/chatScopeHandler'

// Scope-generic chat backend. New scopes register a handler here (collected
// into CHAT_SCOPE_HANDLERS). ChatOrgGuard resolves the org per scope, so an
// elected-office scope and a campaign scope share one controller.
@Module({
  imports: [
    ChatsModule,
    ElectedOfficeModule,
    ChiefOfStaffModule,
    CampaignManagerModule,
  ],
  controllers: [GeneralChatsController],
  providers: [
    GeneralChatsService,
    GeneralChatStoreService,
    ChatScopeRegistry,
    ChatOrgGuard,
    {
      provide: CHAT_SCOPE_HANDLERS,
      useFactory: (
        chiefOfStaff: ChiefOfStaffHandler,
        campaignManager: CampaignManagerHandler,
      ) => [chiefOfStaff, campaignManager],
      inject: [ChiefOfStaffHandler, CampaignManagerHandler],
    },
  ],
  exports: [GeneralChatsService],
})
export class GeneralChatsModule {}

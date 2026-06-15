import { Module } from '@nestjs/common'
import { ChatsModule } from '@/chats/chats.module'
import { ElectedOfficeModule } from '@/electedOffice/electedOffice.module'
import { GeneralChatsController } from './controllers/general-chats.controller'
import { ChatScopeRegistry } from './services/chatScopeRegistry.service'
import { GeneralChatStoreService } from './services/generalChatStore.prisma'
import { GeneralChatsService } from './services/general-chats.service'
import { ChiefOfStaffModule } from './chief-of-staff/chief-of-staff.module'
import { ChiefOfStaffHandler } from './chief-of-staff/chiefOfStaff.handler'
import { CHAT_SCOPE_HANDLERS } from './types/chatScopeHandler'

// Scope-generic chat backend. New scopes register a handler here (collected
// into CHAT_SCOPE_HANDLERS) with no controller/service changes.
@Module({
  imports: [ChatsModule, ElectedOfficeModule, ChiefOfStaffModule],
  controllers: [GeneralChatsController],
  providers: [
    GeneralChatsService,
    GeneralChatStoreService,
    ChatScopeRegistry,
    {
      provide: CHAT_SCOPE_HANDLERS,
      useFactory: (chiefOfStaff: ChiefOfStaffHandler) => [chiefOfStaff],
      inject: [ChiefOfStaffHandler],
    },
  ],
  exports: [GeneralChatsService],
})
export class GeneralChatsModule {}

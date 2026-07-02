import { Module } from '@nestjs/common'
import { ChatsModule } from '@/chats/chats.module'
import { GeneralChatStoreService } from '../services/generalChatStore.prisma'
import {
  CAMPAIGN_MANAGER_MODELS,
  CampaignManagerHandler,
} from './campaignManager.handler'

export { CAMPAIGN_MANAGER_MODELS }

// Registers the campaign_assistant scope handler. Exported so the general chats
// module can collect it into the scope registry. Imports ChatsModule for the
// shared ChatStoreService (used to seed the greeting message on create).
@Module({
  imports: [ChatsModule],
  providers: [CampaignManagerHandler, GeneralChatStoreService],
  exports: [CampaignManagerHandler],
})
export class CampaignManagerModule {}

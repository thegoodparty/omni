import { Module } from '@nestjs/common'
import { ChatsModule } from '@/chats/chats.module'
import { LangGraphChatService } from './langGraphChat.service'
import { LangGraphCheckpointer } from './langGraphCheckpointer'

@Module({
  imports: [ChatsModule],
  providers: [LangGraphCheckpointer, LangGraphChatService],
  exports: [LangGraphCheckpointer, LangGraphChatService],
})
export class LangGraphModule {}

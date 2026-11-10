import { Module } from '@nestjs/common'
import { ContentModule } from 'src/content/content.module'
import { AiModule } from 'src/ai/ai.module'
import { LlmModule } from '@/llm/llm.module'
import { AiChatController } from './chat/aiChat.controller'
import { AiChatService } from './chat/aiChat.service'
import { SlackModule } from 'src/vendors/slack/slack.module'
import { OrganizationsModule } from '@/organizations/organizations.module'
import { ClerkModule } from '@/vendors/clerk/clerk.module'

@Module({
  imports: [
    ContentModule,
    AiModule,
    LlmModule,
    ClerkModule,
    SlackModule,
    OrganizationsModule,
  ],
  controllers: [AiChatController],
  providers: [AiChatService],
  exports: [AiChatService],
})
export class CampaignsAiModule {}

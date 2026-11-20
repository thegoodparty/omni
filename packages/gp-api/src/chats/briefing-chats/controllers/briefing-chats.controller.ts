import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common'
import { User } from '../../../generated/prisma'
import { PinoLogger } from 'nestjs-pino'
import { ZodValidationPipe } from 'nestjs-zod'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { BriefingChatCreateService } from '../services/briefingChatCreate.service'
import { BriefingChatsService } from '../services/briefing-chats.service'
import {
  CreateBriefingChatResponse,
  CreateBriefingChatSchema,
  createBriefingChatResponseSchema,
} from '../schemas/CreateBriefingChat.schema'

// Briefing chat's annotation-keyed half. A briefing conversation is created with
// its Annotation in one transaction, so the create is here and not on
// /v1/chats (whose generic create path the scope refuses). Turns and history
// are conversation-keyed and shared with every other scope:
// /v1/chats/:conversationId?scope=briefing_annotation.
@Controller('briefing-chats')
export class BriefingChatsController {
  constructor(
    private readonly chats: BriefingChatsService,
    private readonly chatCreate: BriefingChatCreateService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(BriefingChatsController.name)
  }

  @Post()
  @ResponseSchema(createBriefingChatResponseSchema)
  async createChat(
    @ReqUser() user: User,
    @Body(ZodValidationPipe) body: CreateBriefingChatSchema,
  ): Promise<CreateBriefingChatResponse> {
    return this.chatCreate.findOrCreate({
      userId: user.id,
      meetingDate: body.meetingDate,
      anchor: body.anchor,
    })
  }

  @Delete(':annotationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteConversation(
    @ReqUser() user: User,
    @Param('annotationId') annotationId: string,
  ): Promise<void> {
    await this.chats.deleteConversation(annotationId, user.id)
  }
}

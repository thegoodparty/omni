import { Inject, Injectable, Optional } from '@nestjs/common'
import { ChatStoreService } from '@/chats/services/chatStore.prisma'
import type { DatabricksProvider } from '@/llm/tools/queryDatabricks.tool'
import { PeopleDatasetService } from '@/peopleDb/services/peopleDataset.service'
import {
  BriefingAnnotationHandler,
  requireConversationId,
} from '../briefingAnnotation.handler'
import { BriefingContextService } from './briefingContext.service'
import { BriefingNotesService } from './briefingNotes.service'
import { DistrictResolverService } from './districtResolver.service'

export const BRIEFING_CHATS_DATABRICKS_PROVIDER =
  'BRIEFING_CHATS_DATABRICKS_PROVIDER'

@Injectable()
export class BriefingChatsService {
  // The one BriefingAnnotationHandler instance. briefing-chats.module
  // republishes it as the briefing_annotation scope, so the handler a turn runs
  // through is this module's own.
  readonly handler: BriefingAnnotationHandler

  constructor(
    private readonly briefingContext: BriefingContextService,
    private readonly chatStore: ChatStoreService,
    notesService: BriefingNotesService,
    @Optional()
    @Inject(BRIEFING_CHATS_DATABRICKS_PROVIDER)
    databricks?: DatabricksProvider,
    @Optional()
    districtResolver?: DistrictResolverService,
    @Optional()
    peopleDatasets?: PeopleDatasetService,
  ) {
    this.handler = new BriefingAnnotationHandler(
      briefingContext,
      notesService,
      databricks,
      districtResolver,
      peopleDatasets,
    )
  }

  // The annotation-keyed half of a briefing chat's lifecycle, which is all this
  // module still owns: the conversation is created with its annotation
  // (POST /v1/briefing-chats) and deleted by that annotation, because the
  // briefing UI deletes the chat row it renders. Turns and history are keyed by
  // conversation and shared with every other scope on /v1/chats.
  async deleteConversation(
    annotationId: string,
    userId: number,
  ): Promise<void> {
    const { annotation } = await this.briefingContext.loadContext(
      annotationId,
      userId,
    )
    const conversationId = requireConversationId(annotation.chatConversationId)
    await this.chatStore.softDeleteConversation(conversationId, userId)
  }
}

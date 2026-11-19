import { createZodDto } from 'nestjs-zod'
import { BackgroundAgentRunsListQuerySchema } from '@goodparty_org/contracts'

export class AdminBackgroundAgentRunsListQueryDto extends createZodDto(
  BackgroundAgentRunsListQuerySchema,
) {}

export {
  BackgroundAgentRunListItemSchema,
  type BackgroundAgentRunListItem,
  BackgroundAgentMessageSchema,
  type BackgroundAgentMessage,
  BackgroundAgentRunDetailSchema,
  type BackgroundAgentRunDetail,
} from '@goodparty_org/contracts'

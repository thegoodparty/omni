import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { serializeError } from 'serialize-error'
import { isPrismaError } from '@/prisma/util/prismaErrors.util'
import { CampaignPlanCompleteMessage } from '@/queue/queue.types'
import { AiGenerationService } from './aiGeneration.service'
import { CampaignTasksService } from './campaignTasks.service'

@Injectable()
export class CampaignPlanCompleteService {
  constructor(
    private readonly aiGenerationService: AiGenerationService,
    private readonly campaignTasksService: CampaignTasksService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CampaignPlanCompleteService.name)
  }

  async handleCampaignPlanComplete(
    data: CampaignPlanCompleteMessage,
  ): Promise<void> {
    if (data.status === 'error') {
      this.logger.warn(
        { campaignId: data.campaignId, error: data.error },
        'campaign plan generation failed',
      )
      return
    }

    try {
      const { campaignId: resultCampaignId, tasks } =
        await this.aiGenerationService.parseCompletionResult(data)
      await this.campaignTasksService.addEventTasks(resultCampaignId, tasks)
      this.logger.info(
        { campaignId: resultCampaignId, taskCount: tasks.length },
        'campaign plan tasks saved',
      )
    } catch (err: unknown) {
      // P2025: the campaign was deleted before its plan came back. P2002:
      // the tasks are already saved. Every retry would hit the same error,
      // so the job completes instead of dead-lettering and paging.
      if (isPrismaError(err, 'P2025') || isPrismaError(err, 'P2002')) {
        this.logger.warn(
          { campaignId: data.campaignId, error: serializeError(err) },
          'campaign plan completion cannot be saved, dropping it',
        )
        return
      }
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.logger.error(
        { campaignId: data.campaignId, error: errorMsg },
        'failed to process campaign plan completion',
      )
      throw err
    }
  }
}

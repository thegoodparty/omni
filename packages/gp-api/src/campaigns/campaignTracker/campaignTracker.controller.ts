import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Put,
} from '@nestjs/common'
import { z } from 'zod'
import { Campaign } from '../../generated/prisma'
import { CampaignTrackerTasksService } from './services/campaignTrackerTasks.service'
import { ReqCampaign } from '../decorators/ReqCampaign.decorator'
import { UseCampaign } from '../decorators/UseCampaign.decorator'
import { McpTool } from '@/mcp/decorators/McpTool.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { IS_NON_PROD_DEPLOY } from '@/shared/util/appEnvironment.util'
import {
  completeTaskBodySchema,
  CompleteTaskBodySchema,
} from '../tasks/schemas/completeTaskBody.schema'
import { CampaignTrackerTaskResponseSchema } from './schemas/trackerTaskResponse.schema'

@Controller('campaigns/tracker-tasks')
@UseCampaign()
export class CampaignTrackerController {
  constructor(
    private readonly trackerTasksService: CampaignTrackerTasksService,
  ) {}

  @Get()
  @McpTool({
    description:
      "List the calling candidate's current campaign tracker tasks, each " +
      'with its title, phase, channel, due date, and whether it is completed. ' +
      'Use this in weekly mode to see what was generated before and which ' +
      'tasks the candidate already finished, so you can carry forward ' +
      'incomplete-but-important work and avoid repeating completed tasks.',
  })
  @ResponseSchema(z.array(CampaignTrackerTaskResponseSchema))
  listCampaignTrackerTasks(@ReqCampaign() campaign: Campaign) {
    return this.trackerTasksService.listCampaignTrackerTasks(campaign)
  }

  // Manual generation override. In prod the weekly cron is the only trigger;
  // this route lets a candidate dispatch a run for their own campaign in
  // non-prod (dev/qa/preview), where the cron is disabled. Gated on the
  // fail-closed IS_NON_PROD_DEPLOY allowlist so it 404s in prod (and on any
  // unexpected env value) rather than exposing on-demand paid runs there.
  @Post('generate')
  @HttpCode(HttpStatus.ACCEPTED)
  async generateTasks(@ReqCampaign() campaign: Campaign) {
    if (!IS_NON_PROD_DEPLOY) {
      throw new NotFoundException()
    }
    await this.trackerTasksService.generateNow(campaign)
  }

  @Put('complete/:id')
  async completeTask(
    @ReqCampaign() campaign: Campaign,
    @Param('id') id: string,
    @Body() body: Partial<CompleteTaskBodySchema> = {},
  ) {
    const voterContact =
      Object.keys(body).length > 0
        ? completeTaskBodySchema.parse(body)
        : undefined
    return this.trackerTasksService.completeTask(campaign, id, voterContact)
  }

  @Delete('complete/:id')
  async unCompleteTask(
    @ReqCampaign() campaign: Campaign,
    @Param('id') id: string,
  ) {
    return this.trackerTasksService.unCompleteTask(campaign, id)
  }
}

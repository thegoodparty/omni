import { Body, Controller, Delete, Get, Param, Put } from '@nestjs/common'
import { Campaign } from '../../generated/prisma'
import { CampaignTrackerTasksService } from './services/campaignTrackerTasks.service'
import { ReqCampaign } from '../decorators/ReqCampaign.decorator'
import { UseCampaign } from '../decorators/UseCampaign.decorator'
import {
  completeTaskBodySchema,
  CompleteTaskBodySchema,
} from '../tasks/schemas/completeTaskBody.schema'

@Controller('campaigns/tracker-tasks')
@UseCampaign()
export class CampaignTrackerController {
  constructor(
    private readonly trackerTasksService: CampaignTrackerTasksService,
  ) {}

  @Get()
  listCampaignTrackerTasks(@ReqCampaign() campaign: Campaign) {
    return this.trackerTasksService.listCampaignTrackerTasks(campaign)
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

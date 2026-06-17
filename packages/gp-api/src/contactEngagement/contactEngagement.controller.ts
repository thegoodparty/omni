import { ReqCampaign } from '@/campaigns/decorators/ReqCampaign.decorator'
import { ReqElectedOffice } from '@/electedOffice/decorators/ReqElectedOffice.decorator'
import { Controller, Get, Param, Query, UsePipes } from '@nestjs/common'
import { Campaign, ElectedOffice } from '../generated/prisma'
import { ZodValidationPipe } from 'nestjs-zod'
import { UseEngagementContext } from './decorators/UseEngagementContext.decorator'
import {
  ConstituentIssuesParamsDTO,
  ConstituentIssuesQueryDTO,
  IndividualActivityParamsDTO,
  IndividualActivityQueryDTO,
} from './contactEngagement.schema'
import { ContactEngagementService } from './contactEngagement.service'
import {
  GetCampaignActivitiesResponse,
  GetConstituentIssuesResponse,
  GetIndividualActivitiesResponse,
} from './contactEngagement.types'

@Controller('contact-engagement')
@UsePipes(ZodValidationPipe)
@UseEngagementContext()
export class ContactEngagementController {
  constructor(
    private readonly contactEngagementService: ContactEngagementService,
  ) {}

  @Get(':id/activities')
  async getIndividualActivities(
    @Param() params: IndividualActivityParamsDTO,
    @Query() query: IndividualActivityQueryDTO,
    @ReqElectedOffice() electedOffice: ElectedOffice | undefined,
    @ReqCampaign() campaign: Campaign,
  ): Promise<GetIndividualActivitiesResponse | GetCampaignActivitiesResponse> {
    if (electedOffice) {
      return this.contactEngagementService.getIndividualActivities({
        personId: params.id,
        ...query,
        electedOfficeId: electedOffice.id,
      })
    }
    // Campaign context: :id is the durable lalVoterId (task 12 contract).
    return this.contactEngagementService.getCampaignActivities({
      lalVoterId: params.id,
      campaignId: campaign.id,
      take: query.take,
      after: query.after,
    })
  }

  @Get(':id/issues')
  async getConstituentIssues(
    @Param() params: ConstituentIssuesParamsDTO,
    @Query() query: ConstituentIssuesQueryDTO,
    @ReqElectedOffice() electedOffice: ElectedOffice | undefined,
  ): Promise<GetConstituentIssuesResponse> {
    if (electedOffice) {
      return this.contactEngagementService.getConstituentIssues(
        params.id,
        electedOffice.id,
        query.take,
        query.after,
      )
    }
    // Issues are poll-specific (elected office); campaigns have none.
    return { nextCursor: null, results: [] }
  }
}

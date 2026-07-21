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
  ): Promise<GetIndividualActivitiesResponse> {
    // :id is the personId in both contexts — the ContactInteraction*/
    // ContactNote tables key on (organizationSlug, personId) for Win and
    // Serve alike. `lalVoterId` is an optional query param (Win only) that
    // brings the legacy VoterOutreachActivity rows into the union during the
    // sunset (this supersedes the old contract where :id was the durable
    // lalVoterId for campaigns).
    return electedOffice
      ? this.contactEngagementService.getIndividualActivities({
          personId: params.id,
          organizationSlug: electedOffice.organizationSlug,
          electedOfficeId: electedOffice.id,
          ...query,
        })
      : this.contactEngagementService.getIndividualActivities({
          personId: params.id,
          organizationSlug: campaign.organizationSlug,
          campaignId: campaign.id,
          ...query,
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

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common'
import {
  Priority as PriorityDto,
  PrioritySchema,
} from '@goodparty_org/contracts'
import { ZodValidationPipe } from 'nestjs-zod'
import { AdminOrM2MGuard } from '@/authentication/guards/AdminOrM2M.guard'
import { ReqElectedOffice } from 'src/electedOffice/decorators/ReqElectedOffice.decorator'
import { UseElectedOffice } from 'src/electedOffice/decorators/UseElectedOffice.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { McpTool } from '@/mcp/decorators/McpTool.decorator'
import { ElectedOffice, Priority } from '../../generated/prisma'
import { toDateOnlyString } from 'src/shared/util/date.util'
import {
  CommunityIssueFeedDetailSchema,
  CommunityIssueFeedListQueryDto,
  CommunityIssueFeedListResponseSchema,
  DispatchRequestDto,
  DispatchResponseSchema,
  IssueIdParamDto,
} from '../schemas/communityIssueFeed.schema'
import { CommunityIssueFeedDispatchService } from '../services/communityIssueFeedDispatch.service'
import { CommunityIssueFeedPrioritizeService } from '../services/communityIssueFeedPrioritize.service'
import { CommunityIssueFeedReadService } from '../services/communityIssueFeedRead.service'

const toApi = (record: Priority): PriorityDto => ({
  id: record.id,
  electedOfficeId: record.electedOfficeId,
  title: record.title,
  description: record.description,
  source: record.source,
  sourceCampaignPositionId: record.sourceCampaignPositionId,
  targetDate: toDateOnlyString(record.targetDate) ?? null,
  createdAt: record.createdAt.toISOString(),
  updatedAt: record.updatedAt.toISOString(),
})

@Controller('community-issue-feed')
@UsePipes(ZodValidationPipe)
@UseInterceptors(ZodResponseInterceptor)
export class CommunityIssueFeedController {
  constructor(
    private readonly read: CommunityIssueFeedReadService,
    private readonly prioritize: CommunityIssueFeedPrioritizeService,
    private readonly dispatch: CommunityIssueFeedDispatchService,
  ) {}

  @Post('dispatch')
  @UseGuards(AdminOrM2MGuard)
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(DispatchResponseSchema)
  async dispatchCohort(@Body() body: DispatchRequestDto) {
    return this.dispatch.dispatchForCohort(body.orgSlugs)
  }

  @Get()
  @UseElectedOffice()
  @McpTool({
    description:
      'List community issue feed items for the elected office.' +
      ' Use the list param to select top_community or trending issues.',
  })
  @ResponseSchema(CommunityIssueFeedListResponseSchema)
  async list(
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Query() query: CommunityIssueFeedListQueryDto,
  ) {
    return this.read.listForOrg(
      electedOffice.organizationSlug,
      electedOffice.id,
      query.list,
    )
  }

  @Get(':id')
  @UseElectedOffice()
  @ResponseSchema(CommunityIssueFeedDetailSchema)
  async detail(
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Param() { id }: IssueIdParamDto,
  ) {
    return this.read.getDetail(id, electedOffice.id)
  }

  @Post(':id/prioritize')
  @UseElectedOffice()
  @HttpCode(HttpStatus.CREATED)
  @ResponseSchema(PrioritySchema)
  async prioritizeIssue(
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Param() { id }: IssueIdParamDto,
  ) {
    const priority = await this.prioritize.prioritize(id, electedOffice.id)
    return toApi(priority)
  }
}

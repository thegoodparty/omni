import {
  Body,
  Controller,
  ForbiddenException,
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
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { ReqElectedOffice } from 'src/electedOffice/decorators/ReqElectedOffice.decorator'
import { UseElectedOffice } from 'src/electedOffice/decorators/UseElectedOffice.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { McpTool } from '@/mcp/decorators/McpTool.decorator'
import { ElectedOffice, Priority, User } from '../../generated/prisma'
import { toDateOnlyString } from 'src/shared/util/date.util'
import {
  CommunityIssueDetailSchema,
  CommunityIssueListQueryDto,
  CommunityIssueListResponseSchema,
  DispatchRequestDto,
  DispatchResponseSchema,
  IssueIdParamDto,
  SeedRequestDto,
  SeedResponseSchema,
  SelfDispatchRequestDto,
} from '../schemas/communityIssues.schema'
import { CommunityIssueDispatchService } from '../services/communityIssueDispatch.service'
import { CommunityIssuePrioritizeService } from '../services/communityIssuePrioritize.service'
import { CommunityIssueReadService } from '../services/communityIssueRead.service'
import { CommunityIssueSeedService } from '../services/communityIssueSeed.service'

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

@Controller('community-issues')
@UsePipes(ZodValidationPipe)
@UseInterceptors(ZodResponseInterceptor)
export class CommunityIssuesController {
  constructor(
    private readonly read: CommunityIssueReadService,
    private readonly prioritize: CommunityIssuePrioritizeService,
    private readonly dispatch: CommunityIssueDispatchService,
    private readonly seedService: CommunityIssueSeedService,
  ) {}

  // Preview/dev-only deterministic seeding for e2e tests; the service rejects
  // the call on qa/prod. Scoped to the caller's own elected-office org.
  @Post('seed')
  @UseElectedOffice()
  @HttpCode(HttpStatus.CREATED)
  @ResponseSchema(SeedResponseSchema)
  async seed(
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Body() body: SeedRequestDto,
  ) {
    return this.seedService.seed(electedOffice, body)
  }

  @Post('dispatch')
  @UseGuards(AdminOrM2MGuard)
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(DispatchResponseSchema)
  async dispatchCohort(@Body() body: DispatchRequestDto) {
    return this.dispatch.dispatchForCohort(body.orgSlugs)
  }

  @Post('self-dispatch')
  @UseElectedOffice()
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(DispatchResponseSchema)
  async selfDispatch(
    @ReqUser() user: User,
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Body() body: SelfDispatchRequestDto,
  ) {
    if (!user.email.toLowerCase().endsWith('@goodparty.org')) {
      throw new ForbiddenException()
    }
    return this.dispatch.dispatchSelfServe(
      electedOffice.organizationSlug,
      body.type,
    )
  }

  /**
   * Self-serve landing catch-up: called client-side after any elected
   * official lands on the community issues dashboard. Dispatches both
   * experiment types if eligible and not already in flight, skipping only
   * the 90-day-inactivity gate — landing already proves the user is active.
   * Distinct from `self-dispatch` above, which is staff-only, single-type,
   * and backs a manual refresh button rather than a fire-on-every-landing
   * check.
   */
  @Post('dispatch-if-needed')
  @UseElectedOffice()
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(DispatchResponseSchema)
  async dispatchIfNeeded(@ReqElectedOffice() electedOffice: ElectedOffice) {
    return this.dispatch.dispatchIfNeeded(electedOffice.organizationSlug)
  }

  @Get()
  @UseElectedOffice()
  @McpTool({
    description:
      'List community issues for the elected office.' +
      ' Use the list param to select top_community or trending issues.',
  })
  @ResponseSchema(CommunityIssueListResponseSchema)
  async list(
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Query() query: CommunityIssueListQueryDto,
  ) {
    return this.read.listForOrg(
      electedOffice.organizationSlug,
      electedOffice.id,
      query.list,
    )
  }

  @Get(':id')
  @UseElectedOffice()
  @ResponseSchema(CommunityIssueDetailSchema)
  async detail(
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Param() { id }: IssueIdParamDto,
  ) {
    return this.read.getDetailForOrg(
      id,
      electedOffice.organizationSlug,
      electedOffice.id,
    )
  }

  @Post(':id/prioritize')
  @UseElectedOffice()
  @HttpCode(HttpStatus.CREATED)
  @ResponseSchema(PrioritySchema)
  async prioritizeIssue(
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Param() { id }: IssueIdParamDto,
  ) {
    const priority = await this.prioritize.prioritize(
      id,
      electedOffice.organizationSlug,
      electedOffice.id,
    )
    return toApi(priority)
  }
}

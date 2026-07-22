import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
  UsePipes,
} from '@nestjs/common'
import { FastifyReply } from 'fastify'
import { Campaign, Organization, User, UserRole } from '../../generated/prisma'
import { ZodValidationPipe } from 'nestjs-zod'
import { ReqUser } from 'src/authentication/decorators/ReqUser.decorator'
import { ReqCampaign } from 'src/campaigns/decorators/ReqCampaign.decorator'
import { UseCampaign } from 'src/campaigns/decorators/UseCampaign.decorator'
import { CampaignsService } from 'src/campaigns/services/campaigns.service'
import { ReqOrganization } from 'src/organizations/decorators/ReqOrganization.decorator'
import { UseOrganization } from 'src/organizations/decorators/UseOrganization.decorator'
import { OrganizationsService } from 'src/organizations/services/organizations.service'
import { userHasRole } from 'src/users/util/users.util'
import { CreateVoterFileFilterSchema } from '../schemas/CreateVoterFileFilterSchema'
import { UpdateVoterFileFilterSchema } from '../schemas/UpdateVoterFileFilterSchema'
import { VoterFileFilterService } from '../services/voterFileFilter.service'
import { CanDownloadVoterFileGuard } from './guards/CanDownloadVoterFile.guard'
import { GetVoterFileSchema } from './schemas/GetVoterFile.schema'
import { VoterFileService } from './voterFile.service'
import { PinoLogger } from 'nestjs-pino'

@Controller('voters/voter-file')
@UsePipes(ZodValidationPipe)
export class VoterFileController {
  constructor(
    private readonly voterFileService: VoterFileService,
    private readonly campaigns: CampaignsService,
    private readonly voterFileFilterService: VoterFileFilterService,
    private readonly organizationsService: OrganizationsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(VoterFileController.name)
  }

  @Get()
  @UseCampaign({
    continueIfNotFound: true,
  })
  @UseGuards(CanDownloadVoterFileGuard)
  async getVoterFile(
    @ReqUser() user: User,
    @ReqCampaign() campaign: Campaign,
    @Query() { slug, ...query }: GetVoterFileSchema,
    @Res() res: FastifyReply,
  ) {
    if (typeof slug === 'string' && campaign?.slug !== slug) {
      if (!userHasRole(user, [UserRole.admin])) {
        throw new ForbiddenException(
          'You are not authorized to access this campaign',
        )
      }

      campaign = await this.campaigns.findFirstOrThrow({
        where: { slug },
      })
    } else if (!campaign) throw new NotFoundException('Campaign not found')

    const organization = await this.organizationsService.findFirstOrThrow({
      where: { slug: campaign.organizationSlug },
    })

    // @Res() puts this handler in manual-response mode (required for the CSV
    // stream), so the count branch sends its own JSON body.
    if (query.countOnly) {
      return res.send(await this.voterFileService.getCount(organization, query))
    }
    await this.voterFileService.streamCsv(organization, query, res)
  }

  @Post('filter')
  @UseOrganization()
  async createVoterFileFilter(
    @ReqOrganization() organization: Organization,
    @Body() voterFileFilter: CreateVoterFileFilterSchema,
  ) {
    await this.voterFileFilterService.filterAccessCheck(organization.slug)
    return this.voterFileFilterService.create(
      organization.slug,
      voterFileFilter,
    )
  }

  @Get('filters')
  @UseOrganization()
  listVoterFileFilters(@ReqOrganization() organization: Organization) {
    return this.voterFileFilterService.findByOrganizationSlug(organization.slug)
  }

  @Get('filter/:id')
  @UseOrganization()
  async getVoterFileFilter(
    @Param('id', ParseIntPipe) id: number,
    @ReqOrganization() organization: Organization,
  ) {
    const filter =
      await this.voterFileFilterService.findByIdAndOrganizationSlug(
        id,
        organization.slug,
      )
    if (!filter) {
      throw new NotFoundException('Voter file filter not found')
    }
    return filter
  }

  @Put('filter/:id')
  @UseOrganization()
  async updateVoterFileFilter(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateVoterFileFilterSchema,
    @ReqOrganization() organization: Organization,
  ) {
    await this.voterFileFilterService.filterAccessCheck(organization.slug)
    const filter =
      await this.voterFileFilterService.findByIdAndOrganizationSlug(
        id,
        organization.slug,
      )
    if (!filter) {
      throw new NotFoundException('Voter file filter not found')
    }
    return this.voterFileFilterService.updateByIdAndOrganizationSlug(
      id,
      organization.slug,
      body,
    )
  }

  @Delete('filter/:id')
  @UseOrganization()
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteVoterFileFilter(
    @Param('id', ParseIntPipe) id: number,
    @ReqOrganization() organization: Organization,
  ) {
    await this.voterFileFilterService.filterAccessCheck(organization.slug)
    await this.voterFileFilterService.deleteByIdAndOrganizationSlug(
      id,
      organization.slug,
    )
  }
}

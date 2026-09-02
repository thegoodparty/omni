import {
  Controller,
  UsePipes,
  Get,
  Post,
  Delete,
  Query,
  ForbiddenException,
  Param,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  Body,
  NotFoundException,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import { CampaignsService } from '../services/campaigns.service'
import { Campaign, User } from '../../generated/prisma'
import { ReqUser } from 'src/authentication/decorators/ReqUser.decorator'
import { getUserFullName, isAdmin } from 'src/users/util/users.util'
import { CampaignUpdateHistoryService } from './campaignUpdateHistory.service'
import { CreateUpdateHistorySchema } from './schemas/createUpdateHistory.schema'
import { ReqCampaign } from '../decorators/ReqCampaign.decorator'
import { UseCampaign } from '../decorators/UseCampaign.decorator'

@Controller('campaigns/mine/update-history')
@UsePipes(ZodValidationPipe)
export class CampaignUpdateHistoryController {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly updateHistory: CampaignUpdateHistoryService,
  ) {}

  @Get()
  async list(@ReqUser() user: User, @Query('slug') slug?: string) {
    if (typeof slug === 'string' && !isAdmin(user)) {
      throw new ForbiddenException()
    }

    const campaign = slug
      ? await this.campaigns.findFirstOrThrow({ where: { slug } })
      : await this.campaigns.findActiveByUserId(user.id)

    if (!campaign) throw new NotFoundException()

    const updateHistory = await this.updateHistory.findMany({
      where: {
        campaignId: campaign.id,
      },
      include: {
        user: {
          select: {
            clerkId: true,
            firstName: true,
            lastName: true,
            name: true,
            avatar: true,
          },
        },
      },
    })

    return updateHistory.map((update) => ({
      ...update,
      user: {
        name: getUserFullName(update.user),
        avatar: update?.user?.avatar?.trim() || null,
      },
    }))
  }

  @Post()
  @UseCampaign()
  create(
    @ReqCampaign() campaign: Campaign,
    @Body() body: CreateUpdateHistorySchema,
  ) {
    return this.updateHistory.create(campaign, body)
  }

  @Delete(':id')
  @UseCampaign()
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Param('id', ParseIntPipe) id: number,
    @ReqCampaign() campaign: Campaign,
  ) {
    await this.updateHistory.delete(id, campaign.id)
  }
}

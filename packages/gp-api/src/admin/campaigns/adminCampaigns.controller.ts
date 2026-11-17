import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Put,
  UsePipes,
} from '@nestjs/common'
import { AdminCampaignsService } from './adminCampaigns.service'
import { ZodValidationPipe } from 'nestjs-zod'
import { AdminUpdateCampaignSchema } from './schemas/adminUpdateCampaign.schema'
import { Roles } from '../../authentication/decorators/Roles.decorator'
import { CampaignsService } from 'src/campaigns/services/campaigns.service'
import { UserRole } from '../../generated/prisma'

@Controller('admin/campaigns')
@Roles(UserRole.admin)
@UsePipes(ZodValidationPipe)
export class AdminCampaignsController {
  constructor(
    private readonly adminCampaigns: AdminCampaignsService,
    private readonly campaigns: CampaignsService,
  ) {}

  @Put(':id')
  @Roles(UserRole.admin, UserRole.sales)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: AdminUpdateCampaignSchema,
  ) {
    return this.adminCampaigns.update(id, body)
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id', ParseIntPipe) id: number) {
    await this.campaigns.findUniqueOrThrow({
      where: { id },
    })
    await this.adminCampaigns.delete(id)
  }

  @Get('pro-no-voter-file')
  proCampaignsWithNoVoterFile() {
    return this.adminCampaigns.proNoVoterFile()
  }
}

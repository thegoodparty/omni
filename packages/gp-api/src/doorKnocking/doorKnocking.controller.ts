import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import { z } from 'zod'
import {
  CreateDoorKnockingTurf,
  CreateDoorKnockingTurfSchema,
  DoorKnockingKnockRequest,
  DoorKnockingKnockRequestSchema,
  DoorKnockingKnockResponseSchema,
  DoorKnockingTurfSchema,
  UpdateDoorKnockingTurf,
  UpdateDoorKnockingTurfSchema,
} from '@goodparty_org/contracts'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { UseOrganization } from '@/organizations/decorators/UseOrganization.decorator'
import { ReqOrganization } from '@/organizations/decorators/ReqOrganization.decorator'
import { UseCampaign } from '@/campaigns/decorators/UseCampaign.decorator'
import { ReqCampaign } from '@/campaigns/decorators/ReqCampaign.decorator'
import { Campaign, Organization } from '../generated/prisma'
import { DoorKnockingTurfService } from './services/doorKnockingTurf.service'
import { DoorKnockingKnockService } from './services/doorKnockingKnock.service'

@Controller('door-knocking')
export class DoorKnockingController {
  constructor(
    private readonly turfService: DoorKnockingTurfService,
    private readonly knockService: DoorKnockingKnockService,
  ) {}

  @Post('turfs')
  @UseOrganization()
  @ResponseSchema(DoorKnockingTurfSchema)
  createTurf(
    @ReqOrganization() organization: Organization,
    @Body(new ZodValidationPipe(CreateDoorKnockingTurfSchema))
    input: CreateDoorKnockingTurf,
  ) {
    return this.turfService.create(organization.slug, input)
  }

  @Get('turfs')
  @UseOrganization()
  @ResponseSchema(z.array(DoorKnockingTurfSchema))
  listTurfs(
    @ReqOrganization() organization: Organization,
    @Query('voterFileFilterId', new ParseIntPipe({ optional: true }))
    voterFileFilterId?: number,
  ) {
    return this.turfService.list(organization.slug, voterFileFilterId)
  }

  @Get('turfs/:id')
  @UseOrganization()
  @ResponseSchema(DoorKnockingTurfSchema)
  getTurf(
    @Param('id', ParseIntPipe) id: number,
    @ReqOrganization() organization: Organization,
  ) {
    return this.turfService.get(id, organization.slug)
  }

  @Put('turfs/:id')
  @UseOrganization()
  @ResponseSchema(DoorKnockingTurfSchema)
  updateTurf(
    @Param('id', ParseIntPipe) id: number,
    @ReqOrganization() organization: Organization,
    @Body(new ZodValidationPipe(UpdateDoorKnockingTurfSchema))
    input: UpdateDoorKnockingTurf,
  ) {
    return this.turfService.update(id, organization.slug, input)
  }

  @Delete('turfs/:id')
  @UseOrganization()
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteTurf(
    @Param('id', ParseIntPipe) id: number,
    @ReqOrganization() organization: Organization,
  ) {
    await this.turfService.delete(id, organization.slug)
  }

  @Post('turfs/:id/knock')
  @UseOrganization()
  @UseCampaign({ continueIfNotFound: true })
  @ResponseSchema(DoorKnockingKnockResponseSchema)
  knock(
    @Param('id', ParseIntPipe) id: number,
    @ReqOrganization() organization: Organization,
    @ReqCampaign() campaign: Campaign | null,
    @Body(new ZodValidationPipe(DoorKnockingKnockRequestSchema))
    request: DoorKnockingKnockRequest,
  ) {
    return this.knockService.knock(id, organization, campaign, request)
  }
}

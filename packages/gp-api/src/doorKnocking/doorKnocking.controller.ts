import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  StreamableFile,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import { z } from 'zod'
import {
  CreateDoorKnockingTurf,
  CreateDoorKnockingTurfSchema,
  RecordDoorKnockInteraction,
  RecordDoorKnockInteractionSchema,
  RecordDoorKnockInteractionResponseSchema,
  SetDoNotKnock,
  SetDoNotKnockSchema,
  SetDoNotKnockResponseSchema,
  DoorKnockingKnockRequest,
  DoorKnockingKnockRequestSchema,
  DoorKnockingKnockResponseSchema,
  DoorKnockingRoutePayloadSchema,
  DoorKnockingTurfSchema,
  UpdateDoorKnockingTurf,
  UpdateDoorKnockingTurfSchema,
} from '@goodparty_org/contracts'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { UseOrganization } from '@/organizations/decorators/UseOrganization.decorator'
import { ReqOrganization } from '@/organizations/decorators/ReqOrganization.decorator'
import { UseCampaign } from '@/campaigns/decorators/UseCampaign.decorator'
import { ReqCampaign } from '@/campaigns/decorators/ReqCampaign.decorator'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { Campaign, Organization, User } from '../generated/prisma'
import { DoorKnockingTurfService } from './services/doorKnockingTurf.service'
import { DoorKnockingKnockService } from './services/doorKnockingKnock.service'
import { DoorKnockingServeService } from './services/doorKnockingServe.service'
import { DoorKnockingInteractionService } from './services/doorKnockingInteraction.service'
import { DoorKnockingPackService } from './services/doorKnockingPack.service'

@Controller('door-knocking')
export class DoorKnockingController {
  constructor(
    private readonly turfService: DoorKnockingTurfService,
    private readonly knockService: DoorKnockingKnockService,
    private readonly serveService: DoorKnockingServeService,
    private readonly interactionService: DoorKnockingInteractionService,
    private readonly packService: DoorKnockingPackService,
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

  @Get('turfs/:id/route')
  @UseOrganization()
  @ResponseSchema(DoorKnockingRoutePayloadSchema)
  serveRoute(
    @Param('id', ParseIntPipe) id: number,
    @ReqOrganization() organization: Organization,
  ) {
    return this.serveService.serve(id, organization)
  }

  @Get('pack')
  @UseOrganization()
  @Header('Content-Type', 'application/octet-stream')
  async pack(@ReqOrganization() organization: Organization) {
    return new StreamableFile(await this.packService.build(organization))
  }

  @Post('interactions')
  @UseOrganization()
  @ResponseSchema(RecordDoorKnockInteractionResponseSchema)
  recordInteraction(
    @ReqOrganization() organization: Organization,
    @Body(new ZodValidationPipe(RecordDoorKnockInteractionSchema))
    input: RecordDoorKnockInteraction,
  ) {
    return this.interactionService.record(organization, input)
  }

  // ADR 0007. Deliberately not the CRM's PATCH /contacts/:personId/status,
  // which is Pro-gated — the flagged pilot is not, and a candidate who cannot
  // honor "don't come back" is worse than one who never had the button.
  @Post('do-not-knock')
  @UseOrganization()
  @ResponseSchema(SetDoNotKnockResponseSchema)
  setDoNotKnock(
    @ReqOrganization() organization: Organization,
    @ReqUser() user: User,
    @Body(new ZodValidationPipe(SetDoNotKnockSchema))
    input: SetDoNotKnock,
  ) {
    return this.interactionService.setDoNotKnock(organization, user.id, input)
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

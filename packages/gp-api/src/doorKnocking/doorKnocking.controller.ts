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
  SetNotAVoter,
  SetNotAVoterSchema,
  SetNotAVoterResponseSchema,
  DoorKnockingAddressPreviewResponseSchema,
  DoorKnockingArchiveRequest,
  DoorKnockingArchiveRequestSchema,
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
import { ContactsService } from '@/contacts/services/contacts.service'
import { Campaign, Organization, User } from '../generated/prisma'
import { DoorKnockingTurfService } from './services/doorKnockingTurf.service'
import { DoorKnockingKnockService } from './services/doorKnockingKnock.service'
import { DoorKnockingServeService } from './services/doorKnockingServe.service'
import { DoorKnockingInteractionService } from './services/doorKnockingInteraction.service'
import { DoorKnockingPackService } from './services/doorKnockingPack.service'
import { DoorKnockingPreviewService } from './services/doorKnockingPreview.service'
import {
  DoorKnockingAddressPreview,
  DoorKnockingAddressPreviewSchema,
} from './schemas/doorKnockingAddressPreview.schema'

// Every route here is Pro-gated through ContactsService.assertProAccess — the
// CRM's own predicate, so an `eo-` (Serve) org keeps access without isPro —
// EXCEPT the two suppression writes below. Reads are gated alongside the
// writes: a map you can open but cannot route is a worse answer than an
// upgrade prompt, and each knock spends real Geoapify routing credits.
@Controller('door-knocking')
export class DoorKnockingController {
  constructor(
    private readonly turfService: DoorKnockingTurfService,
    private readonly knockService: DoorKnockingKnockService,
    private readonly serveService: DoorKnockingServeService,
    private readonly interactionService: DoorKnockingInteractionService,
    private readonly packService: DoorKnockingPackService,
    private readonly previewService: DoorKnockingPreviewService,
    private readonly contacts: ContactsService,
  ) {}

  @Post('turfs')
  @UseOrganization()
  @ResponseSchema(DoorKnockingTurfSchema)
  async createTurf(
    @ReqOrganization() organization: Organization,
    @Body(new ZodValidationPipe(CreateDoorKnockingTurfSchema))
    input: CreateDoorKnockingTurf,
  ) {
    await this.contacts.assertProAccess(organization)
    return this.turfService.create(organization.slug, input)
  }

  @Get('turfs')
  @UseOrganization()
  @ResponseSchema(z.array(DoorKnockingTurfSchema))
  async listTurfs(@ReqOrganization() organization: Organization) {
    await this.contacts.assertProAccess(organization)
    return this.turfService.list(organization.slug)
  }

  // No webapp caller and none wanted: the rail lists every turf at once, so a
  // single-turf read has no surface. It is not orphaned — the routes suite reads
  // `locked` back through it (derived, so there is no column to query instead)
  // and the print-walk-list e2e spec uses it as the control proving a turf
  // exists before asserting the print route 404s on a missing route.
  @Get('turfs/:id')
  @UseOrganization()
  @ResponseSchema(DoorKnockingTurfSchema)
  async getTurf(
    @Param('id', ParseIntPipe) id: number,
    @ReqOrganization() organization: Organization,
  ) {
    await this.contacts.assertProAccess(organization)
    return this.turfService.get(id, organization.slug)
  }

  @Put('turfs/:id')
  @UseOrganization()
  @ResponseSchema(DoorKnockingTurfSchema)
  async updateTurf(
    @Param('id', ParseIntPipe) id: number,
    @ReqOrganization() organization: Organization,
    @Body(new ZodValidationPipe(UpdateDoorKnockingTurfSchema))
    input: UpdateDoorKnockingTurf,
  ) {
    await this.contacts.assertProAccess(organization)
    return this.turfService.update(id, organization.slug, input)
  }

  @Delete('turfs/:id')
  @UseOrganization()
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteTurf(
    @Param('id', ParseIntPipe) id: number,
    @ReqOrganization() organization: Organization,
  ) {
    await this.contacts.assertProAccess(organization)
    await this.turfService.delete(id, organization.slug)
  }

  // POST, not PATCH on the turf: "end the session" and "shelve the list" are
  // events, not field edits, and PUT turfs/:id refuses a knocked turf outright
  // — these apply only to knocked ones.
  @Post('turfs/:id/complete')
  @UseOrganization()
  @ResponseSchema(DoorKnockingTurfSchema)
  async completeTurf(
    @Param('id', ParseIntPipe) id: number,
    @ReqOrganization() organization: Organization,
  ) {
    await this.contacts.assertProAccess(organization)
    return this.turfService.complete(id, organization.slug)
  }

  // One route with a body rather than archive/unarchive as a pair: the client
  // is toggling a shelf, and splitting it would make the restore path a second
  // thing to remember to gate and test.
  @Post('turfs/:id/archive')
  @UseOrganization()
  @ResponseSchema(DoorKnockingTurfSchema)
  async archiveTurf(
    @Param('id', ParseIntPipe) id: number,
    @ReqOrganization() organization: Organization,
    @Body(new ZodValidationPipe(DoorKnockingArchiveRequestSchema))
    input: DoorKnockingArchiveRequest,
  ) {
    await this.contacts.assertProAccess(organization)
    return this.turfService.setArchived(id, organization.slug, input.archived)
  }

  @Get('turfs/:id/route')
  @UseOrganization()
  @ResponseSchema(DoorKnockingRoutePayloadSchema)
  async serveRoute(
    @Param('id', ParseIntPipe) id: number,
    @ReqOrganization() organization: Organization,
  ) {
    await this.contacts.assertProAccess(organization)
    return this.serveService.serve(id, organization)
  }

  // Returns the stream rather than awaiting the pack: awaiting it kept the
  // socket idle for the whole build (12.7-43.5s, and the gateway cuts at
  // ~120s with no status written). The stream writes its magic immediately
  // and heartbeats until the pack is ready — see utils/packStream.util.ts.
  // The corollary is that a build failure lands after this 200, as an error
  // frame and a log line, not as a status code.
  @Get('pack')
  @UseOrganization()
  @Header('Content-Type', 'application/octet-stream')
  async pack(@ReqOrganization() organization: Organization) {
    await this.contacts.assertProAccess(organization)
    return new StreamableFile(this.packService.stream(organization))
  }

  // The draw step's address list (ADR 0010). A read of voter data, so it is
  // Pro-gated with the rest — the two holes below are instructions about a
  // door, and this is neither. A POST because the shape and the filter draft
  // are a body, not a query string; nothing is written and no vendor credit
  // is spent.
  @Post('address-preview')
  @UseOrganization()
  @ResponseSchema(DoorKnockingAddressPreviewResponseSchema)
  async previewAddresses(
    @ReqOrganization() organization: Organization,
    @Body(new ZodValidationPipe(DoorKnockingAddressPreviewSchema))
    input: DoorKnockingAddressPreview,
  ) {
    await this.contacts.assertProAccess(organization)
    return this.previewService.preview(organization, input)
  }

  @Post('interactions')
  @UseOrganization()
  @ResponseSchema(RecordDoorKnockInteractionResponseSchema)
  async recordInteraction(
    @ReqOrganization() organization: Organization,
    @Body(new ZodValidationPipe(RecordDoorKnockInteractionSchema))
    input: RecordDoorKnockInteraction,
  ) {
    await this.contacts.assertProAccess(organization)
    return this.interactionService.record(organization, input)
  }

  // ADR 0007, and the first of the two deliberate holes in the Pro gate above.
  // Deliberately not the CRM's PATCH /contacts/:personId/status, which is
  // Pro-gated — a candidate who cannot honor "don't come back" is worse than
  // one who never had the button, so suppression outlives the entitlement: if
  // an org lapses mid-pilot it must still be able to record a refusal to
  // return, even though every other route here now 400s for it.
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

  // ADR 0008, and the second hole. Ungated for the same reason as
  // do-not-knock: the reason a door is wrong is worth capturing from whoever
  // is standing at it, and "moved" / "deceased" suppress future evaluation the
  // same way a refusal does. Both are instructions about a door rather than
  // work a subscription buys.
  @Post('not-a-voter')
  @UseOrganization()
  @ResponseSchema(SetNotAVoterResponseSchema)
  setNotAVoter(
    @ReqOrganization() organization: Organization,
    @ReqUser() user: User,
    @Body(new ZodValidationPipe(SetNotAVoterSchema))
    input: SetNotAVoter,
  ) {
    return this.interactionService.setNotAVoter(organization, user.id, input)
  }

  @Post('turfs/:id/knock')
  @UseOrganization()
  @UseCampaign({ continueIfNotFound: true })
  @ResponseSchema(DoorKnockingKnockResponseSchema)
  async knock(
    @Param('id', ParseIntPipe) id: number,
    @ReqOrganization() organization: Organization,
    @ReqCampaign() campaign: Campaign | null,
    @Body(new ZodValidationPipe(DoorKnockingKnockRequestSchema))
    request: DoorKnockingKnockRequest,
  ) {
    await this.contacts.assertProAccess(organization)
    return this.knockService.knock(id, organization, campaign, request)
  }
}

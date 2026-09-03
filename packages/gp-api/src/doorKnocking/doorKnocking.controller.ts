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
  DoorKnockingQuotaResponseSchema,
  DoorKnockingArchiveRequest,
  DoorKnockingArchiveRequestSchema,
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
import { UseElectedOffice } from '@/electedOffice/decorators/UseElectedOffice.decorator'
import { ReqElectedOffice } from '@/electedOffice/decorators/ReqElectedOffice.decorator'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { ContactsService } from '@/contacts/services/contacts.service'
import {
  Campaign,
  ElectedOffice,
  Organization,
  User,
} from '../generated/prisma'
import { DoorKnockingTurfService } from './services/doorKnockingTurf.service'
import { DoorKnockingCreateService } from './services/doorKnockingCreate.service'
import { DoorKnockingServeService } from './services/doorKnockingServe.service'
import { DoorKnockingInteractionService } from './services/doorKnockingInteraction.service'
import { DoorKnockingPackService } from './services/doorKnockingPack.service'
import { DoorKnockingPreviewService } from './services/doorKnockingPreview.service'
import { DoorKnockingQuotaService } from './services/doorKnockingQuota.service'
import {
  DoorKnockingAddressPreview,
  DoorKnockingAddressPreviewSchema,
} from './schemas/doorKnockingAddressPreview.schema'

// Every route here is Pro-gated through ContactsService.assertProAccess — the
// CRM's own predicate, so an `eo-` (Serve) org keeps access without isPro —
// EXCEPT the two suppression writes below. Reads are gated alongside the
// writes: a map you can open but cannot route is a worse answer than an
// upgrade prompt, and creating a list spends real Geoapify routing credits.
@Controller('door-knocking')
export class DoorKnockingController {
  constructor(
    private readonly turfService: DoorKnockingTurfService,
    private readonly createService: DoorKnockingCreateService,
    private readonly serveService: DoorKnockingServeService,
    private readonly interactionService: DoorKnockingInteractionService,
    private readonly packService: DoorKnockingPackService,
    private readonly previewService: DoorKnockingPreviewService,
    private readonly quotaService: DoorKnockingQuotaService,
    private readonly contacts: ContactsService,
  ) {}

  // Creating a list buys its route: this is the only paid call in the feature
  // and the only place the Win/Serve scope is chosen. Everything downstream is
  // reached through `voterFileFilter.organizationSlug` and so is already
  // org-scoped, which is why this and its serve sibling below are the only
  // pair — the same shape phone banking settled on.
  @Post('turfs')
  @UseOrganization()
  @UseCampaign({ continueIfNotFound: true })
  @ResponseSchema(DoorKnockingTurfSchema)
  async createTurf(
    @ReqOrganization() organization: Organization,
    @ReqCampaign() campaign: Campaign | null,
    @Body(new ZodValidationPipe(CreateDoorKnockingTurfSchema))
    input: CreateDoorKnockingTurf,
  ) {
    await this.contacts.assertProAccess(organization)
    return this.createService.create(
      organization,
      campaign
        ? {
            campaignId: campaign.id,
            organizationSlug: campaign.organizationSlug,
          }
        : { campaignId: null, organizationSlug: organization.slug },
      input,
    )
  }

  // Serve counterpart: @UseElectedOffice() re-derives the surface from the
  // org's own ElectedOffice row (never trusting the client), same as phone
  // banking's serve/lists. The scope is always { campaignId: null,
  // organizationSlug } — never derived from whether this org also happens to
  // hold a Campaign (the Win/Serve isolation invariant, ENG-10976).
  //
  // assertProAccess still runs, as it does on phone banking's serve sibling,
  // and the constituent-outreach AGENTS.md is right that the ElectedOffice row
  // is the entitlement — the two are not in tension. The predicate is
  // `hasElectedOfficeAccess || isPro`, so on a route @UseElectedOffice() has
  // already admitted, this call cannot refuse anything. It is kept because the
  // gate is applied per method rather than per module: a route missing the
  // line is indistinguishable from one that forgot it, and a redundant pass
  // costs a cached lookup.
  @Post('serve/turfs')
  @UseElectedOffice()
  @UseOrganization()
  @ResponseSchema(DoorKnockingTurfSchema)
  async createServeTurf(
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @ReqOrganization() organization: Organization,
    @Body(new ZodValidationPipe(CreateDoorKnockingTurfSchema))
    input: CreateDoorKnockingTurf,
  ) {
    await this.contacts.assertProAccess(organization)
    return this.createService.create(
      organization,
      { campaignId: null, organizationSlug: electedOffice.organizationSlug },
      input,
    )
  }

  // The rail, scoped by surface as well as by org — the one read that is, and
  // the one 3.0's invariant made expressible (see `railTurfScope`). The scope
  // is chosen exactly as `createTurf` above chooses it, so a list appears on
  // the rail of the surface that made it: a campaign present means Win, its
  // absence means Serve. Deriving it the same way in both places is the point
  // — a create and a list that disagreed would write rows onto a rail that
  // cannot show them.
  @Get('turfs')
  @UseOrganization()
  @UseCampaign({ continueIfNotFound: true })
  @ResponseSchema(z.array(DoorKnockingTurfSchema))
  async listTurfs(
    @ReqOrganization() organization: Organization,
    @ReqCampaign() campaign: Campaign | null,
  ) {
    await this.contacts.assertProAccess(organization)
    return this.turfService.list(organization.slug, {
      campaignId: campaign?.id ?? null,
    })
  }

  // Serve counterpart, and the reason the pair exists at all: an org holding
  // both a Campaign and an ElectedOffice would otherwise have its Serve rail
  // derive `campaignId` from the Campaign it happens to hold and show its Win
  // lists (ENG-10976). A caller that knows it is Serve says so by choosing
  // this route, and the scope is pinned rather than derived.
  @Get('serve/turfs')
  @UseElectedOffice()
  @UseOrganization()
  @ResponseSchema(z.array(DoorKnockingTurfSchema))
  async listServeTurfs(
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @ReqOrganization() organization: Organization,
  ) {
    await this.contacts.assertProAccess(organization)
    return this.turfService.list(electedOffice.organizationSlug, {
      campaignId: null,
    })
  }

  // No webapp caller and none wanted: the rail lists every turf at once, so a
  // single-turf read has no surface. It is not orphaned — the routes suite
  // reads a turf's derived counts and lifecycle back through it, and the
  // print-walk-list e2e spec uses it as the control proving a turf exists
  // before asserting the print route's own failure.
  //
  // Org-scoped only, no serve sibling, like every other by-id route here: an
  // id the caller already holds cannot be made to cross a surface by asking
  // for it on the wrong one.
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

  // POST, not PATCH: "end the session" and "shelve the list" are events, not
  // field edits, and PUT turfs/:id edits the turf's name and color while these
  // two write the Outreach envelope the turf hangs off. They take a turf id
  // because that is what the client holds; the envelope is one @unique hop
  // away.
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

  // The day's allowance, read before the flow opens rather than discovered at
  // the last press. The remedy for this 429 is waiting out a rolling 24-hour
  // window, and the flow holds its polygon, name and travel mode in memory
  // only — so meeting it at Build route throws all of that away. This is the
  // only allowance left to report: a 500-stop daily budget rode the
  // address-preview response and has been removed.
  //
  // Org-scoped with no serve sibling. The allowance belongs to the
  // organization — turfs reach it through `voterFileFilter.organizationSlug`
  // — so there is no per-surface answer for a Win/Serve pair to keep apart,
  // and a Serve org reaches this the same way it reaches address-preview.
  @Get('quota')
  @UseOrganization()
  @ResponseSchema(DoorKnockingQuotaResponseSchema)
  async quota(@ReqOrganization() organization: Organization) {
    await this.contacts.assertProAccess(organization)
    return this.quotaService.read(organization)
  }

  @Post('interactions')
  @UseOrganization()
  @ResponseSchema(RecordDoorKnockInteractionResponseSchema)
  async recordInteraction(
    @ReqOrganization() organization: Organization,
    @ReqUser() user: User,
    @Body(new ZodValidationPipe(RecordDoorKnockInteractionSchema))
    input: RecordDoorKnockInteraction,
  ) {
    await this.contacts.assertProAccess(organization)
    return this.interactionService.record(organization, user.id, input)
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
}

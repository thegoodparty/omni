import { IncomingRequest } from '@/authentication/authentication.types'
import { M2MOnly } from '@/authentication/guards/M2MOnly.guard'
import { MagicLinkService } from '@/magicLink/magicLink.service'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
  UsePipes,
} from '@nestjs/common'
import { ElectedOffice, Organization, Prisma, User } from '../generated/prisma'
import { ZodValidationPipe } from 'nestjs-zod'
import { ReqUser } from 'src/authentication/decorators/ReqUser.decorator'
import { ReqOrganization } from 'src/organizations/decorators/ReqOrganization.decorator'
import { UseOrganization } from 'src/organizations/decorators/UseOrganization.decorator'
import { ReqElectedOffice } from './decorators/ReqElectedOffice.decorator'
import { UseElectedOffice } from './decorators/UseElectedOffice.decorator'
import { UserOrM2MGuard } from './guards/UserOrM2M.guard'
import {
  CreateElectedOfficeDto,
  SetElectedOfficeDistrictDto,
  UpdateElectedOfficeDto,
} from './schemas/electedOffice.schema'
import { ListElectedOfficePaginationSchema } from './schemas/ListElectedOfficePagination.schema'
import {
  dateRangesOverlap,
  ElectedOfficeService,
} from './services/electedOffice.service'
import { SupportEstimateService } from './services/supportEstimate.service'
import { electedOfficeToApi } from './util/electedOffice.util'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import {
  SupportEstimate,
  SupportEstimateSchema,
} from '@goodparty_org/contracts'

@Controller('elected-office')
@UsePipes(ZodValidationPipe)
export class ElectedOfficeController {
  constructor(
    private readonly electedOfficeService: ElectedOfficeService,
    private readonly organizationsService: OrganizationsService,
    private readonly supportEstimateService: SupportEstimateService,
    private readonly magicLinkService: MagicLinkService,
  ) {}

  private toApi(record: Prisma.ElectedOfficeGetPayload<object>) {
    return electedOfficeToApi(record)
  }

  @UseGuards(M2MOnly)
  @Get('list')
  async list(@Query() query: ListElectedOfficePaginationSchema) {
    return this.electedOfficeService.listElectedOffices(query)
  }

  @UseElectedOffice()
  @Get('current')
  async getCurrent(@ReqElectedOffice() electedOffice: ElectedOffice) {
    return this.toApi(electedOffice)
  }

  // The current user's elected offices, used by the serve onboarding flow to
  // enforce the no-overlapping-term-dates invariant (the term-date selector
  // greys out ranges already covered by an existing office).
  @Get('mine')
  async listMine(@ReqUser() user: User) {
    // The global SessionGuard admits M2M tokens without populating request.user,
    // so guard against that here — "mine" is meaningless without a user.
    if (!user) {
      throw new UnauthorizedException()
    }
    const offices =
      await this.electedOfficeService.client.electedOffice.findMany({
        where: { userId: user.id },
        orderBy: { termStartDate: 'asc' },
      })
    return offices.map((office) => this.toApi(office))
  }

  // Called by the /serve/welcome redemption page once the lead has activated
  // their own session via the magic-link ticket. Marks the link redeemed (once)
  // so the sales card reflects it. Session-authed: the global SessionGuard
  // populates request.user, and an M2M token (no user) is rejected here — the
  // caller is always the just-signed-in lead.
  @Post('magic-link/redeemed')
  @HttpCode(HttpStatus.OK)
  async markMagicLinkRedeemed(@ReqUser() user: User) {
    if (!user) {
      throw new UnauthorizedException()
    }
    await this.magicLinkService.markRedeemed(user.id)
    return { ok: true }
  }

  @UseElectedOffice()
  @Get('support-estimate')
  @ResponseSchema(SupportEstimateSchema.nullable())
  getSupportEstimate(
    @ReqElectedOffice() electedOffice: ElectedOffice,
  ): Promise<SupportEstimate | null> {
    return this.supportEstimateService.getSupportEstimate(electedOffice.id)
  }

  @UseGuards(UserOrM2MGuard)
  @Get(':id')
  async getOne(@Param('id') id: string, @Req() req: IncomingRequest) {
    const record = await this.electedOfficeService.findUnique({ where: { id } })
    if (!record) {
      throw new NotFoundException('Elected office not found')
    }
    if (!req.m2mToken && record.userId !== req.user?.id) {
      throw new ForbiddenException('Not allowed to access this elected office')
    }
    return this.toApi(record)
  }

  @Post('/')
  @HttpCode(HttpStatus.OK)
  @UseOrganization({ continueIfNotFound: true })
  async create(
    @ReqUser() user: User,
    @Body() body: CreateElectedOfficeDto,
    @ReqOrganization() organization: Organization | undefined,
  ) {
    // The global SessionGuard admits M2M tokens without populating request.user;
    // creating an office requires a concrete owner, so reject rather than
    // dereference user.id below.
    if (!user) {
      throw new UnauthorizedException()
    }
    const {
      ballotReadyPositionId,
      customPositionName,
      overrideDistrictId,
      ...eoFields
    } = body

    // When an organization context exists (e.g. an existing candidate campaign
    // becoming an elected office), link any campaign and inherit the office
    // identity from that organization. Otherwise this is a net-new elected
    // office with no campaign — the office identity comes from the request body.
    let campaignId: number | undefined
    let orgData: {
      positionId: string | null
      customPositionName: string | null
      overrideDistrictId: string | null
    }
    if (organization) {
      const campaign =
        await this.electedOfficeService.client.campaign.findUnique({
          where: { organizationSlug: organization.slug },
        })
      campaignId = campaign?.id
      orgData = {
        positionId: organization.positionId,
        customPositionName: organization.customPositionName,
        overrideDistrictId: organization.overrideDistrictId,
      }
    } else {
      orgData = {
        positionId: ballotReadyPositionId ?? null,
        customPositionName: customPositionName ?? null,
        overrideDistrictId: overrideDistrictId ?? null,
      }
    }

    // Mirror the PUT guard: completing serve onboarding is only meaningful once
    // the office has a real, fully-dated term. Require BOTH a start and an end —
    // a completed office is no longer prompted for dates, so allowing completion
    // on a term-less or start-only (indefinite) record would either bypass the
    // serve-onboarding flow or strand the EO in a state the dashboard term-date
    // modal perpetually re-prompts (it requires both bounds to save).
    if (
      eoFields.onboardingCompletedAt != null &&
      (!eoFields.termStartDate || !eoFields.termEndDate)
    ) {
      throw new BadRequestException(
        'onboardingCompletedAt requires both a term start and end date',
      )
    }

    const created = await this.electedOfficeService.create({
      ...eoFields,
      userId: user.id,
      campaignId,
      orgData,
    })

    // A net-new lead can complete serve onboarding in a single create (term
    // dates + onboardingCompletedAt in one POST). Mirror that to the magic-link
    // lifecycle so the sales card shows "onboarded". Idempotent + best-effort.
    if (eoFields.onboardingCompletedAt != null) {
      await this.magicLinkService
        .markOnboardingCompleted(user.id)
        .catch(() => undefined)
    }

    return this.toApi(created)
  }

  @UseGuards(UserOrM2MGuard)
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateElectedOfficeDto,
    @Req() req: IncomingRequest,
  ) {
    const existing = await this.electedOfficeService.findUnique({
      where: { id },
    })
    if (!existing) {
      throw new NotFoundException('Elected office not found')
    }
    if (!req.m2mToken && existing.userId !== req.user?.id) {
      throw new ForbiddenException('Not allowed to access this elected office')
    }

    // onboardingCompletedAt gates the serve-onboarding redirect, so only the
    // authenticated onboarding flow (which runs on the user session) may write
    // it. An M2M token carries no user context; letting it set this field would
    // let any trusted service permanently suppress another user's serve
    // onboarding. Reject explicitly (incl. null) rather than silently stripping
    // so misuse is visible. Every OTHER field stays M2M-updatable, preserving
    // the established SDK update() capability for provisioning/integrations.
    if (req.m2mToken && body.onboardingCompletedAt !== undefined) {
      throw new ForbiddenException(
        'onboardingCompletedAt cannot be set via M2M; it is set by the authenticated onboarding flow',
      )
    }

    // selfReported drives serve-onboarding routing the same way
    // onboardingCompletedAt does, so it gets the same protections.
    //
    // M2M write block: only the authenticated onboarding flow (user session)
    // may promote a record to selfReported. An M2M token carries no user
    // context; letting it set this field would let any trusted service
    // permanently reclassify a sales/BallotReady-prefilled record as net-new,
    // routing the holder into the net-new branch and suppressing the BR
    // suggestion-accuracy snapshot. Provisioning never needs this (prefilled
    // records are, by definition, not self-reported).
    if (req.m2mToken && body.selfReported !== undefined) {
      throw new ForbiddenException(
        'selfReported cannot be set via M2M; it is set by the authenticated onboarding flow',
      )
    }

    // onboardingStep is the resume checkpoint written on every "Continue" by the
    // authenticated onboarding flow. An M2M token carries no user session, so it
    // has no business moving another user's resume pointer (which would drop a
    // returning holder onto the wrong step). Provisioning never sets it.
    if (req.m2mToken && body.onboardingStep !== undefined) {
      throw new ForbiddenException(
        'onboardingStep cannot be set via M2M; it is set by the authenticated onboarding flow',
      )
    }
    // Monotonic, one-way marker: once set, downgrading it back to false would
    // silently reclassify a net-new record as a prefill on resume (misleading
    // "pulled from public records" confirm hub) and fire the BR snapshot against
    // user-entered data. Reject the true→false downgrade for any caller; setting
    // it true, or leaving it unset, stays allowed.
    if (body.selfReported === false && existing.selfReported === true) {
      throw new ForbiddenException(
        'selfReported cannot be downgraded from true to false; it is set once by the net-new onboarding flow',
      )
    }

    // Mirror create()'s no-overlap invariant: term dates are writable via PUT,
    // so an update must not push this office's term into a range another office
    // the same user holds already covers. Use the effective post-update bounds
    // (a field left out of the body keeps its existing value).
    const effectiveTermStart =
      body.termStartDate !== undefined
        ? body.termStartDate
        : existing.termStartDate
    const effectiveTermEnd =
      body.termEndDate !== undefined ? body.termEndDate : existing.termEndDate
    // The schema's refineTermDates only fires when BOTH bounds are in the body,
    // so a partial PUT could set one bound against the existing other and
    // invert the term (end on/before start). Re-check the effective bounds.
    if (
      effectiveTermStart &&
      effectiveTermEnd &&
      effectiveTermEnd.getTime() <= effectiveTermStart.getTime()
    ) {
      throw new BadRequestException('termEndDate must be after termStartDate')
    }
    if (effectiveTermStart || effectiveTermEnd) {
      const siblings = await this.electedOfficeService.findMany({
        where: { userId: existing.userId, id: { not: id } },
      })
      const overlapping = siblings.find((office) =>
        dateRangesOverlap(
          office.termStartDate,
          office.termEndDate,
          effectiveTermStart ?? null,
          effectiveTermEnd ?? null,
        ),
      )
      if (overlapping) {
        throw new ConflictException(
          'Elected office term overlaps an existing elected office for this user',
        )
      }
    }

    // Completing serve onboarding is only meaningful once the office has a real,
    // fully-dated term. A completed office is treated as done by post-auth
    // routing AND is no longer prompted for dates, so allowing completion on a
    // start-only (indefinite) term would let an EO finish onboarding into a
    // state the dashboard term-date modal perpetually re-prompts (the modal
    // requires BOTH bounds to save) — an un-satisfiable loop. Require both an
    // effective termStartDate and termEndDate, matching the term-validity
    // invariant and the modal's Save gate. (This is independent of overlap
    // handling, where a null end still counts as an indefinite +Infinity term.)
    if (
      body.onboardingCompletedAt != null &&
      (!effectiveTermStart || !effectiveTermEnd)
    ) {
      throw new BadRequestException(
        'onboardingCompletedAt requires both a term start and end date',
      )
    }

    // isActive and termLengthDays are no longer stored — they are derived from
    // the term dates at read time (see electedOffice.util) — so they are not
    // accepted or written here.
    const data: Prisma.ElectedOfficeUpdateInput = {
      swornInDate: body.swornInDate,
      electedDate: body.electedDate,
      termStartDate: body.termStartDate,
      termEndDate: body.termEndDate,
      party: body.party,
      pledgedAt: body.pledgedAt,
      onboardingCompletedAt: body.onboardingCompletedAt,
      selfReported: body.selfReported,
      onboardingStep: body.onboardingStep,
    }
    const updated = await this.electedOfficeService.update({
      where: { id },
      data,
    })

    // Most serve-onboarding completions land here (PUT with onboardingCompletedAt
    // after the office/term are filled). Mirror the first null→set transition to
    // the magic-link lifecycle for the sales card. Idempotent + best-effort.
    if (
      body.onboardingCompletedAt != null &&
      existing.onboardingCompletedAt == null
    ) {
      await this.magicLinkService
        .markOnboardingCompleted(existing.userId)
        .catch(() => undefined)
    }

    return this.toApi(updated)
  }

  @UseGuards(M2MOnly)
  @Put(':id/district')
  async setDistrict(
    @Param('id') id: string,
    @Body() body: SetElectedOfficeDistrictDto,
  ) {
    const existing = await this.electedOfficeService.findUnique({
      where: { id },
    })
    if (!existing) {
      throw new NotFoundException('Elected office not found')
    }

    const orgSlug = OrganizationsService.electedOfficeOrgSlug(id)
    const org = await this.organizationsService.findUnique({
      where: { slug: orgSlug },
    })
    if (!org) {
      throw new NotFoundException(
        'Organization for this elected office not found',
      )
    }

    const overrideDistrictId =
      await this.organizationsService.resolveOverrideDistrictId({
        positionId: org.positionId ?? undefined,
        state: body.state,
        L2DistrictType: body.L2DistrictType,
        L2DistrictName: body.L2DistrictName,
      })

    await this.organizationsService.model.update({
      where: { slug: orgSlug },
      data: { overrideDistrictId },
    })

    return { electedOfficeId: id, overrideDistrictId }
  }
}

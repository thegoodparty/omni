import { IncomingRequest } from '@/authentication/authentication.types'
import { M2MOnly } from '@/authentication/guards/M2MOnly.guard'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  forwardRef,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
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
import {
  ElectedOffice,
  ElectedOfficeWinSource,
  Organization,
  Prisma,
  User,
} from '../generated/prisma'
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
import { WinTermService } from './services/winTerm.service'
import { CrmOfficeHolderService } from './services/crmOfficeHolder.service'
import { electedOfficeToApi, isPreparedOffice } from './util/electedOffice.util'
import { PrioritiesService } from '@/priorities/services/priorities.service'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import {
  campaignWasEverPro,
  CurrentElectedOffice,
  CurrentElectedOfficeSchema,
  MyElectedOffice,
  MyElectedOfficeSchema,
  SupportEstimate,
  SupportEstimateSchema,
} from '@goodparty_org/contracts'
import { z } from 'zod'
import { addYears, format, parseISO } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { DateFormats, parseIsoDateAsUTC } from '@/shared/util/date.util'

// Term dates are date-only values held at UTC midnight. The years are added
// to the calendar date, not the instant, so a server outside UTC cannot land
// the result on the day before.
const addYearsToDateOnly = (date: Date, years: number): Date =>
  parseIsoDateAsUTC(
    format(
      addYears(
        parseISO(formatInTimeZone(date, 'UTC', DateFormats.isoDate)),
        years,
      ),
      DateFormats.isoDate,
    ),
  )

// The holder's yes keeps the moment they first gave it; a no clears it.
const briefingTextReminderAt = (
  answer: boolean | undefined,
  stored: Date | null,
): Date | null | undefined =>
  answer === undefined ? undefined : answer ? (stored ?? new Date()) : null

@Controller('elected-office')
@UsePipes(ZodValidationPipe)
export class ElectedOfficeController {
  constructor(
    private readonly electedOfficeService: ElectedOfficeService,
    private readonly organizationsService: OrganizationsService,
    private readonly supportEstimateService: SupportEstimateService,
    private readonly crmOfficeHolder: CrmOfficeHolderService,
    @Inject(forwardRef(() => PrioritiesService))
    private readonly prioritiesService: PrioritiesService,
    private readonly winTerm: WinTermService,
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
  @ResponseSchema(CurrentElectedOfficeSchema)
  async getCurrent(
    @ReqElectedOffice() electedOffice: ElectedOffice,
  ): Promise<CurrentElectedOffice> {
    const campaign =
      electedOffice.campaignId === null
        ? null
        : await this.electedOfficeService.client.campaign.findUnique({
            where: { id: electedOffice.campaignId },
            select: { votesReceived: true },
          })
    return {
      ...this.toApi(electedOffice),
      votesReceived: campaign?.votesReceived ?? null,
    }
  }

  // The current user's elected offices, used by the serve onboarding flow to
  // enforce the no-overlapping-term-dates invariant (the term-date selector
  // greys out ranges already covered by an existing office).
  @Get('mine')
  @ResponseSchema(z.array(MyElectedOfficeSchema))
  async listMine(@ReqUser() user: User): Promise<MyElectedOffice[]> {
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
    // Serve onboarding holds back paid community issues research until an
    // official with issues they ran on confirms they are in office.
    const withWinIssues =
      await this.prioritiesService.officesWithWinIssues(offices)
    const linkedCampaignIds = offices.flatMap((office) =>
      office.campaignId === null ? [] : [office.campaignId],
    )
    const linkedCampaigns =
      linkedCampaignIds.length === 0
        ? []
        : await this.electedOfficeService.client.campaign.findMany({
            where: { id: { in: linkedCampaignIds } },
            select: {
              id: true,
              isPro: true,
              details: true,
              votesReceived: true,
            },
          })
    const everProCampaignIds = new Set(
      linkedCampaigns.filter(campaignWasEverPro).map((c) => c.id),
    )
    const votesByCampaignId = new Map(
      linkedCampaigns.map((c) => [c.id, c.votesReceived]),
    )
    return offices.map((office) => ({
      ...this.toApi(office),
      votesReceived:
        office.campaignId === null
          ? null
          : (votesByCampaignId.get(office.campaignId) ?? null),
      hasWinIssues: withWinIssues.has(office.id),
      campaignWasEverPro:
        office.campaignId !== null && everProCampaignIds.has(office.campaignId),
      prepared: isPreparedOffice(office),
    }))
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
    const { ballotReadyPositionId, customPositionName, ...eoFields } = body

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
      // positionId is election-api's own id, never the BallotReady id the
      // body carries — resolve it the same way a campaign or a self-service
      // PATCH does, so later reads of this org don't hand election-api a BR
      // id and 400.
      orgData = await this.organizationsService.resolveOrgData({
        ballotReadyPositionId,
        customPositionName,
      })
      if (ballotReadyPositionId && !orgData.positionId) {
        throw new BadRequestException('Position not found')
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

    // A win sends no term: fill it from the winner's own BallotReady record
    // when there is one, so Serve onboarding's term step comes prefilled.
    const winTerm =
      campaignId != null &&
      !eoFields.termStartDate &&
      !eoFields.termEndDate &&
      eoFields.onboardingCompletedAt == null
        ? await this.winTerm.forWinner(orgData.positionId, user)
        : null

    // A campaign org's create is the Pro winner's own "I won".
    const createArgs = {
      ...eoFields,
      userId: user.id,
      campaignId,
      winSource:
        campaignId != null ? ElectedOfficeWinSource.self_reported : undefined,
      orgData,
    }
    if (winTerm) {
      try {
        return this.toApi(
          await this.electedOfficeService.create({
            ...createArgs,
            ...winTerm,
          }),
        )
      } catch (err) {
        // A looked-up term that collides with an office they already hold
        // must not cost them the win: create it term-less and let them say.
        if (!(err instanceof ConflictException)) throw err
      }
    }
    const created = await this.electedOfficeService.create(createArgs)
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
    // The text reminder is the holder's own consent to be texted, so only
    // their session may give or withdraw it.
    if (req.m2mToken && body.briefingTextReminder !== undefined) {
      throw new ForbiddenException(
        'briefingTextReminder cannot be set via M2M; it is set by the authenticated onboarding flow',
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
    const completesWin =
      body.onboardingCompletedAt != null && existing.campaignId !== null
    // A winner finishing onboarding gives the day of their first meeting as
    // the term's start and nothing else. The seat's term length turns that
    // into an end date; with no length on file the term stays open and the
    // dashboard asks for the end later.
    const termFromStart =
      completesWin &&
      !!effectiveTermStart &&
      !(body.termEndDate ?? existing.termEndDate)
    const derivedTermEnd =
      termFromStart && effectiveTermStart
        ? await this.winTermEnd(existing.campaignId, effectiveTermStart)
        : null
    const termEndDate = derivedTermEnd ?? body.termEndDate
    const effectiveTermEnd =
      termEndDate !== undefined ? termEndDate : existing.termEndDate
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
    const siblings =
      effectiveTermStart || effectiveTermEnd
        ? await this.electedOfficeService.findMany({
            where: { userId: existing.userId, id: { not: id } },
          })
        : []
    const overlapsSibling = siblings.some((office) =>
      dateRangesOverlap(
        office.termStartDate,
        office.termEndDate,
        effectiveTermStart ?? null,
        effectiveTermEnd ?? null,
      ),
    )
    // A term worked out from a first meeting date that collides with an
    // office they already hold (a re-elected incumbent's current term) must
    // not cost a winner the finish: the term stays as stored and the
    // dashboard asks for it.
    if (overlapsSibling && !termFromStart) {
      throw new ConflictException(
        'Elected office term overlaps an existing elected office for this user',
      )
    }

    // Completing serve onboarding is the pledge: it makes the office live and
    // fires its paid dispatches. A prepared office's campaign has no result
    // yet, so onboarding into it would hand a candidate who may have lost a
    // live office. Serve onboarding sends its holder to report the result
    // instead; this refuses the write if the pledge reaches one anyway.
    if (body.onboardingCompletedAt != null && isPreparedOffice(existing)) {
      throw new ConflictException(
        'This office is awaiting an election result and cannot be onboarded yet',
      )
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
    //
    // An office a win created is the exception: a new winner often does not
    // know their term yet, so it finishes with whatever term it has, reads as
    // held (deriveIsActive), and that same modal asks for the dates later.
    if (
      body.onboardingCompletedAt != null &&
      existing.campaignId === null &&
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
      termStartDate: overlapsSibling ? undefined : body.termStartDate,
      termEndDate: overlapsSibling ? undefined : termEndDate,
      party: body.party,
      pledgedAt: body.pledgedAt,
      onboardingCompletedAt: body.onboardingCompletedAt,
      selfReported: body.selfReported,
      onboardingStep: body.onboardingStep,
      briefingTextReminderAt: briefingTextReminderAt(
        body.briefingTextReminder,
        existing.briefingTextReminderAt,
      ),
    }
    const updated = await this.electedOfficeService.update({
      where: { id },
      data,
    })
    return this.toApi(updated)
  }

  // The end of a term that starts on `termStartDate`, from the term length of
  // the race the office's campaign won. Null when no length is on file.
  private async winTermEnd(
    campaignId: number | null,
    termStartDate: Date,
  ): Promise<Date | null> {
    if (campaignId === null) return null
    const campaign = await this.electedOfficeService.client.campaign.findUnique(
      { where: { id: campaignId }, select: { details: true } },
    )
    const years = await this.winTerm.termYears(campaign?.details?.raceId)
    return years === null ? null : addYearsToDateOnly(termStartDate, years)
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
    await this.crmOfficeHolder.syncElectedOffice(id)

    return { electedOfficeId: id, overrideDistrictId }
  }
}

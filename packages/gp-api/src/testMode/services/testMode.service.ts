import { CampaignsService } from '@/campaigns/services/campaigns.service'
import { ComplianceStateService } from '@/campaigns/tcrCompliance/services/complianceState.service'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import {
  DEFAULT_CUSTOM_POSITION_NAME,
  StateTransitionsService,
} from '@/testFixtures/services/stateTransitions.service'
import {
  ApplyTestModeRequest,
  ComplianceStage,
  CreateTestOrganizationRequest,
  PeerlyCvVerificationStatus,
  TEST_MODE_ELECTION_PRESET_VALUES,
  TEST_MODE_ONBOARDING_PRESET_VALUES,
  TEST_MODE_PRO_PRESET_VALUES,
  TEST_MODE_TEN_DLC_PRESET_VALUES,
  TEST_MODE_TERM_PRESET_VALUES,
  TestModeActiveOrganization,
  TestModeElectionPreset,
  TestModeOnboardingPreset,
  TestModeOrganizationType,
  TestModeState,
  TestModeTenDlcPreset,
  TestModeTermPreset,
} from '@goodparty_org/contracts'
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  addDays,
  addYears,
  differenceInCalendarDays,
  format,
  isBefore,
  parseISO,
  startOfDay,
  subDays,
  subMonths,
  subYears,
} from 'date-fns'
import { PinoLogger } from 'nestjs-pino'
import { v7 as uuidv7 } from 'uuid'
import {
  Campaign,
  DomainStatus,
  ElectedOffice,
  OfficeLevel,
  Organization,
  OutreachStatus,
  Prisma,
  TcrComplianceStatus,
  User,
} from '../../generated/prisma'

export const TEST_ORGANIZATION_CAP = 15
const TEST_MODE_PLACEHOLDER = 'test-mode'
const TEST_MODE_FILING_HOLD_REASON = 'Test mode filing hold'
const DATE_FORMAT = 'yyyy-MM-dd'
const ENDING_SOON_WINDOW_DAYS = 90
const IN_ONE_WEEK_WINDOW_DAYS = 14

const IN_FLIGHT_OUTREACH_STATUSES = [
  OutreachStatus.pending,
  OutreachStatus.approved,
  OutreachStatus.paid,
  OutreachStatus.in_progress,
  OutreachStatus.pending_payment,
]
const LIVE_DOMAIN_STATUSES = [
  DomainStatus.submitted,
  DomainStatus.registered,
  DomainStatus.active,
]

type TestOrganization = Organization & {
  campaign: Campaign | null
  electedOffice: ElectedOffice | null
}

const termDates = (
  preset: TestModeTermPreset,
  today: Date,
): { termStartDate: Date; termEndDate: Date } => {
  switch (preset) {
    case 'active':
      return {
        termStartDate: subMonths(today, 6),
        termEndDate: addYears(today, 4),
      }
    case 'ending_soon':
      return {
        termStartDate: subMonths(subYears(today, 3), 10),
        termEndDate: addDays(today, 60),
      }
    case 'ended':
      return {
        termStartDate: subYears(today, 4),
        termEndDate: subDays(today, 1),
      }
  }
}

export const testModeSentinelIdentityId = (campaignId: number) =>
  `test-mode-${campaignId}`

@Injectable()
export class TestModeService {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly organizations: OrganizationsService,
    private readonly complianceState: ComplianceStateService,
    private readonly transitions: StateTransitionsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(TestModeService.name)
  }

  async getState(user: User, activeSlug?: string): Promise<TestModeState> {
    const orgs = await this.organizations.model.findMany({
      where: { ownerId: user.id, testModeCreatedAt: { not: null } },
      include: { campaign: true, electedOffice: true },
      orderBy: [{ createdAt: 'asc' }, { slug: 'asc' }],
    })
    const active = activeSlug
      ? (orgs.find((org) => org.slug === activeSlug) ?? null)
      : null
    return {
      organizations: orgs.map((org) => ({
        slug: org.slug,
        name: this.describe(org),
        type: this.typeOf(org),
        createdAt: org.createdAt.toISOString(),
      })),
      active: active ? await this.activeState(active) : null,
    }
  }

  async createOrganization(
    user: User,
    body: CreateTestOrganizationRequest,
  ): Promise<TestModeState> {
    await this.assertUnderCap(user)

    const slug =
      body.type === 'campaign'
        ? await this.createCampaignOrganization(user, body)
        : await this.createElectedOfficeOrganization(user, body)

    this.logger.info(
      { userId: user.id, email: user.email, orgSlug: slug, action: 'create' },
      'Test mode organization created',
    )
    return this.getState(user, slug)
  }

  async apply(
    user: User,
    organization: Organization,
    body: ApplyTestModeRequest,
  ): Promise<TestModeState> {
    const org = await this.loadTestOrganization(user, organization.slug)
    const campaign = org.campaign
    const office = org.electedOffice

    switch (body.family) {
      case 'onboarding':
        if (campaign) {
          await this.applyCampaignOnboarding(campaign, body.preset)
        } else if (office) {
          await this.applyOfficeOnboarding(office, body.preset)
        }
        break
      case 'pro':
        await this.applyPro(this.requireCampaign(org), body.preset === 'on')
        break
      case 'election':
        await this.applyElection(user, this.requireCampaign(org), body.preset)
        break
      case 'term':
        await this.applyTerm(this.requireOffice(org), body.preset)
        break
      case 'tenDlc':
        await this.applyTenDlc(user, this.requireCampaign(org), body.preset)
        break
    }

    this.logger.info(
      {
        userId: user.id,
        email: user.email,
        orgSlug: org.slug,
        action: 'apply',
        family: body.family,
        preset: body.preset,
      },
      'Test mode preset applied',
    )
    return this.getState(user, org.slug)
  }

  async deleteOrganization(user: User, slug: string): Promise<TestModeState> {
    const org = await this.loadTestOrganization(user, slug)
    const campaign = org.campaign

    if (campaign) {
      if (campaign.details.subscriptionId) {
        throw new ConflictException(
          'This test campaign has a real subscription. Cancel it first.',
        )
      }
      const liveDomain = await this.organizations.client.domain.findFirst({
        where: {
          website: { campaignId: campaign.id },
          status: { in: LIVE_DOMAIN_STATUSES },
        },
      })
      if (liveDomain) {
        throw new ConflictException(
          'This test campaign has a registered domain. Release it first.',
        )
      }
    }

    // Serve outreach hangs off the org alone (campaignId null), so the
    // in-flight check keys on the slug for both org types.
    const inFlight = await this.organizations.client.outreach.findFirst({
      where: {
        status: { in: IN_FLIGHT_OUTREACH_STATUSES },
        OR: [
          { organizationSlug: org.slug },
          ...(campaign ? [{ campaignId: campaign.id }] : []),
        ],
      },
    })
    if (inFlight) {
      throw new ConflictException(
        'This test organization has outreach in flight. Wait for it to finish.',
      )
    }

    await this.organizations.client.$transaction(async (tx) => {
      if (campaign) {
        await tx.electedOffice.updateMany({
          where: { campaignId: campaign.id },
          data: { campaignId: null },
        })
      }
      await tx.organization.delete({ where: { slug: org.slug } })
    })

    this.logger.info(
      { userId: user.id, email: user.email, orgSlug: slug, action: 'delete' },
      'Test mode organization deleted',
    )
    return this.getState(user)
  }

  private async assertUnderCap(user: User) {
    const count = await this.organizations.model.count({
      where: { ownerId: user.id, testModeCreatedAt: { not: null } },
    })
    if (count >= TEST_ORGANIZATION_CAP) {
      throw new ConflictException(
        `You already have ${TEST_ORGANIZATION_CAP} test organizations. Delete one first.`,
      )
    }
  }

  private async loadTestOrganization(
    user: User,
    slug: string,
  ): Promise<TestOrganization> {
    const org = await this.organizations.model.findFirst({
      where: { slug, ownerId: user.id },
      include: { campaign: true, electedOffice: true },
    })
    if (!org) {
      throw new NotFoundException('Organization not found')
    }
    if (!org.testModeCreatedAt) {
      throw new ConflictException(
        'Test mode only changes test organizations it created',
      )
    }
    return org
  }

  private requireCampaign(org: TestOrganization): Campaign {
    if (!org.campaign) {
      throw new ConflictException(
        'This preset applies to a test campaign, not an elected office',
      )
    }
    return org.campaign
  }

  private requireOffice(org: TestOrganization): ElectedOffice {
    if (!org.electedOffice) {
      throw new ConflictException(
        'This preset applies to a test elected office, not a campaign',
      )
    }
    return org.electedOffice
  }

  private typeOf(org: TestOrganization): TestModeOrganizationType {
    return org.electedOffice ? 'elected_office' : 'campaign'
  }

  private describe(org: TestOrganization): string {
    if (org.electedOffice) {
      return org.customPositionName ?? 'Elected office'
    }
    const electionYear = org.campaign?.details.electionDate?.split('-').at(0)
    return [electionYear, 'Campaign'].filter(Boolean).join(' ')
  }

  private async activeState(
    org: TestOrganization,
  ): Promise<TestModeActiveOrganization> {
    const today = startOfDay(new Date())
    if (org.electedOffice) {
      const office = org.electedOffice
      return {
        slug: org.slug,
        type: 'elected_office',
        families: {
          onboarding: {
            current: office.onboardingCompletedAt ? 'complete' : 'not_started',
            available: [...TEST_MODE_ONBOARDING_PRESET_VALUES],
          },
          term: {
            current: this.currentTerm(office, today),
            available: [...TEST_MODE_TERM_PRESET_VALUES],
          },
        },
      }
    }

    const campaign = org.campaign
    return {
      slug: org.slug,
      type: 'campaign',
      families: {
        onboarding: {
          current: campaign?.isActive ? 'complete' : 'not_started',
          available: [...TEST_MODE_ONBOARDING_PRESET_VALUES],
        },
        pro: {
          current: campaign?.isPro ? 'on' : 'off',
          available: [...TEST_MODE_PRO_PRESET_VALUES],
        },
        election: {
          current: campaign ? this.currentElection(campaign, today) : null,
          available: [...TEST_MODE_ELECTION_PRESET_VALUES],
        },
        tenDlc: {
          current: campaign ? await this.currentTenDlc(campaign) : null,
          available: [...TEST_MODE_TEN_DLC_PRESET_VALUES],
        },
      },
    }
  }

  private currentTerm(
    office: ElectedOffice,
    today: Date,
  ): TestModeTermPreset | null {
    if (!office.termEndDate) {
      return null
    }
    if (isBefore(office.termEndDate, today)) {
      return 'ended'
    }
    return differenceInCalendarDays(office.termEndDate, today) <=
      ENDING_SOON_WINDOW_DAYS
      ? 'ending_soon'
      : 'active'
  }

  private currentElection(
    campaign: Campaign,
    today: Date,
  ): TestModeElectionPreset | null {
    const { wonGeneral, electionDate } = campaign.details
    if (wonGeneral === true) {
      return 'passed_won'
    }
    if (wonGeneral === false) {
      return 'passed_lost'
    }
    if (!electionDate) {
      return null
    }
    const daysUntil = differenceInCalendarDays(parseISO(electionDate), today)
    if (daysUntil < 0) {
      return 'passed_unanswered'
    }
    return daysUntil <= IN_ONE_WEEK_WINDOW_DAYS ? 'in_1_week' : 'in_8_weeks'
  }

  private async currentTenDlc(
    campaign: Campaign,
  ): Promise<TestModeTenDlcPreset> {
    const stage = await this.complianceState.getStageForCampaign(campaign.id)
    switch (stage) {
      case ComplianceStage.needs_profile:
      case ComplianceStage.needs_filing:
        return 'none'
      case ComplianceStage.pending_domain_purchase:
      case ComplianceStage.pending_website_live:
      case ComplianceStage.ready_to_submit:
        return 'in_progress'
      case ComplianceStage.filing_review_hold:
        return 'filing_hold'
      case ComplianceStage.awaiting_pin:
        return 'awaiting_pin'
      case ComplianceStage.tcr_in_review:
        return 'in_review'
      case ComplianceStage.tcr_approved:
        return 'approved'
      case ComplianceStage.tcr_rejected: {
        const row = await this.organizations.client.tcrCompliance.findUnique({
          where: { campaignId: campaign.id },
          select: { status: true },
        })
        return row?.status === TcrComplianceStatus.error ? 'error' : 'rejected'
      }
    }
  }

  private async createCampaignOrganization(
    user: User,
    body: Extract<CreateTestOrganizationRequest, { type: 'campaign' }>,
  ): Promise<string> {
    const created = await this.transitions.createLaunchedCampaign(
      user,
      body.race,
      { testMode: true, launch: body.onboarding === 'complete' },
    )
    if (body.onboarding === 'not_started') {
      await this.applyCampaignOnboarding(created, 'not_started')
    }
    if (body.pro === 'on') {
      await this.applyPro(created, true)
    }
    await this.applyElection(user, created, body.election)
    await this.applyTenDlc(user, created, body.tenDlc)
    return created.organizationSlug
  }

  private async createElectedOfficeOrganization(
    user: User,
    body: Extract<CreateTestOrganizationRequest, { type: 'elected_office' }>,
  ): Promise<string> {
    const now = new Date()
    const onboarded = body.onboarding === 'complete'
    const term = onboarded ? termDates(body.term, startOfDay(now)) : null
    return this.insertElectedOfficeOrganization(user, {
      customPositionName: DEFAULT_CUSTOM_POSITION_NAME,
      termStartDate: term?.termStartDate ?? null,
      termEndDate: term?.termEndDate ?? null,
      onboardingCompletedAt: onboarded ? now : null,
      pledgedAt: onboarded ? now : null,
      selfReported: true,
      campaignId: null,
    })
  }

  private async insertElectedOfficeOrganization(
    user: User,
    args: {
      positionId?: string | null
      customPositionName: string | null
      overrideDistrictId?: string | null
      termStartDate: Date | null
      termEndDate: Date | null
      onboardingCompletedAt: Date | null
      pledgedAt: Date | null
      selfReported: boolean
      campaignId: number | null
    },
  ): Promise<string> {
    const id = uuidv7()
    const slug = OrganizationsService.electedOfficeOrgSlug(id)
    // Direct inserts on purpose: ElectedOfficeService.create dispatches real
    // agent runs and refuses on term overlap with the owner's real office.
    await this.organizations.client.$transaction(async (tx) => {
      await tx.organization.create({
        data: {
          slug,
          ownerId: user.id,
          positionId: args.positionId ?? null,
          customPositionName: args.customPositionName,
          overrideDistrictId: args.overrideDistrictId ?? null,
          testModeCreatedAt: new Date(),
        },
      })
      await tx.electedOffice.create({
        data: {
          id,
          organizationSlug: slug,
          userId: user.id,
          termStartDate: args.termStartDate,
          termEndDate: args.termEndDate,
          onboardingCompletedAt: args.onboardingCompletedAt,
          pledgedAt: args.pledgedAt,
          selfReported: args.selfReported,
          campaignId: args.campaignId,
        },
      })
    })
    return slug
  }

  private async applyCampaignOnboarding(
    campaign: Campaign,
    preset: TestModeOnboardingPreset,
  ) {
    if (preset === 'not_started') {
      await this.rewriteCampaignJson(campaign.id, ({ details, data }) => {
        delete details.party
        delete details.otherParty
        delete details.pledged
        delete data.launchStatus
        delete data.currentStep
        return { details, data, scalars: { isActive: false } }
      })
      await this.organizations.model.update({
        where: { slug: campaign.organizationSlug },
        data: { positionId: null, customPositionName: null },
      })
      return
    }

    const org = await this.organizations.model.findUniqueOrThrow({
      where: { slug: campaign.organizationSlug },
    })
    if (!org.positionId && !org.customPositionName) {
      await this.organizations.model.update({
        where: { slug: org.slug },
        data: { customPositionName: DEFAULT_CUSTOM_POSITION_NAME },
      })
    }
    await this.campaigns.updateJsonFields(
      campaign.id,
      { details: { otherParty: 'Independent', pledged: true } },
      false,
    )
    const current = await this.campaigns.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    await this.campaigns.launch(current, { trackCampaign: false })
  }

  private async applyOfficeOnboarding(
    office: ElectedOffice,
    preset: TestModeOnboardingPreset,
  ) {
    const now = new Date()
    const hasTerm = Boolean(office.termStartDate && office.termEndDate)
    const term = hasTerm ? null : termDates('active', startOfDay(now))
    await this.organizations.client.electedOffice.update({
      where: { id: office.id },
      data:
        preset === 'not_started'
          ? {
              onboardingCompletedAt: null,
              onboardingStep: null,
              termStartDate: null,
              termEndDate: null,
              pledgedAt: null,
            }
          : {
              ...(term ?? {}),
              onboardingCompletedAt: now,
              pledgedAt: now,
              selfReported: true,
            },
    })
  }

  private async applyPro(campaign: Campaign, isPro: boolean) {
    if (!isPro && campaign.details.subscriptionId) {
      throw new ConflictException(
        'This test campaign has a real subscription. Cancel it first.',
      )
    }
    // Never setIsPro: it announces the upgrade in Slack.
    await this.campaigns.model.update({
      where: { id: campaign.id },
      data: { isPro },
    })
  }

  private async applyElection(
    user: User,
    campaign: Campaign,
    preset: TestModeElectionPreset,
  ) {
    const today = startOfDay(new Date())
    switch (preset) {
      case 'in_8_weeks':
      case 'in_1_week': {
        const electionDate = format(
          addDays(today, preset === 'in_8_weeks' ? 56 : 7),
          DATE_FORMAT,
        )
        await this.rewriteCampaignJson(campaign.id, ({ details, data }) => {
          delete details.wonGeneral
          delete details.primaryElectionDate
          return {
            details: { ...details, electionDate },
            data,
            scalars: { didWin: null, primaryResult: null },
          }
        })
        return
      }
      case 'passed_unanswered':
      case 'passed_lost': {
        const electionDate = format(subDays(today, 14), DATE_FORMAT)
        await this.rewriteCampaignJson(campaign.id, ({ details, data }) => {
          delete details.wonGeneral
          return {
            details: {
              ...details,
              electionDate,
              ...(preset === 'passed_lost' ? { wonGeneral: false } : {}),
            },
            data,
            scalars: { didWin: null },
          }
        })
        return
      }
      case 'passed_won':
        await this.linkWonRace(user, campaign, today)
        return
    }
  }

  // Mirrors the election-result flow: the office is created first, then the
  // win markers land with a past election date. `didWin` stays null, as it
  // does when a candidate reports the result themselves.
  private async linkWonRace(user: User, campaign: Campaign, today: Date) {
    const linked = await this.organizations.client.electedOffice.findFirst({
      where: { campaignId: campaign.id },
    })
    if (!linked) {
      await this.assertUnderCap(user)
      const org = await this.organizations.model.findUniqueOrThrow({
        where: { slug: campaign.organizationSlug },
      })
      await this.insertElectedOfficeOrganization(user, {
        positionId: org.positionId,
        customPositionName: org.customPositionName,
        overrideDistrictId: org.overrideDistrictId,
        termStartDate: today,
        termEndDate: addYears(today, 4),
        onboardingCompletedAt: new Date(),
        pledgedAt: new Date(),
        selfReported: false,
        campaignId: campaign.id,
      })
    }
    const electionDate = format(subDays(today, 30), DATE_FORMAT)
    await this.rewriteCampaignJson(campaign.id, ({ details, data }) => ({
      details: { ...details, electionDate, wonGeneral: true },
      data,
    }))
  }

  private async applyTerm(office: ElectedOffice, preset: TestModeTermPreset) {
    await this.organizations.client.electedOffice.update({
      where: { id: office.id },
      data: termDates(preset, startOfDay(new Date())),
    })
  }

  private async applyTenDlc(
    user: User,
    campaign: Campaign,
    preset: TestModeTenDlcPreset,
  ) {
    const model = this.organizations.client.tcrCompliance
    const existing = await model.findUnique({
      where: { campaignId: campaign.id },
    })
    if (existing && !existing.internalTestingAt) {
      throw new ConflictException(
        'This test campaign has a real 10DLC registration. Test mode will not overwrite it.',
      )
    }
    if (preset === 'none') {
      if (existing) {
        await model.delete({ where: { id: existing.id } })
      }
      return
    }

    const now = new Date()
    const sentinel = testModeSentinelIdentityId(campaign.id)
    const presetFields: Pick<
      Prisma.TcrComplianceUncheckedCreateInput,
      | 'status'
      | 'peerlyIdentityId'
      | 'peerlyCvStatus'
      | 'cvValidationFailedAt'
      | 'cvValidationFailureReasons'
      | 'kickoffSentAt'
      | 'internalTestingApprovedAt'
    > = {
      status: TcrComplianceStatus.submitted,
      peerlyIdentityId: null,
      peerlyCvStatus: null,
      cvValidationFailedAt: null,
      cvValidationFailureReasons: [],
      kickoffSentAt: null,
      internalTestingApprovedAt: null,
      ...(preset === 'in_progress' ? { kickoffSentAt: now } : {}),
      ...(preset === 'filing_hold'
        ? {
            cvValidationFailedAt: now,
            cvValidationFailureReasons: [TEST_MODE_FILING_HOLD_REASON],
          }
        : {}),
      ...(preset === 'awaiting_pin'
        ? {
            peerlyIdentityId: sentinel,
            peerlyCvStatus: PeerlyCvVerificationStatus.APPROVED,
          }
        : {}),
      ...(preset === 'in_review'
        ? {
            status: TcrComplianceStatus.pending,
            peerlyIdentityId: sentinel,
            peerlyCvStatus: PeerlyCvVerificationStatus.VERIFIED,
          }
        : {}),
      ...(preset === 'approved'
        ? {
            status: TcrComplianceStatus.approved,
            internalTestingApprovedAt: now,
          }
        : {}),
      ...(preset === 'rejected'
        ? { status: TcrComplianceStatus.rejected }
        : {}),
      ...(preset === 'error' ? { status: TcrComplianceStatus.error } : {}),
    }
    const placeholders = {
      ein: TEST_MODE_PLACEHOLDER,
      postalAddress: TEST_MODE_PLACEHOLDER,
      committeeName: TEST_MODE_PLACEHOLDER,
      websiteDomain: TEST_MODE_PLACEHOLDER,
      filingUrl: TEST_MODE_PLACEHOLDER,
      phone: TEST_MODE_PLACEHOLDER,
      email: user.email,
      officeLevel: OfficeLevel.local,
      internalTestingAt: now,
    }
    await model.upsert({
      where: { campaignId: campaign.id },
      create: { campaignId: campaign.id, ...placeholders, ...presetFields },
      update: { ...placeholders, ...presetFields },
    })
  }

  // updateJsonFields deep-merges and cannot delete keys, so the presets that
  // drop `wonGeneral` or the onboarding markers rebuild the columns under the
  // same row lock it takes (see campaigns/AGENTS.md on JSON columns).
  private async rewriteCampaignJson(
    campaignId: number,
    rewrite: (row: {
      details: PrismaJson.CampaignDetails
      data: PrismaJson.CampaignData
    }) => {
      details: PrismaJson.CampaignDetails
      data: PrismaJson.CampaignData
      scalars?: Pick<
        Prisma.CampaignUncheckedUpdateInput,
        'isActive' | 'didWin' | 'primaryResult'
      >
    },
  ) {
    await this.campaigns.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM campaign WHERE id = ${campaignId} FOR UPDATE`
      const row = await tx.campaign.findUniqueOrThrow({
        where: { id: campaignId },
        select: { details: true, data: true },
      })
      const next = rewrite({
        details: { ...row.details },
        data: { ...row.data },
      })
      await tx.campaign.update({
        where: { id: campaignId },
        data: { details: next.details, data: next.data, ...next.scalars },
      })
    })
  }
}

import { CvStatusPollService } from '@/campaigns/tcrCompliance/services/cvStatusPoll.service'
import { CampaignTcrComplianceService } from '@/campaigns/tcrCompliance/services/campaignTcrCompliance.service'
import { CampaignsService } from '@/campaigns/services/campaigns.service'
import { CreateAgenticTcrComplianceDto } from '@/campaigns/tcrCompliance/schemas/createAgenticTcrComplianceDto.schema'
import { ComplianceStateService } from '@/campaigns/tcrCompliance/services/complianceState.service'
import { ElectionsService } from '@/elections/services/elections.service'
import { OutreachCompletionService } from '@/outreach/services/outreachCompletion.service'
import { OutreachResultsAdminService } from '@/outreach/services/outreachResultsAdmin.service'
import { OutreachRobocallCallhubCleanupService } from '@/outreach/services/outreachRobocallCallhubCleanup.service'
import { OutreachRobocallCaptureService } from '@/outreach/services/outreachRobocallCapture.service'
import { OutreachRobocallCompletionService } from '@/outreach/services/outreachRobocallCompletion.service'
import { OutreachRobocallSendService } from '@/outreach/services/outreachRobocallSend.service'
import { OutreachRobocallStagingService } from '@/outreach/services/outreachRobocallStaging.service'
import { OutreachSmsAdminService } from '@/outreach/services/outreachSmsAdmin.service'
import { PaymentEventsService } from '@/payments/services/paymentEventsService'
import { OutreachEmailLifecycleService } from '@/emailOutreach/services/outreachEmailLifecycle.service'
import { OutreachEmailSendSweepService } from '@/emailOutreach/services/outreachEmailSendSweep.service'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { UsersService } from '@/users/services/users.service'
import { VENDOR_MODE } from '@/shared/util/appEnvironment.util'
import { PinoLogger } from 'nestjs-pino'
import { DomainsService } from '@/websites/services/domains.service'
import { WebsitesService } from '@/websites/services/websites.service'
import { isTestUser, newFixtureUserEmail } from '@/users/util/users.util'
import { CLERK_CLIENT_PROVIDER_TOKEN } from '@/vendors/clerk/providers/clerk-client.provider'
import { clerkThrottle } from '@/vendors/clerk/util/clerkThrottle.util'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import { VendorMockRecordService } from '@/vendorMocks/vendorMockRecord.service'
import { EMAIL_AUDIENCE_FIXTURE_KIND } from '@/peopleDb/services/peopleEmailFixture.service'
import { ClerkClient } from '@clerk/backend'
import {
  type ApplyTestFixtureElectionResponse,
  ComplianceStage,
  type TestModeElectionPreset,
  type TestFixtureStateResponse,
  type AdminOutreachActionResponse,
  type DeliverStripeEventResponse,
  type MockAction,
  type MockActionResponse,
  type MockRecordsResponse,
  type RunJobResponse,
  type TimeTravel,
  type EmailAudienceFixtureRequest,
  type EmailAudienceFixtureResponse,
  type TimeTravelResponse,
  DeleteTestFixtureUsersResponse,
  PeerlyCvVerificationStatus,
  TestFixtureSessionResponse,
  TestFixtureUserResponse,
} from '@goodparty_org/contracts'
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import { randomUUID } from 'crypto'
import {
  addDays,
  addSeconds,
  differenceInDays,
  differenceInMilliseconds,
  format,
  formatISO,
  subDays,
  subHours,
  subMinutes,
} from 'date-fns'
import Stripe from 'stripe'
import {
  Campaign,
  DomainSource,
  OutreachType,
  TcrComplianceStatus,
  User,
  VendorMockVendor,
  WebsiteStatus,
} from '@/generated/prisma'
import {
  CreateTestFixtureUserInput,
  DeleteTestFixtureUsersInput,
  MintTestFixtureSessionInput,
} from '../schemas/testFixtures.schema'

import { ActivitySeedService } from './activitySeed.service'
import {
  DEFAULT_RACE,
  StateTransitionsService,
} from './stateTransitions.service'

const FIXTURE_TOKEN_TTL_SECONDS = 60 * 60

// Default Campaign Verify PIN of the Peerly 10DLC mock.
const MOCK_CV_PIN = '123456'
// Texting closes 19 days before the election; keep the fixture well clear.
const MIN_DAYS_TO_ELECTION = 60
const FIXTURE_ELECTION_DAYS_OUT = 90
const FIXTURE_DOMAIN_MAX_PRICE = 50
// How often the purchase's in-flight Vercel order is completed, so the order
// is done by (or right after) the purchase's first poll instead of 30s later.
const VERCEL_ORDER_COMPLETE_INTERVAL_MS = 25

const FIXTURE_BIO =
  'I am running for City Council because our neighborhood deserves a ' +
  'representative who shows up, listens, and follows through. For years ' +
  'I have organized with neighbors on the issues that touch daily life: ' +
  'safe streets, reliable services, affordable housing, and an open, ' +
  'accountable local government. I will bring that same energy to the ' +
  'council, fighting for transparent budgets, smart infrastructure ' +
  'investment, and a city that works for working families rather than ' +
  'the well-connected few. Together we can build a community we are all ' +
  'proud to call home, today and for the generations that follow us.'
const FIXTURE_ISSUE = {
  title: 'Safe and affordable housing',
  description:
    'Expand affordable housing by streamlining permits, protecting renters ' +
    'from unfair increases, and partnering with builders on starter homes.',
}
const FIXTURE_FILING_URL = 'https://sos.wyo.gov/filing/jane-for-council'
const FIXTURE_EIN = '47-1234567'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type ProvisionedUser = { user: User; clerkUserId: string; password: string }
type MintedSession = { jwt: string; signInToken: string; expiresAt: string }

@Injectable()
export class TestFixturesService {
  constructor(
    private readonly users: UsersService,
    private readonly campaigns: CampaignsService,
    private readonly transitions: StateTransitionsService,
    private readonly organizations: OrganizationsService,
    private readonly activitySeed: ActivitySeedService,
    private readonly elections: ElectionsService,
    private readonly vendorMockRecord: VendorMockRecordService,
    private readonly cvStatusPoll: CvStatusPollService,
    private readonly tcrCompliance: CampaignTcrComplianceService,
    private readonly complianceState: ComplianceStateService,
    private readonly domains: DomainsService,
    private readonly websites: WebsitesService,
    private readonly robocallStaging: OutreachRobocallStagingService,
    private readonly robocallSend: OutreachRobocallSendService,
    private readonly robocallCompletion: OutreachRobocallCompletionService,
    private readonly robocallCapture: OutreachRobocallCaptureService,
    private readonly robocallCallhubCleanup: OutreachRobocallCallhubCleanupService,
    private readonly outreachCompletion: OutreachCompletionService,
    private readonly smsAdmin: OutreachSmsAdminService,
    private readonly resultsAdmin: OutreachResultsAdminService,
    private readonly stripeService: StripeService,
    private readonly moduleRef: ModuleRef,
    @Inject(CLERK_CLIENT_PROVIDER_TOKEN)
    private readonly clerkClient: ClerkClient,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(TestFixturesService.name)
  }

  async createFixtureUser(
    input: CreateTestFixtureUserInput,
  ): Promise<TestFixtureUserResponse> {
    if (input.state === 'pro-win-10dlc-mock') this.assertMockVendorMode()
    const { user, clerkUserId, password } = await this.provisionUser(input)

    let campaignId: number | undefined
    let electedOfficeId: string | undefined
    let campaignOrgSlug: string | undefined
    let orgSlug: string

    if (input.state === 'serve') {
      const office = await this.transitions.createElectedOffice(
        user,
        input.activity && !input.serve?.positionId
          ? { ...input.serve, positionId: await this.seedablePositionId(input) }
          : input.serve,
      )
      electedOfficeId = office.id
      orgSlug = OrganizationsService.electedOfficeOrgSlug(office.id)
    } else {
      const campaign = await this.transitions.createLaunchedCampaign(
        user,
        input.race,
      )
      campaignId = campaign.id
      orgSlug = OrganizationsService.campaignOrgSlug(campaign.id)

      if (input.state === 'pro-win') {
        await this.campaigns.setIsPro(campaign.id, true, false)
      } else if (input.state === 'pro-win-10dlc-mock') {
        await this.setupProWin10DlcMock(user.id)
      } else if (input.state === 'serve-won-race') {
        const office = await this.transitions.promoteWonRace(user, campaign)
        electedOfficeId = office.id
        campaignOrgSlug = orgSlug
        orgSlug = OrganizationsService.electedOfficeOrgSlug(office.id)
      }
    }

    if (input.activity) {
      await this.activitySeed.seed(orgSlug, {
        answers: input.answers,
        split: input.split,
      })
    }

    const session = await this.mintSession(clerkUserId)

    return {
      state: input.state,
      userId: user.id,
      clerkUserId,
      email: user.email,
      password,
      campaignId,
      electedOfficeId,
      orgSlug,
      campaignOrgSlug,
      sessionToken: session.jwt,
      signInToken: session.signInToken,
      cookies: this.buildCookies(user, session.jwt, orgSlug),
      expiresAt: session.expiresAt,
    }
  }

  // Drives a Pro Win user's real 10DLC registration to `tcr_approved` against
  // the vendor mocks, server-side and through the same services the agent's
  // routes call, in the agent's order: filing, domain search and purchase,
  // publish, verify-live, submit to Peerly, CV approval, PIN, usecase
  // activation, activation check. Mirrors ten-dlc-registration.spec.ts.
  //
  // internalTestingAt is never set: the P2P send gate (requirePeerlyIdentityId)
  // blocks internal-testing rows by design, and this user must pass it.
  async setupProWin10DlcMock(
    userId: number,
  ): Promise<TestFixtureStateResponse> {
    // Live mode would submit real Campaign Verify requests and buy a real
    // domain, so refuse before touching anything.
    this.assertMockVendorMode()

    const user = await this.users.findUser({ id: userId })
    if (!user) throw new NotFoundException()
    let campaign = await this.campaigns.findFirst({ where: { userId } })
    if (!campaign) throw new NotFoundException('No campaign for this user')

    const existing = await this.tcrCompliance.fetchByCampaignId(campaign.id)
    if (existing) {
      if (
        existing.status === TcrComplianceStatus.approved &&
        existing.peerlyIdentityId &&
        !existing.internalTestingAt
      ) {
        return this.buildDlcStateResponse(user.id, campaign.id, existing)
      }
      throw new ConflictException(
        'User already has a TCR compliance record; the fixture needs a fresh user',
      )
    }

    // 1. Filing. The campaign still reads non-Pro here: createAgentic queues a
    // real compliance_setup agent run for a Pro campaign with a fresh record,
    // and this fixture plays that agent itself. Payment comes after, as in the
    // wizard.
    campaign = await this.ensureTextingWindowOpen(campaign)
    const filing = CreateAgenticTcrComplianceDto.schema.parse({
      ein: FIXTURE_EIN,
      candidateName: `${user.firstName ?? 'QA'} ${user.lastName ?? 'Fixture'}`,
      committeeName: 'Jane for Council',
      filingUrl: FIXTURE_FILING_URL,
      email: user.email,
      phone: '(307) 555-1234',
      officeLevel: 'local',
      manualAddress: {
        addressLine1: '1700 Pennsylvania Ave NW',
        city: 'Cheyenne',
        state: 'WY',
        zip: '82001',
      },
    })
    await this.tcrCompliance.createAgentic(
      user,
      { ...campaign, isPro: false },
      filing,
    )
    const { campaign: proCampaign } = await this.campaigns.setIsPro(
      campaign.id,
      true,
      false,
    )
    campaign = proCampaign

    // 2. Website the agent would have prepared: genuine bio and issue.
    await this.ensurePublishableWebsite(user, campaign.id)

    // 3. Domain search and purchase. The purchase holds the request open until
    // the Vercel mock completes the order (30s after it is placed), so complete
    // the order as soon as it exists.
    const campaignWithUser = { ...campaign, user }
    const { candidates } = await this.domains.searchDomainsForCampaign(
      campaignWithUser,
      [`janeforcouncil${randomUUID().slice(0, 8)}`],
      FIXTURE_DOMAIN_MAX_PRICE,
    )
    const [candidate] = candidates
    if (!candidate) {
      throw new BadGatewayException('Domain search returned no candidates')
    }
    await this.purchaseWithImmediateVercelOrder(
      campaignWithUser,
      candidate.domain,
    )

    // 4. Publish and verify the site is live.
    await this.websites.update({
      where: { campaignId: campaign.id },
      data: { status: WebsiteStatus.published, hasEverBeenPublished: true },
    })
    const live = await this.websites.verifyLive(campaign.id)
    if (!live.verified) {
      throw new BadGatewayException(
        `Mock website did not verify live: ${live.reason}`,
      )
    }

    // 5. Submit to Peerly. The pre-submission gate fetches the filing URL live
    // and asks an LLM, which a fixture candidate can't pass; stamp the same
    // override staff's "override CV validation" step does.
    await this.tcrCompliance.overrideCvValidation(campaign.id)
    await this.tcrCompliance.submitToPeerlyForAgent(user, campaign)
    await this.expectStage(campaign.id, ComplianceStage.awaiting_pin)

    // 6. Campaign Verify approves, the candidate enters the PIN (the
    // submit-cv-pin route's steps), then the usecase goes active and the
    // activation check approves the registration.
    await this.applyMockAction({
      campaignId: campaign.id,
      action: 'peerly.cv.approve',
    })
    const submitted = await this.requireTcrRecord(campaign.id)
    const token = await this.tcrCompliance.retrieveCampaignVerifyToken(
      MOCK_CV_PIN,
      submitted,
    )
    if (!token) {
      throw new BadGatewayException(
        'Campaign verify token could not be retrieved',
      )
    }
    await this.tcrCompliance.submitCampaignVerifyToken(submitted, token)
    await this.tcrCompliance.model.update({
      where: { id: submitted.id },
      data: { status: TcrComplianceStatus.pending },
    })
    await this.applyMockAction({
      campaignId: campaign.id,
      action: 'peerly.usecase.activate',
    })
    await this.checkCampaignUsecaseActivation(campaign.id)

    // 7. It must now pass the send gate: approved, with a real identity.
    await this.expectStage(campaign.id, ComplianceStage.tcr_approved)
    const approved = await this.requireTcrRecord(campaign.id)
    if (
      approved.status !== TcrComplianceStatus.approved ||
      !approved.peerlyIdentityId ||
      approved.internalTestingAt
    ) {
      throw new BadGatewayException(
        `10DLC fixture ended in status ${approved.status} without an approved Peerly identity`,
      )
    }
    return this.buildDlcStateResponse(user.id, campaign.id, approved)
  }

  private assertMockVendorMode() {
    if (VENDOR_MODE !== 'mock') {
      throw new BadRequestException(
        'pro-win-10dlc-mock needs VENDOR_MODE=mock; it never runs against live vendors',
      )
    }
  }

  private buildDlcStateResponse(
    userId: number,
    campaignId: number,
    record: { peerlyIdentityId: string | null },
  ): TestFixtureStateResponse {
    if (!record.peerlyIdentityId) {
      throw new ConflictException('TCR compliance has no Peerly identity')
    }
    return {
      state: 'pro-win-10dlc-mock',
      userId,
      campaignId,
      stage: ComplianceStage.tcr_approved,
      peerlyIdentityId: record.peerlyIdentityId,
    }
  }

  private async requireTcrRecord(campaignId: number) {
    const record = await this.tcrCompliance.fetchByCampaignId(campaignId)
    if (!record) throw new NotFoundException('No TCR compliance record')
    return record
  }

  private async expectStage(campaignId: number, expected: ComplianceStage) {
    const stage = await this.complianceState.getStageForCampaign(campaignId)
    if (stage !== expected) {
      throw new BadGatewayException(
        `10DLC fixture expected compliance stage ${expected}, got ${stage}`,
      )
    }
  }

  // Submitting past the SMS cutoff is refused, so give a campaign with no
  // election date (or one close to it) a date well clear of the window.
  private async ensureTextingWindowOpen(campaign: Campaign): Promise<Campaign> {
    const electionDate = campaign.details?.electionDate
    const daysOut = electionDate
      ? differenceInDays(new Date(electionDate), new Date())
      : null
    if (daysOut !== null && daysOut >= MIN_DAYS_TO_ELECTION) return campaign
    const updated = await this.campaigns.updateJsonFields(
      campaign.id,
      {
        details: {
          electionDate: format(
            addDays(new Date(), FIXTURE_ELECTION_DAYS_OUT),
            'yyyy-MM-dd',
          ),
        },
      },
      false,
    )
    return updated ?? campaign
  }

  private async ensurePublishableWebsite(user: User, campaignId: number) {
    const campaign = await this.campaigns.findUniqueOrThrow({
      where: { id: campaignId },
      include: { campaignPositions: { include: { topIssue: true } } },
    })
    const website =
      (await this.websites.findUnique({ where: { campaignId } })) ??
      (await this.websites.createByCampaign(user, campaign))
    const content = website.content ?? {}
    await this.websites.update({
      where: { campaignId },
      data: {
        content: {
          ...content,
          about: {
            ...content.about,
            bio: FIXTURE_BIO,
            issues: [FIXTURE_ISSUE],
          },
          contact: { ...content.contact, email: user.email },
        },
      },
    })
  }

  // The purchase call returns once the Vercel mock reports the order
  // completed, which it only does 30s after the buy. A short loop completes the
  // campaign's pending orders until the purchase settles. A failed pass is
  // retried rather than ending the loop: an abandoned loop would leave the
  // purchase polling for an order nothing completes, and if the order never
  // completes the purchase's own timeout is the error that explains it.
  private async purchaseWithImmediateVercelOrder(
    campaign: Parameters<DomainsService['purchaseDomainForCampaign']>[0],
    domain: string,
  ) {
    let settled = false
    const completer = (async () => {
      while (!settled) {
        try {
          await this.vendorMockRecord.completeVercelOrders(campaign.id)
        } catch (err) {
          this.logger.warn(
            { err, campaignId: campaign.id },
            'Could not complete the mock Vercel order; retrying',
          )
        }
        await sleep(VERCEL_ORDER_COMPLETE_INTERVAL_MS)
      }
    })()
    try {
      await this.domains.purchaseDomainForCampaign(
        campaign,
        domain,
        FIXTURE_DOMAIN_MAX_PRICE,
        DomainSource.agentic,
      )
    } finally {
      settled = true
      await completer
    }
  }

  // The `tcr.complianceSweep` job body: the activation check for the
  // campaign's own pending record, never other users' rows.
  private async checkCampaignUsecaseActivation(campaignId: number) {
    const record = await this.tcrCompliance.model.findFirst({
      where: { campaignId, status: TcrComplianceStatus.pending },
    })
    if (!record) {
      throw new NotFoundException('No pending TCR compliance record')
    }
    await this.tcrCompliance.checkUsecaseActivation(record)
  }

  // Seeding samples voters from the org's district, and the default custom
  // position has none, so a seeded office sits on the default race's seat.
  private async seedablePositionId(
    input: CreateTestFixtureUserInput,
  ): Promise<string> {
    const race = await this.transitions.findRace(input.race)
    const position = await this.elections.getPositionByBallotReadyId(
      race.brPositionId,
    )
    if (!position) {
      throw new BadGatewayException(
        `No election-db position for race ${race.id}`,
      )
    }
    return position.id
  }

  // The caller's own campaign only; 404 rather than 403 so ids can't be
  // probed. `passed_won` never creates an office: it needs the one the
  // election-result flow already linked.
  async applyElectionPreset(
    userId: number,
    campaignId: number,
    preset: TestModeElectionPreset,
  ): Promise<ApplyTestFixtureElectionResponse> {
    const campaign = await this.campaigns.findFirst({
      where: { id: campaignId, userId },
    })
    if (!campaign) {
      throw new NotFoundException()
    }
    if (preset === 'passed_won') {
      const office = await this.campaigns.client.electedOffice.findFirst({
        where: { campaignId },
      })
      if (!office) {
        throw new ConflictException(
          'passed_won needs the elected office the election-result flow links',
        )
      }
    }
    const electionDate = await this.transitions.applyElectionPreset(
      campaignId,
      preset,
    )
    return { campaignId, preset, electionDate }
  }

  async deleteFixtureUsers(
    input: DeleteTestFixtureUsersInput,
  ): Promise<DeleteTestFixtureUsersResponse> {
    const users = await this.users.findMany({
      where: {
        OR: [
          ...(input.userIds?.length ? [{ id: { in: input.userIds } }] : []),
          ...(input.emails?.length ? [{ email: { in: input.emails } }] : []),
        ],
      },
    })

    const nonTest = users.filter((user) => !isTestUser({ email: user.email }))
    if (nonTest.length > 0) {
      throw new ForbiddenException('Test users only')
    }

    for (const user of users) {
      await this.users.deleteUser(user.id, user.id)
    }

    const foundIds = new Set(users.map((user) => user.id))
    const foundEmails = new Set(users.map((user) => user.email.toLowerCase()))
    return {
      deleted: users.map((user) => ({ userId: user.id, email: user.email })),
      notFound: [
        ...(input.userIds ?? []).filter((id) => !foundIds.has(id)),
        ...(input.emails ?? []).filter(
          (email) => !foundEmails.has(email.toLowerCase()),
        ),
      ],
    }
  }

  async mintFixtureSession(
    userId: number,
    input: MintTestFixtureSessionInput,
  ): Promise<TestFixtureSessionResponse> {
    const user = await this.users.findUser({ id: userId })
    if (!user) {
      throw new NotFoundException()
    }
    if (!isTestUser({ email: user.email })) {
      throw new ForbiddenException('Test users only')
    }
    if (!user.clerkId) {
      throw new ConflictException('Fixture user has no Clerk identity')
    }

    const orgs = await this.organizations.findMany({
      where: { ownerId: userId },
    })
    const orgSlug = input.orgSlug
      ? orgs.find((org) => org.slug === input.orgSlug)?.slug
      : (orgs.find((org) => org.slug.startsWith('eo-'))?.slug ?? orgs[0]?.slug)
    if (input.orgSlug && !orgSlug) {
      throw new BadRequestException('orgSlug is not owned by this user')
    }
    if (!orgSlug) {
      throw new ConflictException('Fixture user owns no organization')
    }

    const session = await this.mintSession(user.clerkId)
    return {
      userId: user.id,
      email: user.email,
      sessionToken: session.jwt,
      signInToken: session.signInToken,
      cookies: this.buildCookies(user, session.jwt, orgSlug),
      expiresAt: session.expiresAt,
    }
  }

  private async provisionUser(
    input: CreateTestFixtureUserInput,
  ): Promise<ProvisionedUser> {
    const firstName = input.user?.firstName ?? 'QA'
    const lastName = input.user?.lastName ?? 'Fixture'
    const email = newFixtureUserEmail()
    const password = `Test${randomUUID()}!`

    const clerkUser = await clerkThrottle(() =>
      this.clerkClient.users.createUser({
        emailAddress: [email],
        password,
        firstName,
        lastName,
        skipPasswordChecks: true,
      }),
    )

    const user = await this.users.findOrProvisionByClerk({
      clerkId: clerkUser.id,
      email,
      firstName,
      lastName,
    })
    if (!user) {
      throw new ConflictException(
        'Fixture user provisioning raced an existing account',
      )
    }

    const zip = input.race?.zip ?? DEFAULT_RACE.zip
    const updated = await this.users.updateUser({ id: user.id }, { zip })
    return { user: updated, clerkUserId: clerkUser.id, password }
  }

  private async mintSession(clerkUserId: string): Promise<MintedSession> {
    // gp-webapp pages are gated by the Clerk session, so a browser consumer
    // needs a sign-in ticket to redeem (strategy: 'ticket'); the session JWT
    // below only authenticates direct gp-api calls. Single-use, so every
    // /session re-mint issues a fresh one.
    const signInTokenResponse = await clerkThrottle(() =>
      this.clerkClient.signInTokens.createSignInToken({
        userId: clerkUserId,
        expiresInSeconds: FIXTURE_TOKEN_TTL_SECONDS,
      }),
    )
    if (!signInTokenResponse.token) {
      throw new BadGatewayException('Clerk did not return a sign-in token')
    }
    const signInToken = signInTokenResponse.token
    // Browser-minted Clerk tokens die at 60s; a backend session token minted
    // with an explicit TTL survives a whole QA run (same pattern as the e2e
    // suite's mintApiToken).
    const session = await clerkThrottle(() =>
      this.clerkClient.sessions.createSession({ userId: clerkUserId }),
    )
    const { jwt } = await clerkThrottle(() =>
      this.clerkClient.sessions.getToken(
        session.id,
        undefined,
        FIXTURE_TOKEN_TTL_SECONDS,
      ),
    )
    return {
      jwt,
      signInToken,
      expiresAt: formatISO(addSeconds(new Date(), FIXTURE_TOKEN_TTL_SECONDS)),
    }
  }

  async applyMockAction(body: MockAction): Promise<MockActionResponse> {
    const { campaignId, action } = body
    if (action === 'geoapify.route.fail') {
      await this.vendorMockRecord.armRouteFail(campaignId)
    } else if (action === 'callhub.campaign.complete') {
      await this.vendorMockRecord.completeCallhubCampaign(campaignId)
    } else if (action === 'callhub.campaign.fail') {
      await this.vendorMockRecord.armCallhubCreateFail(campaignId)
    } else if (action === 'peerly.balance.empty') {
      await this.vendorMockRecord.emptyPeerlyBalance(campaignId)
    } else if (action === 'peerly.cv.approve') {
      await this.vendorMockRecord.setPeerlyCvStatus(campaignId, {
        status: PeerlyCvVerificationStatus.APPROVED,
      })
    } else if (action === 'peerly.cv.reject') {
      const reason = body.params?.['reason']
      if (reason !== undefined && (typeof reason !== 'string' || !reason)) {
        throw new BadRequestException(
          'params.reason must be a non-empty string',
        )
      }
      await this.vendorMockRecord.setPeerlyCvStatus(campaignId, {
        status: PeerlyCvVerificationStatus.REJECTED,
        rejectionReason: reason ?? 'Rejected by mock control action',
      })
    } else if (action === 'peerly.cv.setPin') {
      const pin = body.params?.['pin']
      if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) {
        throw new BadRequestException('params.pin must be a 6-digit string')
      }
      await this.vendorMockRecord.setPeerlyCvStatus(campaignId, { pin })
    } else if (action === 'peerly.usecase.activate') {
      await this.vendorMockRecord.activatePeerlyUsecase(campaignId)
    } else if (action === 'peerly.phonelist.fail') {
      await this.vendorMockRecord.armPhoneListFail(campaignId)
    } else if (action === 'vercel.order.fail') {
      await this.vendorMockRecord.failVercelOrders(campaignId)
    } else {
      throw new BadRequestException(`Unsupported action: ${action}`)
    }
    return this.getMockRecords(campaignId)
  }

  // Replaces the campaign organization's stand-in email audience. Ids are
  // stable and sort in the order given, as the people DB's keyset pages do.
  async setEmailAudienceFixture(
    campaignId: number,
    people: EmailAudienceFixtureRequest['people'],
  ): Promise<EmailAudienceFixtureResponse> {
    const campaign = await this.campaigns.findFirst({
      where: { id: campaignId },
      select: { organizationSlug: true },
    })
    if (!campaign) throw new NotFoundException()
    await this.vendorMockRecord.upsert(
      VendorMockVendor.people_db,
      EMAIL_AUDIENCE_FIXTURE_KIND,
      campaign.organizationSlug,
      {
        people: people.map((person, i) => ({
          id: `fixture-${String(i).padStart(4, '0')}`,
          email: person.email.toLowerCase(),
          firstName: person.firstName ?? null,
          lastName: person.lastName ?? null,
        })),
      },
      campaignId,
    )
    return {
      organizationSlug: campaign.organizationSlug,
      count: people.length,
    }
  }

  async getMockRecordsByOrganization(
    organizationSlug: string,
  ): Promise<MockRecordsResponse> {
    return {
      vendorMode: VENDOR_MODE,
      records: await this.vendorMockRecord.findByOrganization(organizationSlug),
    }
  }

  async getMockRecords(campaignId: number): Promise<MockRecordsResponse> {
    const [campaignRecords, callhubRecords, peerlyJobRecords] =
      await Promise.all([
        this.vendorMockRecord.findByCampaign(campaignId),
        this.vendorMockRecord.findCallhubForCampaign(campaignId),
        this.vendorMockRecord.findPeerlyP2pJobsForCampaign(campaignId),
      ])
    return {
      vendorMode: VENDOR_MODE,
      records: [...campaignRecords, ...callhubRecords, ...peerlyJobRecords],
    }
  }

  async timeTravel(
    body: TimeTravel,
    userId: number,
  ): Promise<TimeTravelResponse> {
    const outreach = await this.campaigns.client.outreach.findUnique({
      where: { id: body.outreachId },
      include: { robocall: true },
    })
    if (!outreach || !outreach.campaignId) throw new NotFoundException()
    const campaign = await this.campaigns.findFirst({
      where: { id: outreach.campaignId },
    })
    if (!campaign) throw new NotFoundException()
    if (campaign.userId !== userId) throw new ForbiddenException()

    let date = outreach.date
    let dialedAt = outreach.robocall?.dialedAt ?? null
    let poolFreedAt = outreach.robocall?.poolFreedAt ?? null

    if (
      body.action.startsWith('email.') &&
      outreach.outreachType !== OutreachType.email
    ) {
      throw new BadRequestException(`${body.action} needs an email send`)
    }
    if (
      body.action === 'robocall.send_due_now' ||
      body.action === 'email.send_due_now'
    ) {
      const sendDue = subMinutes(new Date(), 1)
      await this.campaigns.client.outreach.update({
        where: { id: outreach.id },
        data: { date: sendDue },
      })
      date = sendDue
    } else if (body.action === 'robocall.dialed_48h_ago') {
      if (!outreach.robocall)
        throw new NotFoundException('No robocall record for this outreach')
      const backdated = subHours(new Date(), 49)
      await this.campaigns.client.outreachRobocall.update({
        where: { outreachId: outreach.id },
        data: {
          dialedAt: backdated,
          ...(outreach.robocall.poolFreedAt !== null
            ? { poolFreedAt: backdated }
            : {}),
        },
      })
      dialedAt = backdated
      poolFreedAt = outreach.robocall.poolFreedAt !== null ? backdated : null
    } else if (body.action === 'email.sent_6m_ago') {
      // The settle sweep waits 5 minutes after a send's last email for SES's
      // numbers before it finishes the send. Shifting keeps the send's own
      // window, which warming reads back from CloudWatch.
      await this.campaigns.client.$executeRaw`
        UPDATE outreach_email_recipient r
        SET sent_at = r.sent_at - interval '6 minutes'
        FROM outreach_email e
        WHERE e.id = r.outreach_email_id
          AND e.outreach_id = ${outreach.id}
          AND r.sent_at IS NOT NULL
      `
    } else if (
      body.action === 'sms.start_date_today' ||
      body.action === 'sms.start_date_passed'
    ) {
      // The completion sweep reads the Peerly job's start_date: today (UTC)
      // reads in_progress, a past day reads completed.
      if (!outreach.projectId)
        throw new NotFoundException('No Peerly job for this outreach')
      const startDay =
        body.action === 'sms.start_date_today'
          ? new Date()
          : subDays(new Date(), 1)
      const found = await this.vendorMockRecord.setPeerlyP2pJobStartDate(
        outreach.projectId,
        startDay.toISOString().slice(0, 10),
      )
      if (!found) throw new NotFoundException('No mock Peerly job record')
      await this.campaigns.client.outreach.update({
        where: { id: outreach.id },
        data: { date: startDay },
      })
      date = startDay
    }

    return {
      outreachId: outreach.id,
      date: date ? formatISO(date) : null,
      dialedAt: dialedAt ? formatISO(dialedAt) : null,
      poolFreedAt: poolFreedAt ? formatISO(poolFreedAt) : null,
    }
  }

  // `userId` is the calling test user. Campaign-scoped jobs (the 10DLC ones,
  // and robocall.send when called with one) need it so they never touch other
  // users' records on a shared preview DB.
  async runJob(name: string, userId?: number): Promise<RunJobResponse> {
    const callerCampaign = async () => {
      if (userId === undefined) {
        throw new BadRequestException(`Job ${name} needs a calling test user`)
      }
      const campaign = await this.campaigns.findFirst({ where: { userId } })
      if (!campaign) throw new NotFoundException('No campaign for caller')
      return campaign
    }
    // Live mode keeps the email crons off on purpose; run here, they would
    // send real email and capture real holds.
    const emailMockOnly = async (run: () => Promise<void>) => {
      if (VENDOR_MODE !== 'mock') {
        throw new NotFoundException(`${name} runs only against vendor mocks`)
      }
      await run()
    }
    const jobs: Record<string, () => Promise<void>> = {
      'robocall.staging': () => this.robocallStaging.runStaging(),
      'robocall.send': async () => {
        if (userId === undefined) return this.robocallSend.runSend()
        const campaign = await callerCampaign()
        await this.robocallSend.runSend({ campaignId: campaign.id })
      },
      'robocall.completion': () => this.robocallCompletion.runCompletion(),
      'robocall.capture': () => this.robocallCapture.runCapture(),
      // Aborts the PAUSED CallHub campaigns a cancel/failed send queued.
      'robocall.callhubCleanup': () => this.robocallCallhubCleanup.runSweep(),
      'p2p.phoneListFinish': () =>
        this.vendorMockRecord.finishPeerlyPhoneLists(),
      'outreach.completion': () => this.outreachCompletion.runCompletion(),
      'cvStatusPoll.scanFresh': async () => {
        const campaign = await callerCampaign()
        await this.cvStatusPoll.runFreshScan(`fixture-${randomUUID()}`, {
          campaignId: campaign.id,
          spacingMs: 0,
        })
      },
      // Skips the hourly CronLockService claim on purpose; only this fixture
      // path may (the @Cron wrapper keeps the lock).
      'tcr.usecaseSweep': () => this.tcrCompliance.runUnsubmittedUsecaseSweep(),
      // The email sweeps are global, like the robocall ones. Running one
      // beside its cron is safe: due and settle claim per row, and the send
      // sweep holds the lease.
      'email.due': () =>
        emailMockOnly(() =>
          this.moduleRef
            .get(OutreachEmailLifecycleService, { strict: false })
            .startDueSends(),
        ),
      'email.sweep': () =>
        emailMockOnly(() =>
          this.moduleRef
            .get(OutreachEmailSendSweepService, { strict: false })
            .runTick(),
        ),
      'email.settle': () =>
        emailMockOnly(() =>
          this.moduleRef
            .get(OutreachEmailLifecycleService, { strict: false })
            .settleFinishedSends(),
        ),
      'tcr.complianceSweep': async () => {
        const campaign = await callerCampaign()
        await this.checkCampaignUsecaseActivation(campaign.id)
      },
    }
    const job = jobs[name]
    if (!job) throw new NotFoundException(`Unknown job: ${name}`)
    const ranAt = new Date()
    await job()
    return {
      ranAt: formatISO(ranAt),
      durationMs: differenceInMilliseconds(new Date(), ranAt),
    }
  }

  async deliverStripeEvent(
    type: 'checkout.session.completed',
    sessionId: string,
  ): Promise<DeliverStripeEventResponse> {
    const session = await this.stripeService.retrieveCheckoutSession(sessionId)
    const eventId = `evt_fixture_${randomUUID().replace(/-/g, '')}`
    // Construct a minimal Stripe.Event wrapper — the handler reads only
    // event.type and event.data.object, so the other envelope fields are
    // placeholders. The type assertion is intentional: we are building an
    // in-process fixture, not a real Stripe delivery.
    const event = {
      id: eventId,
      object: 'event',
      type,
      data: { object: session },
      api_version: '2025-03-31.basil',
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      pending_webhooks: 0,
      request: null,
    } as Stripe.CheckoutSessionCompletedEvent
    const paymentEvents = this.moduleRef.get(PaymentEventsService, {
      strict: false,
    })
    await paymentEvents.handleEvent(event)
    return { eventId, status: 'delivered' }
  }

  async applyOutreachAdminAction(
    outreachId: number,
    action: 'cas.approve' | 'results.upload',
    payload: unknown,
    userId: number,
  ): Promise<AdminOutreachActionResponse> {
    const outreach = await this.campaigns.client.outreach.findUnique({
      where: { id: outreachId },
    })
    if (!outreach) throw new NotFoundException()
    if (outreach.campaignId !== null) {
      const campaign = await this.campaigns.findFirst({
        where: { id: outreach.campaignId },
      })
      if (!campaign) throw new NotFoundException()
      if (campaign.userId !== userId) throw new ForbiddenException()
    }

    if (action === 'cas.approve') {
      await this.smsAdmin.approve(outreachId, { approvedBy: 'test-fixture' })
    } else {
      if (typeof payload !== 'string') {
        throw new BadRequestException(
          'results.upload requires payload to be a CSV string',
        )
      }
      // Replace {{recipient:N}} placeholders with real OutreachTextRecipient
      // phones so the spec CSV works across fresh isolated test users whose
      // recipient phones come from the voter file and are unknown at write time.
      let csv = payload
      const recipientMatches = [...payload.matchAll(/\{\{recipient:(\d+)\}\}/g)]
      if (recipientMatches.length > 0) {
        const maxIdx = Math.max(
          ...recipientMatches.map((m) => parseInt(m[1] ?? '0', 10)),
        )
        const recipients =
          await this.campaigns.client.outreachTextRecipient.findMany({
            where: { outreachId },
            select: { phone: true },
            take: maxIdx + 1,
          })
        if (recipients.length <= maxIdx) {
          throw new BadRequestException(
            `results.upload: {{recipient:${maxIdx}}} needs ` +
              `${maxIdx + 1} recipients, found ${recipients.length}`,
          )
        }
        csv = payload.replace(
          /\{\{recipient:(\d+)\}\}/g,
          (_, idx: string) => recipients[parseInt(idx, 10)]?.phone ?? '',
        )
      }
      await this.resultsAdmin.upload(outreachId, {
        fileName: 'fixture.csv',
        csv,
        dryRun: false,
        sourceLabel: 'test-fixture',
      })
    }

    return { outreachId, action, status: 'applied' }
  }

  private buildCookies(user: User, token: string, orgSlug: string) {
    return {
      token,
      user: JSON.stringify({
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        name: user.name,
        zip: user.zip,
        phone: user.phone,
      }),
      'organization-slug': orgSlug,
    }
  }
}

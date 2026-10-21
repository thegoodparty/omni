import { CvStatusPollService } from '@/campaigns/tcrCompliance/services/cvStatusPoll.service'
import { CampaignTcrComplianceService } from '@/campaigns/tcrCompliance/services/campaignTcrCompliance.service'
import { CampaignsService } from '@/campaigns/services/campaigns.service'
import { ElectionsService } from '@/elections/services/elections.service'
import { OutreachCompletionService } from '@/outreach/services/outreachCompletion.service'
import { OutreachResultsAdminService } from '@/outreach/services/outreachResultsAdmin.service'
import { OutreachRobocallCaptureService } from '@/outreach/services/outreachRobocallCapture.service'
import { OutreachRobocallCompletionService } from '@/outreach/services/outreachRobocallCompletion.service'
import { OutreachRobocallSendService } from '@/outreach/services/outreachRobocallSend.service'
import { OutreachRobocallStagingService } from '@/outreach/services/outreachRobocallStaging.service'
import { OutreachSmsAdminService } from '@/outreach/services/outreachSmsAdmin.service'
import { PaymentEventsService } from '@/payments/services/paymentEventsService'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { UsersService } from '@/users/services/users.service'
import { VENDOR_MODE } from '@/shared/util/appEnvironment.util'
import { isTestUser, newFixtureUserEmail } from '@/users/util/users.util'
import { CLERK_CLIENT_PROVIDER_TOKEN } from '@/vendors/clerk/providers/clerk-client.provider'
import { clerkThrottle } from '@/vendors/clerk/util/clerkThrottle.util'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import { VendorMockRecordService } from '@/vendorMocks/vendorMockRecord.service'
import { ClerkClient } from '@clerk/backend'
import {
  type AdminOutreachActionResponse,
  type DeliverStripeEventResponse,
  type MockAction,
  type MockActionResponse,
  type MockRecordsResponse,
  type RunJobResponse,
  type TimeTravel,
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
  addSeconds,
  differenceInMilliseconds,
  formatISO,
  subHours,
  subMinutes,
} from 'date-fns'
import Stripe from 'stripe'
import { User } from '@/generated/prisma'
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
    private readonly robocallStaging: OutreachRobocallStagingService,
    private readonly robocallSend: OutreachRobocallSendService,
    private readonly robocallCompletion: OutreachRobocallCompletionService,
    private readonly robocallCapture: OutreachRobocallCaptureService,
    private readonly outreachCompletion: OutreachCompletionService,
    private readonly smsAdmin: OutreachSmsAdminService,
    private readonly resultsAdmin: OutreachResultsAdminService,
    private readonly stripeService: StripeService,
    private readonly moduleRef: ModuleRef,
    @Inject(CLERK_CLIENT_PROVIDER_TOKEN)
    private readonly clerkClient: ClerkClient,
  ) {}

  async createFixtureUser(
    input: CreateTestFixtureUserInput,
  ): Promise<TestFixtureUserResponse> {
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
    } else if (action === 'vercel.order.fail') {
      await this.vendorMockRecord.failVercelOrders(campaignId)
    } else {
      throw new BadRequestException(`Unsupported action: ${action}`)
    }
    return this.getMockRecords(campaignId)
  }

  async getMockRecords(campaignId: number): Promise<MockRecordsResponse> {
    const [campaignRecords, callhubRecords] = await Promise.all([
      this.vendorMockRecord.findByCampaign(campaignId),
      this.vendorMockRecord.findCallhubForCampaign(campaignId),
    ])
    return {
      vendorMode: VENDOR_MODE,
      records: [...campaignRecords, ...callhubRecords],
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

    if (body.action === 'robocall.send_due_now') {
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
    } else if (body.action === 'sms.start_date_today') {
      throw new BadRequestException('Not implemented until M3')
    }

    return {
      outreachId: outreach.id,
      date: date ? formatISO(date) : null,
      dialedAt: dialedAt ? formatISO(dialedAt) : null,
      poolFreedAt: poolFreedAt ? formatISO(poolFreedAt) : null,
    }
  }

  // Launches ONE robocall by id, bypassing the send sweep's GLOBAL serial gate
  // (`runSend` dials at most one robocall at a time across the whole DB, so any
  // dev-side robocall mid-dial blocks it). The preview shares the dev database,
  // so that gate made the robocall E2E flaky — it stalled whenever another
  // robocall was dialing anywhere on dev. Driving the run's own `startCampaign`
  // directly isolates the test from that shared queue while still exercising the
  // real launch path (claim, hold re-check, CallHub START).
  async launchRobocall(
    outreachId: number,
    userId: number,
  ): Promise<RunJobResponse> {
    const outreach = await this.campaigns.client.outreach.findUnique({
      where: { id: outreachId },
    })
    if (!outreach || !outreach.campaignId) throw new NotFoundException()
    const campaign = await this.campaigns.findFirst({
      where: { id: outreach.campaignId },
    })
    if (!campaign) throw new NotFoundException()
    if (campaign.userId !== userId) throw new ForbiddenException()

    const ranAt = new Date()
    await this.robocallSend.startCampaign(outreachId)
    return {
      ranAt: formatISO(ranAt),
      durationMs: differenceInMilliseconds(new Date(), ranAt),
    }
  }

  // `userId` is the calling test user. Campaign-scoped jobs (the 10DLC ones)
  // need it so they never touch other users' records on a shared preview DB.
  async runJob(name: string, userId?: number): Promise<RunJobResponse> {
    const callerCampaign = async () => {
      if (userId === undefined) {
        throw new BadRequestException(`Job ${name} needs a calling test user`)
      }
      const campaign = await this.campaigns.findFirst({ where: { userId } })
      if (!campaign) throw new NotFoundException('No campaign for caller')
      return campaign
    }
    const jobs: Record<string, () => Promise<void>> = {
      'robocall.staging': () => this.robocallStaging.runStaging(),
      'robocall.send': () => this.robocallSend.runSend(),
      'robocall.completion': () => this.robocallCompletion.runCompletion(),
      'robocall.capture': () => this.robocallCapture.runCapture(),
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
      'tcr.complianceSweep': async () => {
        const campaign = await callerCampaign()
        const record = await this.tcrCompliance.model.findFirst({
          where: { campaignId: campaign.id, status: 'pending' },
        })
        if (!record) {
          throw new NotFoundException('No pending TCR compliance record')
        }
        await this.tcrCompliance.checkUsecaseActivation(record)
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
      await this.resultsAdmin.upload(outreachId, {
        fileName: 'fixture.csv',
        csv: payload,
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

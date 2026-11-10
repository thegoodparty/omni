import { BadGatewayException } from '@nestjs/common'
import { addDays, format, subDays, subMinutes } from 'date-fns'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest'
import { useTestService } from '@/test-service'
import { AnalyticsService } from '@/analytics/analytics.service'
import { ExperimentRunsService } from '@/agentExperiments/services/experimentRuns.service'
import { CrmCampaignsService } from '@/campaigns/services/crmCampaigns.service'
import { disableVendorCrons } from '@/shared/test-utils/appEnvOverrides'
import * as sleepUtil from '@/shared/util/sleep.util'
import { PeerlyCvVerificationStatus } from '@/vendors/peerly/peerly.types'
import { PEERLY_USECASE } from '@/vendors/peerly/services/peerly.const'
import { PeerlyIdentityService } from '@/vendors/peerly/services/peerlyIdentity.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import { SlackService } from '@/vendors/slack/services/slack.service'
import { SlackChannel } from '@/vendors/slack/slackService.types'
import { WebsitesService } from '@/websites/services/websites.service'
import {
  OfficeLevel,
  Prisma,
  TcrComplianceStatus,
} from '../../../generated/prisma'
import { CampaignTcrComplianceService } from '../services/campaignTcrCompliance.service'

// Every test runs the real 10DLC jobs and schedules on the real pg-boss
// workers (src/jobs/AGENTS.md § Tests).
const service = useTestService({ jobs: true })

const electionDateIn = (days: number) =>
  format(addDays(new Date(), days), 'yyyy-MM-dd')

// Passes the kickoff's publish gate: a genuine bio and a genuine issue.
const publishableContent = {
  about: {
    bio: `<p>${'a'.repeat(600)}</p>`,
    issues: [{ title: 'Roads', description: 'Fix the roads' }],
  },
}

let seq = 0

// A campaign of its own user, so the scans and the report (which skip
// internal accounts) see it. Pass `owner` to put it on the test user.
const seedCampaign = async (
  overrides: Partial<Prisma.CampaignUncheckedCreateInput> = {},
  owner?: { id: number },
) => {
  seq += 1
  const unique = `${Date.now()}-${seq}`
  const userId =
    owner?.id ??
    (
      await service.prisma.user.create({
        data: {
          email: `candidate-${unique}@example.com`,
          firstName: 'Jane',
          lastName: 'Doe',
        },
      })
    ).id
  const slug = `tcr-jobs-${unique}`
  await service.prisma.organization.create({
    data: { slug, ownerId: userId },
  })
  return service.prisma.campaign.create({
    data: {
      slug,
      organizationSlug: slug,
      userId,
      isPro: true,
      placeId: 'place-123',
      details: { electionDate: electionDateIn(60) },
      ...overrides,
    },
  })
}

const seedRecord = (
  campaignId: number,
  data: Partial<Prisma.TcrComplianceUncheckedCreateInput> = {},
) =>
  service.prisma.tcrCompliance.create({
    data: {
      campaignId,
      ein: '12-3456789',
      postalAddress: '123 Main St',
      committeeName: 'Friends of Jane Doe',
      websiteDomain: 'example.org',
      filingUrl: 'https://sos.example.gov/filing',
      phone: '555-000-1234',
      email: `candidate-${campaignId}@example.com`,
      officeLevel: OfficeLevel.local,
      ...data,
    },
  })

const recordOf = (id: string) =>
  service.prisma.tcrCompliance.findUniqueOrThrow({ where: { id } })

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('tcrComplianceStatusSweep', () => {
  let track: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    track = vi
      .spyOn(service.app.get(AnalyticsService), 'track')
      .mockResolvedValue({ event: 'tracked', userId: 'tracked' })
    vi.spyOn(service.app.get(AnalyticsService), 'identify').mockResolvedValue(
      undefined,
    )
  })

  const seedPending = async (peerlyIdentityId: string) => {
    const campaign = await seedCampaign()
    return seedRecord(campaign.id, {
      status: TcrComplianceStatus.pending,
      peerlyIdentityId,
      peerlyCvStatus: PeerlyCvVerificationStatus.VERIFIED,
    })
  }

  it('approves each pending registration whose usecase Peerly activated', async () => {
    const active = await seedPending('peerly-active')
    const waiting = await seedPending('peerly-waiting')
    vi.spyOn(
      service.app.get(PeerlyIdentityService),
      'getIdentityUseCases',
    ).mockImplementation(async (identityId) =>
      identityId === 'peerly-active'
        ? [{ usecase: PEERLY_USECASE, activated: 1 }]
        : [],
    )

    await service.jobs.runSchedule('tcrComplianceStatusSweep')

    expect((await recordOf(active.id)).status).toBe(
      TcrComplianceStatus.approved,
    )
    expect((await recordOf(waiting.id)).status).toBe(
      TcrComplianceStatus.pending,
    )
    const { userId } = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: active.campaignId },
    })
    expect(track).toHaveBeenCalledWith(
      userId,
      EVENTS.Outreach.ComplianceCompleted,
    )
  })

  it('dead-letters only the check whose Peerly call keeps failing', async () => {
    const active = await seedPending('peerly-active')
    const failing = await seedPending('peerly-down')
    vi.spyOn(
      service.app.get(PeerlyIdentityService),
      'getIdentityUseCases',
    ).mockImplementation(async (identityId) => {
      if (identityId === 'peerly-down') {
        throw new BadGatewayException('Peerly down')
      }
      return [{ usecase: PEERLY_USECASE, activated: 1 }]
    })

    const { deadLetters } = await service.jobs.runSchedule(
      'tcrComplianceStatusSweep',
      { allowDeadLetters: true },
    )

    expect(deadLetters).toEqual([
      {
        name: 'tcrComplianceStatusCheck',
        data: { tcrComplianceId: failing.id },
        error: 'Peerly down',
      },
    ])
    expect((await recordOf(active.id)).status).toBe(
      TcrComplianceStatus.approved,
    )
  })

  it('still completes the check when the completed-email single-send fails', async () => {
    vi.stubEnv('HUBSPOT_COMPLIANCE_COMPLETED_EMAIL_ID', '12345')
    const active = await seedPending('peerly-active')
    vi.spyOn(
      service.app.get(PeerlyIdentityService),
      'getIdentityUseCases',
    ).mockResolvedValue([{ usecase: PEERLY_USECASE, activated: 1 }])
    vi.spyOn(
      service.app.get(CampaignTcrComplianceService),
      'sendComplianceCompletedSingleSend',
    ).mockRejectedValue(new Error('HubSpot down'))

    await service.jobs.runSchedule('tcrComplianceStatusSweep')

    expect((await recordOf(active.id)).status).toBe(
      TcrComplianceStatus.approved,
    )
  })
})

describe('agenticComplianceKickoff', () => {
  let dispatchRun: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.spyOn(
      service.app.get(CrmCampaignsService),
      'trackCampaign',
    ).mockResolvedValue(undefined)
    vi.spyOn(service.app.get(SlackService), 'message').mockResolvedValue(
      undefined,
    )
    vi.spyOn(
      service.app.get(WebsitesService),
      'getContentForCampaign',
    ).mockResolvedValue(publishableContent)
    // Back to the real dispatchRun, which a test may have stubbed.
    dispatchRun = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockReset()
  })

  const submitAsPro = async () => {
    const campaign = await seedCampaign({}, service.user)
    const res = await service.client.post(
      '/v1/campaigns/tcr-compliance/agentic',
      {
        ein: '12-3456789',
        candidateName: 'Jane Doe',
        placeId: 'place-123',
        formattedAddress: '123 Main St, Springfield, IL 62701',
        committeeName: 'Friends of Jane Doe',
        filingUrl: 'https://sos.example.gov/filing',
        email: 'jane@example.com',
        phone: '+12025550123',
        officeLevel: OfficeLevel.local,
      },
      { headers: { 'x-organization-slug': campaign.slug } },
    )
    expect(res.status).toBe(202)
    return campaign
  }

  it('dispatches the compliance agent for a paid submission', async () => {
    dispatchRun.mockResolvedValue({ runId: 'run-kickoff' } as never)

    const campaign = await submitAsPro()
    await service.jobs.settle()

    expect(dispatchRun).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        type: 'compliance_setup',
        params: expect.objectContaining({
          campaign_id: campaign.id,
          trigger: 'initial',
        }),
      }),
    )
    const record = await service.prisma.tcrCompliance.findUniqueOrThrow({
      where: { campaignId: campaign.id },
    })
    expect(record.kickoffSentAt).not.toBeNull()
    expect(record.agenticRunId).toBe('run-kickoff')
    // The kickoff guaranteed the agent a website to publish.
    expect(
      await service.prisma.website.findUnique({
        where: { campaignId: campaign.id },
      }),
    ).not.toBeNull()
  })

  // Previews: no agent dispatch queue, so dispatchRun creates no run.
  it('completes without a run when no agent queue is configured', async () => {
    const campaign = await submitAsPro()
    await service.jobs.settle()

    expect(dispatchRun).toHaveBeenCalledOnce()
    const record = await service.prisma.tcrCompliance.findUniqueOrThrow({
      where: { campaignId: campaign.id },
    })
    expect(record.agenticRunId).toBeNull()
    expect(record.agenticDispatchAttemptedAt).toBeNull()
    expect(record.status).toBe(TcrComplianceStatus.submitted)
  })

  it('the stranded sweep kicks off open paid records and skips ones past the cutoff', async () => {
    dispatchRun.mockResolvedValue({ runId: 'run-swept' } as never)
    const closed = await seedCampaign(
      { details: { electionDate: electionDateIn(10) } },
      service.user,
    )
    const open = await seedCampaign({}, service.user)
    const createdAt = subMinutes(new Date(), 30)
    const closedRecord = await seedRecord(closed.id, { createdAt })
    const openRecord = await seedRecord(open.id, { createdAt })

    await service.jobs.runSchedule('tcrStrandedKickoffSweep')

    expect(dispatchRun).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        params: expect.objectContaining({ campaign_id: open.id }),
      }),
    )
    expect((await recordOf(openRecord.id)).agenticRunId).toBe('run-swept')
    expect((await recordOf(closedRecord.id)).kickoffSentAt).toBeNull()
  })
})

describe('CV status scans', () => {
  let retrieve: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // The scans pace retrieve_cv a minute apart.
    vi.spyOn(sleepUtil, 'sleep').mockResolvedValue(undefined)
    retrieve = vi
      .spyOn(
        service.app.get(PeerlyIdentityService),
        'retrieveCampaignVerifyDetails',
      )
      .mockResolvedValue({
        status: PeerlyCvVerificationStatus.IN_REVIEW,
        pinDelivery: null,
      } as never)
  })

  const seedInFlight = async () => {
    const campaign = await seedCampaign()
    return seedRecord(campaign.id, {
      status: TcrComplianceStatus.submitted,
      peerlyIdentityId: `peerly-${campaign.id}`,
      peerlySubmissionStartedAt: new Date(),
    })
  }

  it.each(['cvStatusScan', 'cvStatusFreshScan'] as const)(
    '%s records the CV status Peerly reports',
    async (schedule) => {
      const record = await seedInFlight()

      await service.jobs.runSchedule(schedule)

      expect(retrieve).toHaveBeenCalledOnce()
      expect((await recordOf(record.id)).peerlyCvStatus).toBe(
        PeerlyCvVerificationStatus.IN_REVIEW,
      )
    },
  )

  it.each(['cvStatusScan', 'cvStatusFreshScan'] as const)(
    '%s makes no Peerly call on a non-prod deploy in live mode',
    async (schedule) => {
      disableVendorCrons()
      const record = await seedInFlight()

      await service.jobs.runSchedule(schedule)

      expect(retrieve).not.toHaveBeenCalled()
      expect((await recordOf(record.id)).peerlyCvStatus).toBeNull()
    },
  )
})

describe('nightly10DlcReport and peerlyVendorEscalation', () => {
  let message: MockInstance<SlackService['message']>

  beforeEach(() => {
    message = vi
      .spyOn(service.app.get(SlackService), 'message')
      .mockResolvedValue('ok' as never)
  })

  const channelsPosted = () => message.mock.calls.map(([, channel]) => channel)

  it('posts the nightly report to the internal channel in prod', async () => {
    vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'prod')

    await service.jobs.runSchedule('nightly10DlcReport')

    expect(channelsPosted()).toEqual([SlackChannel.bot10DlcCompliance])
  })

  it('retries a failed report post until it dead-letters', async () => {
    vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'prod')
    message.mockResolvedValue(undefined)

    const { deadLetters } = await service.jobs.runSchedule(
      'nightly10DlcReport',
      { allowDeadLetters: true },
    )

    expect(deadLetters).toEqual([
      {
        name: 'nightly10DlcReport',
        data: {},
        error: '10DLC nightly report: Slack post failed',
      },
    ])
    expect(message).toHaveBeenCalledTimes(3)
  })

  it('escalates a stalled CV review to the shared Peerly channel once, in prod', async () => {
    vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'prod')
    const campaign = await seedCampaign()
    const stalled = await seedRecord(campaign.id, {
      status: TcrComplianceStatus.submitted,
      peerlyIdentityId: 'peerly-stalled',
      peerlyCvStatus: PeerlyCvVerificationStatus.IN_REVIEW,
      peerlyCvStatusChangedAt: subDays(new Date(), 14),
    })

    await service.jobs.runSchedule('peerlyVendorEscalation')
    await service.jobs.runSchedule('peerlyVendorEscalation')

    expect(channelsPosted()).toEqual([SlackChannel.sharedGoodpartyPeerly10Dlc])
    expect((await recordOf(stalled.id)).cvInReviewEscalatedAt).not.toBeNull()
  })

  it.each(['nightly10DlcReport', 'peerlyVendorEscalation'] as const)(
    '%s posts nothing outside prod',
    async (schedule) => {
      vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'dev')
      const campaign = await seedCampaign()
      await seedRecord(campaign.id, {
        status: TcrComplianceStatus.submitted,
        peerlyIdentityId: 'peerly-stalled',
        peerlyCvStatus: PeerlyCvVerificationStatus.IN_REVIEW,
        peerlyCvStatusChangedAt: subDays(new Date(), 14),
      })

      await service.jobs.runSchedule(schedule)

      expect(message).not.toHaveBeenCalled()
    },
  )
})

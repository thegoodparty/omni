import { addDays, format, subMinutes } from 'date-fns'
import Stripe from 'stripe'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { AnalyticsService } from '@/analytics/analytics.service'
import { CrmCampaignsService } from '@/campaigns/services/crmCampaigns.service'
import { WebhookEventType } from '@/payments/payments.types'
import { QueueProducerService } from '@/queue/producer/queueProducer.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import { SlackService } from '@/vendors/slack/services/slack.service'
import { WebsitesService } from '@/websites/services/websites.service'
import {
  OfficeLevel,
  Prisma,
  TcrComplianceStatus,
} from '../../../generated/prisma'
import { CampaignTcrComplianceService } from '../services/campaignTcrCompliance.service'

const service = useTestService()

const CLOSED_DAYS_OUT = 10
const OPEN_DAYS_OUT = 60

const electionDateIn = (days: number) =>
  format(addDays(new Date(), days), 'yyyy-MM-dd')

let seq = 0

const seedCampaign = async (
  electionDate: string,
  overrides: Partial<Prisma.CampaignUncheckedCreateInput> = {},
) => {
  seq += 1
  const slug = `sms-cutoff-${seq}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  return service.prisma.campaign.create({
    data: {
      slug,
      organizationSlug: slug,
      userId: service.user.id,
      details: { electionDate },
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

const orgHeaders = (slug: string) => ({
  headers: { 'x-organization-slug': slug },
})

const submission = {
  ein: '12-3456789',
  candidateName: 'Jane Doe',
  placeId: 'place-123',
  formattedAddress: '123 Main St, Springfield, IL 62701',
  committeeName: 'Friends of Jane Doe',
  filingUrl: 'https://sos.example.gov/filing',
  email: 'jane@example.com',
  phone: '+12025550123',
  officeLevel: OfficeLevel.local,
}

const publishableContent = {
  about: {
    bio: `<p>${'a'.repeat(600)}</p>`,
    issues: [{ title: 'Roads', description: 'Fix the roads' }],
  },
}

const spyOnTrack = () =>
  vi
    .spyOn(service.app.get(AnalyticsService), 'track')
    .mockResolvedValue({ event: 'stub', userId: 'stub' })

const spyOnQueue = () =>
  vi
    .spyOn(service.app.get(QueueProducerService), 'sendMessage')
    .mockResolvedValue(undefined)

beforeEach(() => {
  vi.spyOn(
    service.app.get(CrmCampaignsService),
    'trackCampaign',
  ).mockResolvedValue(undefined)
  vi.spyOn(service.app.get(SlackService), 'message').mockResolvedValue(
    undefined,
  )
})

describe('POST /v1/campaigns/tcr-compliance/agentic', () => {
  it('saves a free candidate submission past the cutoff without a kickoff', async () => {
    const campaign = await seedCampaign(electionDateIn(CLOSED_DAYS_OUT))
    const track = spyOnTrack()
    const queue = spyOnQueue()

    const res = await service.client.post(
      '/v1/campaigns/tcr-compliance/agentic',
      submission,
      orgHeaders(campaign.slug),
    )

    expect(res.status).toBe(202)
    const record = await service.prisma.tcrCompliance.findUniqueOrThrow({
      where: { campaignId: campaign.id },
    })
    expect(record.kickoffSentAt).toBeNull()
    const after = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    expect(after.details.einNumber).toBe(submission.ein)
    expect(queue).not.toHaveBeenCalled()
    expect(track).not.toHaveBeenCalledWith(
      service.user.id,
      EVENTS.Outreach.ComplianceSubmissionBlocked,
      expect.anything(),
    )

    const state = await service.client.get(
      '/v1/campaigns/tcr-compliance/mine/compliance-state',
      orgHeaders(campaign.slug),
    )
    expect(state.data.smsCompliance).toBe('closed')
  })

  it('saves a Pro submission past the cutoff but skips the kickoff', async () => {
    const campaign = await seedCampaign(electionDateIn(CLOSED_DAYS_OUT), {
      isPro: true,
    })
    const track = spyOnTrack()
    const queue = spyOnQueue()

    const res = await service.client.post(
      '/v1/campaigns/tcr-compliance/agentic',
      submission,
      orgHeaders(campaign.slug),
    )

    expect(res.status).toBe(202)
    const record = await service.prisma.tcrCompliance.findUniqueOrThrow({
      where: { campaignId: campaign.id },
    })
    expect(record.kickoffSentAt).toBeNull()
    expect(record.status).not.toBe(TcrComplianceStatus.error)
    expect(queue).not.toHaveBeenCalled()
    expect(track).toHaveBeenCalledWith(
      service.user.id,
      EVENTS.Outreach.ComplianceSubmissionBlocked,
      expect.objectContaining({ path: 'agentic', campaignId: campaign.id }),
    )
  })

  it('recreates a rejected record past the cutoff without a kickoff', async () => {
    const campaign = await seedCampaign(electionDateIn(CLOSED_DAYS_OUT), {
      isPro: true,
    })
    const record = await seedRecord(campaign.id, {
      status: TcrComplianceStatus.rejected,
    })
    const queue = spyOnQueue()

    const res = await service.client.post(
      '/v1/campaigns/tcr-compliance/agentic',
      submission,
      orgHeaders(campaign.slug),
    )

    expect(res.status).toBe(202)
    const recreated = await service.prisma.tcrCompliance.findUniqueOrThrow({
      where: { campaignId: campaign.id },
    })
    expect(recreated.id).not.toBe(record.id)
    expect(recreated.kickoffSentAt).toBeNull()
    expect(queue).not.toHaveBeenCalled()
  })

  it('accepts a new submission while the window is open', async () => {
    const campaign = await seedCampaign(electionDateIn(OPEN_DAYS_OUT))

    const res = await service.client.post(
      '/v1/campaigns/tcr-compliance/agentic',
      submission,
      orgHeaders(campaign.slug),
    )

    expect(res.status).toBe(202)
    expect(
      await service.prisma.tcrCompliance.findUnique({
        where: { campaignId: campaign.id },
      }),
    ).not.toBeNull()
  })

  it('lets a candidate who made the cutoff recreate a rejected record', async () => {
    const campaign = await seedCampaign(electionDateIn(CLOSED_DAYS_OUT))
    const record = await seedRecord(campaign.id, {
      status: TcrComplianceStatus.rejected,
      kickoffSentAt: subMinutes(new Date(), 60 * 24 * 14),
    })

    const res = await service.client.post(
      '/v1/campaigns/tcr-compliance/agentic',
      submission,
      orgHeaders(campaign.slug),
    )

    expect(res.status).toBe(202)
    const recreated = await service.prisma.tcrCompliance.findUniqueOrThrow({
      where: { campaignId: campaign.id },
    })
    expect(recreated.id).not.toBe(record.id)
    expect(recreated.status).toBe(TcrComplianceStatus.submitted)
  })
})

describe('POST /v1/campaigns/tcr-compliance', () => {
  it('rejects a legacy submission past the cutoff', async () => {
    const campaign = await seedCampaign(electionDateIn(CLOSED_DAYS_OUT))
    const track = spyOnTrack()

    const res = await service.client.post(
      '/v1/campaigns/tcr-compliance',
      { ...submission, websiteDomain: 'example.org' },
      orgHeaders(campaign.slug),
    )

    expect(res.status).toBe(409)
    expect(res.data.errorCode).toBe('SMS_COMPLIANCE_CUTOFF')
    expect(track).toHaveBeenCalledWith(
      service.user.id,
      EVENTS.Outreach.ComplianceSubmissionBlocked,
      expect.objectContaining({ path: 'legacy' }),
    )
  })
})

describe('POST /v1/campaigns/tcr-compliance/submit-to-peerly', () => {
  it('rejects a Peerly submission for a record that never got a kickoff past the cutoff', async () => {
    const campaign = await seedCampaign(electionDateIn(CLOSED_DAYS_OUT))
    await seedRecord(campaign.id)
    const track = spyOnTrack()

    const res = await service.client.post(
      '/v1/campaigns/tcr-compliance/submit-to-peerly',
      {},
      orgHeaders(campaign.slug),
    )

    expect(res.status).toBe(409)
    expect(res.data.errorCode).toBe('SMS_COMPLIANCE_CUTOFF')
    expect(track).toHaveBeenCalledWith(
      service.user.id,
      EVENTS.Outreach.ComplianceSubmissionBlocked,
      expect.objectContaining({
        path: 'submit_to_peerly',
        campaignId: campaign.id,
      }),
    )
  })
})

describe('Pro payment webhook', () => {
  // Signing-only client; generateTestHeaderString is a local HMAC.
  const signer = new Stripe('sk_test_signing_only')

  const deliverProCheckout = () => {
    const payload = JSON.stringify({
      id: `evt_test_sms_cutoff_${seq}`,
      object: 'event',
      api_version: '2025-03-31.basil',
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
      type: WebhookEventType.CheckoutSessionCompleted,
      data: {
        object: {
          id: `cs_test_sms_cutoff_${seq}`,
          object: 'checkout.session',
          mode: 'subscription',
          customer: 'cus_test_sms_cutoff',
          subscription: 'sub_test_sms_cutoff',
          metadata: { userId: String(service.user.id) },
        },
      },
    })
    return service.client.post('/v1/payments/events', payload, {
      headers: {
        'content-type': 'application/json',
        'stripe-signature': signer.webhooks.generateTestHeaderString({
          payload,
          secret: process.env.STRIPE_WEBSOCKET_SECRET as string,
        }),
      },
    })
  }

  it('does not kick off compliance for a record filed but unpaid past the cutoff', async () => {
    const campaign = await seedCampaign(electionDateIn(CLOSED_DAYS_OUT))
    await seedRecord(campaign.id)
    const track = spyOnTrack()
    const queue = spyOnQueue()

    const res = await deliverProCheckout()

    expect(res.status).toBe(200)
    const after = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    expect(after.isPro).toBe(true)
    const record = await service.prisma.tcrCompliance.findUniqueOrThrow({
      where: { campaignId: campaign.id },
    })
    expect(record.kickoffSentAt).toBeNull()
    expect(queue).not.toHaveBeenCalled()
    expect(track).toHaveBeenCalledWith(
      service.user.id,
      EVENTS.Outreach.ComplianceSubmissionBlocked,
      expect.objectContaining({
        path: 'kickoff',
        days_to_election: expect.any(Number),
      }),
    )
  })
})

describe('stranded kickoff sweep', () => {
  it('skips records past the cutoff and still dispatches open ones', async () => {
    const closed = await seedCampaign(electionDateIn(CLOSED_DAYS_OUT), {
      isPro: true,
    })
    const open = await seedCampaign(electionDateIn(OPEN_DAYS_OUT), {
      isPro: true,
    })
    const createdAt = subMinutes(new Date(), 30)
    await seedRecord(closed.id, { createdAt })
    await seedRecord(open.id, { createdAt })
    vi.spyOn(
      service.app.get(WebsitesService),
      'getContentForCampaign',
    ).mockResolvedValue(publishableContent)
    const queue = spyOnQueue()

    await service.app
      .get(CampaignTcrComplianceService)
      .sweepStrandedAgenticKickoffs()

    expect(queue).toHaveBeenCalledTimes(1)
    expect(queue.mock.calls[0]?.[0]).toMatchObject({
      data: { campaignId: open.id },
    })
    const closedRecord = await service.prisma.tcrCompliance.findUniqueOrThrow({
      where: { campaignId: closed.id },
    })
    expect(closedRecord.kickoffSentAt).toBeNull()
  })
})

describe('SMS compliance window on reads', () => {
  it('returns the window on GET /v1/campaigns/mine', async () => {
    const campaign = await seedCampaign(electionDateIn(CLOSED_DAYS_OUT))

    const res = await service.client.get(
      '/v1/campaigns/mine',
      orgHeaders(campaign.slug),
    )

    expect(res.status).toBe(200)
    expect(res.data).toMatchObject({
      smsCompliance: 'closed',
      smsCutoffDate: electionDateIn(CLOSED_DAYS_OUT - 19),
      generalElectionDate: electionDateIn(CLOSED_DAYS_OUT),
    })
    expect(res.data).not.toHaveProperty('tcrCompliance')
  })

  it('returns not_applicable on compliance-state once the kickoff was sent', async () => {
    const campaign = await seedCampaign(electionDateIn(CLOSED_DAYS_OUT))
    await seedRecord(campaign.id, { kickoffSentAt: new Date() })

    const res = await service.client.get(
      '/v1/campaigns/tcr-compliance/mine/compliance-state',
      orgHeaders(campaign.slug),
    )

    expect(res.status).toBe(200)
    expect(res.data).toMatchObject({
      smsCompliance: 'not_applicable',
      generalElectionDate: electionDateIn(CLOSED_DAYS_OUT),
    })
  })

  it('returns closed on compliance-state for a record without a kickoff', async () => {
    const campaign = await seedCampaign(electionDateIn(CLOSED_DAYS_OUT))
    await seedRecord(campaign.id)

    const res = await service.client.get(
      '/v1/campaigns/tcr-compliance/mine/compliance-state',
      orgHeaders(campaign.slug),
    )

    expect(res.status).toBe(200)
    expect(res.data.smsCompliance).toBe('closed')
  })
})

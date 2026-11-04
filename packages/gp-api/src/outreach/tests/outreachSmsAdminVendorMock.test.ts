import { HttpStatus } from '@nestjs/common'
import { addDays, format } from 'date-fns'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { useAppEnvOverrides } from '@/shared/test-utils/appEnvOverrides'
import { PeerlyBaseConfig } from '@/vendors/peerly/config/peerlyBaseConfig'
import { SmsApprovalQueueResponseSchema } from '@goodparty_org/contracts'
import { OutreachStatus, OutreachType, UserRole } from '../../generated/prisma'

useAppEnvOverrides({ IS_NON_PROD_DEPLOY: true, VENDOR_MODE: 'mock' })

const service = useTestService()

// The real Peerly client, pointed at the test app's own Peerly mock: the
// test app listens on a random port while vendorBaseUrl points at
// localhost:3000, so the port is the one thing substituted.
describe('GET /v1/outreach/admin/sms/queue in vendor-mock mode', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the live job from the Peerly mock', async () => {
    vi.spyOn(PeerlyBaseConfig.prototype, 'baseUrl', 'get').mockReturnValue(
      `${String(service.client.defaults.baseURL)}/v1/vendor-mocks/peerly`,
    )
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { roles: [UserRole.admin] },
    })
    const orgSlug = 'campaign-vendor-mock-queue'
    await service.prisma.organization.create({
      data: { slug: orgSlug, ownerId: service.user.id },
    })
    const campaign = await service.prisma.campaign.create({
      data: {
        organizationSlug: orgSlug,
        userId: service.user.id,
        slug: 'vendor-mock-queue',
        details: { state: 'TX' },
      },
    })
    const job = await service.client.post('/v1/vendor-mocks/peerly/1to1/jobs', {
      name: 'vendor-mock-queue-job',
    })
    expect(job.status).toBe(HttpStatus.CREATED)
    const sendDate = addDays(new Date(), 7)
    const row = await service.prisma.outreach.create({
      data: {
        campaignId: campaign.id,
        outreachType: OutreachType.p2p,
        name: 'Likely voters — SMS',
        status: OutreachStatus.pending,
        projectId: job.data.id,
        identityId: 'identity-1',
        script: 'Hello {first_name}',
        date: sendDate,
        scheduledLocalDate: format(sendDate, 'yyyy-MM-dd'),
        stripeCheckoutSessionId: 'cs_test_seed',
      },
    })

    const res = await service.client.get('/v1/outreach/admin/sms/queue')

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.items).toHaveLength(1)
    expect(res.data.items[0].id).toBe(row.id)
    expect(res.data.items[0].job).toEqual({
      status: 'pending',
      deliverabilityCheckError: null,
      hasCanvassersScheduled: false,
      peerlyApproved: null,
      leadsRemaining: 0,
    })
    expect(SmsApprovalQueueResponseSchema.safeParse(res.data).success).toBe(
      true,
    )
  })
})

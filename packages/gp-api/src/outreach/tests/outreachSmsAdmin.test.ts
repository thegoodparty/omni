import { HttpStatus } from '@nestjs/common'
import { addDays, format, subDays } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { PeerlyP2pJobService } from '@/vendors/peerly/services/peerlyP2pJob.service'
import { SlackService } from '@/vendors/slack/services/slack.service'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import { AnalyticsService } from '@/analytics/analytics.service'
import { S3Service } from 'src/vendors/aws/services/s3.service'
import { HubspotService } from 'src/crm/hubspot.service'
import { Client } from '@hubspot/api-client'
import { OutreachSmsAdminService } from '../services/outreachSmsAdmin.service'
import {
  OutreachStatus,
  OutreachType,
  P2pSmsSettleState,
  UserRole,
} from '../../generated/prisma'

const service = useTestService()

// Relative, not absolute: cancelOutreach 400s once the send time passes,
// so a pinned fixture date is a timebomb for the cancel tests (main went
// red 2026-09-10 when the original literal expired). One shared constant
// so the fixture and the approve assertion can't straddle midnight.
const SEND_DATE = addDays(new Date(), 7)
const SEND_LOCAL_DATE = format(SEND_DATE, 'yyyy-MM-dd')

const requestCanvassers = vi.fn()
const activateJob = vi.fn()
const updateJobSchedule = vi.fn()
const slackMessage = vi.fn()
const clearCanvassers = vi.fn()
const listAccountJobs = vi.fn()
const getJob = vi.fn()
const getJobDetailedStats = vi.fn()
const deleteJob = vi.fn()
const track = vi.fn()

let campaignId: number
let orgSlug: string

const liveJob = (id: string, approved = false) => ({
  id,
  status: 'active',
  deliverability_check_error: undefined,
  has_canvassers_scheduled: approved,
  canvassers_schedule: approved ? { approved: true } : undefined,
  leads_remaining: 1200,
})

// The queue's account-jobs and HubSpot-owner caches live on the service
// instance, which outlives a single test — one cache key for the whole
// account, so distinct-projectId isolation (the getDetail convention)
// can't help. TTL 0 disables them by default; tests exercising the cache
// stub a real TTL and end by invalidating (a mutation clears the maps).
beforeEach(() => {
  vi.stubEnv('QUEUE_JOBS_CACHE_TTL_MS', '0')
  vi.stubEnv('OWNER_CACHE_TTL_MS', '0')
  // A failed read caches on the failure cool-off, not the TTL — zero it
  // too, or one test's rejected account read serves the next test null.
  vi.stubEnv('DETAIL_FAILED_RETRY_COOLDOWN_MS', '0')
})
afterEach(() => {
  vi.unstubAllEnvs()
})

beforeEach(async () => {
  requestCanvassers.mockReset().mockResolvedValue(undefined)
  activateJob.mockReset().mockResolvedValue(undefined)
  updateJobSchedule.mockReset().mockResolvedValue(undefined)
  slackMessage.mockReset().mockResolvedValue(undefined)
  clearCanvassers.mockReset().mockResolvedValue(undefined)
  listAccountJobs.mockReset().mockResolvedValue([])
  getJob.mockReset().mockResolvedValue(liveJob('peerly-job-1'))
  deleteJob.mockReset().mockResolvedValue(undefined)
  getJobDetailedStats.mockReset().mockResolvedValue({
    sentTotal: 100,
    receivedTotal: 4,
    delivered: 90,
    deliveryFailed: 6,
    deliveryUnconfirmed: 4,
    totalCost: 3.5,
  })
  track.mockReset().mockResolvedValue(undefined)

  const peerly = service.app.get(PeerlyP2pJobService)
  vi.spyOn(peerly, 'requestCanvassers').mockImplementation(requestCanvassers)
  vi.spyOn(peerly, 'activateJob').mockImplementation(activateJob)
  vi.spyOn(peerly, 'updateJobSchedule').mockImplementation(updateJobSchedule)
  vi.spyOn(service.app.get(SlackService), 'message').mockImplementation(
    slackMessage,
  )
  vi.spyOn(peerly, 'clearCanvassers').mockImplementation(clearCanvassers)
  vi.spyOn(peerly, 'listAccountJobs').mockImplementation(listAccountJobs)
  vi.spyOn(peerly, 'getJob').mockImplementation(getJob)
  vi.spyOn(peerly, 'getJobDetailedStats').mockImplementation(
    getJobDetailedStats,
  )
  vi.spyOn(peerly, 'deleteJob').mockImplementation(deleteJob)
  vi.spyOn(service.app.get(AnalyticsService), 'track').mockImplementation(track)

  // AdminOrM2MGuard reads the session user's CURRENT roles.
  await service.prisma.user.update({
    where: { id: service.user.id },
    data: { roles: [UserRole.admin] },
  })

  campaignId = 995
  orgSlug = `campaign-${campaignId}`
  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id, positionId: 'pos-1' },
  })
  await service.prisma.campaign.create({
    data: {
      id: campaignId,
      organizationSlug: orgSlug,
      userId: service.user.id,
      slug: 'jane-doe-admin',
      details: { state: 'TX', zip: '78634' },
      data: {},
      aiContent: {},
    },
  })
  await service.prisma.tcrCompliance.create({
    data: {
      id: `tcr-admin-${campaignId}`,
      campaignId,
      email: 'jane@example.org',
      phone: '15551234567',
      ein: '84-3917265',
      postalAddress: '1 Main St, Austin, TX 78634',
      filingUrl: 'https://example.org/filing',
      websiteDomain: '',
      officeLevel: 'local',
      committeeName: 'Friends of Jane',
      candidateName: 'Jane Doe',
      peerlyIdentityId: 'identity-1',
    },
  })
})

const seedOutreach = (
  overrides: Partial<{
    status: OutreachStatus
    outreachType: OutreachType
    projectId: string | null
    identityId: string | null
    approvedAt: Date | null
    deniedAt: Date | null
    canvassRequestedAt: Date | null
    script: string
    stripeCheckoutSessionId: string | null
    freePurchaseSessionId: string | null
    date: Date
    scheduledLocalTime: string | null
  }> = {},
) =>
  service.prisma.outreach.create({
    data: {
      campaignId,
      outreachType: OutreachType.p2p,
      name: 'Likely voters — SMS',
      status: OutreachStatus.pending,
      projectId: 'peerly-job-1',
      identityId: 'identity-1',
      script:
        'Hello {first_name}, this is Jane, candidate for City Council. ' +
        'Vote!\n\nPaid for by Friends of Jane.\nReply STOP to opt out.',
      date: SEND_DATE,
      scheduledLocalDate: SEND_LOCAL_DATE,
      textCount: 1200,
      billableTextCount: 1200,
      // A row only reaches this console through a settled purchase, and
      // approve refuses one that carries neither funding marker.
      stripeCheckoutSessionId: 'cs_test_seed',
      ...overrides,
    },
  })

describe('CAS SMS console (gp-api admin surface)', () => {
  describe('GET /v1/outreach/admin/sms/queue', () => {
    it('lists scheduled sends with standards verdict and live job state', async () => {
      const row = await seedOutreach({ scheduledLocalTime: '18:00' })
      listAccountJobs.mockResolvedValue([liveJob('peerly-job-1')])

      const res = await service.client.get('/v1/outreach/admin/sms/queue')

      expect(res.status).toBe(HttpStatus.OK)
      expect(res.data.items).toHaveLength(1)
      const item = res.data.items[0]
      expect(item.id).toBe(row.id)
      expect(item.scheduledLocalTime).toBe('18:00')
      expect(item.approvalStatus).toBe('awaiting_review')
      expect(item.standards).toEqual({ passed: true, failures: [] })
      expect(item.job).toMatchObject({
        status: 'active',
        hasCanvassersScheduled: false,
      })
    })

    it('flags standards failures and survives a vendor read failure', async () => {
      await seedOutreach({
        script: 'vote for someone, no opt out line here',
      })
      listAccountJobs.mockRejectedValue(new Error('peerly down'))

      const res = await service.client.get('/v1/outreach/admin/sms/queue')

      expect(res.status).toBe(HttpStatus.OK)
      const item = res.data.items[0]
      expect(item.standards.passed).toBe(false)
      expect(item.standards.failures).toEqual(
        expect.arrayContaining([
          'opt_out_line',
          'first_name_token',
          'candidate_name',
          'paid_for_by',
        ]),
      )
      expect(item.job).toBeNull()
    })

    it('caches the one account-wide jobs read and busts it on a mutation', async () => {
      vi.stubEnv('QUEUE_JOBS_CACHE_TTL_MS', '60000')
      const row = await seedOutreach()
      listAccountJobs.mockResolvedValue([liveJob('peerly-job-1')])

      const first = await service.client.get('/v1/outreach/admin/sms/queue')
      expect(first.status).toBe(HttpStatus.OK)
      expect(first.data.items[0].job).toMatchObject({ status: 'active' })
      const second = await service.client.get('/v1/outreach/admin/sms/queue')
      expect(second.status).toBe(HttpStatus.OK)
      expect(second.data.items[0].job).toMatchObject({ status: 'active' })
      // A detail-then-back navigation inside the TTL pays no vendor read.
      expect(listAccountJobs).toHaveBeenCalledTimes(1)

      // Approve changes vendor state (booking + activation), so the next
      // queue view must read fresh instead of serving the cached answer.
      const approved = await service.client.post(
        `/v1/outreach/admin/sms/${row.id}/approve`,
        { approvedBy: 'cas@goodparty.org' },
      )
      expect(approved.status).toBe(HttpStatus.CREATED)
      const third = await service.client.get('/v1/outreach/admin/sms/queue')
      expect(third.status).toBe(HttpStatus.OK)
      expect(listAccountJobs).toHaveBeenCalledTimes(2)

      // Self-cleaning: cancel invalidates again, and a canceled-only queue
      // performs no read — nothing cached leaks into later tests.
      await service.client.post(`/v1/outreach/admin/sms/${row.id}/cancel`, {
        canceledBy: 'cas@goodparty.org',
      })
      const fourth = await service.client.get('/v1/outreach/admin/sms/queue')
      expect(fourth.status).toBe(HttpStatus.OK)
      expect(listAccountJobs).toHaveBeenCalledTimes(2)
    })

    it('excludes rows outside the review window', async () => {
      await seedOutreach({ status: OutreachStatus.completed })
      await seedOutreach({ projectId: null })
      await seedOutreach({ outreachType: OutreachType.text })
      // Pre-console backlog: stranded pending rows older than the cutoff.
      await seedOutreach({ date: new Date('2026-04-15T15:00:00Z') })
      await seedOutreach({ date: new Date('2026-06-01T23:59:00Z') })

      const res = await service.client.get('/v1/outreach/admin/sms/queue')

      expect(res.status).toBe(HttpStatus.OK)
      expect(res.data.items).toHaveLength(0)
    })

    it('keeps dateless and post-cutoff rows visible', async () => {
      const dateless = await service.prisma.outreach.create({
        data: {
          campaignId,
          outreachType: OutreachType.p2p,
          name: 'No date yet',
          status: OutreachStatus.pending,
          projectId: 'peerly-job-1',
          identityId: 'identity-1',
          script: 'Hello {first_name}',
          date: null,
        },
      })
      const recent = await seedOutreach()

      const res = await service.client.get('/v1/outreach/admin/sms/queue')

      expect(res.status).toBe(HttpStatus.OK)
      const ids = res.data.items.map((i: { id: number }) => i.id)
      expect(ids).toContain(dateless.id)
      expect(ids).toContain(recent.id)
    })

    it('lists a booked send whose day has passed as sent', async () => {
      const sent = await seedOutreach({
        status: OutreachStatus.completed,
        approvedAt: subDays(new Date(), 3),
        canvassRequestedAt: subDays(new Date(), 3),
        date: subDays(new Date(), 2),
      })
      // The sweep completes an unapproved row on its day like any other,
      // but nothing went out — it is not a sent campaign.
      await seedOutreach({
        status: OutreachStatus.completed,
        date: subDays(new Date(), 2),
      })
      // Booked and sent, but older than the Sent tab's lookback.
      await seedOutreach({
        status: OutreachStatus.completed,
        approvedAt: subDays(new Date(), 100),
        canvassRequestedAt: subDays(new Date(), 100),
        date: subDays(new Date(), 100),
      })
      listAccountJobs.mockResolvedValue([liveJob('peerly-job-1', true)])

      const res = await service.client.get('/v1/outreach/admin/sms/queue')

      expect(res.status).toBe(HttpStatus.OK)
      expect(res.data.items.map((i: { id: number }) => i.id)).toEqual([sent.id])
      expect(res.data.items[0].approvalStatus).toBe('sent')
    })

    it('keeps a send-day row the completion sweep moved to in_progress', async () => {
      // The hourly completion sweep ratchets pending -> in_progress at UTC
      // midnight of the Peerly start_date whether or not CAS approved, so
      // an unapproved same-day request must not vanish from the queue.
      const sendDay = await seedOutreach({ status: OutreachStatus.in_progress })
      listAccountJobs.mockResolvedValue([liveJob('peerly-job-1')])

      const res = await service.client.get('/v1/outreach/admin/sms/queue')

      expect(res.status).toBe(HttpStatus.OK)
      const item = res.data.items.find(
        (i: { id: number }) => i.id === sendDay.id,
      )
      expect(item).toBeDefined()
      expect(item.approvalStatus).toBe('awaiting_review')
      expect(item.job).toMatchObject({ status: 'active' })
    })

    it('is admin-gated', async () => {
      await service.prisma.user.update({
        where: { id: service.user.id },
        data: { roles: [UserRole.candidate] },
      })
      const res = await service.client.get('/v1/outreach/admin/sms/queue')
      expect(res.status).toBe(HttpStatus.FORBIDDEN)
    })
  })

  // The assigned-PA column is the campaign's HubSpot company owner. Mocked
  // at the HubSpot client boundary (not CrmCampaignsService) so the real
  // batching, merge-following and owner-name formatting run.
  describe('assigned PA (HubSpot company owner)', () => {
    type FakeCompany = { id: string; ownerId?: string; mergedIds?: string[] }
    type FakeOwner = { id: string; firstName?: string; lastName?: string }

    let companies: FakeCompany[]
    let owners: FakeOwner[]
    let ownerPageSize: number

    const findCompany = (id: string) =>
      companies.find((c) => c.id === id || c.mergedIds?.includes(id))

    // Like HubSpot: a merged-away id answers with the surviving record
    // (a different id), and an unknown id is simply absent (207).
    const fakeBatchRead = async ({ inputs }: { inputs: { id: string }[] }) => {
      const found = new Map<string, FakeCompany>()
      for (const { id } of inputs) {
        const company = findCompany(id)
        if (company) found.set(company.id, company)
      }
      return {
        status: 'COMPLETE',
        results: [...found.values()].map((c) => ({
          id: c.id,
          properties: {
            hubspot_owner_id: c.ownerId ?? null,
            hs_merged_object_ids: c.mergedIds?.join(';') ?? null,
          },
        })),
      }
    }
    const fakeGetCompany = async (id: string) => {
      const company = findCompany(id)
      if (!company) throw Object.assign(new Error('not found'), { code: 404 })
      return {
        id: company.id,
        properties: { hubspot_owner_id: company.ownerId ?? null },
      }
    }
    const fakeOwnersPage = async (
      _email: string | undefined,
      after: string | undefined,
    ) => {
      const start = after ? Number(after) : 0
      const end = start + ownerPageSize
      return {
        results: owners.slice(start, end),
        paging:
          end < owners.length ? { next: { after: String(end) } } : undefined,
      }
    }
    const fakeGetOwner = async (id: number) => {
      const owner = owners.find((o) => o.id === String(id))
      if (!owner) throw Object.assign(new Error('bad owner'), { code: 400 })
      return owner
    }

    const batchRead = vi.fn()
    const getCompany = vi.fn()
    const ownersGetPage = vi.fn()
    const ownerGetById = vi.fn()
    const rateLimited = () =>
      Object.assign(new Error('HTTP-Code: 429 Message: TEN_SECONDLY_ROLLING'), {
        code: 429,
      })

    let configuredSpy: { mockRestore: () => void }
    let clientSpy: { mockRestore: () => void }

    beforeEach(() => {
      companies = []
      owners = [
        { id: '501', firstName: 'Casey', lastName: 'Success' },
        { id: '502', firstName: 'Riley' },
        { id: '503', lastName: 'Morgan' },
      ]
      ownerPageSize = 500
      batchRead.mockReset().mockImplementation(fakeBatchRead)
      getCompany.mockReset().mockImplementation(fakeGetCompany)
      ownersGetPage.mockReset().mockImplementation(fakeOwnersPage)
      ownerGetById.mockReset().mockImplementation(fakeGetOwner)

      const hubspot = service.app.get(HubspotService)
      configuredSpy = vi
        .spyOn(hubspot, 'isConfigured', 'get')
        .mockReturnValue(true)
      clientSpy = vi.spyOn(hubspot, 'client', 'get').mockReturnValue({
        crm: {
          companies: {
            batchApi: { read: batchRead },
            basicApi: { getById: getCompany },
          },
          owners: {
            ownersApi: { getPage: ownersGetPage, getById: ownerGetById },
          },
        },
      } as unknown as Client)
    })
    afterEach(() => {
      configuredSpy.mockRestore()
      clientSpy.mockRestore()
    })

    const setHubspotId = (hubspotId: string) =>
      service.prisma.campaign.update({
        where: { id: campaignId },
        data: { data: { hubspotId } },
      })

    const queueOwner = async () => {
      const res = await service.client.get('/v1/outreach/admin/sms/queue')
      expect(res.status).toBe(HttpStatus.OK)
      return res.data.items[0].assignedPa
    }

    // ENG-11319: every 429 used to cache as "unassigned" for the full
    // owner TTL, so a rate-limited cold load blanked the column for 10 min.
    it('renders unassigned when the HubSpot owner read fails, and retries it on the failed cool-off', async () => {
      vi.stubEnv('OWNER_CACHE_TTL_MS', '600000')
      companies = [{ id: '7100001', ownerId: '501' }]
      await setHubspotId('7100001')
      await seedOutreach()
      batchRead.mockRejectedValueOnce(rateLimited())
      getCompany.mockRejectedValueOnce(rateLimited())

      expect(await queueOwner()).toBeNull()
      expect(await queueOwner()).toBe('Casey Success')
    })

    it('caches the HubSpot owner per company across queue views', async () => {
      vi.stubEnv('OWNER_CACHE_TTL_MS', '60000')
      companies = [{ id: '7100010', ownerId: '501' }]
      await setHubspotId('7100010')
      await seedOutreach()

      expect(await queueOwner()).toBe('Casey Success')
      expect(await queueOwner()).toBe('Casey Success')
      expect(batchRead).toHaveBeenCalledTimes(1)
      expect(ownersGetPage).toHaveBeenCalledTimes(1)
    })

    // Campaigns 4000+ each with their own company and queue row; the
    // owners rotate so every display-name shape is exercised.
    const seedCompanies = async (count: number, hubspotBase: number) => {
      const campaignIds = Array.from({ length: count }, (_, i) => 4000 + i)
      const hubspotIdFor = (id: number) => String(hubspotBase + id)
      await service.prisma.organization.createMany({
        data: campaignIds.map((id) => ({
          slug: `campaign-${id}`,
          ownerId: service.user.id,
        })),
      })
      await service.prisma.campaign.createMany({
        data: campaignIds.map((id) => ({
          id,
          organizationSlug: `campaign-${id}`,
          userId: service.user.id,
          slug: `owner-batch-${id}`,
          details: {},
          data: { hubspotId: hubspotIdFor(id) },
          aiContent: {},
        })),
      })
      await service.prisma.outreach.createMany({
        data: campaignIds.map((id) => ({
          campaignId: id,
          outreachType: OutreachType.p2p,
          name: 'Likely voters — SMS',
          status: OutreachStatus.pending,
          projectId: `peerly-job-${id}`,
          identityId: 'identity-1',
          script: 'Hello {first_name}',
          date: SEND_DATE,
          scheduledLocalDate: SEND_LOCAL_DATE,
          textCount: 1200,
          billableTextCount: 1200,
          stripeCheckoutSessionId: 'cs_test_seed',
        })),
      })
      const ownerFor = (id: number) => owners[id % owners.length]!
      companies.push(
        ...campaignIds.map((id) => ({
          id: hubspotIdFor(id),
          ownerId: ownerFor(id).id,
        })),
      )
      const expectedName = (id: number) =>
        ({ '501': 'Casey Success', '502': 'Riley', '503': 'Morgan' })[
          ownerFor(id).id
        ]
      return { campaignIds, hubspotIdFor, expectedName }
    }

    const queueItems = async () => {
      const res = await service.client.get('/v1/outreach/admin/sms/queue')
      expect(res.status).toBe(HttpStatus.OK)
      return new Map<number, string | null>(
        res.data.items.map(
          (item: { campaignId: number; assignedPa: string | null }) => [
            item.campaignId,
            item.assignedPa,
          ],
        ),
      )
    }

    const batchInputIds = (call: number) =>
      batchRead.mock.calls[call]![0].inputs.map(({ id }: { id: string }) => id)

    it('reads 101 companies in batches of at most 100 plus one directory read', async () => {
      const { campaignIds, hubspotIdFor, expectedName } = await seedCompanies(
        101,
        7300000,
      )

      const assigned = await queueItems()

      for (const id of campaignIds) {
        expect(assigned.get(id)).toBe(expectedName(id))
      }
      expect(batchRead).toHaveBeenCalledTimes(2)
      const sent = [...batchInputIds(0), ...batchInputIds(1)]
      expect(batchInputIds(0).length).toBeLessThanOrEqual(100)
      expect(batchInputIds(1).length).toBeLessThanOrEqual(100)
      expect(new Set(sent)).toEqual(new Set(campaignIds.map(hubspotIdFor)))
      expect(sent).toHaveLength(101)
      expect(ownersGetPage).toHaveBeenCalledTimes(1)
      expect(getCompany).not.toHaveBeenCalled()
      expect(ownerGetById).not.toHaveBeenCalled()
    })

    it('renders only the failed batch unassigned and retries just those ids', async () => {
      vi.stubEnv('OWNER_CACHE_TTL_MS', '600000')
      const { campaignIds, hubspotIdFor, expectedName } = await seedCompanies(
        101,
        7400000,
      )
      batchRead.mockRejectedValueOnce(rateLimited())

      const first = await queueItems()

      const failedIds = new Set(batchInputIds(0))
      for (const id of campaignIds) {
        expect(first.get(id)).toBe(
          failedIds.has(hubspotIdFor(id)) ? null : expectedName(id),
        )
      }

      const second = await queueItems()

      for (const id of campaignIds) {
        expect(second.get(id)).toBe(expectedName(id))
      }
      expect(batchRead).toHaveBeenCalledTimes(3)
      expect(new Set(batchInputIds(2))).toEqual(failedIds)
    })

    it('follows a merged company to the surviving record', async () => {
      companies = [
        { id: '7100099', ownerId: '502', mergedIds: ['7100020', '7100021'] },
      ]
      await setHubspotId('7100020')
      await seedOutreach()

      expect(await queueOwner()).toBe('Riley')
    })

    it('caches a company HubSpot no longer has as unassigned', async () => {
      vi.stubEnv('OWNER_CACHE_TTL_MS', '60000')
      await setHubspotId('7100030')
      await seedOutreach()

      expect(await queueOwner()).toBeNull()
      expect(await queueOwner()).toBeNull()
      expect(batchRead).toHaveBeenCalledTimes(1)
    })

    it('renders unassigned for a company with no owner or an unknown owner', async () => {
      companies = [{ id: '7100040' }, { id: '7100041', ownerId: '999' }]
      await setHubspotId('7100040')
      await seedOutreach()

      expect(await queueOwner()).toBeNull()

      await setHubspotId('7100041')
      expect(await queueOwner()).toBeNull()
      expect(ownerGetById).not.toHaveBeenCalled()
    })

    it('never sends a non-numeric HubSpot id to the batch read', async () => {
      await setHubspotId('hs-co-legacy')
      await seedOutreach()

      expect(await queueOwner()).toBeNull()
      expect(batchRead).not.toHaveBeenCalled()
    })

    it('pages through the whole owner directory', async () => {
      ownerPageSize = 1
      companies = [{ id: '7100050', ownerId: '503' }]
      await setHubspotId('7100050')
      await seedOutreach()

      expect(await queueOwner()).toBe('Morgan')
      expect(ownersGetPage).toHaveBeenCalledTimes(3)
      expect(ownersGetPage).toHaveBeenLastCalledWith(undefined, '2', 500)
    })

    it('retries on the failed cool-off when the owner directory read fails', async () => {
      vi.stubEnv('OWNER_CACHE_TTL_MS', '600000')
      companies = [{ id: '7100060', ownerId: '501' }]
      await setHubspotId('7100060')
      await seedOutreach()
      ownersGetPage.mockRejectedValueOnce(rateLimited())

      expect(await queueOwner()).toBeNull()
      expect(await queueOwner()).toBe('Casey Success')
    })

    it('shares one batch between concurrent queue views', async () => {
      vi.stubEnv('OWNER_CACHE_TTL_MS', '60000')
      companies = [{ id: '7100070', ownerId: '501' }]
      await setHubspotId('7100070')
      await seedOutreach()
      let releaseRead!: () => void
      batchRead.mockImplementationOnce(async (input) => {
        await new Promise<void>((resolve) => {
          releaseRead = resolve
        })
        return fakeBatchRead(input)
      })

      const firstView = service.client.get('/v1/outreach/admin/sms/queue')
      const secondView = service.client.get('/v1/outreach/admin/sms/queue')
      await vi.waitFor(() => expect(batchRead).toHaveBeenCalledTimes(1))
      // Give the second view time to reach the owner read while the
      // first view's batch is still outstanding.
      await new Promise<void>((resolve) => setTimeout(resolve, 100))
      releaseRead()
      const [first, second] = await Promise.all([firstView, secondView])

      expect(first.data.items[0].assignedPa).toBe('Casey Success')
      expect(second.data.items[0].assignedPa).toBe('Casey Success')
      expect(batchRead).toHaveBeenCalledTimes(1)
    })

    it('shows the owner on the detail view', async () => {
      companies = [{ id: '7100080', ownerId: '501' }]
      await setHubspotId('7100080')
      const row = await seedOutreach({ projectId: 'peerly-job-detail-owner' })

      const res = await service.client.get(`/v1/outreach/admin/sms/${row.id}`)

      expect(res.status).toBe(HttpStatus.OK)
      expect(res.data.item.assignedPa).toBe('Casey Success')
      expect(batchRead).toHaveBeenCalledTimes(1)
    })

    it('reads nothing from HubSpot when it is not configured', async () => {
      vi.spyOn(
        service.app.get(HubspotService),
        'isConfigured',
        'get',
      ).mockReturnValue(false)
      companies = [{ id: '7100090', ownerId: '501' }]
      await setHubspotId('7100090')
      await seedOutreach()

      expect(await queueOwner()).toBeNull()
      expect(batchRead).not.toHaveBeenCalled()
      expect(ownersGetPage).not.toHaveBeenCalled()
      expect(getCompany).not.toHaveBeenCalled()
      expect(ownerGetById).not.toHaveBeenCalled()
    })
  })

  describe('POST /v1/outreach/admin/sms/:id/approve', () => {
    it('requests canvassers, stamps the row, and tracks', async () => {
      const row = await seedOutreach()

      const res = await service.client.post(
        `/v1/outreach/admin/sms/${row.id}/approve`,
        { approvedBy: 'cas@goodparty.org' },
      )

      expect(res.status).toBe(HttpStatus.CREATED)
      expect(requestCanvassers).toHaveBeenCalledWith('peerly-job-1', {
        date: SEND_LOCAL_DATE,
        startTime: '09:00',
        state: null,
      })
      expect(res.data.approvalStatus).toBe('canvass_requested')
      const updated = await service.prisma.outreach.findFirstOrThrow({
        where: { id: row.id },
      })
      expect(updated.approvedBy).toBe('cas@goodparty.org')
      expect(updated.approvedAt).not.toBeNull()
      expect(updated.canvassRequestedAt).not.toBeNull()
      expect(activateJob).toHaveBeenCalledWith('peerly-job-1', null)
      // The approval notice: request-shaped blocks under the approved
      // header, to the CAS channel.
      expect(slackMessage).toHaveBeenCalledTimes(1)
      const blob = JSON.stringify(slackMessage.mock.calls[0])
      expect(blob).toContain('P2P Campaign Approved to Send')
      expect(blob).toContain('peerly-job-1')
      expect(track).toHaveBeenCalledWith(
        service.user.id,
        'Voter Outreach - Campaign Approved',
        { channel: 'sms', medium: 'text' },
      )
    })

    it('opens the vendor window at the stored wall-clock send time', async () => {
      const row = await seedOutreach({ scheduledLocalTime: '18:00' })

      const res = await service.client.post(
        `/v1/outreach/admin/sms/${row.id}/approve`,
        { approvedBy: 'cas@goodparty.org' },
      )

      expect(res.status).toBe(HttpStatus.CREATED)
      expect(requestCanvassers).toHaveBeenCalledWith('peerly-job-1', {
        date: SEND_LOCAL_DATE,
        startTime: '18:00',
        state: null,
      })
      // Activation carries the same window so a job whose schedule was
      // minted before the send time was honored gets realigned.
      expect(activateJob).toHaveBeenCalledWith('peerly-job-1', {
        campaignId,
        date: SEND_LOCAL_DATE,
        startTime: '18:00',
        state: null,
      })
    })

    it("threads the row's state into the booking and the activation window", async () => {
      const row = await seedOutreach({ scheduledLocalTime: '18:00' })
      await service.prisma.outreach.update({
        where: { id: row.id },
        data: { didState: 'CA' },
      })

      const res = await service.client.post(
        `/v1/outreach/admin/sms/${row.id}/approve`,
        { approvedBy: 'cas@goodparty.org' },
      )

      expect(res.status).toBe(HttpStatus.CREATED)
      expect(requestCanvassers).toHaveBeenCalledWith('peerly-job-1', {
        date: SEND_LOCAL_DATE,
        startTime: '18:00',
        state: 'CA',
      })
      expect(activateJob).toHaveBeenCalledWith('peerly-job-1', {
        campaignId,
        date: SEND_LOCAL_DATE,
        startTime: '18:00',
        state: 'CA',
      })
    })

    it.each([
      ['21:30', '20:00'],
      ['08:00', '09:00'],
      // Malformed minutes never reach Peerly — the clamp's format guard
      // drops the value to the floor rather than booking '19:99:00'.
      ['19:99', '09:00'],
    ])(
      'clamps a stored %s start into the bookable window as %s',
      async (stored, booked) => {
        const row = await seedOutreach({ scheduledLocalTime: stored })

        const res = await service.client.post(
          `/v1/outreach/admin/sms/${row.id}/approve`,
          { approvedBy: 'cas@goodparty.org' },
        )

        expect(res.status).toBe(HttpStatus.CREATED)
        expect(requestCanvassers).toHaveBeenCalledWith('peerly-job-1', {
          date: SEND_LOCAL_DATE,
          startTime: booked,
          state: null,
        })
      },
    )

    it('keeps the approval when the Slack notice fails', async () => {
      slackMessage.mockRejectedValue(new Error('slack down'))
      const row = await seedOutreach()

      const res = await service.client.post(
        `/v1/outreach/admin/sms/${row.id}/approve`,
        { approvedBy: 'cas@goodparty.org' },
      )

      expect(res.status).toBe(HttpStatus.CREATED)
      const updated = await service.prisma.outreach.findFirstOrThrow({
        where: { id: row.id },
      })
      expect(updated.canvassRequestedAt).not.toBeNull()
    })

    it('keeps the booking when vendor activation fails', async () => {
      activateJob.mockRejectedValue(new Error('cannot activate'))
      const row = await seedOutreach()

      const res = await service.client.post(
        `/v1/outreach/admin/sms/${row.id}/approve`,
        { approvedBy: 'cas@goodparty.org' },
      )

      expect(res.status).toBe(HttpStatus.CREATED)
      const updated = await service.prisma.outreach.findFirstOrThrow({
        where: { id: row.id },
      })
      expect(updated.approvedAt).not.toBeNull()
      expect(updated.canvassRequestedAt).not.toBeNull()
    })

    it('reverts the claim when the vendor call fails', async () => {
      requestCanvassers.mockRejectedValue(new Error('peerly down'))
      const row = await seedOutreach()

      const res = await service.client.post(
        `/v1/outreach/admin/sms/${row.id}/approve`,
        { approvedBy: 'cas@goodparty.org' },
      )

      expect(res.status).toBeGreaterThanOrEqual(500)
      const unchanged = await service.prisma.outreach.findFirstOrThrow({
        where: { id: row.id },
      })
      expect(unchanged.approvedAt).toBeNull()
      expect(unchanged.canvassRequestedAt).toBeNull()
    })

    it('approves a send-day row already ratcheted to in_progress', async () => {
      const row = await seedOutreach({ status: OutreachStatus.in_progress })

      const res = await service.client.post(
        `/v1/outreach/admin/sms/${row.id}/approve`,
        { approvedBy: 'cas@goodparty.org' },
      )

      expect(res.status).toBe(HttpStatus.CREATED)
      expect(requestCanvassers).toHaveBeenCalledWith('peerly-job-1', {
        date: SEND_LOCAL_DATE,
        startTime: '09:00',
        state: null,
      })
      const updated = await service.prisma.outreach.findFirstOrThrow({
        where: { id: row.id },
      })
      expect(updated.approvedAt).not.toBeNull()
      expect(updated.canvassRequestedAt).not.toBeNull()
    })

    it('400s approving a completed row', async () => {
      const row = await seedOutreach({ status: OutreachStatus.completed })
      const res = await service.client.post(
        `/v1/outreach/admin/sms/${row.id}/approve`,
        { approvedBy: 'cas@goodparty.org' },
      )
      expect(res.status).toBe(HttpStatus.BAD_REQUEST)
      expect(requestCanvassers).not.toHaveBeenCalled()
    })

    it('400s a row carrying no record of a completed purchase', async () => {
      const row = await seedOutreach({ stripeCheckoutSessionId: null })

      const res = await service.client.post(
        `/v1/outreach/admin/sms/${row.id}/approve`,
        { approvedBy: 'cas@goodparty.org' },
      )

      expect(res.status).toBe(HttpStatus.BAD_REQUEST)
      expect(JSON.stringify(res.data)).toContain('no completed purchase')
      expect(requestCanvassers).not.toHaveBeenCalled()
      const untouched = await service.prisma.outreach.findFirstOrThrow({
        where: { id: row.id },
      })
      expect(untouched.approvedAt).toBeNull()
    })

    it('approves a send the free-texts offer covered', async () => {
      const row = await seedOutreach({
        stripeCheckoutSessionId: null,
        freePurchaseSessionId: 'free_confirmed_1700000000000',
      })

      const res = await service.client.post(
        `/v1/outreach/admin/sms/${row.id}/approve`,
        { approvedBy: 'cas@goodparty.org' },
      )

      expect(res.status).toBe(HttpStatus.CREATED)
      expect(requestCanvassers).toHaveBeenCalledTimes(1)
      const updated = await service.prisma.outreach.findFirstOrThrow({
        where: { id: row.id },
      })
      expect(updated.approvedAt).not.toBeNull()
      expect(updated.canvassRequestedAt).not.toBeNull()
    })

    it('409s a second approve', async () => {
      const row = await seedOutreach()
      await service.client.post(`/v1/outreach/admin/sms/${row.id}/approve`, {
        approvedBy: 'cas@goodparty.org',
      })
      const again = await service.client.post(
        `/v1/outreach/admin/sms/${row.id}/approve`,
        { approvedBy: 'other@goodparty.org' },
      )
      expect(again.status).toBe(HttpStatus.CONFLICT)
      expect(requestCanvassers).toHaveBeenCalledTimes(1)
    })

    // Win SMS hold billing (managed flag win_sms_hold_billing): a paid send is
    // funded by a manual-capture hold that is only money once CAPTURED. The
    // funding marker is stamped at authorization, so the approve/send gate
    // reads the committed `captured` state on the OutreachP2pSms satellite
    // instead — no uncaptured hold can book canvassers. The satellite read is
    // SATELLITE-gated, not flag-gated: a row with a satellite is held to
    // `captured` regardless of the flag, and a row with no satellite stays on
    // the funding-marker gate.
    describe('hold-billing approve gate', () => {
      const seedSatellite = (
        outreachId: number,
        settleState: P2pSmsSettleState,
      ) =>
        service.prisma.outreachP2pSms.create({
          data: { outreachId, settleState },
        })

      it('approves a hold-model row once it is captured', async () => {
        const row = await seedOutreach()
        await seedSatellite(row.id, P2pSmsSettleState.captured)

        const res = await service.client.post(
          `/v1/outreach/admin/sms/${row.id}/approve`,
          { approvedBy: 'cas@goodparty.org' },
        )

        expect(res.status).toBe(HttpStatus.CREATED)
        expect(requestCanvassers).toHaveBeenCalledTimes(1)
        const updated = await service.prisma.outreach.findFirstOrThrow({
          where: { id: row.id },
        })
        expect(updated.canvassRequestedAt).not.toBeNull()
      })

      it('blocks a hold still being captured and books nothing', async () => {
        const row = await seedOutreach()
        await seedSatellite(row.id, P2pSmsSettleState.capturing)

        const res = await service.client.post(
          `/v1/outreach/admin/sms/${row.id}/approve`,
          { approvedBy: 'cas@goodparty.org' },
        )

        expect(res.status).toBe(HttpStatus.BAD_REQUEST)
        expect(JSON.stringify(res.data)).toContain('still being captured')
        expect(requestCanvassers).not.toHaveBeenCalled()
        const untouched = await service.prisma.outreach.findFirstOrThrow({
          where: { id: row.id },
        })
        expect(untouched.approvedAt).toBeNull()
        expect(untouched.canvassRequestedAt).toBeNull()
      })

      it('blocks an authorized-but-uncaptured hold and books nothing', async () => {
        const row = await seedOutreach()
        await seedSatellite(row.id, P2pSmsSettleState.authorized)

        const res = await service.client.post(
          `/v1/outreach/admin/sms/${row.id}/approve`,
          { approvedBy: 'cas@goodparty.org' },
        )

        expect(res.status).toBe(HttpStatus.BAD_REQUEST)
        expect(JSON.stringify(res.data)).toContain('has not been captured')
        expect(requestCanvassers).not.toHaveBeenCalled()
        const untouched = await service.prisma.outreach.findFirstOrThrow({
          where: { id: row.id },
        })
        expect(untouched.approvedAt).toBeNull()
      })

      it('blocks a terminal non-send hold (voided)', async () => {
        const row = await seedOutreach()
        await seedSatellite(row.id, P2pSmsSettleState.voided)

        const res = await service.client.post(
          `/v1/outreach/admin/sms/${row.id}/approve`,
          { approvedBy: 'cas@goodparty.org' },
        )

        expect(res.status).toBe(HttpStatus.BAD_REQUEST)
        expect(JSON.stringify(res.data)).toContain('did not complete')
        expect(requestCanvassers).not.toHaveBeenCalled()
      })

      it('blocks an uncaptured satellite even with the flag OFF (rollback hole)', async () => {
        // The kill-switch-as-free-send hazard: the hold was placed with the
        // flag ON (satellite seeded, stripeCheckoutSessionId stamped at
        // authorization), then the flag was flipped OFF. A flag-gated read
        // would skip the satellite, let the funding marker pass, and send an
        // uncaptured hold for free. The satellite-gated read blocks it.
        const row = await seedOutreach()
        await seedSatellite(row.id, P2pSmsSettleState.authorized)

        const res = await service.client.post(
          `/v1/outreach/admin/sms/${row.id}/approve`,
          { approvedBy: 'cas@goodparty.org' },
        )

        expect(res.status).toBe(HttpStatus.BAD_REQUEST)
        expect(JSON.stringify(res.data)).toContain('has not been captured')
        expect(requestCanvassers).not.toHaveBeenCalled()
        const untouched = await service.prisma.outreach.findFirstOrThrow({
          where: { id: row.id },
        })
        expect(untouched.approvedAt).toBeNull()
      })

      it('approves a captured satellite with the flag OFF (rollback, already settled)', async () => {
        // A hold captured before the rollback is real money committed — it must
        // still be approvable with the flag off.
        const row = await seedOutreach()
        await seedSatellite(row.id, P2pSmsSettleState.captured)

        const res = await service.client.post(
          `/v1/outreach/admin/sms/${row.id}/approve`,
          { approvedBy: 'cas@goodparty.org' },
        )

        expect(res.status).toBe(HttpStatus.CREATED)
        expect(requestCanvassers).toHaveBeenCalledTimes(1)
      })

      it('keeps the funding-marker gate for a non-hold row (no satellite) with the flag off', async () => {
        // The whole default population: no satellite, flag off — byte-for-byte
        // the pre-existing funding-marker behavior.
        const row = await seedOutreach()

        const res = await service.client.post(
          `/v1/outreach/admin/sms/${row.id}/approve`,
          { approvedBy: 'cas@goodparty.org' },
        )

        expect(res.status).toBe(HttpStatus.CREATED)
        expect(requestCanvassers).toHaveBeenCalledTimes(1)
      })

      it('keeps the funding-marker gate for a non-hold row (no satellite) with the flag on', async () => {
        // A free/forgiven send: no satellite, funded by the free marker.
        const row = await seedOutreach({
          stripeCheckoutSessionId: null,
          freePurchaseSessionId: 'free_confirmed_1700000000000',
        })

        const res = await service.client.post(
          `/v1/outreach/admin/sms/${row.id}/approve`,
          { approvedBy: 'cas@goodparty.org' },
        )

        expect(res.status).toBe(HttpStatus.CREATED)
        expect(requestCanvassers).toHaveBeenCalledTimes(1)
      })

      it('still refuses a non-hold row with no funding marker when the flag is on', async () => {
        const row = await seedOutreach({ stripeCheckoutSessionId: null })

        const res = await service.client.post(
          `/v1/outreach/admin/sms/${row.id}/approve`,
          { approvedBy: 'cas@goodparty.org' },
        )

        expect(res.status).toBe(HttpStatus.BAD_REQUEST)
        expect(JSON.stringify(res.data)).toContain('no completed purchase')
        expect(requestCanvassers).not.toHaveBeenCalled()
      })
    })
  })

  describe('POST /v1/outreach/admin/sms/:id/cancel', () => {
    it('cancels with staff attribution and keeps the row visible', async () => {
      const row = await seedOutreach({ stripeCheckoutSessionId: null })

      const res = await service.client.post(
        `/v1/outreach/admin/sms/${row.id}/cancel`,
        { canceledBy: 'cas@goodparty.org' },
      )

      expect(res.status).toBe(HttpStatus.CREATED)
      expect(res.data.approvalStatus).toBe('canceled')
      expect(res.data.canceledBy).toBe('cas@goodparty.org')
      expect(res.data.canceledByAdmin).toBe(true)
      expect(deleteJob).toHaveBeenCalledWith('peerly-job-1')
      const blob = JSON.stringify(slackMessage.mock.calls)
      expect(blob).toContain('P2P Campaign Canceled (by staff)')

      const queue = await service.client.get('/v1/outreach/admin/sms/queue')
      const item = queue.data.items.find((i: { id: number }) => i.id === row.id)
      expect(item.approvalStatus).toBe('canceled')
      // The canceled row's vendor job is gone — no live read attempted.
      expect(listAccountJobs).not.toHaveBeenCalled()

      const detail = await service.client.get(
        `/v1/outreach/admin/sms/${row.id}`,
      )
      expect(detail.status).toBe(HttpStatus.OK)
      expect(detail.data.item.approvalStatus).toBe('canceled')
      expect(detail.data.stats).toBeNull()
      expect(getJob).not.toHaveBeenCalled()
      expect(getJobDetailedStats).not.toHaveBeenCalled()
    })

    it('cancels an unbooked row whose send time has passed', async () => {
      // The QA-stuck shape (2026-09-10, prod outreach 81412): never
      // approved, so nothing was ever booked to send, but the send date
      // passed — the row must still move out of Awaiting Review.
      const row = await seedOutreach({
        stripeCheckoutSessionId: null,
        date: subDays(new Date(), 1),
      })

      const res = await service.client.post(
        `/v1/outreach/admin/sms/${row.id}/cancel`,
        { canceledBy: 'cas@goodparty.org' },
      )

      expect(res.status).toBe(HttpStatus.CREATED)
      expect(res.data.approvalStatus).toBe('canceled')
      expect(deleteJob).toHaveBeenCalledWith('peerly-job-1')

      const queue = await service.client.get('/v1/outreach/admin/sms/queue')
      const item = queue.data.items.find((i: { id: number }) => i.id === row.id)
      expect(item.approvalStatus).toBe('canceled')
    })

    it('cancels an unbooked row the sweep moved to in_progress on its send day', async () => {
      // Prod outreach 85286 (2026-10-15): the completion sweep ratchets a
      // never-approved row to in_progress when its send day begins, and the
      // console's cancel 400'd on it.
      const row = await seedOutreach({
        stripeCheckoutSessionId: null,
        status: OutreachStatus.in_progress,
        date: subDays(new Date(), 1),
      })

      const res = await service.client.post(
        `/v1/outreach/admin/sms/${row.id}/cancel`,
        { canceledBy: 'cas@goodparty.org' },
      )

      expect(res.status).toBe(HttpStatus.CREATED)
      expect(res.data.approvalStatus).toBe('canceled')
      expect(res.data.canceledByAdmin).toBe(true)
      expect(deleteJob).toHaveBeenCalledWith('peerly-job-1')
    })

    it('cancels a booked send past its send time and refunds it', async () => {
      // Staff unbook canvassers through this console, not Peerly, so the
      // candidate's send-time refusal does not apply to them; the console
      // warns instead.
      const stripe = service.app.get(StripeService)
      const retrieveSession = vi
        .spyOn(stripe, 'retrieveCheckoutSession')
        .mockResolvedValue({
          payment_intent: 'pi_booked_1',
        } as Awaited<ReturnType<StripeService['retrieveCheckoutSession']>>)
      const refund = vi
        .spyOn(stripe, 'refundPaymentIntent')
        .mockResolvedValue(
          {} as Awaited<ReturnType<StripeService['refundPaymentIntent']>>,
        )
      const row = await seedOutreach({
        status: OutreachStatus.in_progress,
        date: subDays(new Date(), 1),
        approvedAt: new Date(),
        canvassRequestedAt: new Date(),
      })

      const res = await service.client.post(
        `/v1/outreach/admin/sms/${row.id}/cancel`,
        { canceledBy: 'cas@goodparty.org' },
      )

      expect(res.status).toBe(HttpStatus.CREATED)
      expect(res.data.approvalStatus).toBe('canceled')
      expect(res.data.canceledByAdmin).toBe(true)
      expect(deleteJob).toHaveBeenCalledWith('peerly-job-1')
      expect(retrieveSession).toHaveBeenCalledWith('cs_test_seed')
      expect(refund).toHaveBeenCalledWith(
        'pi_booked_1',
        `outreach-cancel-${row.id}`,
      )
      // No live booking read gates a staff cancel.
      expect(getJob).not.toHaveBeenCalled()
    })

    it('still refuses a completed (sent) row', async () => {
      const row = await seedOutreach({
        stripeCheckoutSessionId: null,
        status: OutreachStatus.completed,
        date: subDays(new Date(), 1),
        canvassRequestedAt: new Date(),
      })

      const res = await service.client.post(
        `/v1/outreach/admin/sms/${row.id}/cancel`,
        { canceledBy: 'cas@goodparty.org' },
      )

      expect(res.status).toBe(HttpStatus.BAD_REQUEST)
      expect(deleteJob).not.toHaveBeenCalled()
      const unchanged = await service.prisma.outreach.findFirstOrThrow({
        where: { id: row.id },
      })
      expect(unchanged.status).toBe(OutreachStatus.completed)
    })

    it('refuses a second cancel via the idempotent early-return', async () => {
      const row = await seedOutreach({ stripeCheckoutSessionId: null })
      await service.client.post(`/v1/outreach/admin/sms/${row.id}/cancel`, {
        canceledBy: 'cas@goodparty.org',
      })
      deleteJob.mockClear()
      const again = await service.client.post(
        `/v1/outreach/admin/sms/${row.id}/cancel`,
        { canceledBy: 'other@goodparty.org' },
      )
      expect(again.status).toBe(HttpStatus.CREATED)
      expect(deleteJob).not.toHaveBeenCalled()
      const unchanged = await service.prisma.outreach.findFirstOrThrow({
        where: { id: row.id },
      })
      expect(unchanged.canceledBy).toBe('cas@goodparty.org')
    })
  })

  describe('PATCH on a canceled row', () => {
    it('400s before any vendor write', async () => {
      const peerly = service.app.get(PeerlyP2pJobService)
      const updateJob = vi
        .spyOn(peerly, 'updatePeerlyP2pJob')
        .mockResolvedValue(undefined)
      const row = await seedOutreach({ stripeCheckoutSessionId: null })
      await service.client.post(`/v1/outreach/admin/sms/${row.id}/cancel`, {
        canceledBy: 'cas@goodparty.org',
      })

      const res = await service.client.patch(
        `/v1/outreach/admin/sms/${row.id}`,
        { script: 'new text', editedBy: 'cas@goodparty.org' },
      )

      expect(res.status).toBe(HttpStatus.BAD_REQUEST)
      expect(updateJob).not.toHaveBeenCalled()
    })
  })

  describe('POST /v1/outreach/admin/sms/:id/deny', () => {
    it('stamps the denial internally without contacting the candidate', async () => {
      const row = await seedOutreach()

      const res = await service.client.post(
        `/v1/outreach/admin/sms/${row.id}/deny`,
        { deniedBy: 'cas@goodparty.org', reason: 'Broken link in message' },
      )

      expect(res.status).toBe(HttpStatus.CREATED)
      expect(res.data.approvalStatus).toBe('denied')
      expect(res.data.deniedReason).toBe('Broken link in message')
      expect(requestCanvassers).not.toHaveBeenCalled()
    })

    it('denies a send-day row already ratcheted to in_progress', async () => {
      const row = await seedOutreach({ status: OutreachStatus.in_progress })
      const res = await service.client.post(
        `/v1/outreach/admin/sms/${row.id}/deny`,
        { deniedBy: 'cas@goodparty.org', reason: 'Broken link in message' },
      )
      expect(res.status).toBe(HttpStatus.CREATED)
      expect(res.data.approvalStatus).toBe('denied')
    })

    it('409s denying an approved row', async () => {
      const row = await seedOutreach({ approvedAt: new Date() })
      const res = await service.client.post(
        `/v1/outreach/admin/sms/${row.id}/deny`,
        { deniedBy: 'cas@goodparty.org', reason: 'too late' },
      )
      expect(res.status).toBe(HttpStatus.CONFLICT)
    })
  })

  describe('PATCH /v1/outreach/admin/sms/:id (staff edit)', () => {
    const withImage = async (rowId: number) => {
      await service.prisma.outreach.update({
        where: { id: rowId },
        data: {
          imageUrl:
            'https://assets.goodparty.org/scheduled-campaign/jane/p2p/i.png',
        },
      })
      const s3 = service.app.get(S3Service)
      vi.spyOn(s3, 'getFileBytesWithContentType').mockResolvedValue({
        bytes: Buffer.from('img'),
        contentType: 'image/png',
      })
      const peerly = service.app.get(PeerlyP2pJobService)
      const updateJob = vi
        .spyOn(peerly, 'updatePeerlyP2pJob')
        .mockResolvedValue(undefined)
      return updateJob
    }

    it('updates the message, stamps the editor, and clears a denial', async () => {
      const row = await seedOutreach({ deniedAt: new Date() })
      await service.prisma.outreach.update({
        where: { id: row.id },
        data: { deniedBy: 'cas@goodparty.org', deniedReason: 'typo' },
      })
      const updateJob = await withImage(row.id)
      const script =
        'Hello {first_name}, this is Jane — fixed.\n\nReply STOP to opt out.'

      const res = await service.client.patch(
        `/v1/outreach/admin/sms/${row.id}`,
        { script, editedBy: 'cas@goodparty.org' },
      )

      expect(res.status).toBe(HttpStatus.OK)
      expect(res.data.approvalStatus).toBe('awaiting_review')
      expect(updateJob).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: 'peerly-job-1',
          scriptText: script,
        }),
      )
      const updated = await service.prisma.outreach.findFirstOrThrow({
        where: { id: row.id },
      })
      expect(updated.script).toBe(script)
      expect(updated.deniedAt).toBeNull()
      expect(updated.deniedReason).toBeNull()
      expect(updated.adminEditedBy).toBe('cas@goodparty.org')
      expect(updated.adminEditedAt).not.toBeNull()
    })

    it('keeps an existing booking and approval intact', async () => {
      const row = await seedOutreach({ approvedAt: new Date() })
      await service.prisma.outreach.update({
        where: { id: row.id },
        data: {
          approvedBy: 'cas@goodparty.org',
          canvassRequestedAt: new Date(),
        },
      })
      await withImage(row.id)

      const res = await service.client.patch(
        `/v1/outreach/admin/sms/${row.id}`,
        { script: 'edited', editedBy: 'cas@goodparty.org' },
      )

      expect(res.status).toBe(HttpStatus.OK)
      expect(clearCanvassers).not.toHaveBeenCalled()
      const updated = await service.prisma.outreach.findFirstOrThrow({
        where: { id: row.id },
      })
      expect(updated.script).toBe('edited')
      expect(updated.approvedAt).not.toBeNull()
      expect(updated.canvassRequestedAt).not.toBeNull()
      expect(updated.adminEditedBy).toBe('cas@goodparty.org')
    })

    it('edits a send-day row that is in_progress but not yet booked', async () => {
      const row = await seedOutreach({ status: OutreachStatus.in_progress })
      const updateJob = await withImage(row.id)

      const res = await service.client.patch(
        `/v1/outreach/admin/sms/${row.id}`,
        { script: 'edited', editedBy: 'cas@goodparty.org' },
      )

      expect(res.status).toBe(HttpStatus.OK)
      expect(updateJob).toHaveBeenCalled()
      const updated = await service.prisma.outreach.findFirstOrThrow({
        where: { id: row.id },
      })
      expect(updated.script).toBe('edited')
    })

    it('400s editing a booked row that is already sending', async () => {
      const row = await seedOutreach({
        status: OutreachStatus.in_progress,
        approvedAt: new Date(),
      })
      await service.prisma.outreach.update({
        where: { id: row.id },
        data: { canvassRequestedAt: new Date() },
      })
      const updateJob = await withImage(row.id)

      const res = await service.client.patch(
        `/v1/outreach/admin/sms/${row.id}`,
        { script: 'edited', editedBy: 'cas@goodparty.org' },
      )

      expect(res.status).toBe(HttpStatus.BAD_REQUEST)
      expect(updateJob).not.toHaveBeenCalled()
    })

    it('400s editing a sent row before any vendor write', async () => {
      const row = await seedOutreach({
        status: OutreachStatus.completed,
        approvedAt: subDays(new Date(), 3),
        canvassRequestedAt: subDays(new Date(), 3),
        date: subDays(new Date(), 2),
      })
      const updateJob = await withImage(row.id)

      const res = await service.client.patch(
        `/v1/outreach/admin/sms/${row.id}`,
        { script: 'edited', editedBy: 'cas@goodparty.org' },
      )

      expect(res.status).toBe(HttpStatus.BAD_REQUEST)
      expect(updateJob).not.toHaveBeenCalled()
    })

    it('400s a campaign with no stored image', async () => {
      const row = await seedOutreach()
      const res = await service.client.patch(
        `/v1/outreach/admin/sms/${row.id}`,
        { script: 'edited', editedBy: 'cas@goodparty.org' },
      )
      expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    })
  })

  describe('PATCH /v1/outreach/admin/sms/:id/date (staff date edit)', () => {
    const NEW_SEND_AT = addDays(new Date(), 14)
    // ET, not runner-local: editDate refuses a pair whose ET calendar day
    // disagrees, and a runner-local format() drifts from ET in the
    // evening hours.
    const NEW_LOCAL_DATE = formatInTimeZone(
      NEW_SEND_AT,
      'America/New_York',
      'yyyy-MM-dd',
    )
    const payload = () => ({
      sendAt: NEW_SEND_AT.toISOString(),
      scheduledLocalDate: NEW_LOCAL_DATE,
      editedBy: 'cas@goodparty.org',
    })

    it('400s a pair whose ET calendar day disagrees', async () => {
      const row = await seedOutreach()

      const res = await service.client.patch(
        `/v1/outreach/admin/sms/${row.id}/date`,
        {
          ...payload(),
          scheduledLocalDate: formatInTimeZone(
            addDays(NEW_SEND_AT, 2),
            'America/New_York',
            'yyyy-MM-dd',
          ),
        },
      )

      expect(res.status).toBe(HttpStatus.BAD_REQUEST)
      expect(updateJobSchedule).not.toHaveBeenCalled()
    })

    it('clears a denial so the rescheduled row is approvable again', async () => {
      const row = await seedOutreach({ deniedAt: new Date() })
      await service.prisma.outreach.update({
        where: { id: row.id },
        data: { deniedBy: 'cas@goodparty.org', deniedReason: 'wrong day' },
      })

      const res = await service.client.patch(
        `/v1/outreach/admin/sms/${row.id}/date`,
        payload(),
      )

      expect(res.status).toBe(HttpStatus.OK)
      expect(res.data.approvalStatus).toBe('awaiting_review')
      const updated = await service.prisma.outreach.findFirstOrThrow({
        where: { id: row.id },
      })
      expect(updated.deniedAt).toBeNull()
      expect(updated.deniedBy).toBeNull()
      expect(updated.deniedReason).toBeNull()

      const approved = await service.client.post(
        `/v1/outreach/admin/sms/${row.id}/approve`,
        { approvedBy: 'cas@goodparty.org' },
      )
      expect(approved.status).toBe(HttpStatus.CREATED)
    })

    it('re-mints the job schedule at the stored send time', async () => {
      const row = await seedOutreach({ scheduledLocalTime: '18:00' })

      const res = await service.client.patch(
        `/v1/outreach/admin/sms/${row.id}/date`,
        payload(),
      )

      expect(res.status).toBe(HttpStatus.OK)
      expect(updateJobSchedule).toHaveBeenCalledWith({
        jobId: 'peerly-job-1',
        campaignId,
        date: NEW_LOCAL_DATE,
        startTime: '18:00',
        state: null,
      })
    })

    it("re-mints and rebooks in the row's state zone", async () => {
      const row = await seedOutreach({ approvedAt: new Date() })
      await service.prisma.outreach.update({
        where: { id: row.id },
        data: {
          didState: 'CA',
          approvedBy: 'cas@goodparty.org',
          canvassRequestedAt: subDays(new Date(), 1),
        },
      })

      const res = await service.client.patch(
        `/v1/outreach/admin/sms/${row.id}/date`,
        payload(),
      )

      expect(res.status).toBe(HttpStatus.OK)
      expect(updateJobSchedule).toHaveBeenCalledWith({
        jobId: 'peerly-job-1',
        campaignId,
        date: NEW_LOCAL_DATE,
        startTime: '09:00',
        state: 'CA',
      })
      expect(requestCanvassers).toHaveBeenCalledWith('peerly-job-1', {
        date: NEW_LOCAL_DATE,
        startTime: '09:00',
        state: 'CA',
      })
    })

    it('moves an unbooked send without touching the booking machinery', async () => {
      const row = await seedOutreach()

      const res = await service.client.patch(
        `/v1/outreach/admin/sms/${row.id}/date`,
        payload(),
      )

      expect(res.status).toBe(HttpStatus.OK)
      expect(updateJobSchedule).toHaveBeenCalledWith({
        jobId: 'peerly-job-1',
        campaignId,
        date: NEW_LOCAL_DATE,
        startTime: '09:00',
        state: null,
      })
      expect(clearCanvassers).not.toHaveBeenCalled()
      expect(requestCanvassers).not.toHaveBeenCalled()
      expect(res.data.scheduledLocalDate).toBe(NEW_LOCAL_DATE)
      expect(res.data.approvalStatus).toBe('awaiting_review')
      const updated = await service.prisma.outreach.findFirstOrThrow({
        where: { id: row.id },
      })
      expect(updated.date?.getTime()).toBe(NEW_SEND_AT.getTime())
      expect(updated.scheduledLocalDate).toBe(NEW_LOCAL_DATE)
      expect(updated.adminEditedBy).toBe('cas@goodparty.org')
      expect(updated.adminEditedAt).not.toBeNull()
      expect(updated.approvedAt).toBeNull()
      expect(updated.canvassRequestedAt).toBeNull()
    })

    it('rebooks a booked send on the new day and keeps the approval', async () => {
      const bookedAt = subDays(new Date(), 1)
      const row = await seedOutreach({ approvedAt: new Date() })
      await service.prisma.outreach.update({
        where: { id: row.id },
        data: {
          approvedBy: 'cas@goodparty.org',
          canvassRequestedAt: bookedAt,
        },
      })

      const res = await service.client.patch(
        `/v1/outreach/admin/sms/${row.id}/date`,
        payload(),
      )

      expect(res.status).toBe(HttpStatus.OK)
      expect(clearCanvassers).toHaveBeenCalledWith('peerly-job-1')
      // The rebook keeps the honor-send-time window start (09:00 default
      // for a row with no stored time) — only the day moved.
      expect(requestCanvassers).toHaveBeenCalledWith('peerly-job-1', {
        date: NEW_LOCAL_DATE,
        startTime: '09:00',
        state: null,
      })
      // The stale booking must be cleared before the new day is requested —
      // Peerly allows one open canvasser request per job.
      expect(clearCanvassers.mock.invocationCallOrder[0]).toBeLessThan(
        requestCanvassers.mock.invocationCallOrder[0]!,
      )
      const updated = await service.prisma.outreach.findFirstOrThrow({
        where: { id: row.id },
      })
      expect(updated.approvedAt).not.toBeNull()
      expect(updated.approvedBy).toBe('cas@goodparty.org')
      expect(updated.canvassRequestedAt!.getTime()).toBeGreaterThan(
        bookedAt.getTime(),
      )
      expect(updated.scheduledLocalDate).toBe(NEW_LOCAL_DATE)
    })

    it('leaves the row unchanged when the vendor window update fails', async () => {
      updateJobSchedule.mockRejectedValue(new Error('peerly down'))
      const row = await seedOutreach()

      const res = await service.client.patch(
        `/v1/outreach/admin/sms/${row.id}/date`,
        payload(),
      )

      expect(res.status).toBeGreaterThanOrEqual(500)
      expect(clearCanvassers).not.toHaveBeenCalled()
      const unchanged = await service.prisma.outreach.findFirstOrThrow({
        where: { id: row.id },
      })
      expect(unchanged.date?.getTime()).toBe(SEND_DATE.getTime())
      expect(unchanged.scheduledLocalDate).toBe(SEND_LOCAL_DATE)
      expect(unchanged.adminEditedAt).toBeNull()
    })

    it('leaves the dates unchanged when the booking clear fails', async () => {
      clearCanvassers.mockRejectedValue(new Error('peerly down'))
      const row = await seedOutreach({ approvedAt: new Date() })
      await service.prisma.outreach.update({
        where: { id: row.id },
        data: { canvassRequestedAt: new Date() },
      })

      const res = await service.client.patch(
        `/v1/outreach/admin/sms/${row.id}/date`,
        payload(),
      )

      expect(res.status).toBeGreaterThanOrEqual(500)
      expect(requestCanvassers).not.toHaveBeenCalled()
      const unchanged = await service.prisma.outreach.findFirstOrThrow({
        where: { id: row.id },
      })
      expect(unchanged.date?.getTime()).toBe(SEND_DATE.getTime())
      expect(unchanged.scheduledLocalDate).toBe(SEND_LOCAL_DATE)
      expect(unchanged.adminEditedAt).toBeNull()
    })

    it('leaves the dates unchanged when rebooking fails after the clear', async () => {
      requestCanvassers.mockRejectedValue(new Error('peerly down'))
      const row = await seedOutreach({ approvedAt: new Date() })
      await service.prisma.outreach.update({
        where: { id: row.id },
        data: { canvassRequestedAt: new Date() },
      })

      const res = await service.client.patch(
        `/v1/outreach/admin/sms/${row.id}/date`,
        payload(),
      )

      expect(res.status).toBeGreaterThanOrEqual(500)
      const unchanged = await service.prisma.outreach.findFirstOrThrow({
        where: { id: row.id },
      })
      expect(unchanged.date?.getTime()).toBe(SEND_DATE.getTime())
      expect(unchanged.scheduledLocalDate).toBe(SEND_LOCAL_DATE)
      expect(unchanged.adminEditedAt).toBeNull()
    })

    it('409s a canceled row before any vendor write', async () => {
      const row = await seedOutreach({ stripeCheckoutSessionId: null })
      await service.client.post(`/v1/outreach/admin/sms/${row.id}/cancel`, {
        canceledBy: 'cas@goodparty.org',
      })

      const res = await service.client.patch(
        `/v1/outreach/admin/sms/${row.id}/date`,
        payload(),
      )

      expect(res.status).toBe(HttpStatus.CONFLICT)
      expect(updateJobSchedule).not.toHaveBeenCalled()
    })

    it('409s a sent row before any vendor write', async () => {
      const row = await seedOutreach({
        status: OutreachStatus.completed,
        approvedAt: subDays(new Date(), 3),
        canvassRequestedAt: subDays(new Date(), 3),
        date: subDays(new Date(), 2),
      })

      const res = await service.client.patch(
        `/v1/outreach/admin/sms/${row.id}/date`,
        payload(),
      )

      expect(res.status).toBe(HttpStatus.CONFLICT)
      expect(updateJobSchedule).not.toHaveBeenCalled()
      expect(clearCanvassers).not.toHaveBeenCalled()
    })

    it('400s a send time in the past', async () => {
      const row = await seedOutreach()

      const res = await service.client.patch(
        `/v1/outreach/admin/sms/${row.id}/date`,
        {
          ...payload(),
          sendAt: subDays(new Date(), 1).toISOString(),
        },
      )

      expect(res.status).toBe(HttpStatus.BAD_REQUEST)
      expect(updateJobSchedule).not.toHaveBeenCalled()
    })

    it('reschedules an in_progress row that was never booked (same-day unapproved)', async () => {
      // The sweep-ratchet case REVIEWABLE_STATUSES exists for: pending ->
      // in_progress at UTC midnight of the send day with no approval. The
      // guard only blocks in_progress rows that are BOOKED (possibly
      // mid-send); this one must stay reschedulable.
      const row = await seedOutreach({ status: OutreachStatus.in_progress })

      const res = await service.client.patch(
        `/v1/outreach/admin/sms/${row.id}/date`,
        payload(),
      )

      expect(res.status).toBe(HttpStatus.OK)
      expect(updateJobSchedule).toHaveBeenCalledWith({
        jobId: 'peerly-job-1',
        campaignId,
        date: NEW_LOCAL_DATE,
        startTime: '09:00',
        state: null,
      })
      expect(clearCanvassers).not.toHaveBeenCalled()
      expect(requestCanvassers).not.toHaveBeenCalled()
      const updated = await service.prisma.outreach.findFirstOrThrow({
        where: { id: row.id },
      })
      expect(updated.date?.getTime()).toBe(NEW_SEND_AT.getTime())
      expect(updated.scheduledLocalDate).toBe(NEW_LOCAL_DATE)
      expect(updated.adminEditedBy).toBe('cas@goodparty.org')
      expect(updated.canvassRequestedAt).toBeNull()
    })

    it('400s rescheduling a booked row that is already sending', async () => {
      const row = await seedOutreach({
        status: OutreachStatus.in_progress,
        approvedAt: new Date(),
      })
      await service.prisma.outreach.update({
        where: { id: row.id },
        data: { canvassRequestedAt: new Date() },
      })

      const res = await service.client.patch(
        `/v1/outreach/admin/sms/${row.id}/date`,
        payload(),
      )

      expect(res.status).toBe(HttpStatus.BAD_REQUEST)
      expect(updateJobSchedule).not.toHaveBeenCalled()
    })

    it('is admin-gated', async () => {
      const row = await seedOutreach()
      await service.prisma.user.update({
        where: { id: service.user.id },
        data: { roles: [UserRole.candidate] },
      })

      const res = await service.client.patch(
        `/v1/outreach/admin/sms/${row.id}/date`,
        payload(),
      )

      expect(res.status).toBe(HttpStatus.FORBIDDEN)
      expect(updateJobSchedule).not.toHaveBeenCalled()
    })
  })

  describe('GET /v1/outreach/admin/sms/:id', () => {
    // Each test below uses its OWN projectId — getDetail now single-flights
    // and caches its vendor reads per jobId on the service instance, which
    // outlives a single test, so two tests sharing a jobId could serve one
    // another's cached (or in-flight) result instead of hitting their own
    // freshly-configured mock.
    it('merges the live job and stats onto the row', async () => {
      const row = await seedOutreach({ projectId: 'peerly-job-detail-ok' })

      const res = await service.client.get(`/v1/outreach/admin/sms/${row.id}`)

      expect(res.status).toBe(HttpStatus.OK)
      expect(res.data.item.id).toBe(row.id)
      expect(res.data.item.job).toMatchObject({ status: 'active' })
      expect(res.data.stats).toMatchObject({ delivered: 90, totalCost: 3.5 })
    })

    it('serves a send-day row already ratcheted to in_progress', async () => {
      const row = await seedOutreach({
        status: OutreachStatus.in_progress,
        projectId: 'peerly-job-detail-in-progress',
      })

      const res = await service.client.get(`/v1/outreach/admin/sms/${row.id}`)

      expect(res.status).toBe(HttpStatus.OK)
      expect(res.data.item.approvalStatus).toBe('awaiting_review')
    })

    it('serves a sent row with its delivery stats', async () => {
      const row = await seedOutreach({
        status: OutreachStatus.completed,
        approvedAt: subDays(new Date(), 3),
        canvassRequestedAt: subDays(new Date(), 3),
        date: subDays(new Date(), 2),
        projectId: 'peerly-job-detail-sent',
      })

      const res = await service.client.get(`/v1/outreach/admin/sms/${row.id}`)

      expect(res.status).toBe(HttpStatus.OK)
      expect(res.data.item.approvalStatus).toBe('sent')
      expect(res.data.stats).toMatchObject({ sentTotal: 100, delivered: 90 })
    })

    it('renders without stats when the vendor read fails', async () => {
      getJobDetailedStats.mockRejectedValue(new Error('peerly down'))
      const row = await seedOutreach({ projectId: 'peerly-job-detail-fail' })

      const res = await service.client.get(`/v1/outreach/admin/sms/${row.id}`)

      expect(res.status).toBe(HttpStatus.OK)
      expect(res.data.stats).toBeNull()
    })
  })

  describe('OutreachSmsAdminService.getDetail — single-flight + cache + cool-off', () => {
    // Exercised directly on the service (no HTTP round trip) so the same
    // service instance's in-memory maps persist across the calls each test
    // makes within itself, mirroring what a rapid page refresh does. Each
    // test uses its OWN projectId for the isolation reason noted above.
    afterEach(() => {
      vi.unstubAllEnvs()
    })

    const statsPayload = (overrides: Partial<{ delivered: number }> = {}) => ({
      sentTotal: 100,
      receivedTotal: 4,
      delivered: 90,
      deliveryFailed: 6,
      deliveryUnconfirmed: 4,
      totalCost: 3.5,
      ...overrides,
    })

    it('single-flights concurrent detail reads for the same job into one vendor call', async () => {
      const row = await seedOutreach({ projectId: 'peerly-job-sf-concurrent' })
      // Assigned synchronously the moment getDetail invokes the mock below.
      let resolveStats!: (value: ReturnType<typeof statsPayload>) => void
      getJobDetailedStats.mockReset().mockImplementation(
        () =>
          new Promise<ReturnType<typeof statsPayload>>((resolve) => {
            resolveStats = resolve
          }),
      )
      const smsAdmin = service.app.get(OutreachSmsAdminService)

      const firstCall = smsAdmin.getDetail(row.id)
      const secondCall = smsAdmin.getDetail(row.id)
      // Wait for the vendor mock to actually be invoked (not a fixed delay)
      // before answering it — the calls' own DB prefixes (findFirst +
      // registrations + owners) run first, at whatever speed the DB gives.
      await vi.waitFor(() =>
        expect(getJobDetailedStats).toHaveBeenCalledTimes(1),
      )
      resolveStats(statsPayload())

      const [first, second] = await Promise.all([firstCall, secondCall])

      expect(getJobDetailedStats).toHaveBeenCalledTimes(1)
      expect(first.stats).toMatchObject({ delivered: 90 })
      expect(second.stats).toMatchObject({ delivered: 90 })
    })

    it('does not duplicate the vendor call on a later page view while the read is still outstanding past its timebox', async () => {
      vi.stubEnv('VENDOR_READ_TIMEOUT_MS', '50')
      const row = await seedOutreach({ projectId: 'peerly-job-sf-outstanding' })
      // Simulates Peerly still computing the report — never settles.
      getJobDetailedStats
        .mockReset()
        .mockImplementation(
          () => new Promise<ReturnType<typeof statsPayload>>(() => undefined),
        )
      const smsAdmin = service.app.get(OutreachSmsAdminService)

      const first = await smsAdmin.getDetail(row.id)
      expect(first.stats).toBeNull()

      const second = await smsAdmin.getDetail(row.id)
      expect(second.stats).toBeNull()

      expect(getJobDetailedStats).toHaveBeenCalledTimes(1)
    })

    it('serves the cached result on a refresh within the TTL, no vendor call', async () => {
      const row = await seedOutreach({ projectId: 'peerly-job-sf-cache' })
      getJobDetailedStats.mockReset().mockResolvedValue(statsPayload())
      const smsAdmin = service.app.get(OutreachSmsAdminService)

      const first = await smsAdmin.getDetail(row.id)
      expect(first.stats).toMatchObject({ delivered: 90 })

      // If the cache were bypassed, this would be the answer instead.
      getJobDetailedStats.mockResolvedValue(statsPayload({ delivered: 1 }))
      const second = await smsAdmin.getDetail(row.id)

      expect(second.stats).toMatchObject({ delivered: 90 })
      expect(getJobDetailedStats).toHaveBeenCalledTimes(1)
    })

    it('issues a new vendor request once the failed-read cool-off expires', async () => {
      // Generous relative to real DB latency in the call's own DB prefix
      // (findFirst + registrations + owners) — a too-tight margin here
      // races against that latency, not against the cool-off logic itself.
      vi.stubEnv('DETAIL_FAILED_RETRY_COOLDOWN_MS', '300')
      const row = await seedOutreach({ projectId: 'peerly-job-sf-cooloff' })
      getJobDetailedStats
        .mockReset()
        .mockRejectedValueOnce(new Error('peerly down'))
      const smsAdmin = service.app.get(OutreachSmsAdminService)

      const first = await smsAdmin.getDetail(row.id)
      expect(first.stats).toBeNull()
      expect(getJobDetailedStats).toHaveBeenCalledTimes(1)

      getJobDetailedStats.mockResolvedValueOnce(statsPayload({ delivered: 4 }))

      // Still inside the cool-off — served from the negative cache.
      const stillCoolingOff = await smsAdmin.getDetail(row.id)
      expect(stillCoolingOff.stats).toBeNull()
      expect(getJobDetailedStats).toHaveBeenCalledTimes(1)

      // Past the cool-off — a fresh vendor call is allowed.
      await new Promise<void>((resolve) => setTimeout(resolve, 600))
      const afterCooldown = await smsAdmin.getDetail(row.id)
      expect(afterCooldown.stats).toMatchObject({ delivered: 4 })
      expect(getJobDetailedStats).toHaveBeenCalledTimes(2)
    })

    it('does not let a late-resolving abandoned read clobber a newer attempt after the outstanding cool-off sweeps it', async () => {
      vi.stubEnv('DETAIL_OUTSTANDING_RETRY_COOLDOWN_MS', '300')
      const row = await seedOutreach({
        projectId: 'peerly-job-sf-anticlobber',
      })
      let resolveFirst!: (value: ReturnType<typeof statsPayload>) => void
      let resolveSecond!: (value: ReturnType<typeof statsPayload>) => void
      getJobDetailedStats
        .mockReset()
        .mockImplementationOnce(
          () =>
            new Promise<ReturnType<typeof statsPayload>>((resolve) => {
              resolveFirst = resolve
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise<ReturnType<typeof statsPayload>>((resolve) => {
              resolveSecond = resolve
            }),
        )
      const smsAdmin = service.app.get(OutreachSmsAdminService)

      // Never resolved yet — this read is registered in-flight. Wait for
      // the vendor mock to actually have been invoked (not just for the
      // call to have been made) before timing the cool-off from it — the
      // call's own DB prefix (findFirst + registrations + owners) runs
      // first and its duration isn't part of what we're timing here.
      const firstCall = smsAdmin.getDetail(row.id)
      await vi.waitFor(() =>
        expect(getJobDetailedStats).toHaveBeenCalledTimes(1),
      )

      // Past the (stubbed) outstanding cool-off, but the first read is
      // STILL unresolved — a genuinely abandoned request, per Peerly's
      // own "no response" guidance. The next call's sweep forgets it and
      // fires a fresh one instead of continuing to share it.
      await new Promise<void>((resolve) => setTimeout(resolve, 600))
      const secondCall = smsAdmin.getDetail(row.id)
      await vi.waitFor(() =>
        expect(getJobDetailedStats).toHaveBeenCalledTimes(2),
      )

      // The abandoned first read finally answers — LATE, and with STALE
      // data — after the second (current) read is already in flight.
      resolveFirst(statsPayload({ delivered: 90 }))
      resolveSecond(statsPayload({ delivered: 4 }))
      await Promise.all([firstCall, secondCall])

      // A third call must see the fresh (second) answer, not the late,
      // stale (first) one the abandoned read tried to write.
      const third = await smsAdmin.getDetail(row.id)
      expect(third.stats).toMatchObject({ delivered: 4 })
      expect(getJobDetailedStats).toHaveBeenCalledTimes(2)
    })
  })
})

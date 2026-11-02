import { AreaCodeFromZipService } from '@/ai/util/areaCodeFromZip.util'
import { TcrComplianceStatus } from '@/generated/prisma'
import { useTestService } from '@/test-service'
import { PeerlyBaseConfig } from '@/vendors/peerly/config/peerlyBaseConfig'
import { VendorMockRecordService } from '@/vendorMocks/vendorMockRecord.service'
import { TestFixtureStateResponseSchema } from '@goodparty_org/contracts'
import { BadRequestException, HttpStatus } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TestFixturesService } from './services/testFixtures.service'

const { envNonProd, vendorMode, proxyTarget } = vi.hoisted(() => ({
  envNonProd: { value: true },
  vendorMode: { value: 'mock' },
  proxyTarget: { baseUrl: '' },
}))

// The vendor clients call http://localhost:3000, but the test app listens on a
// random port, and the Vercel and Route53 clients capture their URL when they
// are built (before the port is known). So vendorBaseUrl points them at a
// loopback proxy that forwards to the test app once it is up.
vi.mock('@/shared/util/appEnvironment.util', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/shared/util/appEnvironment.util')>()
  const http = await import('node:http')
  const server = http.createServer((req, res) => {
    if (!proxyTarget.baseUrl) {
      res.writeHead(503).end()
      return
    }
    const target = new URL(proxyTarget.baseUrl)
    const forwarded = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: req.url,
        method: req.method,
        headers: req.headers,
      },
      (upstream) => {
        res.writeHead(upstream.statusCode ?? 502, upstream.headers)
        upstream.pipe(res)
      },
    )
    req.pipe(forwarded)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  server.unref()
  const { port } = server.address() as AddressInfo
  return {
    ...actual,
    get IS_NON_PROD_DEPLOY() {
      return envNonProd.value
    },
    get VENDOR_MODE() {
      return vendorMode.value as 'mock' | 'live'
    },
    vendorBaseUrl: (vendor: string, _liveUrl: string, org?: string) =>
      `http://127.0.0.1:${port}/v1/vendor-mocks/${vendor}` +
      (org ? `/org/${encodeURIComponent(org)}` : ''),
  }
})

const service = useTestService()

const ROUTE = (id: number) =>
  `/v1/test-fixtures/users/${id}/states/pro-win-10dlc-mock`
const TEN_SECONDS_MS = 10_000

const seedCampaign = async (userId: number) => {
  const slug = `pro-win-10dlc-${Math.random().toString(36).slice(2)}`
  await service.prisma.organization.create({
    data: { slug, ownerId: userId },
  })
  return service.prisma.campaign.create({
    data: { userId, slug, organizationSlug: slug },
  })
}

describe('pro-win-10dlc-mock fixture state', () => {
  beforeEach(async () => {
    envNonProd.value = true
    vendorMode.value = 'mock'
    proxyTarget.baseUrl = String(service.client.defaults.baseURL)

    await service.prisma.user.update({
      where: { id: service.user.id },
      data: {
        email: 'qa-00000000-0000-0000-0000-000000000000@goodparty.org',
        firstName: 'Jane',
        lastName: 'Smith',
      },
    })
    vi.spyOn(
      service.app.get(AreaCodeFromZipService),
      'getAreaCodeFromZip',
    ).mockResolvedValue(['512'])
    vi.spyOn(
      PeerlyBaseConfig.prototype,
      'accountNumber',
      'get',
    ).mockReturnValue('12345678')
    vi.spyOn(PeerlyBaseConfig.prototype, 'email', 'get').mockReturnValue('mock')
    vi.spyOn(PeerlyBaseConfig.prototype, 'password', 'get').mockReturnValue(
      'mock',
    )
  })

  afterEach(async () => {
    // The mock tables are not truncated with the rest between tests unless a
    // test wrote them, but a stale Vercel domain would collide on re-search.
    await service.app.get(VendorMockRecordService).model.deleteMany({})
  })

  it('drives the real 10DLC flow to tcr_approved with a Peerly identity, in under 10 seconds', async () => {
    const campaign = await seedCampaign(service.user.id)

    const startedAt = Date.now()
    const res = await service.client.post(ROUTE(service.user.id))
    const elapsedMs = Date.now() - startedAt

    expect(res.status).toBe(HttpStatus.OK)
    const body = TestFixtureStateResponseSchema.parse(res.data)
    expect(body).toMatchObject({
      state: 'pro-win-10dlc-mock',
      userId: service.user.id,
      campaignId: campaign.id,
      stage: 'tcr_approved',
    })
    expect(body.peerlyIdentityId).toBeTruthy()
    expect(elapsedMs).toBeLessThan(TEN_SECONDS_MS)

    const tcr = await service.prisma.tcrCompliance.findUniqueOrThrow({
      where: { campaignId: campaign.id },
    })
    // The send gate blocks internal-testing rows; this user must pass it.
    expect(tcr).toMatchObject({
      status: TcrComplianceStatus.approved,
      peerlyIdentityId: body.peerlyIdentityId,
      internalTestingAt: null,
      kickoffSentAt: null,
    })
    const refreshed = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    expect(refreshed.isPro).toBe(true)
  })

  it('returns the existing result when the user is already approved', async () => {
    await seedCampaign(service.user.id)
    const first = await service.client.post(ROUTE(service.user.id))
    expect(first.status).toBe(HttpStatus.OK)

    const second = await service.client.post(ROUTE(service.user.id))

    expect(second.status).toBe(HttpStatus.OK)
    expect(second.data.peerlyIdentityId).toBe(first.data.peerlyIdentityId)
  })

  it('refuses to run when VENDOR_MODE is live', async () => {
    const campaign = await seedCampaign(service.user.id)
    vendorMode.value = 'live'

    await expect(
      service.app
        .get(TestFixturesService)
        .setupProWin10DlcMock(service.user.id),
    ).rejects.toThrow(BadRequestException)

    const res = await service.client.post(ROUTE(service.user.id))
    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(
      await service.prisma.tcrCompliance.findUnique({
        where: { campaignId: campaign.id },
      }),
    ).toBeNull()
  })

  it('404s outside a non-prod deploy', async () => {
    envNonProd.value = false

    const res = await service.client.post(ROUTE(service.user.id))

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })

  it('403s a non-test user', async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { email: 'someone@example.com' },
    })

    const res = await service.client.post(ROUTE(service.user.id))

    expect(res.status).toBe(HttpStatus.FORBIDDEN)
  })

  it("404s another user's id", async () => {
    const res = await service.client.post(ROUTE(service.user.id + 1000))

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })
})

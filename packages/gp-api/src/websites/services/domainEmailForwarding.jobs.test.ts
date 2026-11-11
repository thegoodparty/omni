import { BadGatewayException } from '@nestjs/common'
import { AxiosError, AxiosHeaders } from 'axios'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest'
import { DomainStatus, WebsiteStatus } from '@/generated/prisma'
import { useTestService } from '@/test-service'
import { appEnvOverrides } from '@/shared/test-utils/appEnvOverrides'
import { ForwardEmailService } from '@/vendors/forwardEmail/services/forwardEmail.service'
import { VercelService } from '@/vendors/vercel/services/vercel.service'
import { DomainsService } from './domains.service'

const service = useTestService({ jobs: true })

const FORWARD_EMAIL_DOMAIN = {
  id: 'fed_1',
  name: 'jordan-for-council.com',
  verification_record: 'verify_1',
}

// What ForwardEmailService throws when the API answers with this status.
const forwardEmailRejection = (status: number) =>
  new BadGatewayException('Failed to communicate with Forward Email API', {
    cause: new AxiosError(
      `Request failed with status code ${status}`,
      'ERR_BAD_REQUEST',
      undefined,
      undefined,
      {
        status,
        statusText: 'error',
        data: {},
        headers: {},
        config: { headers: new AxiosHeaders() },
      },
    ),
  })

let seq = 0

const seedDomain = async (
  name: string,
  overrides: { emailForwardingDomainId?: string } = {},
) => {
  const n = seq++
  const organizationSlug = `org-forwarding-${n}`
  await service.prisma.organization.create({
    data: { slug: organizationSlug, ownerId: service.user.id },
  })
  const campaign = await service.prisma.campaign.create({
    data: {
      organizationSlug,
      userId: service.user.id,
      slug: `jordan-${n}`,
      isActive: true,
    },
  })
  const website = await service.prisma.website.create({
    data: {
      campaignId: campaign.id,
      vanityPath: `jordan-${n}`,
      status: WebsiteStatus.published,
      content: {},
    },
  })
  return service.prisma.domain.create({
    data: {
      name,
      websiteId: website.id,
      status: DomainStatus.registered,
      ...overrides,
    },
  })
}

const forwardingIdOf = async (id: number) =>
  (await service.prisma.domain.findUniqueOrThrow({ where: { id } }))
    .emailForwardingDomainId

let addDomain: MockInstance<ForwardEmailService['addDomain']>

beforeEach(() => {
  // Forward Email has no vendor mock, so mock mode skips forwarding.
  appEnvOverrides.VENDOR_MODE = 'live'
  vi.stubEnv('ENABLE_DOMAIN_PURCHASE', 'true')
  const forwardEmail = service.app.get(ForwardEmailService)
  vi.spyOn(forwardEmail, 'getDomain').mockResolvedValue(null)
  addDomain = vi
    .spyOn(forwardEmail, 'addDomain')
    .mockImplementation(async (domain) => ({
      ...FORWARD_EMAIL_DOMAIN,
      name: domain.name,
    }))
  vi.spyOn(forwardEmail, 'getCatchAllDomainAliases').mockResolvedValue([])
  vi.spyOn(forwardEmail, 'createCatchAllAlias').mockImplementation(
    async (forwardToEmail, forwardingDomain) => ({
      user: { email: forwardToEmail, display_name: '', id: 'user_1' },
      domain: { name: forwardingDomain.name, id: forwardingDomain.id },
      name: '*',
      labels: [],
      is_enabled: true,
      has_recipient_verification: false,
      verified_recipients: [],
      pending_recipients: [],
      recipients: [forwardToEmail],
      id: 'alias_1',
      object: 'alias',
      created_at: '2026-11-01T00:00:00Z',
      updated_at: '2026-11-01T00:00:00Z',
      storage_location: '',
      has_imap: false,
    }),
  )
  const vercel = service.app.get(VercelService)
  vi.spyOn(vercel, 'listDnsRecords').mockResolvedValue([])
  vi.spyOn(vercel, 'createMXRecords').mockResolvedValue([])
  vi.spyOn(vercel, 'createTXTVerificationRecord').mockResolvedValue({
    uid: 'rec_1',
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('domainEmailForwarding', () => {
  it('sets up forwarding for every domain without it when a task boots', async () => {
    const first = await seedDomain('jordan-for-council.com')
    const second = await seedDomain('jordan-for-mayor.com')
    const done = await seedDomain('already-forwarding.com', {
      emailForwardingDomainId: 'fed_existing',
    })

    await service.app.get(DomainsService).backfillDomainEmailRedirects()
    await service.jobs.settle()

    expect(await forwardingIdOf(first.id)).toBe('fed_1')
    expect(await forwardingIdOf(second.id)).toBe('fed_1')
    expect(await forwardingIdOf(done.id)).toBe('fed_existing')
    expect(addDomain).toHaveBeenCalledTimes(2)
  })

  it('sends one job per domain when several tasks boot at once', async () => {
    const domain = await seedDomain('jordan-for-council.com')
    const domains = service.app.get(DomainsService)

    await Promise.all([
      domains.backfillDomainEmailRedirects(),
      domains.backfillDomainEmailRedirects(),
    ])
    await service.jobs.settle()

    expect(await forwardingIdOf(domain.id)).toBe('fed_1')
    expect(addDomain).toHaveBeenCalledTimes(1)
  })

  it('completes without retrying when Forward Email rejects the domain', async () => {
    const domain = await seedDomain('jordan-for-council.com')
    addDomain.mockRejectedValue(forwardEmailRejection(422))

    await service.app.get(DomainsService).backfillDomainEmailRedirects()
    await service.jobs.settle()

    expect(await forwardingIdOf(domain.id)).toBeNull()
    expect(addDomain).toHaveBeenCalledTimes(1)
  })

  it.each([401, 403, 429])(
    'retries a setup Forward Email answers with %i until it dead-letters',
    async (status) => {
      const domain = await seedDomain('jordan-for-council.com')
      addDomain.mockRejectedValue(forwardEmailRejection(status))

      await service.app.get(DomainsService).backfillDomainEmailRedirects()
      const { deadLetters } = await service.jobs.settle({
        allowDeadLetters: true,
      })

      expect(deadLetters).toEqual([
        expect.objectContaining({
          name: 'domainEmailForwarding',
          data: { domainId: domain.id },
        }),
      ])
      expect(addDomain).toHaveBeenCalledTimes(3)
    },
  )
})

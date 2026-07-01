import { Test, TestingModule } from '@nestjs/testing'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { PrismaService } from 'src/prisma/prisma.service'
import { PinoLogger } from 'nestjs-pino'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { firstOrThrow } from 'src/shared/test-utils/arrays.util'
import axios, { AxiosError } from 'axios'
import * as dns from 'node:dns'
import {
  WebsitesService,
  applyCompliancePublishFallbacks,
  isPublicAddress,
  ssrfSafeLookup,
  type PositionWithTopIssue,
} from './websites.service'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import {
  createMockUser,
  createMockCampaign,
} from '@/shared/test-utils/mockData.util'
import { CampaignWith } from 'src/campaigns/campaigns.types'

vi.mock('axios', async (orig) => {
  const real = await orig<typeof import('axios')>()
  return {
    default: { get: vi.fn() },
    AxiosError: real.AxiosError,
  }
})

vi.mock('node:dns', async (orig) => {
  const real = await orig<typeof import('node:dns')>()
  return { ...real, default: real, lookup: vi.fn() }
})

const mockedAxiosGet = vi.mocked(axios.get)
const mockedDnsLookup = vi.mocked(dns.lookup)

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  result: dns.LookupAddress[],
) => void

const stubDnsLookup = (addresses: dns.LookupAddress[] | Error) => {
  mockedDnsLookup.mockImplementation(
    (
      _hostname: string,
      optionsOrCallback: unknown,
      maybeCallback?: unknown,
    ) => {
      const cb = (
        typeof optionsOrCallback === 'function'
          ? optionsOrCallback
          : maybeCallback
      ) as LookupCallback
      if (addresses instanceof Error) {
        cb(addresses as NodeJS.ErrnoException, [])
      } else {
        cb(null, addresses)
      }
    },
  )
}

const buildHtml = ({
  candidateName = 'Jane Doe',
  includePrivacyPolicy = true,
  includeTerms = true,
  includeIdentity = true,
} = {}): string => `
  <html>
    <body>
      <h1>${includeIdentity ? candidateName : 'Anonymous Campaign'} for Senate</h1>
      <p>Vote for change.</p>
      ${includePrivacyPolicy ? '<a href="/privacy">Privacy Policy</a>' : ''}
      ${includeTerms ? '<a href="/terms">Terms of Service</a>' : ''}
    </body>
  </html>
`

describe('WebsitesService.verifyLive', () => {
  let service: WebsitesService
  let mockPrisma: {
    website: { findUnique: ReturnType<typeof vi.fn> }
  }
  let originalOtelEnv: string | undefined

  beforeEach(async () => {
    // verifyLive short-circuits when OTEL_SERVICE_ENVIRONMENT !== 'prod' so the
    // dev placeholder page doesn't fail the content checks. Pin to 'prod' here
    // so every test exercises the real code path; the single bypass test
    // overrides this locally.
    originalOtelEnv = process.env.OTEL_SERVICE_ENVIRONMENT
    process.env.OTEL_SERVICE_ENVIRONMENT = 'prod'

    mockPrisma = {
      website: {
        findUnique: vi.fn().mockResolvedValue({
          id: 1,
          domain: { name: 'vote-jane.com' },
          campaign: {
            user: { firstName: 'Jane', lastName: 'Doe' },
          },
        }),
      },
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebsitesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PinoLogger, useValue: createMockLogger() },
      ],
    }).compile()

    service = module.get<WebsitesService>(WebsitesService)
    vi.clearAllMocks()
    stubDnsLookup([{ address: '93.184.216.34', family: 4 }])
  })

  afterEach(() => {
    if (originalOtelEnv === undefined) {
      delete process.env.OTEL_SERVICE_ENVIRONMENT
    } else {
      process.env.OTEL_SERVICE_ENVIRONMENT = originalOtelEnv
    }
  })

  it('short-circuits to verified=true without fetching when OTEL_SERVICE_ENVIRONMENT=dev', async () => {
    const original = process.env.OTEL_SERVICE_ENVIRONMENT
    process.env.OTEL_SERVICE_ENVIRONMENT = 'dev'
    try {
      const result = await service.verifyLive(1)
      expect(mockedAxiosGet).not.toHaveBeenCalled()
      expect(result).toEqual({
        verified: true,
        url: 'https://vote-jane.com/',
        reason: null,
        checks: {
          http_200: true,
          has_privacy_policy: true,
          has_terms: true,
          has_candidate_identity: true,
        },
      })
    } finally {
      if (original === undefined) delete process.env.OTEL_SERVICE_ENVIRONMENT
      else process.env.OTEL_SERVICE_ENVIRONMENT = original
    }
  })

  it('returns verified=true when HTTP 200 + all required sections + identity present', async () => {
    mockedAxiosGet.mockResolvedValue({ status: 200, data: buildHtml() })

    const result = await service.verifyLive(1)

    expect(mockedAxiosGet).toHaveBeenCalledWith(
      'https://vote-jane.com/',
      expect.objectContaining({ validateStatus: expect.any(Function) }),
    )
    expect(result).toEqual({
      verified: true,
      url: 'https://vote-jane.com/',
      reason: null,
      checks: {
        http_200: true,
        has_privacy_policy: true,
        has_terms: true,
        has_candidate_identity: true,
      },
    })
  })

  it('returns verified=false with has_privacy_policy=false when the privacy section is missing', async () => {
    mockedAxiosGet.mockResolvedValue({
      status: 200,
      data: buildHtml({ includePrivacyPolicy: false }),
    })

    const result = await service.verifyLive(1)

    expect(result.verified).toBe(false)
    expect(result.reason).toBe('content_missing')
    expect(result.checks).toEqual({
      http_200: true,
      has_privacy_policy: false,
      has_terms: true,
      has_candidate_identity: true,
    })
  })

  it('returns verified=false reason=not_live when the URL responds 404', async () => {
    mockedAxiosGet.mockResolvedValue({ status: 404, data: 'Not Found' })

    const result = await service.verifyLive(1)

    expect(result.verified).toBe(false)
    expect(result.reason).toBe('not_live')
    expect(result.checks.http_200).toBe(false)
    expect(result.checks.has_privacy_policy).toBe(false)
    expect(result.checks.has_terms).toBe(false)
    expect(result.checks.has_candidate_identity).toBe(false)
  })

  it('returns verified=false with has_candidate_identity=false when the page does not name the candidate', async () => {
    mockedAxiosGet.mockResolvedValue({
      status: 200,
      data: buildHtml({ includeIdentity: false }),
    })

    const result = await service.verifyLive(1)

    expect(result.verified).toBe(false)
    expect(result.checks.has_candidate_identity).toBe(false)
  })

  it('does not retry on network failure — single shot, reason=unreachable', async () => {
    mockedAxiosGet.mockRejectedValue(new Error('ECONNREFUSED'))

    const result = await service.verifyLive(1)

    expect(mockedAxiosGet).toHaveBeenCalledTimes(1)
    expect(result.verified).toBe(false)
    expect(result.reason).toBe('unreachable')
    expect(result.checks.http_200).toBe(false)
  })

  it('classifies a redirect loop as redirect_loop (reachable but misconfigured)', async () => {
    mockedAxiosGet.mockRejectedValue(
      new AxiosError(
        'Maximum number of redirects exceeded',
        'ERR_FR_TOO_MANY_REDIRECTS',
      ),
    )

    const result = await service.verifyLive(1)

    expect(result.verified).toBe(false)
    expect(result.reason).toBe('redirect_loop')
  })

  it('throws BadRequestException when no domain is attached', async () => {
    mockPrisma.website.findUnique.mockResolvedValue({
      id: 1,
      domain: null,
      campaign: { user: { firstName: 'Jane', lastName: 'Doe' } },
    })

    await expect(service.verifyLive(1)).rejects.toBeInstanceOf(
      BadRequestException,
    )
    expect(mockedAxiosGet).not.toHaveBeenCalled()
  })

  it('throws NotFoundException when no website exists for the campaign', async () => {
    mockPrisma.website.findUnique.mockResolvedValue(null)

    await expect(service.verifyLive(1)).rejects.toBeInstanceOf(
      NotFoundException,
    )
    expect(mockedAxiosGet).not.toHaveBeenCalled()
  })

  it('throws BadRequestException without fetching when domain resolves to a private IPv4 (10.x.x.x)', async () => {
    stubDnsLookup([{ address: '10.0.0.1', family: 4 }])

    await expect(service.verifyLive(1)).rejects.toBeInstanceOf(
      BadRequestException,
    )
    expect(mockedAxiosGet).not.toHaveBeenCalled()
  })

  it('throws BadRequestException when domain resolves to the AWS metadata IP (169.254.169.254)', async () => {
    stubDnsLookup([{ address: '169.254.169.254', family: 4 }])

    await expect(service.verifyLive(1)).rejects.toBeInstanceOf(
      BadRequestException,
    )
    expect(mockedAxiosGet).not.toHaveBeenCalled()
  })

  it('throws BadRequestException when domain resolves to loopback (127.0.0.1)', async () => {
    stubDnsLookup([{ address: '127.0.0.1', family: 4 }])

    await expect(service.verifyLive(1)).rejects.toBeInstanceOf(
      BadRequestException,
    )
    expect(mockedAxiosGet).not.toHaveBeenCalled()
  })

  it('throws BadRequestException when any resolved address is private (mixed v4 + v6)', async () => {
    stubDnsLookup([
      { address: '93.184.216.34', family: 4 },
      { address: 'fe80::1', family: 6 },
    ])

    await expect(service.verifyLive(1)).rejects.toBeInstanceOf(
      BadRequestException,
    )
    expect(mockedAxiosGet).not.toHaveBeenCalled()
  })

  it('proceeds to fetch when domain resolves to a public unicast address', async () => {
    stubDnsLookup([{ address: '93.184.216.34', family: 4 }])
    mockedAxiosGet.mockResolvedValue({ status: 200, data: buildHtml() })

    const result = await service.verifyLive(1)

    expect(mockedAxiosGet).toHaveBeenCalledTimes(1)
    expect(result.verified).toBe(true)
  })

  it('proceeds (and the fetch naturally fails) when DNS lookup fails — does not pre-emptively block', async () => {
    stubDnsLookup(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }))
    mockedAxiosGet.mockRejectedValue(new Error('ENOTFOUND'))

    const result = await service.verifyLive(1)

    expect(result.verified).toBe(false)
    expect(result.checks.http_200).toBe(false)
  })
})

describe('isPublicAddress', () => {
  it.each([
    '10.0.0.1',
    '10.255.255.254',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.1.1',
    '127.0.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '255.255.255.255',
    '224.0.0.1',
    '::1',
    'fe80::1',
    'fc00::1',
    '::',
    '::ffff:10.0.0.1',
  ])('rejects %s as non-public', (ip) => {
    expect(isPublicAddress(ip)).toBe(false)
  })

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '93.184.216.34',
    '2001:4860:4860::8888',
    '2606:4700:4700::1111',
  ])('accepts %s as public unicast', (ip) => {
    expect(isPublicAddress(ip)).toBe(true)
  })

  it('rejects garbage input', () => {
    expect(isPublicAddress('not-an-ip')).toBe(false)
    expect(isPublicAddress('')).toBe(false)
  })
})

describe('ssrfSafeLookup (connection-time defense)', () => {
  const invoke = (
    hostname = 'example.com',
  ): Promise<{
    err: NodeJS.ErrnoException | null
    address: string
    family: number
  }> =>
    new Promise((resolve) => {
      ssrfSafeLookup(hostname, {}, (err, address, family) =>
        resolve({
          err,
          address: typeof address === 'string' ? address : '',
          family: family ?? 0,
        }),
      )
    })

  beforeEach(() => {
    mockedDnsLookup.mockReset()
  })

  it('passes the address through when DNS resolves to a single public unicast IP', async () => {
    stubDnsLookup([{ address: '93.184.216.34', family: 4 }])

    const { err, address, family } = await invoke()

    expect(err).toBeNull()
    expect(address).toBe('93.184.216.34')
    expect(family).toBe(4)
  })

  it('propagates the dns.lookup error to the callback', async () => {
    stubDnsLookup(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }))

    const { err, address, family } = await invoke()

    expect(err).toBeInstanceOf(Error)
    expect(err?.message).toBe('ENOTFOUND')
    expect(address).toBe('')
    expect(family).toBe(0)
  })

  it('rejects when any resolved address is non-public (single private result)', async () => {
    stubDnsLookup([{ address: '10.0.0.1', family: 4 }])

    const { err, address } = await invoke('attacker.example.com')

    expect(err).toBeInstanceOf(Error)
    expect(err?.message).toMatch(/non-public IP 10\.0\.0\.1/)
    expect(address).toBe('')
  })

  it('rejects when any resolved address is non-public (mixed v4 public + v6 link-local)', async () => {
    stubDnsLookup([
      { address: '93.184.216.34', family: 4 },
      { address: 'fe80::1', family: 6 },
    ])

    const { err } = await invoke()

    expect(err).toBeInstanceOf(Error)
    expect(err?.message).toMatch(/non-public IP fe80::1/)
  })

  it('rejects with a clear error when dns.lookup returns an empty array', async () => {
    stubDnsLookup([])

    const { err, address, family } = await invoke('empty.example.com')

    expect(err).toBeInstanceOf(Error)
    expect(err?.message).toMatch(/No addresses resolved/)
    expect(address).toBe('')
    expect(family).toBe(0)
  })

  it('rejects the AWS metadata IP (169.254.169.254)', async () => {
    stubDnsLookup([{ address: '169.254.169.254', family: 4 }])

    const { err } = await invoke()

    expect(err).toBeInstanceOf(Error)
    expect(err?.message).toMatch(/169\.254\.169\.254/)
  })

  // Node's http/https Agent calls the custom lookup with `all: true`. In that
  // mode the callback contract is the array form `(err, LookupAddress[])`.
  // The single-address form makes Node throw ERR_INVALID_IP_ADDRESS, which
  // silently broke every prod verify-live fetch. The other tests here pass
  // `{}`, so this path was previously uncovered.
  it('calls back with the full address array when invoked with all:true', async () => {
    stubDnsLookup([
      { address: '93.184.216.34', family: 4 },
      { address: '93.184.216.35', family: 4 },
    ])

    const addresses = await new Promise<string | dns.LookupAddress[]>(
      (resolve, reject) => {
        ssrfSafeLookup('example.com', { all: true }, (err, address) =>
          err ? reject(err) : resolve(address),
        )
      },
    )

    expect(addresses).toEqual([
      { address: '93.184.216.34', family: 4 },
      { address: '93.184.216.35', family: 4 },
    ])
  })
})

describe('applyCompliancePublishFallbacks', () => {
  const user = createMockUser({ firstName: 'Rick', lastName: 'Bennett' })
  const campaign: CampaignWith<'campaignPositions'> = {
    ...createMockCampaign({ details: { state: 'ME' } }),
    campaignPositions: [],
  }

  it('backfills title and email but not bio or issues', () => {
    const patched = applyCompliancePublishFallbacks({}, user, campaign)

    expect(patched?.main?.title).toBe('Vote For Rick Bennett')
    expect(patched?.contact?.email).toBe(user.email)
    expect(patched?.about?.bio ?? '').toBe('')
    expect(patched?.about?.issues ?? []).toEqual([])
  })

  it('returns null when all publish-gated fields are already present', () => {
    const content = {
      main: { title: 'Vote For Rick Bennett' },
      about: {
        bio: '<p>A candidate-authored biography that the agent must keep.</p>',
        issues: [{ title: 'Housing', description: 'More affordable homes' }],
      },
      contact: { email: 'rick@example.com' },
    }

    expect(applyCompliancePublishFallbacks(content, user, campaign)).toBeNull()
  })

  it('never backfills a bio, even with existing issues present', () => {
    const content = {
      main: { title: 'Set' },
      contact: { email: 'x@example.com' },
      about: { issues: [{ title: 'Housing', description: 'More homes' }] },
    }

    expect(applyCompliancePublishFallbacks(content, user, campaign)).toBeNull()
  })

  it('seeds real campaign positions as issues, never a default', () => {
    const positions: PositionWithTopIssue[] = [
      {
        id: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        description: 'Build more affordable housing.',
        order: 0,
        campaignId: 1,
        positionId: 1,
        topIssueId: 5,
        topIssue: {
          id: 5,
          createdAt: new Date(),
          updatedAt: new Date(),
          name: 'Housing',
        },
      },
    ]
    const campaignWithPositions: CampaignWith<'campaignPositions'> = {
      ...createMockCampaign({ details: { state: 'ME' } }),
      campaignPositions: positions,
    }
    const content = { about: { bio: '<p>A real candidate bio.</p>' } }

    const patched = applyCompliancePublishFallbacks(
      content,
      user,
      campaignWithPositions,
    )

    expect(patched?.about?.bio).toBe('<p>A real candidate bio.</p>')
    expect(patched?.about?.issues).toEqual([
      { title: 'Housing', description: 'Build more affordable housing.' },
    ])
  })

  it('backfills main.title and contact.email when they are empty', () => {
    const patched = applyCompliancePublishFallbacks({}, user, campaign)

    expect(patched?.main?.title).toBe('Vote For Rick Bennett')
    expect(patched?.contact?.email).toBe(user.email)
  })

  it('keeps an existing main.title and contact.email', () => {
    const content = {
      main: { title: 'Rick Bennett for Council' },
      about: {
        bio: '<p>Real bio.</p>',
        issues: [{ title: 'Housing', description: 'More homes' }],
      },
      contact: { email: 'custom@example.com' },
    }

    expect(applyCompliancePublishFallbacks(content, user, campaign)).toBeNull()
  })

  it('falls back to a placeholder name when the user has no name', () => {
    const namelessUser = createMockUser({ firstName: null, name: null })

    const patched = applyCompliancePublishFallbacks({}, namelessUser, campaign)

    expect(patched?.main?.title).toBe('Vote For The Candidate')
  })

  it('drops issues with blank title or description, seeding none by default', () => {
    const content = {
      about: {
        bio: '<p>Real bio.</p>',
        issues: [{ title: 'Housing', description: '   ' }],
      },
      main: { title: 'Set' },
      contact: { email: 'x@example.com' },
    }

    const patched = applyCompliancePublishFallbacks(content, user, campaign)

    expect(patched?.about?.issues).toEqual([])
  })

  it('keeps valid issues while dropping malformed ones', () => {
    const content = {
      about: {
        bio: '<p>Real bio.</p>',
        issues: [
          { title: 'Housing', description: 'More homes' },
          { title: 'Roads', description: '' },
        ],
      },
      main: { title: 'Set' },
      contact: { email: 'x@example.com' },
    }

    const patched = applyCompliancePublishFallbacks(content, user, campaign)

    expect(patched?.about?.issues).toEqual([
      { title: 'Housing', description: 'More homes' },
    ])
  })

  it('seeds issues from real campaign positions before the default', () => {
    // Legacy-Pro candidates often have real top-issue positions but an empty
    // about.issues; the fallback must surface those, not the generic default
    // (ENG-10602).
    const positions: PositionWithTopIssue[] = [
      {
        id: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        description: 'Lower the cost of housing across Maine.',
        order: 0,
        campaignId: 1,
        positionId: 1,
        topIssueId: 5,
        topIssue: {
          id: 5,
          createdAt: new Date(),
          updatedAt: new Date(),
          name: 'Housing Affordability',
        },
      },
    ]
    const campaignWithPositions: CampaignWith<'campaignPositions'> = {
      ...createMockCampaign({ details: { state: 'ME' } }),
      campaignPositions: positions,
    }

    const patched = applyCompliancePublishFallbacks(
      {},
      user,
      campaignWithPositions,
    )

    expect(patched?.about?.issues).toEqual([
      {
        title: 'Housing Affordability',
        description: 'Lower the cost of housing across Maine.',
      },
    ])
    expect(patched?.about?.issues?.[0]?.title).not.toBe(
      'Local Solutions, Not Party Politics',
    )
  })
})

describe('WebsitesService.ensureCompliancePublishableWebsite', () => {
  let service: WebsitesService
  let mockPrisma: {
    website: {
      findUnique: ReturnType<typeof vi.fn>
      create: ReturnType<typeof vi.fn>
      update: ReturnType<typeof vi.fn>
    }
  }
  const user = createMockUser({ firstName: 'Rick', lastName: 'Bennett' })
  const campaign: CampaignWith<'campaignPositions'> = {
    ...createMockCampaign({ id: 99, details: { state: 'ME' } }),
    campaignPositions: [],
  }

  beforeEach(async () => {
    mockPrisma = {
      website: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebsitesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PinoLogger, useValue: createMockLogger() },
      ],
    }).compile()

    service = module.get<WebsitesService>(WebsitesService)
    vi.clearAllMocks()
  })

  it('creates a website and does not backfill once title/email are set', async () => {
    mockPrisma.website.findUnique.mockResolvedValue(null)
    mockPrisma.website.create.mockResolvedValue({
      id: 5,
      campaignId: 99,
      content: {
        main: { title: 'Vote For Rick Bennett' },
        about: { issues: [] },
        contact: { email: 'rick@example.com' },
      },
    })

    await service.ensureCompliancePublishableWebsite(user, campaign)

    expect(mockPrisma.website.create).toHaveBeenCalledTimes(1)
    expect(mockPrisma.website.update).not.toHaveBeenCalled()
  })

  it('does not create or update when the website is already publishable', async () => {
    mockPrisma.website.findUnique.mockResolvedValue({
      id: 5,
      campaignId: 99,
      content: {
        main: { title: 'Vote For Rick Bennett' },
        about: {
          bio: '<p>A real candidate bio that should be left alone.</p>',
          issues: [{ title: 'Housing', description: 'More homes' }],
        },
        contact: { email: 'rick@example.com' },
      },
    })

    await service.ensureCompliancePublishableWebsite(user, campaign)

    expect(mockPrisma.website.create).not.toHaveBeenCalled()
    expect(mockPrisma.website.update).not.toHaveBeenCalled()
  })

  it('creates a website with a placeholder title when the user has no name', async () => {
    const namelessUser = createMockUser({ firstName: null, name: null })
    mockPrisma.website.findUnique.mockResolvedValue(null)
    mockPrisma.website.create.mockImplementation(
      ({ data }: { data: { content: PrismaJson.WebsiteContent } }) => ({
        id: 8,
        campaignId: 99,
        content: data.content,
      }),
    )

    await service.ensureCompliancePublishableWebsite(namelessUser, campaign)

    const createArg = firstOrThrow(mockPrisma.website.create.mock.calls)[0]
    expect(createArg.data.content.main.title).toBe('Vote For The Candidate')
  })

  it('drops incomplete positions, leaving issues empty rather than a default', async () => {
    // A description-only position (no topIssue → empty title) is incomplete;
    // it must be dropped rather than emitted as "Issue 1: <description>".
    const campaignWithIncompletePosition: CampaignWith<'campaignPositions'> = {
      ...createMockCampaign({ id: 99, details: { state: 'ME' } }),
      campaignPositions: [
        {
          id: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          description: 'Roads need repair',
          order: 0,
          campaignId: 99,
          positionId: 1,
          topIssueId: null,
        },
      ],
    }
    mockPrisma.website.findUnique.mockResolvedValue(null)
    mockPrisma.website.create.mockImplementation(
      ({ data }: { data: { content: PrismaJson.WebsiteContent } }) => ({
        id: 9,
        campaignId: 99,
        content: data.content,
      }),
    )

    await service.ensureCompliancePublishableWebsite(
      user,
      campaignWithIncompletePosition,
    )

    const createArg = firstOrThrow(mockPrisma.website.create.mock.calls)[0]
    expect(createArg.data.content.about.issues).toEqual([])
  })

  it('backfills an existing website with gaps without creating a new one', async () => {
    mockPrisma.website.findUnique.mockResolvedValue({
      id: 7,
      campaignId: 99,
      content: {
        about: { issues: [] },
      },
    })

    await service.ensureCompliancePublishableWebsite(user, campaign)

    expect(mockPrisma.website.create).not.toHaveBeenCalled()
    expect(mockPrisma.website.update).toHaveBeenCalledTimes(1)
    const updateArg = firstOrThrow(mockPrisma.website.update.mock.calls)[0]
    expect(updateArg.where).toEqual({ campaignId: 99 })
    expect(updateArg.data.content.main.title).toBe('Vote For Rick Bennett')
    expect(updateArg.data.content.contact.email).toBe(user.email)
    expect(updateArg.data.content.about.issues).toEqual([])
  })
})

describe('WebsitesService.createByCampaign', () => {
  let service: WebsitesService
  let mockPrisma: {
    website: { create: ReturnType<typeof vi.fn> }
  }
  const user = createMockUser({ firstName: 'Rick', lastName: 'Bennett' })
  const campaign: CampaignWith<'campaignPositions'> = {
    ...createMockCampaign({ id: 99, details: { state: 'ME' } }),
    campaignPositions: [],
  }

  beforeEach(async () => {
    mockPrisma = { website: { create: vi.fn() } }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebsitesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PinoLogger, useValue: createMockLogger() },
      ],
    }).compile()

    service = module.get<WebsitesService>(WebsitesService)
  })

  it('seeds empty issues and no tagline when the campaign has no positions', () => {
    service.createByCampaign(user, campaign)

    const createArg = firstOrThrow(mockPrisma.website.create.mock.calls)[0]
    expect(createArg.data.content.main.title).toBe('Vote For Rick Bennett')
    expect(createArg.data.content.main.tagline).toBeUndefined()
    expect(createArg.data.content.about.issues).toEqual([])
    expect(createArg.data.content.contact.email).toBe(user.email)
  })

  it('seeds real campaign positions as issues', () => {
    const positions: PositionWithTopIssue[] = [
      {
        id: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        description: 'Build more affordable housing.',
        order: 0,
        campaignId: 99,
        positionId: 1,
        topIssueId: 5,
        topIssue: {
          id: 5,
          createdAt: new Date(),
          updatedAt: new Date(),
          name: 'Housing',
        },
      },
    ]
    const campaignWithPositions: CampaignWith<'campaignPositions'> = {
      ...createMockCampaign({ id: 99, details: { state: 'ME' } }),
      campaignPositions: positions,
    }

    service.createByCampaign(user, campaignWithPositions)

    const createArg = firstOrThrow(mockPrisma.website.create.mock.calls)[0]
    expect(createArg.data.content.about.issues).toEqual([
      { title: 'Housing', description: 'Build more affordable housing.' },
    ])
  })
})

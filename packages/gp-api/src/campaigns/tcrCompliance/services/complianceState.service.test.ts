import {
  Campaign,
  Domain,
  DomainStatus,
  TcrCompliance,
  TcrComplianceStatus,
  Website,
  WebsiteStatus,
} from '../../../generated/prisma'
import {
  ComplianceStage,
  PeerlyCvVerificationStatus,
} from '@goodparty_org/contracts'
import { parseISO } from 'date-fns'
import { Test, TestingModule } from '@nestjs/testing'
import { BadGatewayException } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PinoLogger } from 'nestjs-pino'
import { PrismaService } from '@/prisma/prisma.service'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { PeerlyIdentityService } from '../../../vendors/peerly/services/peerlyIdentity.service'
import {
  ComplianceStateService,
  deriveComplianceStage,
} from './complianceState.service'

const mockCampaign = (
  overrides?: Partial<Pick<Campaign, 'formattedAddress'>>,
): Pick<Campaign, 'formattedAddress'> => ({
  formattedAddress: '123 Main St, Anytown, USA',
  ...overrides,
})

const mockWebsite = (
  status: WebsiteStatus = WebsiteStatus.published,
): Pick<Website, 'status'> => ({ status })

const mockDomain = (
  overrides?: Partial<
    Pick<Domain, 'status' | 'registrantVerifiedAt' | 'createdAt'>
  >,
): Pick<Domain, 'status' | 'registrantVerifiedAt' | 'createdAt'> => ({
  status: DomainStatus.registered,
  registrantVerifiedAt: new Date(),
  createdAt: parseISO('2026-06-15T00:00:00Z'),
  ...overrides,
})

const mockTcr = (
  overrides?: Partial<
    Pick<
      TcrCompliance,
      | 'status'
      | 'peerlyIdentityId'
      | 'internalTestingApprovedAt'
      | 'cvValidationFailedAt'
    >
  >,
): Pick<
  TcrCompliance,
  | 'status'
  | 'peerlyIdentityId'
  | 'internalTestingApprovedAt'
  | 'cvValidationFailedAt'
> => ({
  status: TcrComplianceStatus.submitted,
  peerlyIdentityId: null,
  internalTestingApprovedAt: null,
  cvValidationFailedAt: null,
  ...overrides,
})

describe('deriveComplianceStage', () => {
  it('returns needs_profile when no address and no compliance record', () => {
    expect(
      deriveComplianceStage(
        mockCampaign({ formattedAddress: null }),
        null,
        null,
        null,
      ),
    ).toBe(ComplianceStage.needs_profile)
  })

  it('returns needs_filing when address present but no compliance record', () => {
    expect(deriveComplianceStage(mockCampaign(), null, null, null)).toBe(
      ComplianceStage.needs_filing,
    )
  })

  it('returns pending_domain_purchase when compliance record exists but no domain', () => {
    expect(deriveComplianceStage(mockCampaign(), null, null, mockTcr())).toBe(
      ComplianceStage.pending_domain_purchase,
    )
  })

  it('returns pending_domain_purchase when domain is still pending', () => {
    expect(
      deriveComplianceStage(
        mockCampaign(),
        mockWebsite(WebsiteStatus.unpublished),
        mockDomain({
          status: DomainStatus.pending,
          registrantVerifiedAt: null,
        }),
        mockTcr(),
      ),
    ).toBe(ComplianceStage.pending_domain_purchase)
  })

  it('returns pending_website_live when domain registered but website not published', () => {
    expect(
      deriveComplianceStage(
        mockCampaign(),
        mockWebsite(WebsiteStatus.unpublished),
        mockDomain(),
        mockTcr(),
      ),
    ).toBe(ComplianceStage.pending_website_live)
  })

  it('returns pending_website_live when website published but registrant unverified', () => {
    expect(
      deriveComplianceStage(
        mockCampaign(),
        mockWebsite(),
        mockDomain({ registrantVerifiedAt: null }),
        mockTcr(),
      ),
    ).toBe(ComplianceStage.pending_website_live)
  })

  it('clears the website gate for a legacy pre-2026-06 domain with no registrant stamp', () => {
    expect(
      deriveComplianceStage(
        mockCampaign(),
        mockWebsite(),
        mockDomain({
          status: DomainStatus.submitted,
          registrantVerifiedAt: null,
          createdAt: parseISO('2026-05-08T11:14:36Z'),
        }),
        mockTcr(),
      ),
    ).toBe(ComplianceStage.ready_to_submit)
  })

  it('still requires the registrant stamp for a domain created after the cutoff', () => {
    expect(
      deriveComplianceStage(
        mockCampaign(),
        mockWebsite(),
        mockDomain({
          registrantVerifiedAt: null,
          createdAt: parseISO('2026-06-01T00:00:00Z'),
        }),
        mockTcr(),
      ),
    ).toBe(ComplianceStage.pending_website_live)
  })

  it('does not let a legacy domain bypass the published-website requirement', () => {
    expect(
      deriveComplianceStage(
        mockCampaign(),
        mockWebsite(WebsiteStatus.unpublished),
        mockDomain({
          registrantVerifiedAt: null,
          createdAt: parseISO('2026-05-08T11:14:36Z'),
        }),
        mockTcr(),
      ),
    ).toBe(ComplianceStage.pending_website_live)
  })

  // ENG-11018: `awaiting_pin` used to be the fallthrough for every live-site
  // `submitted` record, so a record that never reached Peerly reported an
  // outstanding PIN that was never issued. `peerlyIdentityId` is what tells
  // the two halves apart.
  it('returns ready_to_submit when the site is live but nothing reached Peerly', () => {
    expect(
      deriveComplianceStage(
        mockCampaign(),
        mockWebsite(),
        mockDomain(),
        mockTcr({ peerlyIdentityId: null }),
      ),
    ).toBe(ComplianceStage.ready_to_submit)
  })

  it('returns awaiting_pin only once a Peerly identity exists', () => {
    expect(
      deriveComplianceStage(
        mockCampaign(),
        mockWebsite(),
        mockDomain(),
        mockTcr({ peerlyIdentityId: 'peerly-123' }),
      ),
    ).toBe(ComplianceStage.awaiting_pin)
  })

  it('returns filing_review_hold when the CV pre-submission gate holds it', () => {
    expect(
      deriveComplianceStage(
        mockCampaign(),
        mockWebsite(),
        mockDomain(),
        mockTcr({
          peerlyIdentityId: null,
          cvValidationFailedAt: parseISO('2026-09-01T18:08:56Z'),
        }),
      ),
    ).toBe(ComplianceStage.filing_review_hold)
  })

  // An admin override clears the hold columns in the same write
  // (overrideCvValidation), so an overridden record is indistinguishable from
  // one that was never held — and must be submittable again.
  it('returns ready_to_submit once a held record has been overridden', () => {
    expect(
      deriveComplianceStage(
        mockCampaign(),
        mockWebsite(),
        mockDomain(),
        mockTcr({ peerlyIdentityId: null, cvValidationFailedAt: null }),
      ),
    ).toBe(ComplianceStage.ready_to_submit)
  })

  it('lets a terminal TCR status outrank a stale validation hold', () => {
    expect(
      deriveComplianceStage(
        mockCampaign(),
        mockWebsite(),
        mockDomain(),
        mockTcr({
          status: TcrComplianceStatus.approved,
          peerlyIdentityId: 'peerly-123',
          cvValidationFailedAt: parseISO('2026-09-01T18:08:56Z'),
        }),
      ),
    ).toBe(ComplianceStage.tcr_approved)
  })

  it('returns tcr_in_review when status is pending', () => {
    expect(
      deriveComplianceStage(
        mockCampaign(),
        mockWebsite(),
        mockDomain(),
        mockTcr({
          status: TcrComplianceStatus.pending,
          peerlyIdentityId: 'peerly-123',
        }),
      ),
    ).toBe(ComplianceStage.tcr_in_review)
  })

  it('returns tcr_approved when status is approved', () => {
    expect(
      deriveComplianceStage(
        mockCampaign(),
        mockWebsite(),
        mockDomain(),
        mockTcr({
          status: TcrComplianceStatus.approved,
          peerlyIdentityId: 'peerly-123',
        }),
      ),
    ).toBe(ComplianceStage.tcr_approved)
  })

  // Internal-testing approvals have no domain/website/Peerly footprint, so
  // the live-website precondition must not downgrade them.
  it('returns tcr_approved for an internal-testing approval with no domain or website', () => {
    expect(
      deriveComplianceStage(
        mockCampaign(),
        null,
        null,
        mockTcr({
          status: TcrComplianceStatus.approved,
          internalTestingApprovedAt: new Date(),
        }),
      ),
    ).toBe(ComplianceStage.tcr_approved)
  })

  // A live website is a precondition for submission, so it gates every
  // submission-or-later stage. An `approved` record whose site is no longer
  // live (or whose domain never verified) must report pending_website_live so
  // the setup agent republishes/re-verifies instead of skipping those steps on
  // the strength of a stale approval — the exact prod state behind campaign
  // 21062 (approved TCR, unpublished website, unverified domain).
  it('returns pending_website_live when approved but website is unpublished', () => {
    expect(
      deriveComplianceStage(
        mockCampaign(),
        mockWebsite(WebsiteStatus.unpublished),
        mockDomain(),
        mockTcr({
          status: TcrComplianceStatus.approved,
          peerlyIdentityId: 'peerly-123',
        }),
      ),
    ).toBe(ComplianceStage.pending_website_live)
  })

  it('returns pending_website_live when approved but domain registrant is unverified', () => {
    expect(
      deriveComplianceStage(
        mockCampaign(),
        mockWebsite(),
        mockDomain({ registrantVerifiedAt: null }),
        mockTcr({
          status: TcrComplianceStatus.approved,
          peerlyIdentityId: 'peerly-123',
        }),
      ),
    ).toBe(ComplianceStage.pending_website_live)
  })

  it('returns pending_website_live when in review but website is unpublished', () => {
    expect(
      deriveComplianceStage(
        mockCampaign(),
        mockWebsite(WebsiteStatus.unpublished),
        mockDomain(),
        mockTcr({
          status: TcrComplianceStatus.pending,
          peerlyIdentityId: 'peerly-123',
        }),
      ),
    ).toBe(ComplianceStage.pending_website_live)
  })

  it('returns tcr_rejected when status is rejected', () => {
    expect(
      deriveComplianceStage(
        mockCampaign(),
        mockWebsite(),
        mockDomain(),
        mockTcr({
          status: TcrComplianceStatus.rejected,
          peerlyIdentityId: 'peerly-123',
        }),
      ),
    ).toBe(ComplianceStage.tcr_rejected)
  })

  it('returns tcr_rejected when status is error', () => {
    expect(
      deriveComplianceStage(
        mockCampaign(),
        mockWebsite(),
        mockDomain(),
        mockTcr({
          status: TcrComplianceStatus.error,
          peerlyIdentityId: 'peerly-123',
        }),
      ),
    ).toBe(ComplianceStage.tcr_rejected)
  })
})

describe('ComplianceStateService - findStateForCampaign', () => {
  const PEERLY_IDENTITY_ID = 'peerly-123'
  let service: ComplianceStateService
  let mockRetrieveCv: ReturnType<typeof vi.fn>
  let mockFindUniqueOrThrow: ReturnType<typeof vi.fn>

  // A campaign row whose derived stage is `awaiting_pin` (live site + verified
  // domain + a `submitted` TCR record), so the CV-status resolution runs.
  const awaitingPinCampaign = (
    tcrOverrides?: Partial<
      Pick<
        TcrCompliance,
        'status' | 'peerlyIdentityId' | 'peerlyCvVerificationId'
      >
    >,
  ) => ({
    id: 42,
    formattedAddress: '123 Main St, Anytown, USA',
    website: {
      id: 7,
      status: WebsiteStatus.published,
      domain: {
        name: 'candidate.org',
        status: DomainStatus.registered,
        registrantVerifiedAt: new Date('2026-01-01T00:00:00Z'),
      },
    },
    tcrCompliance: {
      status: TcrComplianceStatus.submitted,
      peerlyIdentityId: PEERLY_IDENTITY_ID,
      peerlyCvVerificationId: 'cv-123',
      ...tcrOverrides,
    },
  })

  beforeEach(async () => {
    mockRetrieveCv = vi.fn()
    mockFindUniqueOrThrow = vi.fn()

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: PrismaService,
          useValue: { campaign: { findUniqueOrThrow: mockFindUniqueOrThrow } },
        },
        {
          provide: PeerlyIdentityService,
          useValue: { retrieveCampaignVerifyDetails: mockRetrieveCv },
        },
        { provide: PinoLogger, useValue: createMockLogger() },
        ComplianceStateService,
      ],
    }).compile()

    service = module.get(ComplianceStateService)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('surfaces the live Peerly CV status + PIN delivery at awaiting_pin in prod', async () => {
    vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'prod')
    mockFindUniqueOrThrow.mockResolvedValue(awaitingPinCampaign())
    mockRetrieveCv.mockResolvedValue({
      status: PeerlyCvVerificationStatus.APPROVED,
      pinDelivery: { method: 'text', destination: '3126851162' },
    })

    const result = await service.findStateForCampaign(42)

    expect(result.stage).toBe(ComplianceStage.awaiting_pin)
    expect(result.peerlyCvStatus).toBe(PeerlyCvVerificationStatus.APPROVED)
    // Raw destination masked server-side into the display string.
    expect(result.pinDelivery).toEqual({
      method: 'text',
      displayString: '(312) •••-1162',
    })
    expect(mockRetrieveCv).toHaveBeenCalledWith(
      PEERLY_IDENTITY_ID,
      expect.anything(),
    )
  })

  it('reports IN_REVIEW with null PIN delivery before Peerly issues a PIN', async () => {
    vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'prod')
    mockFindUniqueOrThrow.mockResolvedValue(awaitingPinCampaign())
    mockRetrieveCv.mockResolvedValue({
      status: PeerlyCvVerificationStatus.IN_REVIEW,
      pinDelivery: null,
    })

    const result = await service.findStateForCampaign(42)

    expect(result.peerlyCvStatus).toBe(PeerlyCvVerificationStatus.IN_REVIEW)
    expect(result.pinDelivery).toBeNull()
  })

  // Before ENG-11018 this same record reported `awaiting_pin` — an
  // outstanding PIN for a candidate Peerly had never heard of. It now reports
  // the pre-submission stage, and the Peerly read is skipped by the stage
  // itself rather than by the identity check further in.
  it('reports ready_to_submit and calls no Peerly when no identity exists', async () => {
    vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'prod')
    mockFindUniqueOrThrow.mockResolvedValue(
      awaitingPinCampaign({ peerlyIdentityId: null }),
    )

    const result = await service.findStateForCampaign(42)

    expect(result.stage).toBe(ComplianceStage.ready_to_submit)
    expect(result.peerlyCvStatus).toBeNull()
    expect(result.pinDelivery).toBeNull()
    expect(mockRetrieveCv).not.toHaveBeenCalled()
  })

  it('degrades an unrecognized Peerly status to null (keeping PIN delivery)', async () => {
    vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'prod')
    mockFindUniqueOrThrow.mockResolvedValue(awaitingPinCampaign())
    mockRetrieveCv.mockResolvedValue({
      status: 'SOMETHING_NEW',
      pinDelivery: null,
    })

    const result = await service.findStateForCampaign(42)

    expect(result.peerlyCvStatus).toBeNull()
    expect(result.pinDelivery).toBeNull()
  })

  // A transient Peerly error must not 502 the compliance-state read (polled by
  // the agent + FE). retrieveCampaignVerifyDetails throws BadGatewayException via
  // handleApiError on any non-404 failure, so mock that production error here.
  it('degrades CV status + PIN delivery to null when the Peerly read throws', async () => {
    vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'prod')
    mockFindUniqueOrThrow.mockResolvedValue(awaitingPinCampaign())
    mockRetrieveCv.mockRejectedValue(
      new BadGatewayException('Peerly retrieve_cv failed'),
    )

    const result = await service.findStateForCampaign(42)

    expect(result.stage).toBe(ComplianceStage.awaiting_pin)
    expect(result.peerlyCvStatus).toBeNull()
    expect(result.pinDelivery).toBeNull()
  })

  it('short-circuits to APPROVED with null PIN delivery in non-prod', async () => {
    vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'dev')
    mockFindUniqueOrThrow.mockResolvedValue(awaitingPinCampaign())

    const result = await service.findStateForCampaign(42)

    expect(result.peerlyCvStatus).toBe(PeerlyCvVerificationStatus.APPROVED)
    expect(result.pinDelivery).toBeNull()
    expect(mockRetrieveCv).not.toHaveBeenCalled()
  })

  it('does not resolve CV state outside the awaiting_pin stage', async () => {
    vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'prod')
    mockFindUniqueOrThrow.mockResolvedValue(
      awaitingPinCampaign({ status: TcrComplianceStatus.pending }),
    )

    const result = await service.findStateForCampaign(42)

    expect(result.stage).toBe(ComplianceStage.tcr_in_review)
    expect(result.peerlyCvStatus).toBeNull()
    expect(result.pinDelivery).toBeNull()
    expect(mockRetrieveCv).not.toHaveBeenCalled()
  })
})

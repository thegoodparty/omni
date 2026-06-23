import {
  Campaign,
  Domain,
  DomainStatus,
  TcrCompliance,
  TcrComplianceStatus,
  Website,
  WebsiteStatus,
} from '../../../generated/prisma'
import { ComplianceStage } from '@goodparty_org/contracts'
import { describe, expect, it } from 'vitest'
import { deriveComplianceStage } from './complianceState.service'

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
  overrides?: Partial<Pick<Domain, 'status' | 'registrantVerifiedAt'>>,
): Pick<Domain, 'status' | 'registrantVerifiedAt'> => ({
  status: DomainStatus.registered,
  registrantVerifiedAt: new Date(),
  ...overrides,
})

const mockTcr = (
  overrides?: Partial<Pick<TcrCompliance, 'status' | 'peerlyIdentityId'>>,
): Pick<TcrCompliance, 'status' | 'peerlyIdentityId'> => ({
  status: TcrComplianceStatus.submitted,
  peerlyIdentityId: null,
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

  it('returns awaiting_pin when website is live and TCR status is submitted', () => {
    expect(
      deriveComplianceStage(
        mockCampaign(),
        mockWebsite(),
        mockDomain(),
        mockTcr(),
      ),
    ).toBe(ComplianceStage.awaiting_pin)
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

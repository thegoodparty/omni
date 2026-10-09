import { TcrCompliance, TcrComplianceStatus } from '../../../generated/prisma'
import { ComplianceStage } from '@goodparty_org/contracts'
import { describe, expect, it } from 'vitest'
import { deriveComplianceStage } from './complianceState.service'

// Minimal campaign + domain + website fixtures so deriveComplianceStage is
// callable without reaching the domain/website branches (internalTestingAt
// short-circuits before those checks).
const campaign = { formattedAddress: '123 Main St, Springfield, USA' }

const mockTestOrgTcr = (
  overrides?: Partial<
    Pick<
      TcrCompliance,
      | 'status'
      | 'peerlyIdentityId'
      | 'internalTestingAt'
      | 'internalTestingApprovedAt'
      | 'cvValidationFailedAt'
    >
  >,
): Pick<
  TcrCompliance,
  | 'status'
  | 'peerlyIdentityId'
  | 'internalTestingAt'
  | 'internalTestingApprovedAt'
  | 'cvValidationFailedAt'
> => ({
  status: TcrComplianceStatus.submitted,
  peerlyIdentityId: null,
  internalTestingAt: new Date('2026-10-01T00:00:00Z'),
  internalTestingApprovedAt: null,
  cvValidationFailedAt: null,
  ...overrides,
})

describe('deriveComplianceStage — test-org rows (internalTestingAt set)', () => {
  it('returns tcr_approved when status is approved', () => {
    expect(
      deriveComplianceStage(
        campaign,
        null,
        null,
        mockTestOrgTcr({ status: TcrComplianceStatus.approved }),
      ),
    ).toBe(ComplianceStage.tcr_approved)
  })

  it('returns tcr_in_review when status is pending', () => {
    expect(
      deriveComplianceStage(
        campaign,
        null,
        null,
        mockTestOrgTcr({ status: TcrComplianceStatus.pending }),
      ),
    ).toBe(ComplianceStage.tcr_in_review)
  })

  it('returns filing_review_hold when cvValidationFailedAt is set', () => {
    expect(
      deriveComplianceStage(
        campaign,
        null,
        null,
        mockTestOrgTcr({ cvValidationFailedAt: new Date() }),
      ),
    ).toBe(ComplianceStage.filing_review_hold)
  })

  it('returns ready_to_submit when no peerlyIdentityId and no hold', () => {
    expect(
      deriveComplianceStage(
        campaign,
        null,
        null,
        mockTestOrgTcr({ peerlyIdentityId: null }),
      ),
    ).toBe(ComplianceStage.ready_to_submit)
  })

  it('returns awaiting_pin when peerlyIdentityId is set', () => {
    expect(
      deriveComplianceStage(
        campaign,
        null,
        null,
        mockTestOrgTcr({ peerlyIdentityId: 'peerly-id-123' }),
      ),
    ).toBe(ComplianceStage.awaiting_pin)
  })

  it('short-circuits before domain/website checks (no domain present)', () => {
    // Without the internalTestingAt branch this would fall through to
    // pending_domain_purchase because domain is null.
    expect(
      deriveComplianceStage(
        campaign,
        null,
        null,
        mockTestOrgTcr({ peerlyIdentityId: 'peerly-id-456' }),
      ),
    ).toBe(ComplianceStage.awaiting_pin)
  })
})

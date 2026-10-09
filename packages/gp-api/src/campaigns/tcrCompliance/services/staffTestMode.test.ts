import { TcrCompliance, TcrComplianceStatus } from '../../../generated/prisma'
import { ComplianceStage } from '@goodparty_org/contracts'
import { describe, expect, it } from 'vitest'
import { deriveComplianceStage } from './complianceState.service'

// Minimal campaign + domain + website fixtures so deriveComplianceStage is
// callable without reaching the domain/website branches (internalTestingAt
// short-circuits before those checks). Rows with internalTestingApprovedAt
// unset are the shape the test-mode presets will write; rows with both
// markers set are what the admin checkbox and the backfill produce today.
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

  it('returns tcr_rejected when status is rejected', () => {
    expect(
      deriveComplianceStage(
        campaign,
        null,
        null,
        mockTestOrgTcr({ status: TcrComplianceStatus.rejected }),
      ),
    ).toBe(ComplianceStage.tcr_rejected)
  })

  it('returns tcr_approved for an admin-approved row that carries both markers', () => {
    // The backfill and grantInternalTestingApproval set both columns; the
    // row must still read as approved regardless of its persisted status.
    expect(
      deriveComplianceStage(
        campaign,
        null,
        null,
        mockTestOrgTcr({
          internalTestingApprovedAt: new Date('2026-09-01T00:00:00Z'),
          status: TcrComplianceStatus.submitted,
        }),
      ),
    ).toBe(ComplianceStage.tcr_approved)
  })

  it('derives intermediate stages when only internalTestingAt is set', () => {
    // Pins the ordering against the internalTestingApprovedAt guard: a row
    // with the synthetic marker alone must not collapse to tcr_approved.
    expect(
      deriveComplianceStage(
        campaign,
        null,
        null,
        mockTestOrgTcr({ status: TcrComplianceStatus.pending }),
      ),
    ).not.toBe(ComplianceStage.tcr_approved)
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

import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { CommitteeType, OfficeLevel } from '../../../generated/prisma'
import {
  tcrComplianceBaseShape,
  tcrComplianceSuperRefine,
} from './tcrComplianceBase.schema'

const schema = (options?: { requireFecCommitteeId?: boolean }) =>
  z
    .object({
      officeLevel: z.nativeEnum(OfficeLevel),
      fecCommitteeId: z.string().optional(),
      committeeType: z.nativeEnum(CommitteeType).optional(),
      filingUrl: z.string(),
    })
    .superRefine((data, ctx) => tcrComplianceSuperRefine(data, ctx, options))

const federalBase = {
  officeLevel: OfficeLevel.federal,
  committeeType: CommitteeType.HOUSE,
  filingUrl: 'https://www.fec.gov/data/committee/C00936328/',
}

const localBase = {
  officeLevel: OfficeLevel.local,
  filingUrl: 'https://sos.example.gov/candidates/jane',
}

describe('tcrComplianceBaseShape.fecCommitteeId', () => {
  it('normalizes an empty string to undefined (so the service ?? fallback fires)', () => {
    expect(tcrComplianceBaseShape.fecCommitteeId.parse('')).toBeUndefined()
  })

  it('preserves a provided committee id', () => {
    expect(tcrComplianceBaseShape.fecCommitteeId.parse('C00123456')).toBe(
      'C00123456',
    )
  })
})

describe('tcrComplianceBaseShape address fields', () => {
  it('rejects an empty placeId so compliance cannot start without an address', () => {
    expect(tcrComplianceBaseShape.placeId.safeParse('').success).toBe(false)
  })

  it('rejects an empty formattedAddress', () => {
    expect(tcrComplianceBaseShape.formattedAddress.safeParse('').success).toBe(
      false,
    )
  })

  it('rejects a whitespace-only placeId (trim runs before min)', () => {
    expect(tcrComplianceBaseShape.placeId.safeParse('   ').success).toBe(false)
  })

  it('rejects a whitespace-only formattedAddress (trim runs before min)', () => {
    expect(
      tcrComplianceBaseShape.formattedAddress.safeParse('   ').success,
    ).toBe(false)
  })

  it('accepts a resolved placeId and address', () => {
    expect(
      tcrComplianceBaseShape.placeId.safeParse('ChIJYTIMy9dP1oAR_sLgDF5Xg04')
        .success,
    ).toBe(true)
    expect(
      tcrComplianceBaseShape.formattedAddress.safeParse(
        '525 Montano Dr, San Luis, AZ 85349',
      ).success,
    ).toBe(true)
  })

  it('rejects an empty or whitespace-only committeeName', () => {
    expect(tcrComplianceBaseShape.committeeName.safeParse('').success).toBe(
      false,
    )
    expect(tcrComplianceBaseShape.committeeName.safeParse('   ').success).toBe(
      false,
    )
    expect(
      tcrComplianceBaseShape.committeeName.safeParse('Friends of Jane').success,
    ).toBe(true)
  })
})

describe('tcrComplianceSuperRefine — fecCommitteeId', () => {
  it('requires fecCommitteeId for federal by default', () => {
    const result = schema().safeParse(federalBase)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.path[0] === 'fecCommitteeId'),
      ).toBe(true)
    }
  })

  it('allows a federal payload with no fecCommitteeId when the requirement is opted out (submit path)', () => {
    const result = schema({ requireFecCommitteeId: false }).safeParse(
      federalBase,
    )
    expect(result.success).toBe(true)
  })

  it('still rejects a malformed fecCommitteeId even when the requirement is opted out', () => {
    const result = schema({ requireFecCommitteeId: false }).safeParse({
      ...federalBase,
      fecCommitteeId: 'not-a-committee-id',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.path[0] === 'fecCommitteeId'),
      ).toBe(true)
    }
  })
})

describe('tcrComplianceSuperRefine — filingUrl host', () => {
  const expectFilingUrlRejected = (filingUrl: string) => {
    const result = schema().safeParse({ ...localBase, filingUrl })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === 'filingUrl')).toBe(
        true,
      )
    }
  }

  it('rejects a goodparty.org filing URL (our own page, never a filing)', () => {
    expectFilingUrlRejected('https://goodparty.org/candidate/jane-doe')
  })

  it('rejects a bare goodparty.org domain filing URL', () => {
    expectFilingUrlRejected('goodparty.org/candidate/jane-doe')
  })

  it('rejects www.goodparty.org', () => {
    expectFilingUrlRejected('https://www.goodparty.org/elections/jane-doe')
  })

  it('rejects a goodparty.org subdomain', () => {
    expectFilingUrlRejected('https://elections.goodparty.org/jane-doe')
  })

  it('rejects goodparty.org behind a non-http scheme (no host-parse bypass)', () => {
    expectFilingUrlRejected('ftp://goodparty.org/candidate/jane-doe')
  })

  it('does not reject a lookalike domain that merely ends in goodparty.org', () => {
    const result = schema().safeParse({
      ...localBase,
      filingUrl: 'https://notgoodparty.org/candidates/jane-doe',
    })
    expect(result.success).toBe(true)
  })

  it('accepts a real election-authority filing URL', () => {
    expect(schema().safeParse(localBase).success).toBe(true)
  })
})

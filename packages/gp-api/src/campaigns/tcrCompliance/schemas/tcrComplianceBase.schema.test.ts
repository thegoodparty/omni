import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { CommitteeType, OfficeLevel } from '../../../generated/prisma'
import {
  formatManualFilingAddress,
  ManualFilingAddressSchema,
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
      placeId: z.string().optional(),
      formattedAddress: z.string().optional(),
      manualAddress: ManualFilingAddressSchema.optional(),
    })
    .superRefine((data, ctx) => tcrComplianceSuperRefine(data, ctx, options))

const resolvedAddress = {
  placeId: 'ChIJYTIMy9dP1oAR_sLgDF5Xg04',
  formattedAddress: '525 Montano Dr, San Luis, AZ 85349',
}

const federalBase = {
  officeLevel: OfficeLevel.federal,
  committeeType: CommitteeType.HOUSE,
  filingUrl: 'https://www.fec.gov/data/committee/C00936328/',
  ...resolvedAddress,
}

const localBase = {
  officeLevel: OfficeLevel.local,
  filingUrl: 'https://sos.example.gov/candidates/jane',
  ...resolvedAddress,
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

  it('rejects an empty or whitespace-only candidateName', () => {
    expect(tcrComplianceBaseShape.candidateName.safeParse('').success).toBe(
      false,
    )
    expect(tcrComplianceBaseShape.candidateName.safeParse('   ').success).toBe(
      false,
    )
    expect(
      tcrComplianceBaseShape.candidateName.safeParse('Jane Doe').success,
    ).toBe(true)
  })
})

describe('ManualFilingAddressSchema', () => {
  const manual = {
    addressLine1: 'PO Box 621',
    city: 'Toledo',
    state: 'wa',
    zip: '98591',
  }

  it('accepts a PO Box street line and uppercases the state', () => {
    const result = ManualFilingAddressSchema.parse(manual)
    expect(result.addressLine1).toBe('PO Box 621')
    expect(result.state).toBe('WA')
  })

  it('normalizes an empty addressLine2 to undefined', () => {
    expect(
      ManualFilingAddressSchema.parse({ ...manual, addressLine2: '' })
        .addressLine2,
    ).toBeUndefined()
  })

  it('rejects a non-state code', () => {
    expect(
      ManualFilingAddressSchema.safeParse({ ...manual, state: 'ZZ' }).success,
    ).toBe(false)
  })

  it('rejects a malformed ZIP and accepts ZIP+4', () => {
    expect(
      ManualFilingAddressSchema.safeParse({ ...manual, zip: '9859' }).success,
    ).toBe(false)
    expect(
      ManualFilingAddressSchema.safeParse({ ...manual, zip: '98591-1234' })
        .success,
    ).toBe(true)
  })

  it('rejects blank required components', () => {
    expect(
      ManualFilingAddressSchema.safeParse({ ...manual, addressLine1: '  ' })
        .success,
    ).toBe(false)
    expect(
      ManualFilingAddressSchema.safeParse({ ...manual, city: '' }).success,
    ).toBe(false)
  })
})

describe('formatManualFilingAddress', () => {
  it('composes line1, city, state, and zip', () => {
    expect(
      formatManualFilingAddress({
        addressLine1: 'PO Box 621',
        city: 'Toledo',
        state: 'WA',
        zip: '98591',
      }),
    ).toBe('PO Box 621, Toledo, WA 98591')
  })

  it('includes line2 when present', () => {
    expect(
      formatManualFilingAddress({
        addressLine1: '1931 State Route 505',
        addressLine2: 'Unit B',
        city: 'Toledo',
        state: 'WA',
        zip: '98591',
      }),
    ).toBe('1931 State Route 505, Unit B, Toledo, WA 98591')
  })
})

describe('tcrComplianceSuperRefine — address one-of', () => {
  const withoutAddress = ({
    placeId: _p,
    formattedAddress: _f,
    ...rest
  }: typeof localBase) => rest

  it('rejects a payload with neither a resolved nor a manual address', () => {
    const result = schema().safeParse(withoutAddress(localBase))
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === 'placeId')).toBe(
        true,
      )
    }
  })

  it('rejects a placeId without its formattedAddress pair', () => {
    const result = schema().safeParse({
      ...withoutAddress(localBase),
      placeId: resolvedAddress.placeId,
    })
    expect(result.success).toBe(false)
  })

  it('accepts a manual address with no placeId', () => {
    const result = schema().safeParse({
      ...withoutAddress(localBase),
      manualAddress: {
        addressLine1: 'PO Box 621',
        city: 'Toledo',
        state: 'WA',
        zip: '98591',
      },
    })
    expect(result.success).toBe(true)
  })

  it('accepts a resolved placeId + formattedAddress pair', () => {
    expect(schema().safeParse(localBase).success).toBe(true)
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

  it('rejects a URL with userinfo that hides the real host before the @', () => {
    expectFilingUrlRejected('https://goodparty.org@sos.example.gov/path')
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

describe('tcrComplianceSuperRefine — non-federal FEC filing URL', () => {
  const expectFilingUrlRejected = (filingUrl: string) => {
    const result = schema().safeParse({ ...localBase, filingUrl })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === 'filingUrl')).toBe(
        true,
      )
    }
  }

  it('rejects an fec.gov filing URL for local office (CampaignVerify: "FEC filing URLs are not allowed")', () => {
    expectFilingUrlRejected('https://www.fec.gov/data/committee/C00950105/')
  })

  it('rejects a docquery.fec.gov filing URL for local office', () => {
    expectFilingUrlRejected(
      'https://docquery.fec.gov/cgi-bin/forms/C00950105/1973838/',
    )
  })

  it('rejects an fec.gov filing URL for state office', () => {
    const result = schema().safeParse({
      officeLevel: OfficeLevel.state,
      filingUrl: 'https://www.fec.gov/data/committee/C00950105/',
    })
    expect(result.success).toBe(false)
  })

  it('does not reject a lookalike host that merely ends in fec.gov', () => {
    const result = schema().safeParse({
      ...localBase,
      filingUrl: 'https://notfec.gov/candidates/jane-doe',
    })
    expect(result.success).toBe(true)
  })

  it('still accepts (and requires) an fec.gov filing URL for federal office', () => {
    const result = schema().safeParse({
      ...federalBase,
      fecCommitteeId: 'C00936328',
    })
    expect(result.success).toBe(true)
  })
})

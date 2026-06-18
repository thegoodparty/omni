import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { CommitteeType, OfficeLevel } from '../../../generated/prisma'
import { tcrComplianceSuperRefine } from './tcrComplianceBase.schema'

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

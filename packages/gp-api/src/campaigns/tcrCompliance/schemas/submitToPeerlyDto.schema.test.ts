import { describe, expect, it } from 'vitest'
import { OfficeLevel } from '../../../generated/prisma'
import { submitToPeerlyFilingSchema } from './submitToPeerlyDto.schema'

const validBase = {
  filingUrl: 'https://sos.example.gov/candidates/jane',
  officeLevel: OfficeLevel.local,
  websiteHost: 'janeforcity.com',
}

describe('submitToPeerlyFilingSchema — persisted filing URL guards', () => {
  const expectFilingUrlRejected = (overrides: {
    filingUrl: string
    officeLevel?: OfficeLevel
    websiteHost?: string
  }) => {
    const result = submitToPeerlyFilingSchema.safeParse({
      ...validBase,
      ...overrides,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === 'filingUrl')).toBe(
        true,
      )
    }
  }

  it('accepts a filing URL on a different host from the website', () => {
    expect(submitToPeerlyFilingSchema.safeParse(validBase).success).toBe(true)
  })

  it('rejects a filing URL that is the candidate own campaign website', () => {
    expectFilingUrlRejected({ filingUrl: 'https://janeforcity.com/about' })
  })

  it('rejects when the website host carries a www. prefix but the host matches', () => {
    expectFilingUrlRejected({
      websiteHost: 'www.janeforcity.com',
      filingUrl: 'https://janeforcity.com/candidate',
    })
  })

  it('rejects a goodparty.org filing URL (shared guard applies here too)', () => {
    expectFilingUrlRejected({
      filingUrl: 'https://goodparty.org/candidate/jane',
    })
  })

  it('rejects a filing URL with userinfo that hides the real host before the @', () => {
    expectFilingUrlRejected({
      filingUrl: 'https://goodparty.org@sos.example.gov/path',
    })
  })

  it('rejects a persisted FEC filing URL for a non-federal record (CampaignVerify: "FEC filing URLs are not allowed")', () => {
    expectFilingUrlRejected({
      filingUrl: 'https://docquery.fec.gov/cgi-bin/forms/C00950105/1973838/',
    })
  })

  it('accepts an fec.gov filing URL for a federal record', () => {
    const result = submitToPeerlyFilingSchema.safeParse({
      ...validBase,
      officeLevel: OfficeLevel.federal,
      filingUrl: 'https://www.fec.gov/data/committee/C00954552/',
    })
    expect(result.success).toBe(true)
  })
})

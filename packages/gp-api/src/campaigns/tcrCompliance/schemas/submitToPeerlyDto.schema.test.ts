import { describe, expect, it } from 'vitest'
import { OfficeLevel } from '../../../generated/prisma'
import { SubmitToPeerlyDto } from './submitToPeerlyDto.schema'

const validBase = {
  ein: '12-3456789',
  committeeName: 'Friends of Jane',
  filingUrl: 'https://sos.example.gov/candidates/jane',
  email: 'jane@example.com',
  phone: '+14155552671',
  officeLevel: OfficeLevel.local,
  websiteUrl: 'https://janeforcity.com',
}

describe('SubmitToPeerlyDto — filingUrl vs campaign website', () => {
  const expectFilingUrlRejected = (overrides: {
    filingUrl: string
    websiteUrl?: string
  }) => {
    const result = SubmitToPeerlyDto.schema.safeParse({
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
    expect(SubmitToPeerlyDto.schema.safeParse(validBase).success).toBe(true)
  })

  it('rejects a filing URL that is the candidate own campaign website', () => {
    expectFilingUrlRejected({ filingUrl: 'https://janeforcity.com/about' })
  })

  it('rejects when the website carries a www. prefix but the host matches', () => {
    expectFilingUrlRejected({
      websiteUrl: 'https://www.janeforcity.com',
      filingUrl: 'https://janeforcity.com/candidate',
    })
  })

  it('rejects a goodparty.org filing URL (shared guard applies here too)', () => {
    expectFilingUrlRejected({
      filingUrl: 'https://goodparty.org/candidate/jane',
    })
  })
})

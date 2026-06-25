import { describe, expect, it } from 'vitest'
import { VoterFileFilter } from '../../generated/prisma'
import { VoterFileFilterService } from './voterFileFilter.service'

const filter = (overrides: Partial<VoterFileFilter>): VoterFileFilter =>
  ({
    id: 1,
    organizationSlug: 'campaign-1',
    name: 'My List',
    ...overrides,
  }) as VoterFileFilter

describe('voterFileFilterToAudience', () => {
  const service = new VoterFileFilterService()

  it('maps genderUnknown to the gender_unknown filter', async () => {
    const audience = await service.voterFileFilterToAudience(
      filter({ genderUnknown: true }),
    )

    expect(audience).toEqual({ gender_unknown: true })
  })

  it('maps the rich list fields backed by an L2 column', async () => {
    const audience = await service.voterFileFilterToAudience(
      filter({
        hasCellPhone: true,
        hasLandline: true,
        ethnicityEuropean: true,
        ethnicityAsian: true,
        ethnicityHispanic: true,
        ethnicityAfricanAmerican: true,
      }),
    )

    expect(audience).toEqual({
      has_cell_phone: true,
      has_landline: true,
      ethnicity_european: true,
      ethnicity_asian: true,
      ethnicity_hispanic: true,
      ethnicity_african_american: true,
    })
  })
})

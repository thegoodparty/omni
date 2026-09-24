import { describe, expect, it } from 'vitest'
import { User } from '../../generated/prisma'
import { CampaignWith } from '@/campaigns/campaigns.types'
import { ownerCandidateName } from './ownerCandidateName.util'

const campaignWithOwner = (user: Partial<User> | null) =>
  ({ id: 1, user }) as CampaignWith<'user'>

describe('ownerCandidateName', () => {
  it("returns the owner's full name from the user relation", () => {
    expect(
      ownerCandidateName(
        campaignWithOwner({
          firstName: 'Jared',
          lastName: 'Smith',
          name: null,
        }),
      ),
    ).toBe('Jared Smith')
  })

  it('falls back to the display name when first/last are absent', () => {
    expect(
      ownerCandidateName(
        campaignWithOwner({
          firstName: null,
          lastName: null,
          name: 'Jared Smith',
        }),
      ),
    ).toBe('Jared Smith')
  })

  it('returns an empty string when the owner has no usable name', () => {
    expect(
      ownerCandidateName(
        campaignWithOwner({ firstName: null, lastName: null, name: null }),
      ),
    ).toBe('')
    expect(ownerCandidateName(campaignWithOwner(null))).toBe('')
  })
})

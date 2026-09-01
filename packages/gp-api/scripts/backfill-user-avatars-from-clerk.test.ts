import { describe, expect, it } from 'vitest'
import { isEligibleForAvatarBackfill } from './backfill-user-avatars-from-clerk'

describe('isEligibleForAvatarBackfill', () => {
  it('accepts a linked user with no avatar', () => {
    expect(
      isEligibleForAvatarBackfill({ clerkId: 'user_1', avatar: null }),
    ).toBe(true)
  })

  it('rejects a user who already has an avatar', () => {
    expect(
      isEligibleForAvatarBackfill({
        clerkId: 'user_1',
        avatar: 'https://assets.goodparty.org/uploads/1/a.png',
      }),
    ).toBe(false)
  })

  it('accepts a user whose avatar is an empty string', () => {
    expect(isEligibleForAvatarBackfill({ clerkId: 'user_1', avatar: '' })).toBe(
      true,
    )
  })

  it('accepts a user whose avatar is only whitespace', () => {
    expect(
      isEligibleForAvatarBackfill({ clerkId: 'user_1', avatar: '   ' }),
    ).toBe(true)
  })

  it('rejects an unlinked user', () => {
    expect(isEligibleForAvatarBackfill({ clerkId: null, avatar: null })).toBe(
      false,
    )
  })
})

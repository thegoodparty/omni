import { describe, expect, it } from 'vitest'
import {
  isEligibleForAvatarBackfill,
  mapClerkBatchToOutcomes,
} from './backfill-user-avatars-from-clerk'

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

describe('mapClerkBatchToOutcomes', () => {
  it('returns the image url for a user Clerk has an image for', () => {
    const outcomes = mapClerkBatchToOutcomes(
      ['user_1'],
      [{ id: 'user_1', hasImage: true, imageUrl: 'https://img.clerk/1.png' }],
    )

    expect(outcomes.get('user_1')).toEqual({
      status: 'image',
      url: 'https://img.clerk/1.png',
    })
  })

  it('returns noImage for a returned user whose hasImage is false', () => {
    const outcomes = mapClerkBatchToOutcomes(
      ['user_1'],
      [{ id: 'user_1', hasImage: false, imageUrl: 'https://img.clerk/1.png' }],
    )

    expect(outcomes.get('user_1')).toEqual({ status: 'noImage' })
  })

  it('returns providerMiss for an id Clerk did not return', () => {
    const outcomes = mapClerkBatchToOutcomes(['user_1', 'user_2'], [])

    expect(outcomes.get('user_1')).toEqual({ status: 'providerMiss' })
    expect(outcomes.get('user_2')).toEqual({ status: 'providerMiss' })
  })

  it('classifies a mixed batch per id', () => {
    const outcomes = mapClerkBatchToOutcomes(
      ['user_1', 'user_2', 'user_3'],
      [
        { id: 'user_1', hasImage: true, imageUrl: 'https://img.clerk/1.png' },
        { id: 'user_2', hasImage: false, imageUrl: 'https://img.clerk/2.png' },
      ],
    )

    expect([...outcomes.entries()]).toEqual([
      ['user_1', { status: 'image', url: 'https://img.clerk/1.png' }],
      ['user_2', { status: 'noImage' }],
      ['user_3', { status: 'providerMiss' }],
    ])
  })

  it('ignores users Clerk returned that were not asked for', () => {
    const outcomes = mapClerkBatchToOutcomes(
      ['user_1'],
      [
        { id: 'user_1', hasImage: false, imageUrl: '' },
        { id: 'user_9', hasImage: true, imageUrl: 'https://img.clerk/9.png' },
      ],
    )

    expect(outcomes.size).toBe(1)
    expect(outcomes.get('user_1')).toEqual({ status: 'noImage' })
  })
})

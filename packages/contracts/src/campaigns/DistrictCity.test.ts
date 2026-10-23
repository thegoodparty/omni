import { describe, expect, it } from 'vitest'
import { cityFromDistrictName } from './DistrictCity'

describe('cityFromDistrictName', () => {
  it.each([
    ['Fayetteville Ward 4', 'Fayetteville'],
    ['City of Kyle', 'Kyle'],
    ['Pocatello City (Est.)', 'Pocatello'],
    ['Dubuque City Ward 3', 'Dubuque'],
    ['Ward Town', 'Ward'],
    ['Council City (Est.)', 'Council'],
  ])('names the place in %s', (district, place) => {
    expect(cityFromDistrictName(district)).toBe(place)
  })

  it.each(['05', ''])('names no place for %s', (district) => {
    expect(cityFromDistrictName(district)).toBeNull()
  })
})
